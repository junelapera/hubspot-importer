import Link from "next/link";
import { listPortals } from "@/lib/db/portals";
import { createSupabaseServerClient } from "@/lib/db/supabase";
import { PortalForm } from "./portal-form";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function PortalsPage() {
  let portals: Awaited<ReturnType<typeof listPortals>> = [];
  let loadError: string | null = null;
  try {
    const supabase = createSupabaseServerClient();
    portals = await listPortals(supabase);
  } catch (err) {
    loadError = (err as Error).message;
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-12 space-y-10">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">Phase 1 · F1</p>
        <h1 className="text-2xl font-semibold">Portals</h1>
        <p className="text-sm text-muted-foreground">
          Connect a HubSpot portal by pasting its private-app token. Tokens are
          encrypted at rest and never returned to the browser after save.
        </p>
      </header>

      {loadError ? (
        <section className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm">
          <p className="font-medium text-destructive">Could not load portals</p>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs text-destructive/80">{loadError}</pre>
        </section>
      ) : (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Connected ({portals.length})</h2>
          {portals.length === 0 ? (
            <p className="text-sm text-muted-foreground">No portals yet — add one below.</p>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
              {portals.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                  <EnvBadge env={p.env} />
                  <span className="font-medium">{p.label}</span>
                  {p.hubId ? (
                    <span className="text-muted-foreground">· Hub {p.hubId}</span>
                  ) : null}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {new Date(p.createdAt).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Add a portal</h2>
        <PortalForm />
        <p className="text-xs text-muted-foreground">
          Private-app token from HubSpot: Settings → Integrations → Private
          Apps → your app → Auth tab. Requires the <code>hubdb</code>{" "}
          (read + write) scope.
        </p>
      </section>

      <footer className="pt-6 text-xs text-muted-foreground">
        <Link href="/" className="underline underline-offset-2">
          ← Home
        </Link>
      </footer>
    </main>
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
