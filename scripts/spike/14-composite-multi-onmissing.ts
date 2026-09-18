import { client, log, runSpike } from "./client";
import {
  deleteTable,
  fetchPortalSchema,
  ImportFailFastError,
  importRows,
  listAllDraftRows,
  opsFromClient,
  opsFromClientForImport,
  provision,
} from "../../lib/hubdb";
import { diffSchema, parseSchema } from "../../lib/schema";

// End-to-end sandbox exercise for the last three lib additions:
//   1. Composite naturalKey on the main table (upsert by (slug, variant))
//   2. Multi-value FK cell split (tags = "featured,new" splits on `,`)
//   3. onMissing="null" (unresolved token drops the FK column, row still inserts)
//   4. onMissing="fail" (unresolved token throws ImportFailFastError, everything after aborts)
//
// Uses namespaced tables to avoid colliding with the Phase-0 brands/categories/products.

const NAMESPACE = `smoke_${Date.now()}`;
const TAGS = `${NAMESPACE}_tags`;
const POSTS = `${NAMESPACE}_posts`;

async function cleanup(): Promise<void> {
  const snap = await fetchPortalSchema(client);
  // Delete posts first (has FK cols referencing tags)
  for (const name of [POSTS, TAGS]) {
    const t = snap.tables.find((x) => x.name === name);
    if (!t) continue;
    try {
      await deleteTable(client, t.id);
    } catch (err) {
      log(`cleanup ${name}: failed`, (err as Error).message);
    }
  }
}

runSpike(async () => {
  await cleanup();
  log("using namespace", NAMESPACE);

  const schema = parseSchema({
    version: 1,
    tables: [
      {
        name: TAGS,
        label: TAGS,
        naturalKey: "slug",
        columns: [{ name: "slug", label: "Slug", type: "TEXT" }],
      },
      {
        name: POSTS,
        label: POSTS,
        // Composite naturalKey: (slug, variant) upserts identify a row.
        naturalKey: ["slug", "variant"],
        columns: [
          { name: "slug", label: "Slug", type: "TEXT" },
          { name: "variant", label: "Variant", type: "TEXT" },
          { name: "title", label: "Title", type: "TEXT" },
          {
            name: "tags",
            label: "Tags",
            type: "FOREIGN_ID",
            foreignTable: TAGS,
            foreignColumn: "slug",
          },
        ],
      },
    ],
  });

  // ── Step 1: diff + provision (empty portal side; both tables new) ──
  const before = await fetchPortalSchema(client);
  const plan = diffSchema(schema, before.tables);
  log("step-1 plan", {
    ok: plan.ok,
    actions: plan.tables.map((t) => ({ name: t.name, action: t.action })),
  });
  if (!plan.ok) throw new Error("plan has conflicts");

  const provisionEvents: string[] = [];
  const provisionResult = await provision(opsFromClient(client), plan, {
    onEvent: (e) => provisionEvents.push(`${e.kind}:${e.table}`),
  });
  log("step-1 provision", {
    order: provisionResult.order,
    tableIds: provisionResult.tableIds,
    events: provisionEvents,
  });

  // ── Step 2: import (composite NK + multi-value FK + onMissing="null") ──
  //
  // - "featured" and "new" exist as tag rows
  // - Row 3 posts references a mix of resolved ("featured") and unresolved
  //   ("nonexistent") tokens; onMissing="null" should drop the whole
  //   `tags` column from row 3 while inserting the rest of the row.
  const tags = [{ slug: "featured" }, { slug: "new" }];
  const posts = [
    { slug: "post-a", variant: "v1", title: "Post A / v1", tags: "featured,new" },
    { slug: "post-a", variant: "v2", title: "Post A / v2", tags: "featured" },
    { slug: "post-b", variant: "v1", title: "Post B / v1", tags: "featured,nonexistent" },
  ];

  const importEvents: string[] = [];
  const importResult = await importRows(
    opsFromClientForImport(client),
    {
      schema,
      tableIds: provisionResult.tableIds,
      source: { [TAGS]: tags, [POSTS]: posts },
      fkOptions: {
        [POSTS]: { tags: { multi: true, delimiter: ",", onMissing: "null" } },
      },
    },
    { onEvent: (e) => importEvents.push(`${e.kind}:${e.table}`) },
  );
  log("step-2 import result", {
    ok: importResult.ok,
    tables: importResult.tables.map((t) => ({
      name: t.name,
      created: t.created,
      updated: t.updated,
      skipped: t.skipped,
      errors: t.errors.length,
    })),
    events: importEvents,
  });
  if (!importResult.ok) {
    log("step-2 row errors", importResult.tables.flatMap((t) => t.errors));
    throw new Error("import had row errors");
  }

  // ── Step 3: verify composite-NK identity + null-drop behavior ──
  const draftPosts = await listAllDraftRows(client, provisionResult.tableIds[POSTS]);
  if (draftPosts.length !== 3) {
    throw new Error(`expected 3 posts, got ${draftPosts.length}`);
  }

  const postAv1 = draftPosts.find(
    (r) => r.values["slug"] === "post-a" && r.values["variant"] === "v1",
  );
  const postAv2 = draftPosts.find(
    (r) => r.values["slug"] === "post-a" && r.values["variant"] === "v2",
  );
  const postBv1 = draftPosts.find(
    (r) => r.values["slug"] === "post-b" && r.values["variant"] === "v1",
  );
  if (!postAv1 || !postAv2 || !postBv1) {
    throw new Error("could not find all 3 posts by (slug, variant)");
  }

  const av1Tags = postAv1.values["tags"] as { id: string }[] | undefined;
  const av2Tags = postAv2.values["tags"] as { id: string }[] | undefined;
  const bv1Tags = postBv1.values["tags"] as { id: string }[] | undefined;
  log("step-3 tag cells", {
    "post-a/v1": Array.isArray(av1Tags) ? av1Tags.length : null,
    "post-a/v2": Array.isArray(av2Tags) ? av2Tags.length : null,
    "post-b/v1": Array.isArray(bv1Tags) ? bv1Tags.length : "absent/null",
  });
  if (!Array.isArray(av1Tags) || av1Tags.length !== 2) {
    throw new Error(`post-a/v1 expected 2 tag refs, got ${JSON.stringify(av1Tags)}`);
  }
  if (!Array.isArray(av2Tags) || av2Tags.length !== 1) {
    throw new Error(`post-a/v2 expected 1 tag ref, got ${JSON.stringify(av2Tags)}`);
  }
  // The null-drop assertion: whatever HubDB returns for post-b/v1's tags,
  // it should NOT be a populated array (the executor dropped the whole
  // cell because one token was missing).
  if (Array.isArray(bv1Tags) && bv1Tags.length > 0) {
    throw new Error(
      `post-b/v1 should have empty/absent tags under onMissing="null", got ${JSON.stringify(bv1Tags)}`,
    );
  }
  log("step-3 verified", { compositeNk: "ok", multiValueSplit: "ok", nullPolicy: "ok" });

  // ── Step 4: re-import same 3 posts → prove composite upsert (0 create / 3 update) ──
  const rerun = await importRows(opsFromClientForImport(client), {
    schema,
    tableIds: provisionResult.tableIds,
    source: { [TAGS]: tags, [POSTS]: posts },
    fkOptions: {
      [POSTS]: { tags: { multi: true, delimiter: ",", onMissing: "null" } },
    },
  });
  const rerunPosts = rerun.tables.find((t) => t.name === POSTS);
  log("step-4 idempotency", {
    tags: rerun.tables.find((t) => t.name === TAGS),
    posts: rerunPosts,
  });
  if (rerunPosts?.created !== 0 || rerunPosts?.updated !== 3) {
    throw new Error(
      `composite upsert misidentified: created=${rerunPosts?.created} updated=${rerunPosts?.updated}`,
    );
  }

  // ── Step 5: onMissing="fail" — a new orphan post should abort the run ──
  //
  // Add "post-c/v1" with a missing tag under fail policy. Expect
  // ImportFailFastError; the tags table should not be touched (already
  // synced from step 2), and posts should have the failing row logged.
  let failFast: ImportFailFastError | null = null;
  try {
    await importRows(opsFromClientForImport(client), {
      schema,
      tableIds: provisionResult.tableIds,
      source: {
        [TAGS]: tags,
        [POSTS]: [
          ...posts,
          { slug: "post-c", variant: "v1", title: "Post C / v1", tags: "does-not-exist" },
        ],
      },
      fkOptions: {
        [POSTS]: { tags: { multi: true, delimiter: ",", onMissing: "fail" } },
      },
    });
  } catch (err) {
    if (err instanceof ImportFailFastError) failFast = err;
    else throw err;
  }
  if (!failFast) throw new Error("expected ImportFailFastError, got none");
  log("step-5 fail-fast", {
    row: failFast.row,
    partial: failFast.partial.tables.map((t) => ({
      name: t.name,
      created: t.created,
      updated: t.updated,
      skipped: t.skipped,
      errors: t.errors.length,
    })),
    ok: failFast.partial.ok,
  });
  // Note: fail-fast fires on post-b/v1 (sourceIndex=2), the FIRST orphan
  // in row order — NOT post-c that we just appended. Under "fail" the
  // policy applies to every row, so re-running the null-tolerant orphan
  // as fail-mode aborts before we ever reach post-c. That's the correct
  // fail-fast semantic; if this ever ran to post-c it would mean the
  // executor was skipping earlier failures, which is what "fail" is
  // meant to prevent.
  if (failFast.row.sourceIndex !== 2 || failFast.row.column !== "tags") {
    throw new Error(
      `fail-fast row mismatch: sourceIndex=${failFast.row.sourceIndex} column=${failFast.row.column}`,
    );
  }

  // ── Step 6: onMissing="create-stub" — insert stubs mid-flight ──
  //
  // Re-run with a new post whose tags reference "unlaunched" (missing).
  // Under create-stub, importOneTable should:
  //   - Detect the missing "unlaunched" token during planning
  //   - Batch-insert a stub tags row with slug="unlaunched"
  //   - Re-plan and finish with the FK resolved
  // Confirm by counting tag rows (3 = featured/new + stub) and by
  // reading back the new post's tags cell.
  const stubResult = await importRows(opsFromClientForImport(client), {
    schema,
    tableIds: provisionResult.tableIds,
    source: {
      [TAGS]: tags,
      [POSTS]: [
        { slug: "post-d", variant: "v1", title: "Post D / v1", tags: "featured,unlaunched" },
      ],
    },
    fkOptions: {
      [POSTS]: { tags: { multi: true, delimiter: ",", onMissing: "create-stub" } },
    },
  });
  log("step-6 create-stub result", {
    tags: stubResult.tables.find((t) => t.name === TAGS),
    posts: stubResult.tables.find((t) => t.name === POSTS),
  });
  if (!stubResult.ok) {
    throw new Error(`create-stub had row errors: ${JSON.stringify(stubResult.tables)}`);
  }

  const tagRows = await listAllDraftRows(client, provisionResult.tableIds[TAGS]);
  const stub = tagRows.find((r) => r.values["slug"] === "unlaunched");
  if (!stub) throw new Error(`expected a stub tags row with slug="unlaunched", got ${tagRows.map((r) => r.values["slug"]).join(",")}`);

  const postD = (await listAllDraftRows(client, provisionResult.tableIds[POSTS])).find(
    (r) => r.values["slug"] === "post-d" && r.values["variant"] === "v1",
  );
  if (!postD) throw new Error("post-d/v1 not found after create-stub run");
  const postDTags = postD.values["tags"] as { id: string }[] | undefined;
  if (!Array.isArray(postDTags) || postDTags.length !== 2) {
    throw new Error(`post-d/v1 expected 2 tag refs, got ${JSON.stringify(postDTags)}`);
  }
  if (!postDTags.some((r) => r.id === stub.id)) {
    throw new Error("post-d/v1 tags do not include the stub id");
  }
  log("step-6 verified", { stubId: stub.id, postDTags: postDTags.length });

  await cleanup();
  log("cleanup", "namespace deleted");
});
