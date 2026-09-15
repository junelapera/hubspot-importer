import { client, HubdbError, log, runSpike } from "./client";
import {
  createTable,
  getTable,
  listTables,
  type HubdbColumnInput,
  type HubdbTable,
} from "../../lib/hubdb";

const MAIN_NAME = "products";
const MAIN_LABEL = "Products";

function nameBasedColumns(): HubdbColumnInput[] {
  return [
    { name: "sku", label: "SKU", type: "TEXT" },
    { name: "title", label: "Title", type: "TEXT" },
    { name: "brand", label: "Brand", type: "FOREIGN_ID", foreignTableName: "brands", foreignColumnName: "name" },
    { name: "category", label: "Category", type: "FOREIGN_ID", foreignTableName: "categories", foreignColumnName: "name" },
  ];
}

function idBasedColumns(brands: HubdbTable, categories: HubdbTable): HubdbColumnInput[] {
  const brandNameCol = brands.columns.find((c) => c.name === "name");
  const categoryNameCol = categories.columns.find((c) => c.name === "name");
  if (!brandNameCol?.id || !categoryNameCol?.id) {
    throw new Error("brands or categories missing 'name' column id — cannot build id-based FK columns");
  }
  return [
    { name: "sku", label: "SKU", type: "TEXT" },
    { name: "title", label: "Title", type: "TEXT" },
    { name: "brand", label: "Brand", type: "FOREIGN_ID", foreignTableId: brands.id, foreignColumnId: brandNameCol.id },
    { name: "category", label: "Category", type: "FOREIGN_ID", foreignTableId: categories.id, foreignColumnId: categoryNameCol.id },
  ];
}

async function tryAttempt(label: string, attempt: () => Promise<HubdbTable>) {
  try {
    const res = await attempt();
    return {
      attempt: label,
      ok: true as const,
      id: res.id,
      published: res.published,
      columns: res.columns.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        foreignTableId: c.foreignTableId,
        foreignColumnId: c.foreignColumnId,
      })),
    };
  } catch (err) {
    if (err instanceof HubdbError) {
      return { attempt: label, ok: false as const, status: err.status, body: err.responseBody };
    }
    throw err;
  }
}

runSpike(async () => {
  const list = await listTables(client);
  const brands = list.find((t) => t.name === "brands");
  const categories = list.find((t) => t.name === "categories");
  if (!brands || !categories) {
    throw new Error("brands and/or categories missing — run 01-provision-foreign.ts first");
  }

  const existing = list.find((t) => t.name === MAIN_NAME);
  if (existing) {
    const detail = await getTable(client, existing.id);
    log("products already exists — skipping create", {
      id: existing.id,
      published: existing.published,
      columns: detail.columns.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        foreignTableId: c.foreignTableId,
        foreignColumnId: c.foreignColumnId,
      })),
    });
    return;
  }

  const brandsDetail = await getTable(client, brands.id);
  const categoriesDetail = await getTable(client, categories.id);
  log("foreign table columns", {
    brands: brandsDetail.columns.map((c) => ({ id: c.id, name: c.name, type: c.type })),
    categories: categoriesDetail.columns.map((c) => ({ id: c.id, name: c.name, type: c.type })),
  });

  const nameAttempt = await tryAttempt(
    "names (foreignTableName + foreignColumnName)",
    () =>
      createTable(client, {
        name: MAIN_NAME,
        label: MAIN_LABEL,
        useForPages: false,
        allowChildTables: false,
        enableChildTablePages: false,
        columns: nameBasedColumns(),
      }),
  );
  log("attempt: name-based FK", nameAttempt);
  if (nameAttempt.ok) return;

  const idAttempt = await tryAttempt(
    "ids (foreignTableId + foreignColumnId)",
    () =>
      createTable(client, {
        name: MAIN_NAME,
        label: MAIN_LABEL,
        useForPages: false,
        allowChildTables: false,
        enableChildTablePages: false,
        columns: idBasedColumns(brandsDetail, categoriesDetail),
      }),
  );
  log("attempt: id-based FK", idAttempt);
});
