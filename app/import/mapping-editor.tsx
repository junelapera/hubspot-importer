"use client";

import { useMemo } from "react";
import type { HubdbColumn, HubdbTable } from "@/lib/hubdb";
import {
  autoMap,
  countResolvable,
  detectTypeMismatch,
  initialForeignKeyConfig,
  initialMappingState as initialMappingStateLib,
  validatePathColumn,
  type ColumnAssignment,
  type ColumnMap,
  type ForeignKeyConfig,
  type FkMatching,
  type FkOnMissing,
  type MappingState as LibMappingState,
  type TypeMismatch,
} from "@/lib/mapping";
export type MappingState = LibMappingState;
export const initialMappingState = initialMappingStateLib;
import type { Delimiter } from "@/lib/resolve";
import { validateSource, type Warning } from "@/lib/source/validate";

export interface SourceTable {
  name: string;
  headers: string[];
  rows: Record<string, string>[];
}


export function MappingEditor({
  source,
  allSources,
  portalTables,
  value,
  onChange,
}: {
  source: SourceTable;
  allSources: SourceTable[];
  portalTables: HubdbTable[];
  value: MappingState;
  onChange: (next: MappingState) => void;
}) {
  const target = useMemo(
    () => portalTables.find((t) => t.name === value.targetTableName) ?? null,
    [portalTables, value.targetTableName],
  );

  const siblingSources = useMemo(
    () => allSources.filter((s) => s.name !== source.name),
    [allSources, source.name],
  );

  function foreignKeyColumns(t: HubdbTable, map: ColumnMap): { sourceCol: string; targetCol: HubdbColumn }[] {
    const out: { sourceCol: string; targetCol: HubdbColumn }[] = [];
    for (const [sourceCol, a] of Object.entries(map)) {
      if (a.kind !== "mapped") continue;
      const tc = t.columns.find((c) => c.name === a.targetColumn);
      if (tc?.type === "FOREIGN_ID") out.push({ sourceCol, targetCol: tc });
    }
    return out;
  }

  function chooseTarget(name: string) {
    const next = portalTables.find((t) => t.name === name) ?? null;
    if (!next) {
      onChange({
        ...value,
        targetTableName: null,
        targetTableId: null,
        columnMap: {},
        naturalKey: [],
        foreignKeys: {},
      });
      return;
    }
    const columnMap = autoMap(source.headers, next.columns);
    const fkCols = foreignKeyColumns(next, columnMap);
    const foreignKeys: Record<string, ForeignKeyConfig> = {};
    for (const { sourceCol } of fkCols) {
      foreignKeys[sourceCol] = value.foreignKeys[sourceCol] ?? initialForeignKeyConfig();
    }
    onChange({
      ...value,
      targetTableName: name,
      targetTableId: next.id,
      columnMap,
      naturalKey: value.naturalKey.filter((k) => columnMap[k]?.kind === "mapped"),
      hsName: next.useForPages ? value.hsName : null,
      hsPath: next.useForPages ? value.hsPath : null,
      foreignKeys,
    });
  }

  function setAssignment(sourceCol: string, assignment: ColumnAssignment) {
    const columnMap: ColumnMap = { ...value.columnMap, [sourceCol]: assignment };
    // if user un-maps a source column that was in the natural key, drop it
    const naturalKey = value.naturalKey.filter((k) => columnMap[k]?.kind === "mapped");
    const foreignKeys = { ...value.foreignKeys };
    // reconcile FK configs against the new column map
    for (const key of Object.keys(foreignKeys)) {
      const a = columnMap[key];
      if (a?.kind !== "mapped") { delete foreignKeys[key]; continue; }
      const tc = target?.columns.find((c) => c.name === a.targetColumn);
      if (tc?.type !== "FOREIGN_ID") delete foreignKeys[key];
    }
    if (target && assignment.kind === "mapped") {
      const tc = target.columns.find((c) => c.name === assignment.targetColumn);
      if (tc?.type === "FOREIGN_ID" && !foreignKeys[sourceCol]) {
        foreignKeys[sourceCol] = initialForeignKeyConfig();
      }
    }
    onChange({ ...value, columnMap, naturalKey, foreignKeys });
  }

  function setFkConfig(sourceCol: string, patch: Partial<ForeignKeyConfig>) {
    const current = value.foreignKeys[sourceCol] ?? initialForeignKeyConfig();
    onChange({ ...value, foreignKeys: { ...value.foreignKeys, [sourceCol]: { ...current, ...patch } } });
  }

  function toggleNaturalKey(sourceCol: string) {
    const set = new Set(value.naturalKey);
    if (set.has(sourceCol)) set.delete(sourceCol);
    else set.add(sourceCol);
    onChange({ ...value, naturalKey: Array.from(set) });
  }

  const requiredColumns = value.naturalKey;
  const liveWarnings = useMemo<Warning[]>(
    () =>
      validateSource({
        table: source.name,
        rows: source.rows,
        naturalKey: value.naturalKey.length > 0 ? value.naturalKey : undefined,
        requiredColumns: requiredColumns.length > 0 ? requiredColumns : undefined,
      }),
    [source, value.naturalKey, requiredColumns],
  );

  const pathIssues = useMemo(
    () => (value.hsPath ? validatePathColumn(source.rows, value.hsPath) : []),
    [source.rows, value.hsPath],
  );

  return (
    <div className="space-y-4 rounded-md border border-border bg-muted/20 p-4">
      <header className="flex flex-wrap items-baseline gap-3">
        <h4 className="text-sm font-semibold">Mapping · {source.name}</h4>
        <span className="text-xs text-muted-foreground">
          {source.headers.length} column{source.headers.length === 1 ? "" : "s"} · {source.rows.length.toLocaleString()} row
          {source.rows.length === 1 ? "" : "s"}
        </span>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Target HubDB table</span>
          <select
            value={value.targetTableName ?? ""}
            onChange={(e) => chooseTarget(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <option value="">— pick a table —</option>
            {portalTables.map((t) => (
              <option key={t.id} value={t.name}>
                {t.label ?? t.name} ({t.name})
              </option>
            ))}
          </select>
          {value.targetTableId ? (
            <span className="text-xs text-muted-foreground">
              id <code className="rounded bg-muted px-1">{value.targetTableId}</code> — cached in profile
            </span>
          ) : null}
        </label>

        {target?.useForPages ? (
          <div className="grid grid-cols-2 gap-2">
            <SelectField
              label="hs_name column"
              hint="Row label in the HubDB UI"
              value={value.hsName ?? ""}
              onChange={(v) => onChange({ ...value, hsName: v || null })}
              options={mappedSourceColumns(source.headers, value.columnMap)}
            />
            <SelectField
              label="hs_path column"
              hint="Dynamic-page URL slug"
              value={value.hsPath ?? ""}
              onChange={(v) => onChange({ ...value, hsPath: v || null })}
              options={mappedSourceColumns(source.headers, value.columnMap)}
            />
          </div>
        ) : null}
      </div>

      {target ? (
        <>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-xs">
              <thead className="bg-muted/60 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">Source column</th>
                  <th className="px-3 py-2 font-medium">Sample</th>
                  <th className="px-3 py-2 font-medium">Target</th>
                  <th className="px-3 py-2 font-medium">Type check</th>
                  <th className="px-3 py-2 font-medium">Key</th>
                </tr>
              </thead>
              <tbody>
                {source.headers.map((h) => {
                  const assignment = value.columnMap[h] ?? { kind: "unmapped" };
                  const targetCol =
                    assignment.kind === "mapped"
                      ? target.columns.find((c) => c.name === assignment.targetColumn)
                      : undefined;
                  const sample = source.rows.slice(0, 5).map((r) => r[h] ?? "");
                  const mismatch = targetCol ? detectTypeMismatch(sample, targetCol.type) : null;
                  return (
                    <tr key={h} className="border-t border-border align-top">
                      <td className="px-3 py-2 font-medium">{h}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {sampleSummary(sample)}
                      </td>
                      <td className="px-3 py-2">
                        <AssignmentSelect
                          assignment={assignment}
                          targetColumns={target.columns}
                          claimed={claimedTargets(value.columnMap, h)}
                          onChange={(a) => setAssignment(h, a)}
                        />
                        {targetCol ? (
                          <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                            {targetCol.type}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        {mismatch ? <MismatchBadge mismatch={mismatch} /> : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        {assignment.kind === "mapped" ? (
                          <label className="inline-flex items-center gap-1">
                            <input
                              type="checkbox"
                              checked={value.naturalKey.includes(h)}
                              onChange={() => toggleNaturalKey(h)}
                            />
                            <span className="text-[11px] text-muted-foreground">key</span>
                          </label>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {target ? (() => {
            const fkCols = foreignKeyColumns(target, value.columnMap);
            if (fkCols.length === 0) return null;
            return (
              <div className="space-y-3">
                <h5 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Foreign key resolution ({fkCols.length})
                </h5>
                <ul className="space-y-3">
                  {fkCols.map(({ sourceCol, targetCol }) => (
                    <li key={sourceCol}>
                      <ForeignKeyPanel
                        sourceCol={sourceCol}
                        targetCol={targetCol}
                        cfg={value.foreignKeys[sourceCol] ?? initialForeignKeyConfig()}
                        onChange={(patch) => setFkConfig(sourceCol, patch)}
                        siblingSources={siblingSources}
                        mainRows={source.rows}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            );
          })() : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <MappingSummary
              value={value}
              target={target}
              sourceHeaders={source.headers}
            />
            <WarningsPanel warnings={liveWarnings} pathIssues={pathIssues} hsPath={value.hsPath} />
          </div>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          Pick a target table above to auto-match columns and configure the natural key.
        </p>
      )}
    </div>
  );
}

function ForeignKeyPanel({
  sourceCol,
  targetCol,
  cfg,
  onChange,
  siblingSources,
  mainRows,
}: {
  sourceCol: string;
  targetCol: HubdbColumn;
  cfg: ForeignKeyConfig;
  onChange: (patch: Partial<ForeignKeyConfig>) => void;
  siblingSources: SourceTable[];
  mainRows: Record<string, string>[];
}) {
  const foreignSource = useMemo(
    () => siblingSources.find((s) => s.name === cfg.sourceTable) ?? null,
    [siblingSources, cfg.sourceTable],
  );

  const counts = useMemo(() => {
    if (!foreignSource || !cfg.matchKey) return null;
    return countResolvable(mainRows, sourceCol, foreignSource.rows, cfg.matchKey, {
      multi: cfg.multi,
      delimiter: cfg.delimiter,
      matching: cfg.matching,
    });
  }, [foreignSource, cfg.matchKey, cfg.multi, cfg.delimiter, cfg.matching, mainRows, sourceCol]);

  return (
    <article className="space-y-3 rounded-md border border-border bg-background p-3 text-xs">
      <header className="flex flex-wrap items-baseline gap-2">
        <span className="font-semibold">
          <code className="rounded bg-muted px-1">{sourceCol}</code> → <code className="rounded bg-muted px-1">{targetCol.name}</code>
        </span>
        <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          FOREIGN_ID
        </span>
        {targetCol.foreignTableId ? (
          <span className="text-muted-foreground">
            HubDB target table id <code className="rounded bg-muted px-1">{targetCol.foreignTableId}</code>
          </span>
        ) : null}
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="font-medium">Foreign source table</span>
          <select
            value={cfg.sourceTable ?? ""}
            onChange={(e) => onChange({ sourceTable: e.target.value || null, matchKey: null })}
            className="w-full rounded-md border border-input bg-background px-2 py-1 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <option value="">— pick a sibling source —</option>
            {siblingSources.map((s) => (
              <option key={s.name} value={s.name}>{s.name}</option>
            ))}
          </select>
          <span className="text-[10px] text-muted-foreground">
            Sibling parsed source whose row ids we&apos;ll substitute into this cell.
          </span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-medium">Match key column</span>
          <select
            value={cfg.matchKey ?? ""}
            onChange={(e) => onChange({ matchKey: e.target.value || null })}
            disabled={!foreignSource}
            className="w-full rounded-md border border-input bg-background px-2 py-1 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <option value="">— pick a column —</option>
            {foreignSource?.headers.map((h) => (
              <option key={h} value={h}>{h}</option>
            ))}
          </select>
          <span className="text-[10px] text-muted-foreground">
            Foreign-source column whose values appear inside <code className="rounded bg-muted px-1">{sourceCol}</code>.
          </span>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <label className="flex flex-col gap-1">
          <span className="font-medium">Multi-value</span>
          <select
            value={cfg.multi ? "yes" : "no"}
            onChange={(e) => onChange({ multi: e.target.value === "yes" })}
            className="w-full rounded-md border border-input bg-background px-2 py-1 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <option value="no">single</option>
            <option value="yes">multiple</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium">Delimiter</span>
          <select
            value={cfg.delimiter}
            disabled={!cfg.multi}
            onChange={(e) => onChange({ delimiter: e.target.value as Delimiter })}
            className="w-full rounded-md border border-input bg-background px-2 py-1 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <option value=",">, (comma)</option>
            <option value="|">| (pipe)</option>
            <option value=";">; (semicolon)</option>
            <option value={"\n"}>\n (newline)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium">On missing</span>
          <select
            value={cfg.onMissing}
            onChange={(e) => onChange({ onMissing: e.target.value as FkOnMissing })}
            className="w-full rounded-md border border-input bg-background px-2 py-1 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <option value="fail">fail</option>
            <option value="skip-row">skip row</option>
            <option value="null">null the cell</option>
            <option value="create-stub">create stub</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium">Matching</span>
          <select
            value={cfg.matching}
            onChange={(e) => onChange({ matching: e.target.value as FkMatching })}
            className="w-full rounded-md border border-input bg-background px-2 py-1 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <option value="default">default (trim + casefold)</option>
            <option value="strict">strict</option>
          </select>
        </label>
      </div>

      {counts ? (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-[11px]">
          <p>
            <span className="font-medium">Resolvability preview</span> · {counts.matched} row(s) fully resolve ·{" "}
            <span className={counts.unmatched > 0 ? "text-yellow-800 dark:text-yellow-200" : ""}>
              {counts.unmatched} unresolved
            </span>{" "}
            · {counts.empty} empty
          </p>
          <p className="text-muted-foreground">
            {counts.totalValues} value(s) checked, {counts.missingValues} missing from{" "}
            <code className="rounded bg-muted px-1">{cfg.sourceTable}.{cfg.matchKey}</code>
          </p>
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">Pick a foreign source + match key to see resolvability counts.</p>
      )}
    </article>
  );
}

function claimedTargets(map: ColumnMap, exceptFor: string): Set<string> {
  const set = new Set<string>();
  for (const [src, a] of Object.entries(map)) {
    if (src === exceptFor) continue;
    if (a.kind === "mapped") set.add(a.targetColumn);
  }
  return set;
}

function mappedSourceColumns(headers: string[], map: ColumnMap): { value: string; label: string }[] {
  return headers
    .filter((h) => map[h]?.kind === "mapped")
    .map((h) => ({ value: h, label: h }));
}

function sampleSummary(sample: string[]): string {
  const nonEmpty = sample.filter((v) => v && v.trim() !== "");
  if (nonEmpty.length === 0) return "(all empty)";
  const joined = nonEmpty.slice(0, 3).join(", ");
  return joined.length > 60 ? joined.slice(0, 60) + "…" : joined;
}

function AssignmentSelect({
  assignment,
  targetColumns,
  claimed,
  onChange,
}: {
  assignment: ColumnAssignment;
  targetColumns: HubdbColumn[];
  claimed: Set<string>;
  onChange: (a: ColumnAssignment) => void;
}) {
  const currentValue =
    assignment.kind === "mapped" ? `col:${assignment.targetColumn}` : assignment.kind === "ignored" ? "ignored" : "";
  return (
    <select
      value={currentValue}
      onChange={(e) => {
        const v = e.target.value;
        if (v === "ignored") onChange({ kind: "ignored" });
        else if (v === "") onChange({ kind: "unmapped" });
        else onChange({ kind: "mapped", targetColumn: v.replace(/^col:/, "") });
      }}
      className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <option value="">— unmapped —</option>
      <option value="ignored">— ignored —</option>
      {targetColumns.map((c) => {
        const isClaimed = claimed.has(c.name);
        return (
          <option key={c.id} value={`col:${c.name}`} disabled={isClaimed}>
            {c.name}
            {isClaimed ? " (in use)" : ""}
          </option>
        );
      })}
    </select>
  );
}

function SelectField({
  label,
  hint,
  value,
  onChange,
  options,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <option value="">— none —</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {hint ? <span className="text-[10px] text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

function MismatchBadge({ mismatch }: { mismatch: TypeMismatch }) {
  const msg =
    mismatch.kind === "number-non-numeric"
      ? `${mismatch.badCount} non-numeric`
      : mismatch.kind === "boolean-non-boolean"
        ? `${mismatch.badCount} non-boolean`
        : mismatch.kind === "date-unparseable"
          ? `${mismatch.badCount} bad date`
          : `${mismatch.badCount} bad datetime`;
  return (
    <span className="rounded-full border border-yellow-500/40 bg-yellow-500/10 px-2 py-0.5 text-[10px] font-medium text-yellow-800 dark:text-yellow-200">
      ⚠ {msg}
    </span>
  );
}

function MappingSummary({
  value,
  target,
  sourceHeaders,
}: {
  value: MappingState;
  target: HubdbTable;
  sourceHeaders: string[];
}) {
  const mapped = sourceHeaders.filter((h) => value.columnMap[h]?.kind === "mapped").length;
  const ignored = sourceHeaders.filter((h) => value.columnMap[h]?.kind === "ignored").length;
  const unmapped = sourceHeaders.filter((h) => (value.columnMap[h]?.kind ?? "unmapped") === "unmapped").length;
  return (
    <div className="rounded-md border border-border bg-background p-3 text-xs space-y-1">
      <p className="font-medium">Summary</p>
      <p className="text-muted-foreground">
        Target · <code className="rounded bg-muted px-1">{target.name}</code>{" "}
        {target.useForPages ? <span>· page-rendered</span> : null}
      </p>
      <p className="text-muted-foreground">
        Columns · {mapped} mapped, {ignored} ignored, {unmapped} unmapped
      </p>
      <p className="text-muted-foreground">
        Natural key · {value.naturalKey.length ? value.naturalKey.join(" + ") : "(none picked)"}
      </p>
      {target.useForPages ? (
        <p className="text-muted-foreground">
          Page fields · hs_name={value.hsName ?? "—"} · hs_path={value.hsPath ?? "—"}
        </p>
      ) : null}
    </div>
  );
}

function WarningsPanel({
  warnings,
  pathIssues,
  hsPath,
}: {
  warnings: Warning[];
  pathIssues: ReturnType<typeof validatePathColumn>;
  hsPath: string | null;
}) {
  const total = warnings.length + pathIssues.length;
  if (total === 0) {
    return (
      <div className="rounded-md border border-border bg-background p-3 text-xs text-muted-foreground">
        No new warnings from this mapping.
      </div>
    );
  }
  return (
    <ul className="space-y-1 rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 text-xs">
      {warnings.map((w, i) => (
        <li key={`w-${i}`} className="text-yellow-800 dark:text-yellow-200">
          <span className="font-mono uppercase tracking-wider">{w.kind}</span> — {w.message}
        </li>
      ))}
      {hsPath ? (
        <PathIssueSummary column={hsPath} issues={pathIssues} />
      ) : null}
    </ul>
  );
}

function PathIssueSummary({
  column,
  issues,
}: {
  column: string;
  issues: ReturnType<typeof validatePathColumn>;
}) {
  const buckets = new Map<string, number>();
  for (const i of issues) buckets.set(i.kind, (buckets.get(i.kind) ?? 0) + 1);
  return (
    <>
      {Array.from(buckets).map(([kind, count]) => (
        <li key={`p-${kind}`} className="text-yellow-800 dark:text-yellow-200">
          <span className="font-mono uppercase tracking-wider">hs_path/{kind}</span> — {count} row(s) in column{" "}
          <code className="rounded bg-muted px-1">{column}</code>
        </li>
      ))}
    </>
  );
}
