import { describe, expect, it } from "vitest";
import { createHubdbClient } from "./client";
import { importFileFromUrl, listFolderFiles, uploadImages } from "./files";
import { imageUploadKey } from "../image-uploads";

type Handler = (url: string, init: RequestInit) => { status: number; body: unknown };

function client(handler: Handler) {
  const calls: { url: string; body?: unknown }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const { status, body } = handler(url, init);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof globalThis.fetch;
  return {
    calls,
    client: createHubdbClient({ token: "t", fetch, sleep: async () => {}, retry: { maxAttempts: 1 } }),
  };
}

const noSleep = { sleep: async () => {}, pollIntervalMs: 0 };

describe("importFileFromUrl", () => {
  it("queues the import into the folder, polls until COMPLETE, and returns the hubfs url", async () => {
    let polls = 0;
    const { client: c, calls } = client((url) => {
      if (url.endsWith("/files/v3/files/import-from-url/async")) return { status: 202, body: { id: "task-1" } };
      polls++;
      return polls < 3
        ? { status: 200, body: { status: "PROCESSING" } }
        : { status: 200, body: { status: "COMPLETE", result: { url: "https://hubfs/a.jpg" } } };
    });
    const url = await importFileFromUrl(c, { url: "https://x.com/a.jpg", folderPath: "/f", fileName: "a" }, noSleep);
    expect(url).toBe("https://hubfs/a.jpg");
    expect(calls[0].body).toMatchObject({ url: "https://x.com/a.jpg", folderPath: "/f", name: "a", overwrite: true });
    expect(calls.at(-1)?.url).toContain("/files/v3/files/import-from-url/async/tasks/task-1/status");
  });

  it("throws the task's error when HubSpot cancels it", async () => {
    const { client: c } = client((url) =>
      url.endsWith("/async")
        ? { status: 202, body: { id: "t" } }
        : { status: 200, body: { status: "CANCELED", errors: [{ message: "404 fetching url" }] } },
    );
    await expect(importFileFromUrl(c, { url: "https://x.com/a.jpg", folderPath: "/f" }, noSleep)).rejects.toThrow(
      "404 fetching url",
    );
  });
});

describe("uploadImages", () => {
  it("collects per-file failures instead of throwing", async () => {
    const { client: c } = client((url, init) => {
      if (url.endsWith("/async")) {
        const body = JSON.parse(String(init.body)) as { url: string };
        return body.url.includes("bad")
          ? { status: 400, body: { message: "bad url" } }
          : { status: 202, body: { id: "ok" } };
      }
      return { status: 200, body: { status: "COMPLETE", result: { url: "https://hubfs/good.jpg" } } };
    });
    const tasks = [
      { key: imageUploadKey("/f", "https://x.com/good.jpg"), url: "https://x.com/good.jpg", folderPath: "/f", fileName: "good", extension: "jpg" },
      { key: imageUploadKey("/f", "https://x.com/bad.jpg"), url: "https://x.com/bad.jpg", folderPath: "/f", fileName: "bad", extension: "jpg" },
    ];
    const res = await uploadImages(c, tasks, noSleep);
    expect(res.uploaded).toEqual({ [tasks[0].key]: "https://hubfs/good.jpg" });
    expect(res.failures).toEqual([{ url: "https://x.com/bad.jpg", folderPath: "/f", error: "400: bad url" }]);
  });

  it("reports a missing files scope once and stops calling the API", async () => {
    const { client: c, calls } = client(() => ({
      status: 403,
      body: { category: "MISSING_SCOPES", message: "missing scopes" },
    }));
    const tasks = ["a", "b", "c"].map((n) => ({
      key: imageUploadKey("/f", `https://x.com/${n}.jpg`),
      url: `https://x.com/${n}.jpg`,
      folderPath: "/f",
      fileName: n,
      extension: "jpg",
    }));
    const res = await uploadImages(c, tasks, { ...noSleep, concurrency: 1 });
    expect(calls).toHaveLength(1);
    expect(res.failures).toHaveLength(3);
    expect(res.failures.every((f) => f.error.includes("`files` scope"))).toBe(true);
  });
});

describe("listFolderFiles", () => {
  it("resolves the folder by exact path, paginates, and drops files outside it", async () => {
    const { client: c, calls } = client((url) => {
      if (url.includes("/folders/search")) {
        return { status: 200, body: { results: [{ id: "9", path: "/other/Advisors" }, { id: "7", path: "/hubdb-importer/Advisors" }] } };
      }
      if (!url.includes("after=")) {
        return {
          status: 200,
          body: {
            results: [{ name: "a", extension: "jpg", url: "https://hubfs/a.jpg", path: "/hubdb-importer/Advisors/a.jpg" }],
            paging: { next: { after: "p2" } },
          },
        };
      }
      return {
        status: 200,
        body: { results: [{ name: "stray", extension: "jpg", url: "https://hubfs/s.jpg", path: "/elsewhere/stray.jpg" }] },
      };
    });
    const files = await listFolderFiles(c, "/hubdb-importer/Advisors");
    expect(files).toEqual([{ name: "a", extension: "jpg", url: "https://hubfs/a.jpg" }]);
    expect(calls[1].url).toContain("parentFolderIds=7");
  });

  it("returns [] when the folder doesn't exist yet", async () => {
    const { client: c } = client(() => ({ status: 200, body: { results: [] } }));
    expect(await listFolderFiles(c, "/hubdb-importer/New")).toEqual([]);
  });
});
