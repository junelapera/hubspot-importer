"use client";

import { startTransition, useEffect, useState, type FormEvent } from "react";
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
import { deriveImportOrder } from "@/lib/mapping";

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

type Mode = "csv" | "json";
type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string; extra?: string }
  | { kind: "success"; response: ParseResponse };

export function SourceUploader({ portals }: { portals: PortalSummary[] }) {
  const [mode, setMode] = useState<Mode>("csv");
  const [portalId, setPortalId] = useState<string>(portals[0]?.id ?? "");
  const [state, setState] = useState<SubmitState>({ kind: "idle" });
  const [portalTables, setPortalTables] = useState<HubdbTable[]>([]);
  const [portalSchemaState, setPortalSchemaState] = useState<"idle" | "loading" | "error" | "ready">("idle");
  const [portalSchemaError, setPortalSchemaError] = useState<string | null>(null);
  const [mappings, setMappings] = useState<Record<string, MappingState>>({});
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);

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
  }

  function loadProfile(next: Record<string, MappingState>, profileId: string) {
    setMappings(next);
    setSelectedProfileId(profileId);
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
    } catch (err) {
      setState({ kind: "error", message: (err as Error).message });
    }
  }

  const disabled = state.kind === "submitting" || portals.length === 0;

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Target portal</h2>
        <select
          value={portalId}
          onChange={(e) => setPortalId(e.target.value)}
          disabled={portals.length === 0}
          className="w-full max-w-sm rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {portals.length === 0 ? (
            <option value="">No portals available</option>
          ) : (
            portals.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} · {p.env}
                {p.hubId ? ` · Hub ${p.hubId}` : ""}
              </option>
            ))
          )}
        </select>
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
              <SelectField label="Delimiter" name="delimiter" hint="Auto-detected if blank" disabled={disabled}>
                <option value="">auto</option>
                <option value=",">, (comma)</option>
                <option value=";">; (semicolon)</option>
                <option value="\t">\t (tab)</option>
                <option value="|">| (pipe)</option>
              </SelectField>
              <SelectField label="Encoding" name="encoding" hint="Auto from BOM if blank" disabled={disabled}>
                <option value="">auto</option>
                <option value="utf-8">utf-8</option>
                <option value="utf-16le">utf-16le</option>
                <option value="utf-16be">utf-16be</option>
              </SelectField>
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
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
        {...rest}
      />
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

function SelectField({
  label,
  name,
  hint,
  disabled,
  children,
}: {
  label: string;
  name: string;
  hint?: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <select
        name={name}
        disabled={disabled}
        defaultValue=""
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {children}
      </select>
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
}: {
  response: ParseResponse;
  portalId: string;
  portalTables: HubdbTable[];
  portalSchemaState: "idle" | "loading" | "error" | "ready";
  portalSchemaError: string | null;
  mappings: Record<string, MappingState>;
  onMappingChange: (source: string, next: MappingState) => void;
  profileId: string | null;
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
            {showOrderPanel ? <ImportOrderPanel plan={orderPlan} /> : null}
            {showDryRun ? (
              <DryRunPanel portalId={portalId} sources={allSources} mappings={mappings} />
            ) : null}
            {showDryRun ? (
              <ExecutePanel
                portalId={portalId}
                sources={allSources}
                mappings={mappings}
                profileId={profileId}
                disabled={false}
                disabledReason="Run a dry run first to preview what will happen — the API endpoint will still refuse execution if the synthesized mapping isn't valid."
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
