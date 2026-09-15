import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 space-y-10">
      <header className="space-y-3">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Phase 1 · MVP
        </p>
        <h1 className="text-3xl font-semibold">HubDB Importer</h1>
        <p className="text-base leading-relaxed text-muted-foreground">
          Import relational data into HubSpot HubDB — resolves{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 text-sm">FOREIGN_ID</code>{" "}
          cells from natural keys so a{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 text-sm">
            products → brands + categories
          </code>{" "}
          dataset lands in one pass.
        </p>
      </header>

      <nav aria-label="Sections" className="grid gap-3 sm:grid-cols-2">
        <SectionLink
          href="/portals"
          title="Portals"
          desc="Connect HubSpot portals with private-app tokens (F1)."
          ready
        />
        <SectionLink
          href="#"
          title="Mappings"
          desc="Author + review schema and import mapping definitions (F2–F5)."
        />
        <SectionLink
          href="#"
          title="Runs"
          desc="Dry-run and execute imports; watch progress (F7–F8)."
        />
        <SectionLink
          href="#"
          title="Results"
          desc="Per-table stats and row-level error logs (F10)."
        />
      </nav>

      <footer className="border-t border-border pt-6 text-xs text-muted-foreground">
        <a
          href="https://github.com/junelapera/hubspot-importer"
          className="underline underline-offset-2"
        >
          github.com/junelapera/hubspot-importer
        </a>
        {" · see "}
        <code className="rounded bg-muted px-1 py-0.5">STATUS.md</code>
        {" for phase progress"}
      </footer>
    </main>
  );
}

function SectionLink({
  href,
  title,
  desc,
  ready,
}: {
  href: string;
  title: string;
  desc: string;
  ready?: boolean;
}) {
  const disabled = !ready;
  const Wrapper = disabled ? "div" : Link;
  return (
    <Wrapper
      href={href}
      className={
        "flex flex-col gap-1 rounded-md border border-border p-4 transition-colors " +
        (disabled
          ? "cursor-not-allowed opacity-50"
          : "hover:border-foreground/40 hover:bg-muted/50")
      }
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold">{title}</span>
        {disabled ? (
          <span className="rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            planned
          </span>
        ) : null}
      </div>
      <span className="text-xs text-muted-foreground">{desc}</span>
    </Wrapper>
  );
}
