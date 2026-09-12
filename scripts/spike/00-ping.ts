import { hubdb, log, runSpike } from "./client";

type TablesResponse = {
  results: Array<{ id: string; name: string; label: string; published: boolean }>;
  total?: number;
};

runSpike(async () => {
  const v3 = await hubdb<TablesResponse>("/tables", { base: "v3" });
  log("v3 /tables", {
    count: v3.results?.length ?? 0,
    sample: v3.results?.slice(0, 5).map((t) => ({ id: t.id, name: t.name, published: t.published })),
  });
});
