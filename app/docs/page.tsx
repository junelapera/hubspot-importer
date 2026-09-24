import Link from "next/link";
import { DocsToc } from "./docs-toc";

export const metadata = {
  title: "Docs · S2 HubDB Importer",
};

const EXAMPLES = [
  {
    href: "/examples/brands.csv",
    name: "brands.csv",
    size: "4 rows",
    desc: "Foreign table — natural key is slug (acme, globex, initech, umbrella).",
  },
  {
    href: "/examples/categories.csv",
    name: "categories.csv",
    size: "4 rows",
    desc: "Foreign table — natural key is slug (kitchen, outdoors, office, tools).",
  },
  {
    href: "/examples/products.csv",
    name: "products.csv",
    size: "8 rows",
    desc: "Main table — natural key is sku. brand + category columns reference the two tables above by slug.",
  },
  {
    href: "/examples/schema.json",
    name: "schema.json",
    size: "3 tables",
    desc: "Schema definition for the F3 provisioning step — creates the three tables above with the right column types + FK links.",
  },
];

export default function DocsPage() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-12 lg:grid lg:grid-cols-[minmax(0,1fr)_200px] lg:gap-10">
      <div className="space-y-10">
        <header className="space-y-3">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Guide</p>
          <h1 className="text-3xl font-semibold">How to use S2 HubDB Importer</h1>
          <p className="text-base leading-relaxed text-muted-foreground">
            A step-by-step walkthrough for importing relational data (a main
            table plus its foreign lookups) into a HubSpot HubDB portal, with a
            downloadable example dataset you can run end-to-end against a
            sandbox portal in a few minutes.
          </p>
        </header>

        <DocsToc variant="inline" />

      <Section id="overview" title="What this app does">
        <p>
          HubSpot&apos;s native HubDB CSV importer <em>cannot</em> populate{" "}
          <Code>FOREIGN_ID</Code> columns — foreign relationships have to be
          linked one row at a time in the UI. This app takes source data (CSV,
          XLSX, JSON, or a published Google Sheet), resolves foreign keys from
          human-readable natural keys (SKU, slug, name), and writes rows in
          dependency order so <Code>FOREIGN_ID</Code> cells land with real
          HubDB row IDs on the first pass.
        </p>
        <p>
          Two ideas do most of the work:{" "}
          <strong>two-pass import</strong> (foreign tables written first to
          obtain row IDs, then the main table with substituted IDs) and{" "}
          <strong>name-based FK references</strong> (schema definitions point
          at other tables by name, so files stay portable across portals).
        </p>
      </Section>

      <Section id="example-dataset" title="Example dataset — download to test">
        <p>
          The files below model a small product catalog:{" "}
          <Code>products</Code> references <Code>brands</Code> and{" "}
          <Code>categories</Code> by slug. Drop them into the wizard to
          exercise the full loop.
        </p>
        <ul className="space-y-2">
          {EXAMPLES.map((f) => (
            <li
              key={f.href}
              className="flex flex-col gap-1 rounded-md border border-border bg-card p-3 sm:flex-row sm:items-baseline sm:gap-3"
            >
              <a
                href={f.href}
                download
                className="text-sm font-semibold text-primary underline-offset-2 hover:underline"
              >
                {f.name}
              </a>
              <span className="text-xs text-muted-foreground">{f.size}</span>
              <span className="text-xs text-muted-foreground sm:flex-1">
                {f.desc}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          All four files are served statically from{" "}
          <Code>public/examples/</Code> in this repo.
        </p>
      </Section>

      <Section id="prerequisites" title="Prerequisites">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>An @saltedstone.com email address.</strong> Registration
            is restricted to the Saltedstone domain. Visit{" "}
            <NavLink href="/register">/register</NavLink> to self-create an
            account (first visit) or <NavLink href="/login">/login</NavLink>{" "}
            if you already have one. Your signed-in email appears at the
            bottom of the sidebar.
          </li>
          <li>
            A HubSpot portal (sandbox strongly recommended for first-time
            runs) with a private-app token that has the <Code>hubdb</Code>{" "}
            read + write scopes. Create one under{" "}
            <em>Settings → Integrations → Private Apps</em>.
          </li>
          <li>
            The app running locally or on Vercel with Supabase configured (see{" "}
            <ExternalLink href="https://github.com/junelapera/hubspot-importer/blob/main/DEPLOYMENT.md">
              DEPLOYMENT.md
            </ExternalLink>{" "}
            for env vars).
          </li>
          <li>Node 22+ (supabase-js needs the native WebSocket global).</li>
        </ul>
      </Section>

      <Section id="walkthrough" title="Walkthrough">
        <p className="rounded-md border border-primary/40 bg-[color-mix(in_oklch,var(--color-brand-butter),var(--card)_50%)] px-3 py-2 text-xs">
          <strong>Not a developer?</strong> Every step below also has an
          inline <em>&quot;New to this? Show me how&quot;</em> tutorial in
          the app itself — click any source tab on{" "}
          <NavLink href="/import">/import</NavLink> or the schema planner
          on the portal detail page and expand the disclosure at the top
          of the form. This walkthrough is the concise reference; the
          inline tutorials are the step-by-step.
        </p>
        <Step
          n={1}
          title="Connect the portal"
          route="/portals"
          body={
            <>
              Open <NavLink href="/portals">Portals</NavLink>. Click{" "}
              <em>Add portal</em>, give it a label, pick{" "}
              <Code>sandbox</Code> or <Code>production</Code> (production gets
              a red badge as a safety cue), and paste the private-app token.
              The token is validated against HubSpot before it&apos;s stored
              encrypted at rest.
            </>
          }
        />
        <Step
          n={2}
          title="Upload the source files"
          route="/import"
          body={
            <>
              Open <NavLink href="/import">Import</NavLink> and pick the
              portal. Pick a source tab — <em>CSV upload</em>,{" "}
              <em>XLSX upload</em> (one table per sheet), <em>JSON paste</em>,
              or <em>Google Sheets</em> (one published-CSV URL per table; see
              the Reference below for how to get the URL). For the example
              dataset, upload <Code>brands.csv</Code>,{" "}
              <Code>categories.csv</Code>, and <Code>products.csv</Code>.
              Each table shows a 20-row preview + parse warnings. Delimiter,
              encoding, and header row auto-detect — override in the toolbar
              if needed.
            </>
          }
        />
        <Step
          n={3}
          title="Provision the HubDB tables"
          route="/portals/[id]/schema"
          body={
            <>
              From the portal detail page, paste{" "}
              <Code>schema.json</Code> into the schema planner. The flow is
              two-step:
              <br />
              <br />
              <strong>1. Generate plan</strong> — POSTs your schema to{" "}
              <Code>/api/portals/[id]/diff</Code>. The server parses it,
              fetches the portal&apos;s current draft schema, and returns a
              per-table verdict:
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>
                  <Code>create</Code> — table doesn&apos;t exist yet, will be
                  created draft-only.
                </li>
                <li>
                  <Code>match</Code> — portal already has this table with
                  identical columns; nothing to do.
                </li>
                <li>
                  <Code>update</Code> — portal has this table but is missing
                  columns; they&apos;ll be added.
                </li>
                <li>
                  <Code>conflict</Code> — an existing column&apos;s type
                  doesn&apos;t match the schema. The provisioner refuses to
                  retype (v1 never drops or retypes columns), so this stops
                  the flow and lists what needs manual reconciliation.
                </li>
              </ul>
              No writes happen — this is a preview.
              <br />
              <br />
              <strong>2. Provision</strong> — only enabled once the plan
              comes back with zero conflicts. POSTs to{" "}
              <Code>/api/portals/[id]/provision</Code>, which creates the
              missing tables in topological order (foreign tables first) and
              adds any missing columns. Tables are draft-only until you
              publish them from the wizard&apos;s <em>Execute</em> step.
              <br />
              <br />
              <strong>Working with your own CSVs?</strong> Instead of
              hand-authoring the schema, use the <em>Suggest a schema</em>{" "}
              panel that appears on <NavLink href="/import">/import</NavLink>{" "}
              once your files are parsed. It infers types + a natural-key
              candidate for each table, detects foreign-key columns by
              checking value membership across tables (no name-based
              guessing), and downloads a matching{" "}
              <Code>schema.json</Code> you can review and paste here.
            </>
          }
        />
        <Step
          n={4}
          title="Map source columns to target columns"
          route="/import"
          body={
            <>
              Back in the wizard, each source table gets a mapping panel.
              Auto-match handles obvious cases; use the per-row dropdown to
              re-map or ignore columns. Type mismatches (a text SKU into a
              NUMBER column, etc.) surface as inline badges. Tick a natural
              key so the importer can upsert on re-runs — for the example set
              that&apos;s <Code>slug</Code> on brands + categories and{" "}
              <Code>sku</Code> on products.
            </>
          }
        />
        <Step
          n={5}
          title="Configure foreign relationships"
          route="/import"
          body={
            <>
              For every source column mapped to a <Code>FOREIGN_ID</Code>{" "}
              target, a <em>Foreign key</em> panel appears. Pick the sibling
              source table (e.g. <Code>brands</Code>) and the match key on it
              (<Code>slug</Code>). Toggle multi-value if a cell contains
              several delimited references (e.g.{" "}
              <Code>&quot;acme,globex&quot;</Code>). Pick an{" "}
              <em>onMissing</em> policy: <Code>skip-row</Code>,{" "}
              <Code>null</Code>, <Code>fail</Code>, or <Code>create-stub</Code>{" "}
              (auto-inserts a placeholder row in the foreign table). Live
              counts show matched / unmatched / empty as you edit.
            </>
          }
        />
        <Step
          n={6}
          title="Dry run"
          route="/import"
          body={
            <>
              The <em>Dry run</em> panel reports rows to create / update,
              unresolved FKs (with source row + column + value), coercion
              warnings, and the projected HubSpot API call count. No writes
              happen. Download the unresolved-refs CSV if you need to clean up
              source data before executing. The dry run also produces a
              signature — <em>Execute</em> stays disabled until the signature
              matches, so you can&apos;t accidentally execute against edited
              mappings.
            </>
          }
        />
        <Step
          n={7}
          title="Execute + publish"
          route="/import"
          body={
            <>
              Pick a publish mode: <Code>none</Code> (leave everything draft),{" "}
              <Code>foreign-only</Code> (publish just the lookup tables), or{" "}
              <Code>all</Code>. Click <em>Execute</em>. Per-table cards show
              created / updated / skipped counts as batches complete. Cancel
              at any batch boundary via the red <em>Cancel</em> button — the
              in-flight batch always finishes so no rows are left half-written.
              A stale-FK retry runs once automatically if a foreign row was
              inserted mid-flight but not yet visible on the write.
            </>
          }
        />
        <Step
          n={8}
          title="Review + save the mapping profile"
          route="/jobs"
          body={
            <>
              Every run persists to <NavLink href="/jobs">Jobs</NavLink> with
              per-table totals and a row-error log (CSV + JSON download).
              Save the mapping as a named profile from the wizard&apos;s{" "}
              <em>Mapping profile</em> panel so future runs (with fresh source
              files) load in one click. Profiles can also be duplicated,
              exported to JSON, or imported from someone else&apos;s export —
              collisions auto-rename to <Code>Copy of X</Code>.
            </>
          }
        />
        <Step
          n={9}
          title="Resume if it fails"
          route="/jobs/[id]"
          body={
            <>
              Failed or cancelled runs get a <em>Resume</em> button on the
              job detail page. Clicking it reopens the wizard with the
              linked mapping profile pre-loaded and the target portal
              pre-selected — you re-upload the same source files and click{" "}
              <em>Execute</em>. The run continues on the existing job row,
              and because the importer upserts by natural key, rows that
              already landed in HubDB are re-classified as no-op updates.
              Per-batch cursors + per-table key maps are written to
              Supabase during every run for audit visibility.
            </>
          }
        />
      </Section>

      <Section id="reference" title="Reference">
        <Subsection title="Google Sheets source">
          <p>
            The <em>Google Sheets</em> source tab fetches published-to-web
            CSV URLs server-side. To get a URL:
          </p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              Open the sheet, then <em>File → Share → Publish to web</em>.
            </li>
            <li>
              In the dialog, pick the specific sheet tab (not{" "}
              <em>Entire document</em>) and choose{" "}
              <strong>Comma-separated values (.csv)</strong>.
            </li>
            <li>
              Click <em>Publish</em>, confirm, and copy the URL.
            </li>
          </ol>
          <p>
            Paste one URL per HubDB table in the wizard, give each a table
            name, and click <em>Fetch sheets</em>. The importer also accepts{" "}
            <Code>/pubhtml</Code> URLs (rewritten to the CSV form),{" "}
            <Code>/edit#gid=…</Code> URLs (rewritten to{" "}
            <Code>/export?format=csv</Code>; requires{" "}
            <em>anyone with the link can view</em> sharing), and gviz
            (<Code>/gviz/tq?tqx=out:csv</Code>) URLs.
          </p>
          <p>
            <strong>Private-sheet support</strong> (OAuth) is intentionally
            deferred — publishing to web covers the common case without a
            Google Cloud project. The published-CSV URL is a secret-URL,
            not a public listing; only rows visible in the published tab
            are fetched.
          </p>
        </Subsection>
        <Subsection title="Schema inference">
          <p>
            The <em>Suggest a schema</em> panel on{" "}
            <NavLink href="/import">/import</NavLink> runs a pure inference
            over your parsed source rows and returns an editable schema:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Types</strong> — checked most-specific first: DATE (
              <Code>YYYY-MM-DD</Code>) → DATETIME (parses + has time-of-day)
              → BOOLEAN → URL → IMAGE (URL + image extension) → CURRENCY
              (numeric + column name matches{" "}
              <Code>price/cost/amount/total/…</Code>) → NUMBER → RICHTEXT
              (any cell &gt; 500 chars) → TEXT fallback. Every stricter type
              requires <em>all</em> non-empty samples to match; one bad row
              drops back to TEXT.
            </li>
            <li>
              <strong>Natural key</strong> — a column qualifies if every
              non-empty value is unique (case-insensitive) and it&apos;s
              filled in ≥50% of rows. Among candidates, preference by name:{" "}
              <Code>id</Code> · <Code>uuid</Code> · <Code>sku</Code> ·{" "}
              <Code>slug</Code> · <Code>handle</Code> · <Code>code</Code> ·{" "}
              <Code>key</Code> · <Code>identifier</Code>, then any{" "}
              <Code>*_id</Code>, then shortest name wins.
            </li>
            <li>
              <strong>Foreign keys</strong> — value-membership check, not a
              name heuristic. Column A becomes FOREIGN_ID pointing at table
              B if every non-empty value of A appears in B&apos;s natural-key
              column (case-insensitive, all-or-nothing). Zero false
              positives; the trade-off is that FKs with typo&apos;d or
              genuinely unresolvable source values won&apos;t be detected —
              fix the source and re-upload, or set the FK by hand in the
              panel.
            </li>
          </ul>
        </Subsection>
        <Subsection title="Foreign-key resolution">
          <p>
            Match keys are normalized before lookup: trim → collapse
            whitespace → casefold, so <Code>&quot;Acme&nbsp;&nbsp;Corp&quot;</Code>{" "}
            and <Code>&quot;acme corp&quot;</Code> resolve to the same row.
            Use <em>strict</em> matching if you need byte-exact comparison.
            Multi-value cells are split on <Code>, | ; \n</Code> (pick one)
            and deduped per cell.
          </p>
        </Subsection>
        <Subsection title="onMissing policies">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <Code>skip-row</Code> — drop the row from the batch, log the
              unresolved value, continue with the rest.
            </li>
            <li>
              <Code>null</Code> — write the row without the FK cell (empty
              array, not null).
            </li>
            <li>
              <Code>fail</Code> — abort the whole run at the first
              unresolvable row. Partial results still persist so you can see
              exactly how far it got.
            </li>
            <li>
              <Code>create-stub</Code> — insert a placeholder row in the
              foreign table using the unresolved token as its natural key,
              then link the main row. Deduped by normalized key so{" "}
              <Code>&quot;NEW-BRAND&quot;</Code> and{" "}
              <Code>&quot;new-brand&quot;</Code> produce one stub.
            </li>
          </ul>
        </Subsection>
        <Subsection title="Resume from failure">
          <p>
            Every batch attempt writes a row to Supabase&apos;s{" "}
            <Code>job_batches</Code> table (kind, status, sent-at, finished-at)
            and every table&apos;s completed key map lands in{" "}
            <Code>key_maps</Code>. When a run fails or is cancelled, the job
            detail page shows a <em>Resume</em> button that deep-links back
            into the wizard with the mapping profile and target portal
            pre-selected. Re-upload the same source files, run the dry run,
            and click <em>Execute</em> — the resume request threads the
            original job id through so the audit trail continues on the
            same row rather than creating a new one.
          </p>
          <p>
            <strong>Why re-run is safe:</strong> the importer splits source
            rows into insert / update batches by looking up their natural
            key in the current HubDB state. Rows that succeeded before are
            now visible in HubDB, so on resume they get re-classified as
            no-op PATCH updates rather than duplicate inserts. Rows that
            failed re-run naturally as fresh inserts. No explicit
            skip-completed-batches logic — correctness falls out of the
            upsert design.
          </p>
        </Subsection>
        <Subsection title="Cell type coercion">
          <p>
            Every source cell arrives as a string (CSV / XLSX / Google
            Sheets all serialize that way). HubSpot&apos;s batch write API
            is strict about JSON types on typed columns, so the importer
            coerces each cell to the right JSON type before writing:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <Code>NUMBER</Code> and <Code>CURRENCY</Code> — parsed with{" "}
              <Code>Number()</Code>. Currency formatting is stripped first
              (<Code>$</Code> <Code>€</Code> <Code>£</Code> <Code>¥</Code>,
              commas, whitespace), so <Code>&quot;$1,299.00&quot;</Code>{" "}
              becomes <Code>1299</Code>.
            </li>
            <li>
              <Code>BOOLEAN</Code> — accepts{" "}
              <Code>true/false/1/0/yes/no</Code> case-insensitively.
            </li>
            <li>
              <Code>DATE</Code> and <Code>DATETIME</Code> — parsed via{" "}
              <Code>Date.parse()</Code>, sent as epoch milliseconds.
            </li>
            <li>
              <Code>TEXT</Code>, <Code>RICHTEXT</Code>, <Code>URL</Code>,{" "}
              <Code>IMAGE</Code>, etc. — sent as-is; HubSpot parses these
              server-side.
            </li>
          </ul>
          <p>
            Empty strings on non-text columns get dropped from the row
            entirely (sending <Code>&quot;&quot;</Code> also 400s). Cells
            that can&apos;t be parsed become <Code>type-mismatch</Code>{" "}
            row errors — surfaced on the Execute result card — rather
            than aborting the whole batch.
          </p>
        </Subsection>
        <Subsection title="Constraints enforced client + server">
          <ul className="list-disc space-y-1 pl-5">
            <li>10,000 rows / table (HubDB limit)</li>
            <li>10,000 chars / TEXT cell · 65,000 chars / RICHTEXT cell</li>
            <li>Dynamic page paths must be lowercase</li>
            <li>Batch mutations capped at 100 rows / call</li>
            <li>429 / 5xx retried with exponential backoff + Retry-After</li>
          </ul>
        </Subsection>
      </Section>

      <Section id="troubleshooting" title="Troubleshooting">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>&quot;Node.js detected but native WebSocket not found&quot;</strong>{" "}
            — you&apos;re on Node 20 or older. Upgrade to Node 22+
            (<Code>nvm use 22</Code>) and restart the dev server.
          </li>
          <li>
            <strong>409 on portal save</strong> — a portal with that label
            already exists in that environment. Rename or delete the old one.
          </li>
          <li>
            <strong>Execute button stays disabled</strong> — the dry run
            signature doesn&apos;t match. Re-run the dry run panel; any
            mapping edit invalidates the signature.
          </li>
          <li>
            <strong>Foreign rows created but not linked</strong> — check the
            row-error log at <NavLink href="/jobs">/jobs</NavLink>. Typically
            an <Code>onMissing: skip-row</Code> policy caught a typo in a
            main-table cell; download the CSV and fix the source.
          </li>
          <li>
            <strong>Import fails with a 400 from HubSpot</strong> — expand
            the <em>HubSpot response</em> block under the error message on
            the Execute panel. It shows the exact rejection from HubSpot
            (which cell / which column). Most common cause: a{" "}
            <Code>NUMBER</Code> column whose source has non-numeric
            characters we couldn&apos;t strip (e.g.{" "}
            <Code>&quot;TBD&quot;</Code>, <Code>&quot;N/A&quot;</Code>) —
            fix the source or promote the target column to <Code>TEXT</Code>.
          </li>
          <li>
            <strong>FK panel looks configured but resolvability preview
            doesn&apos;t show</strong> — reload <Code>/import</Code> and
            reconfigure. Older saved profiles created before the Base UI
            Select fix (2026-09-26) may have <Code>null</Code>{" "}
            <Code>sourceTable</Code>/<Code>matchKey</Code> values that
            display as selected but never committed to state. Re-save the
            profile to overwrite.
          </li>
          <li>
            <strong>&quot;Only @saltedstone.com email addresses are allowed to register&quot;</strong>{" "}
            — that&apos;s working as designed; the app is Saltedstone-internal.
            If you need access and have a different email, ask an admin to
            add an alias for you on their end.
          </li>
          <li>
            <strong>Registered but the login form says &quot;Email not confirmed&quot;</strong>{" "}
            — the Supabase project has &quot;Confirm email&quot; enabled.
            Ask an admin to toggle it off under{" "}
            <em>Authentication → Providers → Email → Confirm email</em> in
            the Supabase dashboard, then log in again.
          </li>
          <li>
            <strong>Mapping cards missing after navigating back to Import</strong>{" "}
            — parsed source rows aren&apos;t persisted (they can be too
            large for browser storage), but your mapping config <em>is</em>{" "}
            preserved per portal in the browser tab. Look for the blue{" "}
            <em>&quot;Restored N mapping(s) from your last session&quot;</em>{" "}
            banner and just re-upload / re-fetch your sources — the config
            re-attaches automatically. Close the tab or click{" "}
            <em>Clear session</em> in the banner to reset.
          </li>
        </ul>
      </Section>

        <footer className="border-t border-border pt-6 text-xs text-muted-foreground">
          See{" "}
          <ExternalLink href="https://github.com/junelapera/hubspot-importer/blob/main/hubdb-importer-prd.md">
            the PRD
          </ExternalLink>{" "}
          for full product spec, or{" "}
          <ExternalLink href="https://github.com/junelapera/hubspot-importer/blob/main/STATUS.md">
            STATUS.md
          </ExternalLink>{" "}
          for the running project log.
        </footer>
      </div>

      <DocsToc variant="sidebar" />
    </main>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="space-y-3 scroll-mt-20">
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-foreground/90">
        {children}
      </div>
    </section>
  );
}

function Subsection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </div>
  );
}

function Step({
  n,
  title,
  route,
  body,
}: {
  n: number;
  title: string;
  route?: string;
  body: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <div
        aria-hidden
        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
      >
        {n}
      </div>
      <div className="space-y-1 pb-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <h3 className="text-sm font-semibold">{title}</h3>
          {route ? <Code>{route}</Code> : null}
        </div>
        <p className="text-sm leading-relaxed text-foreground/90">{body}</p>
      </div>
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
      {children}
    </code>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-primary underline-offset-2 hover:underline">
      {children}
    </Link>
  );
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-primary underline-offset-2 hover:underline"
    >
      {children}
    </a>
  );
}
