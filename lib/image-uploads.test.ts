import { describe, expect, it } from "vitest";
import {
  applyImageUrlMap,
  fileNameForUrl,
  imageUploadKey,
  isHubspotHostedUrl,
  matchExistingFiles,
  planImageUploads,
} from "./image-uploads";

const cols = { advisors: { photo: { folderPath: "/hubdb-importer/advisors" } } };

describe("isHubspotHostedUrl", () => {
  it("recognizes File Manager hosts and hubfs paths", () => {
    expect(isHubspotHostedUrl("https://123.fs1.hubspotusercontent-na1.net/hubfs/123/a.jpg")).toBe(true);
    expect(isHubspotHostedUrl("https://cdn2.hubspot.net/hubfs/123/a.jpg")).toBe(true);
    expect(isHubspotHostedUrl("https://www.example.com/hubfs/a.jpg")).toBe(true);
    expect(isHubspotHostedUrl("https://example.com/wp-content/a.jpg")).toBe(false);
    expect(isHubspotHostedUrl("not a url")).toBe(false);
  });
});

describe("planImageUploads", () => {
  it("dedupes per folder, trims, and skips empty / non-http / already-hosted cells", () => {
    const tasks = planImageUploads(
      {
        advisors: [
          { slug: "a", photo: " https://x.com/a.jpg " },
          { slug: "b", photo: "https://x.com/a.jpg" },
          { slug: "c", photo: "" },
          { slug: "d", photo: "a.jpg" },
          { slug: "e", photo: "https://cdn2.hubspot.net/hubfs/1/e.jpg" },
          { slug: "f", photo: "https://x.com/f.jpg" },
        ],
        other: [{ photo: "https://x.com/ignored.jpg" }],
      },
      cols,
    );
    expect(tasks.map((t) => t.url)).toEqual(["https://x.com/a.jpg", "https://x.com/f.jpg"]);
    expect(tasks[0]).toMatchObject({ folderPath: "/hubdb-importer/advisors" });
  });
});

describe("applyImageUrlMap", () => {
  it("swaps uploaded cells, keeps failed ones, and leaves untouched rows/tables as-is", () => {
    const source = {
      advisors: [
        { slug: "a", photo: "https://x.com/a.jpg" },
        { slug: "b", photo: "https://x.com/failed.jpg" },
      ],
      locations: [{ slug: "l" }],
    };
    const out = applyImageUrlMap(source, cols, {
      [imageUploadKey("/hubdb-importer/advisors", "https://x.com/a.jpg")]: "https://hubfs/a.jpg",
    });
    expect(out.advisors).toEqual([
      { slug: "a", photo: "https://hubfs/a.jpg" },
      { slug: "b", photo: "https://x.com/failed.jpg" },
    ]);
    expect(out.advisors[1]).toBe(source.advisors[1]);
    expect(out.locations).toBe(source.locations);
    expect(source.advisors[0].photo).toBe("https://x.com/a.jpg");
  });
});

describe("fileNameForUrl", () => {
  it("uses the decoded last path segment, keeps case, splits off the extension", () => {
    expect(fileNameForUrl("https://x.com/up/2024/07/PCIA-HEADSHOT_900x_Adam-Billings.jpg")).toEqual({
      name: "PCIA-HEADSHOT_900x_Adam-Billings",
      extension: "jpg",
    });
    expect(fileNameForUrl("https://x.com/a/My%20Photo%20(1).PNG?w=300")).toEqual({ name: "My-Photo-1", extension: "png" });
    expect(fileNameForUrl("https://x.com/")).toMatchObject({ extension: null });
  });
});

describe("planImageUploads — file names", () => {
  it("disambiguates different URLs that would share a name in the same folder, deterministically", () => {
    const source = {
      advisors: [
        { photo: "https://x.com/2024/headshot.jpg" },
        { photo: "https://x.com/2025/headshot.jpg" },
        { photo: "https://x.com/2025/unique.jpg" },
      ],
    };
    const a = planImageUploads(source, cols);
    const b = planImageUploads(source, cols);
    expect(a.map((t) => t.fileName)).toEqual(b.map((t) => t.fileName));
    expect(a[0].fileName).not.toBe(a[1].fileName);
    expect(a[0].fileName).toMatch(/^headshot-[0-9a-f]{6}$/);
    expect(a[2].fileName).toBe("unique");
  });
});

describe("matchExistingFiles", () => {
  it("reuses files already in the folder by name + extension (case-insensitive) and leaves the rest", () => {
    const tasks = planImageUploads(
      { advisors: [{ photo: "https://x.com/Adam.jpg" }, { photo: "https://x.com/New.jpg" }] },
      cols,
    );
    const { found, remaining } = matchExistingFiles(tasks, {
      "/hubdb-importer/advisors": [
        { name: "adam", extension: "JPG", url: "https://hubfs/adam.jpg" },
        { name: "New", extension: "png", url: "https://hubfs/new.png" },
      ],
    });
    expect(found).toEqual({ [tasks[0].key]: "https://hubfs/adam.jpg" });
    expect(remaining.map((t) => t.url)).toEqual(["https://x.com/New.jpg"]);
  });

  it("treats .jpeg sources as matching the .jpg HubSpot stored", () => {
    const tasks = planImageUploads({ advisors: [{ photo: "https://x.com/Stock_1.jpeg" }] }, cols);
    const { remaining } = matchExistingFiles(tasks, {
      "/hubdb-importer/advisors": [{ name: "Stock_1", extension: "jpg", url: "https://hubfs/stock.jpg" }],
    });
    expect(remaining).toEqual([]);
  });
});
