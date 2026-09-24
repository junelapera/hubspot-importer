"use client";

import { startTransition, useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { PortalSummary } from "@/lib/db/portals";
import type { HubdbTable } from "@/lib/hubdb";
import {
  MappingEditor,
  initialMappingState,
  type MappingState,
  type SourceTable,
} from "./mapping-editor";
import { ImportOrderPanel } from "./import-order-panel";
import { DryRunPanel } from "./dry-run-panel";
import { ExecutePanel } from "./execute-panel";
import { ProfilePanel } from "./profile-panel";
import { SchemaInferPanel } from "./schema-infer-panel";
import { deriveImportOrder } from "@/lib/mapping";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TutorialPanel, TutorialSteps, TutorialTip } from "@/components/ui/tutorial-panel";

type ParsedTable = {
  name: string;
  filename: string | null;
  headers: string[];
  preview: Record<string, string>[];
  rows: Record<string, string>[];
  totalRows: number;
  detected: { encoding: string; delimiter: string; hadBOM: boolean } | null;
  parseWarnings: string[];
  validationWarnings: Array<{ kind: string; table: string; message: string; detail?: unknown }>;
};

type ParseResponse = {
  tables: ParsedTable[];
  warnings?: string[];
  error?: string;
  path?: string;
  kind?: string;
};

type Mode = "csv" | "xlsx" | "json" | "gsheets";

type SessionState = {
  mode?: Mode;
  mappings?: Record<string, MappingState>;
  selectedProfileId?: string | null;
  gsheetRows?: { tableName: string; url: string }[];
};

const SESSION_KEY_PREFIX = "hubdb-importer:wizard:";
function sessionKey(portalId: string) {
  return `${SESSION_KEY_PREFIX}${portalId}`;
}
type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string; extra?: string }
  | { kind: "success"; response: ParseResponse };

export function SourceUploader({ portals }: { portals: PortalSummary[] }) {
  const searchParams = useSearchParams();
  // Resume mode kicks in when /jobs/[id] links here with ?resume=<jobId>&
  // portalId=<...>&mappingId=<...>. The wizard pre-selects the portal +
  // auto-loads the mapping profile so the user only has to re-upload the
  // same source files and click Execute; the resume flag threads through
  // to /api/portals/[id]/execute which reuses the existing job row.
  const resumeJobId = searchParams.get("resume");
  const resumePortalId = searchParams.get("portalId");
  const resumeMappingId = searchParams.get("mappingId");

  const [mode, setMode] = useState<Mode>("csv");
  const [portalId, setPortalId] = useState<string>(
    resumePortalId ?? portals[0]?.id ?? "",
  );
  const [state, setState] = useState<SubmitState>({ kind: "idle" });
  const [portalTables, setPortalTables] = useState<HubdbTable[]>([]);
  const [portalSchemaState, setPortalSchemaState] = useState<"idle" | "loading" | "error" | "ready">("idle");
  const [portalSchemaError, setPortalSchemaError] = useState<string | null>(null);
  const [mappings, setMappings] = useState<Record<string, MappingState>>({});
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [resumeStatus, setResumeStatus] = useState<null | "loading" | "loaded" | "error">(
    resumeJobId ? "loading" : null,
  );
  const [resumeError, setResumeError] = useState<string | null>(null);
  // Cleared whenever sources/mappings change (either edit or profile load)
  // so ExecutePanel can gate on a fresh dry run.
  const [dryRunSignature, setDryRunSignature] = useState<string | null>(null);
  // gsheets tab: dynamic list of {tableName, url} pairs. Start with one row.
  const [gsheetRows, setGsheetRows] = useState<{ tableName: string; url: string }[]>([
    { tableName: "", url: "" },
  ]);
  // sessionStorage-backed wizard state. Persist mode + mappings +
  // selectedProfileId + gsheetRows so navigating to /portals/[id]/schema and
  // back doesn't drop everything. Raw parsed rows are NOT persisted (too big
  // for the ~5 MB sessionStorage cap) — user re-parses on return; the
  // mapping config (the expensive-to-recreate thing) survives.
  // Ref, not state — setting state in the hydration effect would trip the
  // react-hooks/set-state-in-effect lint rule. Hydration is a one-shot
  // gate; we don't need a re-render when it completes.
  const hydratedRef = useRef(false);

  // Auto-load the linked mapping profile on resume so the wizard is
  // pre-configured before the user re-uploads sources.
  useEffect(() => {
    if (!resumeJobId || !resumeMappingId) return;
    let cancelled = false;
    fetch(`/api/mappings/${resumeMappingId}`)
      .then(async (res) => {
        const body = (await res.json()) as { profile?: { id: string; state: Record<string, MappingState> }; error?: string };
        if (cancelled) return;
        if (!res.ok || !body.profile) {
          setResumeStatus("error");
          setResumeError(body.error ?? `HTTP ${res.status}`);
          return;
        }
        setMappings(body.profile.state);
        setSelectedProfileId(body.profile.id);
        setResumeStatus("loaded");
      })
      .catch((err) => {
        if (cancelled) return;
        setResumeStatus("error");
        setResumeError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [resumeJobId, resumeMappingId]);

  // Hydrate from sessionStorage on mount. Resume flow takes precedence — if
  // the user landed here via /jobs/[id] Resume, we honor that mapping load
  // instead of last session's state.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!portalId) return;
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    if (resumeJobId) return;
    try {
      const raw = window.sessionStorage.getItem(sessionKey(portalId));
      if (!raw) return;
      const saved = JSON.parse(raw) as SessionState;
      // Legit external-source hydration — the react-hooks/set-state-in-effect
      // lint rule is a warning about avoidable cascading renders, not about
      // one-shot mount-time syncs from client-only storage. React docs OK
      // this pattern (alternative would be useSyncExternalStore, overkill here).
      /* eslint-disable react-hooks/set-state-in-effect */
      if (saved.mode === "csv" || saved.mode === "xlsx" || saved.mode === "json" || saved.mode === "gsheets") {
        setMode(saved.mode);
      }
      if (saved.mappings && typeof saved.mappings === "object") {
        setMappings(saved.mappings as Record<string, MappingState>);
      }
      if (typeof saved.selectedProfileId === "string" || saved.selectedProfileId === null) {
        setSelectedProfileId(saved.selectedProfileId);
      }
      if (Array.isArray(saved.gsheetRows) && saved.gsheetRows.length > 0) {
        setGsheetRows(saved.gsheetRows);
      }
      /* eslint-enable react-hooks/set-state-in-effect */
    } catch {
      // ignore parse errors — treat as no saved state
    }
  }, [portalId, resumeJobId]);

  // Persist on any change once hydrated. Skip empty payloads (initial-mount
  // render, where state is at defaults) — otherwise the persist effect fires
  // before hydration has committed the loaded state and briefly overwrites
  // saved data with defaults. Empty state removes the key instead, so the
  // "Clear session" flow (which sets everything back to defaults) works.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!hydratedRef.current || !portalId) return;
    const hasContent =
      Object.keys(mappings).length > 0 ||
      selectedProfileId !== null ||
      gsheetRows.some((r) => r.tableName || r.url);
    try {
      if (hasContent) {
        const payload: SessionState = { mode, mappings, selectedProfileId, gsheetRows };
        window.sessionStorage.setItem(sessionKey(portalId), JSON.stringify(payload));
      } else {
        window.sessionStorage.removeItem(sessionKey(portalId));
      }
    } catch {
      // sessionStorage might be full or disabled — silently skip
    }
  }, [portalId, mode, mappings, selectedProfileId, gsheetRows]);

  function clearSession() {
    if (typeof window === "undefined" || !portalId) return;
    try {
      window.sessionStorage.removeItem(sessionKey(portalId));
    } catch {}
    setMappings({});
    setSelectedProfileId(null);
    setGsheetRows([{ tableName: "", url: "" }]);
    setDryRunSignature(null);
    setState({ kind: "idle" });
  }

  useEffect(() => {
    if (!portalId) return;
    let cancelled = false;
    startTransition(() => {
      setPortalSchemaState("loading");
      setPortalSchemaError(null);
    });
    fetch(`/api/portals/${portalId}/schema`)
      .then(async (res) => {
        const body = (await res.json()) as { tables?: HubdbTable[]; error?: string };
        if (cancelled) return;
        startTransition(() => {
          if (!res.ok) {
            setPortalSchemaError(body.error ?? `HTTP ${res.status}`);
            setPortalSchemaState("error");
            setPortalTables([]);
            return;
          }
          setPortalTables(body.tables ?? []);
          setPortalSchemaState("ready");
        });
      })
      .catch((err) => {
        if (cancelled) return;
        startTransition(() => {
          setPortalSchemaError((err as Error).message);
          setPortalSchemaState("error");
        });
      });
    return () => {
      cancelled = true;
    };
  }, [portalId]);

  function updateMapping(sourceName: string, next: MappingState) {
    setMappings((prev) => ({ ...prev, [sourceName]: next }));
    setDryRunSignature(null);
  }

  function loadProfile(next: Record<string, MappingState>, profileId: string) {
    setMappings(next);
    setSelectedProfileId(profileId);
    setDryRunSignature(null);
  }

  const currentSourceNames =
    state.kind === "success" ? state.response.tables.map((t) => t.name) : [];

  async function submitCsv(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState({ kind: "submitting" });
    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/sources/csv", { method: "POST", body: form });
      const payload = (await res.json()) as ParseResponse;
      if (!res.ok) {
        setState({ kind: "error", message: payload.error ?? `HTTP ${res.status}` });
        return;
      }
      setState({ kind: "success", response: payload });
      setDryRunSignature(null);
    } catch (err) {
      setState({ kind: "error", message: (err as Error).message });
    }
  }

  async function submitXlsx(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState({ kind: "submitting" });
    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/sources/xlsx", { method: "POST", body: form });
      const payload = (await res.json()) as ParseResponse;
      if (!res.ok) {
        setState({ kind: "error", message: payload.error ?? `HTTP ${res.status}` });
        return;
      }
      setState({ kind: "success", response: payload });
      setDryRunSignature(null);
    } catch (err) {
      setState({ kind: "error", message: (err as Error).message });
    }
  }

  async function submitGsheets(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const cleanedRows = gsheetRows
      .map((r) => ({ tableName: r.tableName.trim(), url: r.url.trim() }))
      .filter((r) => r.tableName || r.url);
    if (cleanedRows.length === 0) {
      setState({ kind: "error", message: "add at least one table name + URL pair" });
      return;
    }
    setState({ kind: "submitting" });
    try {
      const res = await fetch("/api/sources/gsheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sources: cleanedRows }),
      });
      const payload = (await res.json()) as ParseResponse;
      if (!res.ok) {
        setState({ kind: "error", message: payload.error ?? `HTTP ${res.status}` });
        return;
      }
      setState({ kind: "success", response: payload });
      setDryRunSignature(null);
    } catch (err) {
      setState({ kind: "error", message: (err as Error).message });
    }
  }

  async function submitJson(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState({ kind: "submitting" });
    const form = new FormData(e.currentTarget);
    const payload = String(form.get("payload") ?? "");
    try {
      const res = await fetch("/api/sources/json", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload }),
      });
      const body = (await res.json()) as ParseResponse;
      if (!res.ok) {
        setState({
          kind: "error",
          message: body.error ?? `HTTP ${res.status}`,
          extra: body.path ? `at ${body.path}` : body.kind,
        });
        return;
      }
      setState({ kind: "success", response: body });
      setDryRunSignature(null);
    } catch (err) {
      setState({ kind: "error", message: (err as Error).message });
    }
  }

  const disabled = state.kind === "submitting" || portals.length === 0;

  return (
    <div className="space-y-8">
      {resumeJobId ? (
        <section className="space-y-1 rounded-md border border-primary/40 bg-primary/5 p-4 text-sm">
          <p className="font-semibold">Resuming job {resumeJobId}</p>
          <p className="text-xs text-muted-foreground">
            {resumeStatus === "loading"
              ? "Loading the linked mapping profile…"
              : resumeStatus === "loaded"
                ? "Mapping profile pre-loaded. Re-upload the same source files, run the dry run, then Execute — the run continues on the existing job row and upserts by natural key so already-imported rows are no-ops."
                : resumeStatus === "error"
                  ? `Could not load the linked mapping profile: ${resumeError}. You can still re-configure the mapping by hand — the resume job id will still be used on Execute.`
                  : null}
          </p>
        </section>
      ) : null}

      {!resumeJobId && state.kind === "idle" && Object.keys(mappings).length > 0 ? (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-primary/40 bg-primary/5 p-3 text-sm">
          <div className="space-y-0.5">
            <p className="font-medium">
              Restored {Object.keys(mappings).length} mapping{Object.keys(mappings).length === 1 ? "" : "s"} from your last session on this portal
            </p>
            <p className="text-xs text-muted-foreground">
              Re-fetch or re-upload your source files below — the mapping config is already filled in and will attach automatically.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={clearSession}>
            Clear session
          </Button>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Target portal</h2>
        <Select
          value={portalId}
          onValueChange={(v) => setPortalId(v ?? "")}
          disabled={portals.length === 0}
          items={portals.map((p) => ({
            value: p.id,
            label: `${p.label} · ${p.env}${p.hubId ? ` · Hub ${p.hubId}` : ""}`,
          }))}
        >
          <SelectTrigger className="w-full max-w-sm">
            <SelectValue placeholder={portals.length === 0 ? "No portals available" : "Pick a portal"} />
          </SelectTrigger>
          <SelectContent>
            {portals.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.label} · {p.env}
                {p.hubId ? ` · Hub ${p.hubId}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Parsing runs entirely on the server; the portal isn&apos;t contacted until the mapping + provisioning steps.
        </p>
      </section>

      {portalId ? (
        <ProfilePanel
          portalId={portalId}
          mappings={mappings}
          currentSourceNames={currentSourceNames}
          onLoad={loadProfile}
          onSelectionCleared={() => setSelectedProfileId(null)}
        />
      ) : null}

      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <ModeTab active={mode === "csv"} onClick={() => setMode("csv")}>
            CSV upload
          </ModeTab>
          <ModeTab active={mode === "xlsx"} onClick={() => setMode("xlsx")}>
            XLSX upload
          </ModeTab>
          <ModeTab active={mode === "json"} onClick={() => setMode("json")}>
            JSON paste
          </ModeTab>
          <ModeTab active={mode === "gsheets"} onClick={() => setMode("gsheets")}>
            Google Sheets
          </ModeTab>
        </div>

        {mode === "csv" ? (
          <form onSubmit={submitCsv} className="space-y-4 rounded-md border border-border p-4">
            <TutorialPanel>
              <p>
                A CSV is a plain-text spreadsheet — the kind you get by exporting from Excel, Google
                Sheets, or Numbers. Each CSV file you upload becomes one HubDB table.
              </p>
              <TutorialSteps>
                <li>
                  Prepare your data so <strong>row 1 is the column headers</strong> (like{" "}
                  <code className="rounded bg-muted px-1 text-xs">sku,name,price</code>) and every row
                  below is one record.
                </li>
                <li>
                  Save each table as its own CSV file: <em>File → Save As</em> (Excel/Numbers) or{" "}
                  <em>File → Download → CSV</em> (Google Sheets).
                </li>
                <li>
                  Name each file after the HubDB table it represents (e.g.{" "}
                  <code className="rounded bg-muted px-1 text-xs">brands.csv</code>,{" "}
                  <code className="rounded bg-muted px-1 text-xs">products.csv</code>) — the filename
                  becomes the table name here.
                </li>
                <li>
                  Click <em>Choose files</em> below and pick all your CSVs at once, then{" "}
                  <em>Parse CSV</em>.
                </li>
              </TutorialSteps>
              <TutorialTip>
                If Excel gave you a semicolon-delimited file (common outside the US), pick{" "}
                <code className="rounded bg-muted px-1 text-xs">;</code> in the Delimiter dropdown. If
                characters look garbled after parsing, try <em>utf-16le</em> under Encoding.
              </TutorialTip>
            </TutorialPanel>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">CSV files (one per table)</span>
              <input
                name="file"
                type="file"
                accept=".csv,text/csv"
                multiple
                required
                disabled={disabled}
                className="text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-muted/60"
              />
              <span className="text-xs text-muted-foreground">
                Table name is derived from the filename (extension stripped).
              </span>
            </label>

            <div className="grid gap-3 sm:grid-cols-3">
              <SelectField
                label="Delimiter"
                name="delimiter"
                hint="Auto-detected if blank"
                disabled={disabled}
                options={[
                  { value: "", label: "auto" },
                  { value: ",", label: ", (comma)" },
                  { value: ";", label: "; (semicolon)" },
                  { value: "\t", label: "\\t (tab)" },
                  { value: "|", label: "| (pipe)" },
                ]}
              />
              <SelectField
                label="Encoding"
                name="encoding"
                hint="Auto from BOM if blank"
                disabled={disabled}
                options={[
                  { value: "", label: "auto" },
                  { value: "utf-8", label: "utf-8" },
                  { value: "utf-16le", label: "utf-16le" },
                  { value: "utf-16be", label: "utf-16be" },
                ]}
              />
              <InputField
                label="Header row"
                name="headerRow"
                hint="0-based index (default 0)"
                type="number"
                min={0}
                disabled={disabled}
              />
            </div>

            <div className="flex items-center gap-3">
              <Button type="submit" disabled={disabled}>
                {state.kind === "submitting" ? "Parsing…" : "Parse CSV"}
              </Button>
              {state.kind === "error" ? (
                <p className="text-sm text-destructive">
                  {state.message}
                  {state.extra ? ` (${state.extra})` : ""}
                </p>
              ) : null}
            </div>
          </form>
        ) : mode === "xlsx" ? (
          <form onSubmit={submitXlsx} className="space-y-4 rounded-md border border-border p-4">
            <TutorialPanel>
              <p>
                XLSX is Microsoft Excel&apos;s file format (.xlsx). Each <strong>sheet tab</strong>{" "}
                inside the workbook becomes its own HubDB table — so one workbook can carry multiple
                related tables (brands + categories + products, etc.) in a single file.
              </p>
              <TutorialSteps>
                <li>Open your workbook in Excel, Google Sheets, or Numbers.</li>
                <li>
                  Make sure each sheet tab has its column headers on <strong>row 1</strong> and one
                  record per row underneath.
                </li>
                <li>
                  Rename each sheet tab to match the HubDB table it represents (e.g.{" "}
                  <code className="rounded bg-muted px-1 text-xs">brands</code>,{" "}
                  <code className="rounded bg-muted px-1 text-xs">categories</code>,{" "}
                  <code className="rounded bg-muted px-1 text-xs">products</code>).
                </li>
                <li>
                  Save as <em>.xlsx</em>. In Google Sheets: <em>File → Download → Microsoft Excel</em>.
                </li>
                <li>Upload the file below and click <em>Parse XLSX</em>.</li>
              </TutorialSteps>
              <TutorialTip>
                Leave <em>Sheet allowlist</em> blank to import every sheet in the workbook. To only
                import specific ones, type their names comma-separated (e.g.{" "}
                <code className="rounded bg-muted px-1 text-xs">brands, products</code>). Single-sheet
                workbooks are named after the filename; multi-sheet workbooks combine as{" "}
                <code className="rounded bg-muted px-1 text-xs">filename__sheetname</code>.
              </TutorialTip>
            </TutorialPanel>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">XLSX files</span>
              <input
                name="file"
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                multiple
                required
                disabled={disabled}
                className="text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-muted/60"
              />
              <span className="text-xs text-muted-foreground">
                Each sheet becomes a table. Single-sheet workbooks use the filename; multi-sheet
                workbooks combine as <code>filename__sheetname</code>.
              </span>
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Sheet allowlist</span>
                <input
                  name="sheetNames"
                  type="text"
                  disabled={disabled}
                  placeholder="brands, categories, products"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                />
                <span className="text-xs text-muted-foreground">
                  Comma-separated names. Blank = all sheets.
                </span>
              </label>
              <InputField
                label="Header row"
                name="headerRow"
                hint="0-based index (default 0)"
                type="number"
                min={0}
                disabled={disabled}
              />
            </div>

            <div className="flex items-center gap-3">
              <Button type="submit" disabled={disabled}>
                {state.kind === "submitting" ? "Parsing…" : "Parse XLSX"}
              </Button>
              {state.kind === "error" ? (
                <p className="text-sm text-destructive">
                  {state.message}
                  {state.extra ? ` (${state.extra})` : ""}
                </p>
              ) : null}
            </div>
          </form>
        ) : mode === "gsheets" ? (
          <form onSubmit={submitGsheets} className="space-y-4 rounded-md border border-border p-4">
            <TutorialPanel>
              <p>
                Import straight from a Google Sheet without downloading anything. The sheet stays
                private in your Drive — only the specific tab you publish becomes accessible via the
                secret URL you paste here.
              </p>
              <TutorialSteps>
                <li>Open your Google Sheet in a browser.</li>
                <li>
                  Menu: <em>File → Share → Publish to web</em>.
                </li>
                <li>
                  In the dialog, use the <strong>left dropdown</strong> to pick a specific sheet tab
                  (not <em>Entire document</em>).
                </li>
                <li>
                  Use the <strong>right dropdown</strong> to change the format from <em>Web page</em>{" "}
                  to <strong>Comma-separated values (.csv)</strong>.
                </li>
                <li>
                  Click <em>Publish</em>, confirm the prompt, and copy the URL Google shows you (it
                  looks like{" "}
                  <code className="rounded bg-muted px-1 text-xs">
                    …/spreadsheets/d/e/…/pub?output=csv&gid=…
                  </code>
                  ).
                </li>
                <li>
                  Paste it below, name the table (e.g.{" "}
                  <code className="rounded bg-muted px-1 text-xs">brands</code>), and click{" "}
                  <em>Add another sheet</em> to repeat for each additional table.
                </li>
                <li>Click <em>Fetch sheets</em> when all URLs are in.</li>
              </TutorialSteps>
              <TutorialTip>
                Edits you make to the sheet after publishing take a minute or two to appear at the
                published URL — Google caches it. If you re-fetch and the data looks stale, wait
                90 seconds and try again.
              </TutorialTip>
            </TutorialPanel>
            <div className="space-y-1 text-sm">
              <p className="font-medium">Published Google Sheets URLs</p>
              <p className="text-xs text-muted-foreground">
                One URL per HubDB table.
              </p>
            </div>

            <div className="space-y-3">
              {gsheetRows.map((row, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto]">
                  <input
                    type="text"
                    value={row.tableName}
                    onChange={(e) => {
                      const next = e.target.value;
                      setGsheetRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, tableName: next } : r)));
                    }}
                    disabled={disabled}
                    placeholder={i === 0 ? "table name (e.g. brands)" : "table name"}
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                  />
                  <input
                    type="url"
                    value={row.url}
                    onChange={(e) => {
                      const next = e.target.value;
                      setGsheetRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, url: next } : r)));
                    }}
                    disabled={disabled}
                    placeholder="https://docs.google.com/spreadsheets/d/e/…/pub?output=csv&gid=…"
                    className="h-9 rounded-md border border-input bg-background px-3 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={disabled || gsheetRows.length === 1}
                    onClick={() => setGsheetRows((prev) => prev.filter((_, idx) => idx !== i))}
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => setGsheetRows((prev) => [...prev, { tableName: "", url: "" }])}
              >
                Add another sheet
              </Button>
              <Button type="submit" disabled={disabled}>
                {state.kind === "submitting" ? "Fetching…" : "Fetch sheets"}
              </Button>
              {state.kind === "error" ? (
                <p className="text-sm text-destructive">
                  {state.message}
                  {state.extra ? ` (${state.extra})` : ""}
                </p>
              ) : null}
            </div>
          </form>
        ) : (
          <form onSubmit={submitJson} className="space-y-4 rounded-md border border-border p-4">
            <TutorialPanel title="What's JSON? (developer format — most users can skip)">
              <p>
                JSON is a text format typically written by developers or exported from another
                system. If you&apos;re not sure what JSON is, use the <strong>CSV</strong>,{" "}
                <strong>XLSX</strong>, or <strong>Google Sheets</strong> tabs instead — they cover
                the same use case without the syntax.
              </p>
              <p>Two shapes are accepted:</p>
              <TutorialSteps>
                <li>
                  <strong>Keyed by table name</strong> (each key is a table, each value is an array of
                  rows):
                  <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 text-xs">{`{
  "brands":     [{ "slug": "acme", "name": "Acme" }],
  "categories": [{ "slug": "tools", "name": "Tools" }]
}`}</pre>
                </li>
                <li>
                  <strong>Array of {'{table, rows}'} objects</strong>:
                  <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 text-xs">{`[
  { "table": "brands",     "rows": [{ "slug": "acme", "name": "Acme" }] },
  { "table": "categories", "rows": [{ "slug": "tools", "name": "Tools" }] }
]`}</pre>
                </li>
              </TutorialSteps>
              <TutorialTip>
                Each cell value must be a plain string, number, or boolean — no nested objects or
                arrays. If you have a multi-value field (like multiple category tags), join them
                with a delimiter like <code className="rounded bg-muted px-1 text-xs">,</code> and
                configure that in the foreign-key panel on the mapping step.
              </TutorialTip>
            </TutorialPanel>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">JSON payload</span>
              <textarea
                name="payload"
                required
                rows={10}
                disabled={disabled}
                placeholder={'{\n  "brands": [{ "slug": "acme", "name": "Acme" }],\n  "categories": [{ "name": "Tools" }]\n}'}
                className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
              />
              <span className="text-xs text-muted-foreground">
                Accepts <code>{`{ "table": [rows] }`}</code> or{" "}
                <code>{`[{ "table": "name", "rows": [rows] }]`}</code>. Cells must be scalars or delimited strings —
                nested objects/arrays are rejected with a path pointer.
              </span>
            </label>
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={disabled}>
                {state.kind === "submitting" ? "Parsing…" : "Parse JSON"}
              </Button>
              {state.kind === "error" ? (
                <p className="text-sm text-destructive">
                  {state.message}
                  {state.extra ? ` (${state.extra})` : ""}
                </p>
              ) : null}
            </div>
          </form>
        )}
      </section>

      {state.kind === "success" ? (
        <Results
          response={state.response}
          portalId={portalId}
          portalTables={portalTables}
          portalSchemaState={portalSchemaState}
          portalSchemaError={portalSchemaError}
          mappings={mappings}
          onMappingChange={updateMapping}
          profileId={selectedProfileId}
          resumeJobId={resumeJobId}
          dryRunSignature={dryRunSignature}
          onDryRunComplete={setDryRunSignature}
        />
      ) : null}
    </div>
  );
}

function ModeTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded-md px-3 py-1.5 text-sm font-medium transition-colors " +
        (active
          ? "bg-foreground text-background"
          : "border border-border text-muted-foreground hover:bg-muted/60")
      }
    >
      {children}
    </button>
  );
}

function InputField({
  label,
  name,
  hint,
  disabled,
  ...rest
}: {
  label: string;
  name: string;
  hint?: string;
  disabled?: boolean;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <input
        name={name}
        disabled={disabled}
        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
        {...rest}
      />
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

const AUTO_SENTINEL = "__auto__";

function SelectField({
  label,
  name,
  hint,
  disabled,
  options,
}: {
  label: string;
  name: string;
  hint?: string;
  disabled?: boolean;
  options: readonly { value: string; label: string }[];
}) {
  // Base UI Select rejects empty-string values, so map "" to a sentinel
  // that we translate back to "" for the hidden input (FormData).
  const initial = options[0]?.value ?? "";
  const [value, setValue] = useState<string>(initial === "" ? AUTO_SENTINEL : initial);
  const formValue = value === AUTO_SENTINEL ? "" : value;
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <input type="hidden" name={name} value={formValue} />
      <Select
        value={value}
        onValueChange={(v) => setValue(v ?? AUTO_SENTINEL)}
        disabled={disabled}
        items={options.map((o) => ({
          value: o.value === "" ? AUTO_SENTINEL : o.value,
          label: o.label,
        }))}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => {
            const key = o.value === "" ? AUTO_SENTINEL : o.value;
            return (
              <SelectItem key={key} value={key}>
                {o.label}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

function Results({
  response,
  portalId,
  portalTables,
  portalSchemaState,
  portalSchemaError,
  mappings,
  onMappingChange,
  profileId,
  resumeJobId,
  dryRunSignature,
  onDryRunComplete,
}: {
  response: ParseResponse;
  portalId: string;
  portalTables: HubdbTable[];
  portalSchemaState: "idle" | "loading" | "error" | "ready";
  portalSchemaError: string | null;
  mappings: Record<string, MappingState>;
  onMappingChange: (source: string, next: MappingState) => void;
  profileId: string | null;
  resumeJobId: string | null;
  dryRunSignature: string | null;
  onDryRunComplete: (signature: string) => void;
}) {
  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Parsed tables ({response.tables.length})</h2>
        {response.warnings && response.warnings.length > 0 ? (
          <span className="text-xs text-muted-foreground">{response.warnings.length} top-level notice(s)</span>
        ) : null}
      </div>

      {response.warnings && response.warnings.length > 0 ? (
        <ul className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 text-xs">
          {response.warnings.map((w, i) => (
            <li key={i} className="text-yellow-800 dark:text-yellow-200">{w}</li>
          ))}
        </ul>
      ) : null}

      {portalSchemaState === "loading" ? (
        <p className="text-xs text-muted-foreground">Fetching target-portal schema…</p>
      ) : portalSchemaState === "error" ? (
        <p className="text-xs text-destructive">Could not load portal schema: {portalSchemaError}</p>
      ) : null}

      {(() => {
        const allSources: SourceTable[] = response.tables.map((t) => ({ name: t.name, headers: t.headers, rows: t.rows }));
        const orderPlan = deriveImportOrder(allSources.map((s) => s.name), mappings);
        const showOrderPanel =
          portalSchemaState === "ready" &&
          Object.values(mappings).some((m) => Object.keys(m.foreignKeys).length > 0);
        const showDryRun =
          portalSchemaState === "ready" &&
          Object.values(mappings).some((m) => m.targetTableName && m.naturalKey.length > 0);
        return (
          <>
            <SchemaInferPanel sources={allSources} />
            {showOrderPanel ? <ImportOrderPanel plan={orderPlan} /> : null}
            {showDryRun ? (
              <DryRunPanel
                portalId={portalId}
                sources={allSources}
                mappings={mappings}
                onComplete={onDryRunComplete}
              />
            ) : null}
            {showDryRun ? (
              <ExecutePanel
                portalId={portalId}
                sources={allSources}
                mappings={mappings}
                profileId={profileId}
                resumeJobId={resumeJobId}
                dryRunSignature={dryRunSignature}
                disabled={false}
                disabledReason="Run a dry run first — execute is gated on a matching dry-run signature."
              />
            ) : null}
            {response.tables.map((t) => {
          const source = allSources.find((s) => s.name === t.name)!;
          const mapping = mappings[t.name] ?? initialMappingState();
          return (
            <div key={t.name} className="space-y-3">
              <TableCard table={t} />
              {portalSchemaState === "ready" ? (
                <MappingEditor
                  source={source}
                  allSources={allSources}
                  portalTables={portalTables}
                  value={mapping}
                  onChange={(next) => onMappingChange(t.name, next)}
                />
              ) : null}
            </div>
          );
        })}
          </>
        );
      })()}
    </section>
  );
}

function TableCard({ table }: { table: ParsedTable }) {
  const totalWarnings = table.parseWarnings.length + table.validationWarnings.length;
  return (
    <article className="space-y-3 rounded-md border border-border p-4">
      <header className="flex flex-wrap items-baseline gap-3">
        <h3 className="text-base font-semibold">{table.name}</h3>
        {table.filename ? (
          <span className="text-xs text-muted-foreground">from {table.filename}</span>
        ) : null}
        <span className="ml-auto text-xs text-muted-foreground">
          {table.totalRows.toLocaleString()} row{table.totalRows === 1 ? "" : "s"} · {table.headers.length} column{table.headers.length === 1 ? "" : "s"}
        </span>
      </header>

      {table.detected ? (
        <p className="text-xs text-muted-foreground">
          detected: {table.detected.encoding}
          {table.detected.hadBOM ? " (BOM)" : ""} · delimiter <code className="rounded bg-muted px-1">{table.detected.delimiter === "\t" ? "\\t" : table.detected.delimiter}</code>
        </p>
      ) : null}

      {totalWarnings > 0 ? (
        <ul className="space-y-1 rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 text-xs">
          {table.parseWarnings.map((w, i) => (
            <li key={`p-${i}`} className="text-yellow-800 dark:text-yellow-200">parse: {w}</li>
          ))}
          {table.validationWarnings.map((w, i) => (
            <li key={`v-${i}`} className="text-yellow-800 dark:text-yellow-200">
              <span className="font-mono uppercase tracking-wider">{w.kind}</span> — {w.message}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-xs">
          <thead className="bg-muted/60 text-left">
            <tr>
              {table.headers.map((h) => (
                <th key={h} className="px-3 py-2 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.preview.length === 0 ? (
              <tr>
                <td colSpan={Math.max(table.headers.length, 1)} className="px-3 py-4 text-center text-muted-foreground">
                  no rows
                </td>
              </tr>
            ) : (
              table.preview.map((row, i) => (
                <tr key={i} className="border-t border-border">
                  {table.headers.map((h) => (
                    <td key={h} className="px-3 py-2 align-top">{truncate(row[h] ?? "")}</td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {table.totalRows > table.preview.length ? (
        <p className="text-xs text-muted-foreground">
          showing first {table.preview.length} of {table.totalRows.toLocaleString()} rows
        </p>
      ) : null}
    </article>
  );
}

function truncate(v: string, max = 120): string {
  return v.length > max ? `${v.slice(0, max)}…` : v;
}
