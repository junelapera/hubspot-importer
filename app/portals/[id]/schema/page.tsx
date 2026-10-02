import { notFound } from "next/navigation";
import { getPortalById, getPortalToken } from "@/lib/db/portals";
import { createSupabaseServerClient } from "@/lib/db/supabase";
import { createHubdbClient, fetchPortalSchema, isPublished } from "@/lib/hubdb";
import type { HubdbColumn, PortalSchemaTable } from "@/lib/hubdb";
import { DropTableButton } from "./drop-table-button";
import { RefreshButton } from "./refresh-button";
import { SchemaPlanner } from "./schema-planner";
import { PAGE_ACCENTS, PageHeader } from "@/components/ui/page-header";
import { ErrorCard } from "@/components/ui/error-card";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function PortalSchemaPage({ params }: Props) {
  const { id } = await params;
  const supabase = createSupabaseServerClient();
  const portal = await getPortalById(supabase, id);
  if (!portal) notFound();

  let fetchError: string | null = null;
  let snapshot: Awaited<ReturnType<typeof fetchPortalSchema>> | null = null;
  try {
    const token = await getPortalToken(supabase, id);
    if (!token) throw new Error("portal token is missing");
    const client = createHubdbClient({ token });
    snapshot = await fetchPortalSchema(client);
  } catch (err) {
    fetchError = (err as Error).message;
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-12 space-y-8">
      <Breadcrumbs
        items={[
          { label: "Portals", href: "/portals" },
          { label: portal.label },
        ]}
      />
      <PageHeader
        icon={PAGE_ACCENTS.portals.icon}
        accentColor={PAGE_ACCENTS.portals.color}
        title={portal.label}
        description="Draft schemas from the portal. Column lists reflect what a subsequent PATCH would see, not the currently published state."
      >
        <EnvBadge env={portal.env} />
        {portal.hubId ? (
          <span className="text-sm text-muted-foreground">Hub {portal.hubId}</span>
        ) : null}
      </PageHeader>

      <section className="flex items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground">
          {snapshot ? (
            <>
              {snapshot.tables.length} table{snapshot.tables.length === 1 ? "" : "s"} · fetched{" "}
              {new Date(snapshot.fetchedAt).toLocaleTimeString()}
            </>
          ) : (
            "not fetched"
          )}
        </div>
        <RefreshButton />
      </section>

      <details className="rounded-md border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground">
          About draft vs. published state
        </summary>
        <div className="mt-2 space-y-2">
          <p>
            Every HubDB table has two parallel copies — a <strong>draft</strong> and a{" "}
            <strong>live</strong> (published) version. Schema changes, row inserts, and row updates
            all write to the draft first. The live copy is what HubL and{" "}
            <code className="rounded bg-muted px-1">/rows</code> API reads serve to your pages until
            you explicitly promote the draft via <code className="rounded bg-muted px-1">push-live</code>.
          </p>
          <p>
            This page shows the <strong>draft</strong> column list — the shape a subsequent write
            would see. A{" "}
            <span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
              published
            </span>{" "}
            badge means the table has been pushed live at least once; a{" "}
            <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              draft only
            </span>{" "}
            table exists in the portal but isn&apos;t visible on your site yet.
          </p>
          <p>
            The import wizard writes new rows to draft and promotes them live based on the{" "}
            <em>Publish</em> option on the Execute step.
          </p>
        </div>
      </details>

      {fetchError ? (
        <ErrorCard error={fetchError} />
      ) : snapshot && snapshot.tables.length === 0 ? (
        <p className="rounded-md border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
          No HubDB tables in this portal yet.
        </p>
      ) : snapshot ? (
        <ul className="space-y-4">
          {snapshot.tables.map((t) => (
            <li key={t.id}>
              <TableCard table={t} portalId={id} portalEnv={portal.env} />
            </li>
          ))}
        </ul>
      ) : null}

      <SchemaPlanner portalId={id} />
    </main>
  );
}

function TableCard({
  table,
  portalId,
  portalEnv,
}: {
  table: PortalSchemaTable;
  portalId: string;
  portalEnv: "sandbox" | "production";
}) {
  const published = isPublished(table);
  return (
    <article className="space-y-3 rounded-md border border-border p-4">
      <header className="flex flex-wrap items-baseline gap-3">
        <h2 className="text-base font-semibold">{table.label ?? table.name}</h2>
        <span className="text-xs text-muted-foreground">
          name <code className="rounded bg-muted px-1">{table.name}</code> · id{" "}
          <code className="rounded bg-muted px-1">{table.id}</code>
        </span>
        <span className="ml-auto flex items-center gap-2 text-xs">
          <StateBadge published={published} />
          {typeof table.rowCount === "number" ? (
            <span className="text-muted-foreground">
              {table.rowCount.toLocaleString()} row{table.rowCount === 1 ? "" : "s"}
            </span>
          ) : null}
          <DropTableButton
            portalId={portalId}
            tableId={table.id}
            tableLabel={table.label ?? table.name}
            portalEnv={portalEnv}
          />
        </span>
      </header>

      {table.draftFetchError ? (
        <p className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 text-xs text-yellow-800 dark:text-yellow-200">
          Could not fetch draft columns — showing live-view columns instead. ({table.draftFetchError})
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[480px] text-xs">
          <thead className="bg-muted/60 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Column</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Details</th>
            </tr>
          </thead>
          <tbody>
            {table.draftColumns.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-3 py-4 text-center text-muted-foreground">
                  no columns
                </td>
              </tr>
            ) : (
              table.draftColumns.map((c) => (
                <tr key={c.id} className="border-t border-border align-top">
                  <td className="px-3 py-2">
                    <div className="font-medium">{c.label ?? c.name}</div>
                    <div className="text-muted-foreground">
                      <code className="rounded bg-muted px-1">{c.name}</code>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <TypeBadge type={c.type} />
                  </td>
                  <td className="px-3 py-2">
                    <ColumnDetail column={c} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function ColumnDetail({ column }: { column: HubdbColumn }) {
  if (column.type === "FOREIGN_ID") {
    return (
      <div className="text-muted-foreground">
        target table{" "}
        <code className="rounded bg-muted px-1">{column.foreignTableId ?? "?"}</code>
        {column.foreignColumnId ? (
          <>
            {" "}
            · display column <code className="rounded bg-muted px-1">{column.foreignColumnId}</code>
          </>
        ) : null}
      </div>
    );
  }
  return <span className="text-muted-foreground">—</span>;
}

function TypeBadge({ type }: { type: string }) {
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] uppercase tracking-wider">{type}</code>
  );
}

function StateBadge({ published }: { published: boolean }) {
  return published ? (
    <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
      published
    </span>
  ) : (
    <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      draft only
    </span>
  );
}

function EnvBadge({ env }: { env: "sandbox" | "production" }) {
  const isProd = env === "production";
  return (
    <span
      className={
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider " +
        (isProd
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : "border-border bg-muted text-muted-foreground")
      }
    >
      {env}
    </span>
  );
}
