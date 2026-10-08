import { HubdbError, type HubdbClient } from "./client";
import type { ExistingFile, ImageUploadFailure, ImageUploadTask } from "../image-uploads";

// HubSpot Files API — import-from-url. The POST only queues the copy; the
// task has to be polled until COMPLETE, at which point `result.url` is the
// File Manager (hubfs) URL. Requires the private app's `files` scope.

type TaskLocator = { id: string };
type TaskStatus = {
  status: "PENDING" | "PROCESSING" | "CANCELED" | "COMPLETE" | string;
  result?: { id?: string; url?: string };
  errors?: { message?: string }[];
};

export class FilesScopeError extends Error {
  constructor() {
    super(
      "the portal's private app token is missing the `files` scope — add it in HubSpot " +
        "(Settings → Integrations → Private Apps → Scopes) to upload images",
    );
    this.name = "FilesScopeError";
  }
}

export type ImportFromUrlOptions = {
  pollIntervalMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function isMissingScope(err: unknown): boolean {
  if (!(err instanceof HubdbError) || err.status !== 403) return false;
  const body = err.responseBody as { category?: string } | null;
  return body?.category === "MISSING_SCOPES";
}

function describe(err: unknown): string {
  if (err instanceof HubdbError) {
    const body = err.responseBody as { message?: string } | null;
    return body?.message ? `${err.status}: ${body.message}` : err.message;
  }
  return (err as Error).message;
}

type FolderSearch = { results?: { id: string; path?: string }[] };
type FileSearch = {
  results?: { name?: string; extension?: string; url?: string; path?: string; archived?: boolean }[];
  paging?: { next?: { after?: string } };
};

/**
 * Every file directly inside `folderPath` (empty when the folder doesn't
 * exist yet). Used before uploading so a re-import reuses files instead of
 * creating `photo-1.jpg`, `photo-2.jpg`, … — HubSpot's import-from-url
 * ignores duplicateValidationStrategy. Results are path-checked because
 * the search API silently ignores filters it doesn't understand.
 */
export async function listFolderFiles(client: HubdbClient, folderPath: string): Promise<ExistingFile[]> {
  const path = folderPath.replace(/\/+$/, "");
  const segment = path.split("/").filter(Boolean).pop();
  if (!segment) return [];
  const folders = await client.request<FolderSearch>("/folders/search", {
    base: "files",
    query: { name: segment, limit: 100 },
  });
  const folder = folders.results?.find((f) => f.path === path);
  if (!folder) return [];

  const out: ExistingFile[] = [];
  let after: string | undefined;
  do {
    const page = await client.request<FileSearch>("/files/search", {
      base: "files",
      query: { parentFolderIds: folder.id, limit: 100, after },
    });
    for (const f of page.results ?? []) {
      if (!f.url || !f.name || f.archived) continue;
      if (f.path && !f.path.startsWith(`${path}/`)) continue;
      out.push({ name: f.name, extension: f.extension ?? null, url: f.url });
    }
    after = page.paging?.next?.after;
  } while (after);
  return out;
}

/** Copies one URL into the File Manager and returns its hubfs URL. */
export async function importFileFromUrl(
  client: HubdbClient,
  input: { url: string; folderPath: string; fileName?: string },
  opts: ImportFromUrlOptions = {},
): Promise<string> {
  const sleep = opts.sleep ?? defaultSleep;
  const pollIntervalMs = opts.pollIntervalMs ?? 1000;
  const deadline = Date.now() + (opts.timeoutMs ?? 60_000);

  const task = await client.request<TaskLocator>("/files/import-from-url/async", {
    base: "files",
    method: "POST",
    body: {
      url: input.url,
      folderPath: input.folderPath,
      access: "PUBLIC_INDEXABLE",
      // Fixed name + overwrite keeps one file per image: a re-upload that
      // slipped past listFolderFiles replaces it in place (same hubfs path)
      // instead of becoming `photo-1.jpg`. duplicateValidationStrategy is
      // ignored by this endpoint, so it isn't sent.
      ...(input.fileName ? { name: input.fileName, overwrite: true } : {}),
    },
  });

  for (;;) {
    const status = await client.request<TaskStatus>(
      `/files/import-from-url/async/tasks/${encodeURIComponent(task.id)}/status`,
      { base: "files" },
    );
    if (status.status === "COMPLETE") {
      if (status.result?.url) return status.result.url;
      throw new Error(
        status.errors?.map((e) => e.message).filter(Boolean).join("; ") || "upload finished without a file URL",
      );
    }
    if (status.status === "CANCELED") {
      throw new Error(status.errors?.map((e) => e.message).filter(Boolean).join("; ") || "upload was canceled");
    }
    if (Date.now() > deadline) throw new Error("timed out waiting for HubSpot to process the file");
    await sleep(pollIntervalMs);
  }
}

export type UploadImagesResult = {
  uploaded: Record<string, string>;
  failures: ImageUploadFailure[];
};

/**
 * Uploads `tasks` with bounded concurrency. Per-file failures are collected,
 * not thrown — the caller keeps the original URL for those cells. A missing
 * `files` scope fails every remaining task with one clear message instead
 * of N identical 403s.
 */
export async function uploadImages(
  client: HubdbClient,
  tasks: readonly ImageUploadTask[],
  opts: ImportFromUrlOptions & { concurrency?: number } = {},
): Promise<UploadImagesResult> {
  const uploaded: Record<string, string> = {};
  const failures: ImageUploadFailure[] = [];
  let scopeError: FilesScopeError | null = null;
  let next = 0;

  async function worker() {
    while (next < tasks.length) {
      const t = tasks[next++];
      if (scopeError) {
        failures.push({ url: t.url, folderPath: t.folderPath, error: scopeError.message });
        continue;
      }
      try {
        uploaded[t.key] = await importFileFromUrl(client, t, opts);
      } catch (err) {
        if (isMissingScope(err)) scopeError ??= new FilesScopeError();
        failures.push({
          url: t.url,
          folderPath: t.folderPath,
          error: isMissingScope(err) ? scopeError!.message : describe(err),
        });
      }
    }
  }

  const n = Math.max(1, Math.min(opts.concurrency ?? 4, tasks.length));
  await Promise.all(Array.from({ length: n }, worker));
  return { uploaded, failures };
}
