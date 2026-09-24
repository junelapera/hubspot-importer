"use client";

import { startTransition, useEffect, useState, type FormEvent } from "react";
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

type Mode = "csv" | "xlsx" | "json";
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
        </div>

        {mode === "csv" ? (
          <form onSubmit={submitCsv} className="space-y-4 rounded-md border border-border p-4">
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
        ) : (
          <form onSubmit={submitJson} className="space-y-4 rounded-md border border-border p-4">
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
