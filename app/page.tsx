import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Chevron } from "@/components/ui/chevron";

export default function Home() {
  return (
    <main className="page space-y-10">
      <PageHeader
        title="S2 HubDB Importer"
        description={
          <>
            Import relational data into HubSpot HubDB — resolves{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-sm">FOREIGN_ID</code>{" "}
            cells from natural keys so a{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-sm">
              products <Chevron /> brands + categories
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
        "group flex flex-col gap-3 rounded-xl border border-foreground bg-card p-5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring " +
        (disabled
          ? "cursor-not-allowed opacity-50"
          : "hover:bg-accent")
      }
    >
      <span className="eyebrow">
        {index} <span aria-hidden>✷</span> {tag}
        {disabled ? " · planned" : null}
      </span>
      <h2 className="font-heading text-3xl font-medium leading-tight tracking-tight">{title}</h2>
      <span className="text-sm text-muted-foreground group-hover:text-foreground">{desc}</span>
      {disabled ? null : (
        <span className="eyebrow mt-auto inline-flex items-center gap-1.5 pt-2">
          Open <ChevronRight aria-hidden className="size-3.5" />
        </span>
      )}
    </Wrapper>
  );
}
