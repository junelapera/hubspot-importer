import Link from "next/link";
import { PAGE_ACCENTS, PageHeader } from "@/components/ui/page-header";

export default function Home() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-12 space-y-10">
      <PageHeader
        icon={PAGE_ACCENTS.home.icon}
        accentColor={PAGE_ACCENTS.home.color}
        title="S2 HubDB Importer"
        description={
          <>
            Import relational data into HubSpot HubDB — resolves{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-sm">FOREIGN_ID</code>{" "}
            cells from natural keys so a{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-sm">
              products → brands + categories
            </code>{" "}
            dataset lands in one pass.
          </>
        }
      />

      <nav aria-label="Sections" className="grid gap-4 sm:grid-cols-2">
        <SectionLink
          index="01"
          tag="Connect"
          href="/portals"
          title="Portals"
          desc="Connect HubSpot portals with private-app tokens."
          ready
        />
        <SectionLink
          index="02"
          tag="Import"
          href="/import"
          title="Import source"
          desc="Upload CSV, Excel, JSON or a Google Sheet, then map, dry-run and execute."
          ready
        />
        <SectionLink
          index="03"
          tag="History"
          href="/jobs"
          title="Jobs"
          desc="History of imports, dry runs, and publishes with per-table totals and row-error logs."
          ready
        />
        <SectionLink
          index="04"
          tag="Guide"
          href="/docs"
          title="Docs"
          desc="Step-by-step walkthrough + downloadable example CSVs and schema.json for testing the full loop."
          ready
        />
      </nav>

      <footer className="border-t-2 border-foreground pt-6 text-xs text-muted-foreground">
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
  index,
  tag,
  href,
  title,
  desc,
  ready,
}: {
  index: string;
  tag: string;
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
        "group flex flex-col gap-3 rounded-md border-2 border-foreground bg-card p-5 transition-all " +
        (disabled
          ? "cursor-not-allowed opacity-50"
          : "hover:-translate-y-1 hover:bg-primary")
      }
    >
      <span className="eyebrow">
        {index} <span aria-hidden>✷</span> {tag}
        {disabled ? " · planned" : null}
      </span>
      <h2 className="text-3xl font-medium leading-none">{title}</h2>
      <span className="text-sm text-muted-foreground group-hover:text-foreground">{desc}</span>
      {disabled ? null : (
        <span className="eyebrow mt-auto pt-2">
          Open <span aria-hidden>→</span>
        </span>
      )}
    </Wrapper>
  );
}
