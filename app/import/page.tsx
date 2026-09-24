import Link from "next/link";
import { listPortals } from "@/lib/db/portals";
import { createSupabaseServerClient } from "@/lib/db/supabase";
import { SourceUploader } from "./source-uploader";
import { PAGE_ACCENTS, PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function ImportPage() {
  let portals: Awaited<ReturnType<typeof listPortals>> = [];
  let loadError: string | null = null;
  try {
    const supabase = createSupabaseServerClient();
    portals = await listPortals(supabase);
  } catch (err) {
    loadError = (err as Error).message;
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-12 space-y-10">
      <PageHeader
        icon={PAGE_ACCENTS.import.icon}
        accentColor={PAGE_ACCENTS.import.color}
        title="Import source"
        description="Upload one CSV per table, or paste a single JSON document containing a keyed set of tables. Sources are parsed on the server and previewed below — nothing is written to HubSpot yet."
      />

      {loadError ? (
        <section className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm">
          <p className="font-medium text-destructive">Could not load portals</p>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs text-destructive/80">{loadError}</pre>
        </section>
      ) : portals.length === 0 ? (
        <section className="rounded-md border border-border bg-muted/40 p-4 text-sm">
          <p className="font-medium">No portals connected yet.</p>
          <p className="mt-1 text-muted-foreground">
            <Link href="/portals" className="underline underline-offset-2">
              Connect a portal
            </Link>{" "}
            first so imports have a target to run against.
          </p>
        </section>
      ) : null}

      <SourceUploader portals={portals} />

      <footer className="pt-6 text-xs text-muted-foreground">
        <Link href="/" className="underline underline-offset-2">
          ← Home
        </Link>
      </footer>
    </main>
  );
}
