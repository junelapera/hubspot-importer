// Pure planning for the "copy images into the File Manager" pre-step.
// The Inngest runner plans the unique (folder, url) pairs, uploads them
// via lib/hubdb/files.ts, then rewrites the synthesized source rows so
// IMAGE cells carry the hubfs URL instead of the external one.

export type ImageColumns = Readonly<Record<string, Readonly<Record<string, { folderPath: string }>>>>;

export type ImageUploadTask = {
  key: string;
  url: string;
  folderPath: string;
  // Deterministic File Manager name (no extension) — sent on upload and
  // used to find the file on re-import. HubSpot's import-from-url ignores
  // duplicateValidationStrategy, so name-in-folder is the only dedupe.
  fileName: string;
  extension: string | null;
};

export type ExistingFile = { name: string; extension: string | null; url: string };

export type ImageUploadFailure = { url: string; folderPath: string; error: string };

export function imageUploadKey(folderPath: string, url: string): string {
  return `${folderPath}\n${url}`;
}

// Already in some portal's File Manager — re-uploading would just copy
// the file across portals (or into itself), so leave these as-is.
export function isHubspotHostedUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const host = u.hostname.toLowerCase();
  return (
    /(^|\.)hubspotusercontent[a-z0-9-]*\.(net|com)$/.test(host) ||
    /(^|\.)hubspot\.net$/.test(host) ||
    u.pathname.startsWith("/hubfs/") ||
    u.pathname.startsWith("/hs-fs/hubfs/")
  );
}

function uploadableUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const url = raw.trim();
  if (!/^https?:\/\//i.test(url)) return null;
  if (isHubspotHostedUrl(url)) return null;
  return url;
}

// FNV-1a — tiny, dependency-free, stable across runs. Only used to
// disambiguate file-name collisions, not for security.
function shortHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0").slice(0, 6);
}

/**
 * File Manager name for a source URL: the URL's last path segment, minus
 * extension, with anything outside [A-Za-z0-9._-] turned into "-". Kept
 * case-preserving so it matches what HubSpot derived for files uploaded
 * before names were sent explicitly.
 */
export function fileNameForUrl(url: string): { name: string; extension: string | null } {
  let segment = "";
  try {
    segment = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
  } catch {
    segment = "";
  }
  try {
    segment = decodeURIComponent(segment);
  } catch {
    // Malformed escape — keep the raw segment.
  }
  const dot = segment.lastIndexOf(".");
  const rawName = dot > 0 ? segment.slice(0, dot) : segment;
  const extension = dot > 0 ? segment.slice(dot + 1).toLowerCase() || null : null;
  const name = rawName.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || `image-${shortHash(url)}`;
  return { name, extension };
}

/** Unique upload tasks across every enabled IMAGE column, in first-seen order. */
export function planImageUploads(
  source: Readonly<Record<string, ReadonlyArray<Record<string, unknown>>>>,
  imageColumns: ImageColumns,
): ImageUploadTask[] {
  const seen = new Set<string>();
  const tasks: ImageUploadTask[] = [];
  for (const [table, cols] of Object.entries(imageColumns)) {
    for (const row of source[table] ?? []) {
      for (const [col, { folderPath }] of Object.entries(cols)) {
        const url = uploadableUrl(row[col]);
        if (!url) continue;
        const key = imageUploadKey(folderPath, url);
        if (seen.has(key)) continue;
        seen.add(key);
        const { name, extension } = fileNameForUrl(url);
        tasks.push({ key, url, folderPath, fileName: name, extension });
      }
    }
  }
  // Two different URLs landing on the same name in one folder would
  // overwrite each other (uploads use overwrite: true). Suffix every
  // colliding one with a hash of its URL — deterministic, so re-imports
  // find the same files again.
  const byName = new Map<string, ImageUploadTask[]>();
  for (const t of tasks) {
    const k = `${t.folderPath}\n${t.fileName.toLowerCase()}.${t.extension ?? ""}`;
    byName.set(k, [...(byName.get(k) ?? []), t]);
  }
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    for (const t of group) t.fileName = `${t.fileName}-${shortHash(t.url)}`;
  }
  return tasks;
}

// HubSpot normalizes some extensions on upload (e.g. a `.jpeg` source is
// stored as `.jpg`), so compare extensions through this alias map.
const EXTENSION_ALIASES: Record<string, string> = { jpeg: "jpg", jpe: "jpg", tif: "tiff" };
function sameExtension(a: string | null, b: string | null): boolean {
  const norm = (e: string | null) => {
    const lc = (e ?? "").toLowerCase();
    return EXTENSION_ALIASES[lc] ?? lc;
  };
  return norm(a) === norm(b);
}

/**
 * Splits tasks into ones whose file already sits in its destination folder
 * (matched by name + extension, case-insensitive) and ones still to upload.
 */
export function matchExistingFiles(
  tasks: readonly ImageUploadTask[],
  existingByFolder: Readonly<Record<string, readonly ExistingFile[]>>,
): { found: Record<string, string>; remaining: ImageUploadTask[] } {
  const index = new Map<string, Map<string, ExistingFile[]>>();
  for (const [folder, files] of Object.entries(existingByFolder)) {
    const byName = new Map<string, ExistingFile[]>();
    for (const f of files) {
      const n = f.name.toLowerCase();
      byName.set(n, [...(byName.get(n) ?? []), f]);
    }
    index.set(folder, byName);
  }
  const found: Record<string, string> = {};
  const remaining: ImageUploadTask[] = [];
  for (const t of tasks) {
    const candidates = index.get(t.folderPath)?.get(t.fileName.toLowerCase()) ?? [];
    const match = t.extension
      ? candidates.find((f) => sameExtension(f.extension, t.extension))
      : candidates.length === 1
        ? candidates[0]
        : undefined;
    if (match) found[t.key] = match.url;
    else remaining.push(t);
  }
  return { found, remaining };
}

/**
 * Copy of `source` with uploaded IMAGE cells swapped for their hubfs URL.
 * Cells whose upload failed (no entry in `uploaded`) keep the original
 * external URL — the import still lands, the failure is reported apart.
 */
export function applyImageUrlMap(
  source: Readonly<Record<string, ReadonlyArray<Record<string, unknown>>>>,
  imageColumns: ImageColumns,
  uploaded: Readonly<Record<string, string>>,
): Record<string, Record<string, unknown>[]> {
  const out: Record<string, Record<string, unknown>[]> = {};
  for (const [table, rows] of Object.entries(source)) {
    const cols = imageColumns[table];
    if (!cols) {
      out[table] = rows as Record<string, unknown>[];
      continue;
    }
    out[table] = rows.map((row) => {
      let next: Record<string, unknown> | null = null;
      for (const [col, { folderPath }] of Object.entries(cols)) {
        const url = uploadableUrl(row[col]);
        if (!url) continue;
        const hosted = uploaded[imageUploadKey(folderPath, url)];
        if (!hosted) continue;
        next ??= { ...row };
        next[col] = hosted;
      }
      return next ?? row;
    });
  }
  return out;
}
