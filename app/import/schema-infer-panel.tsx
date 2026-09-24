"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  inferSchema,
  toSchema,
  type InferredColumn,
  type InferredColumnType,
  type InferredTable,
} from "@/lib/schema-infer";

const TYPES: readonly InferredColumnType[] = [
  "TEXT",
  "RICHTEXT",
  "NUMBER",
  "CURRENCY",
  "BOOLEAN",
  "DATE",
  "DATETIME",
  "URL",
  "IMAGE",
  "FOREIGN_ID",
];

type Source = { name: string; headers: string[]; rows: Record<string, string>[] };

export function SchemaInferPanel({ sources }: { sources: readonly Source[] }) {
  // Fingerprint the input so we reset editable state whenever the user
  // uploads a new set of files. Row content isn't hashed — file identity
  // (name + row count) is enough for the "did the user re-upload" check.
  const fingerprint = useMemo(
    () => sources.map((s) => `${s.name}:${s.rows.length}`).join("|"),
    [sources],
  );

  const inferred = useMemo(() => inferSchema(sources), [sources]);
  const [expanded, setExpanded] = useState(false);
  const [tables, setTables] = useState<Record<string, InferredTable>>(() =>
    tablesFromInferred(inferred),
  );
  // Re-derive state when the upload fingerprint changes. Setting state
  // during render (guarded by a committed-value check) is the sanctioned
  // React way to reset on prop change without an effect.
  const [committedFingerprint, setCommittedFingerprint] = useState(fingerprint);
  if (fingerprint !== committedFingerprint) {
    setCommittedFingerprint(fingerprint);
    setTables(tablesFromInferred(inferred));
  }

  const tableList = inferred.map((t) => tables[t.name] ?? t);
  const foreignChoices = tableList.filter((t) => t.naturalKey !== null);

  function updateTable(name: string, next: (prev: InferredTable) => InferredTable) {
    setTables((prev) => ({ ...prev, [name]: next(prev[name] ?? inferred.find((t) => t.name === name)!) }));
  }

  function updateColumn(
    tableName: string,
    columnName: string,
    patch: Partial<InferredColumn>,
  ) {
    updateTable(tableName, (prev) => ({
      ...prev,
      columns: prev.columns.map((c) => (c.name === columnName ? { ...c, ...patch } : c)),
    }));
  }

  function toggleNaturalKey(tableName: string, columnName: string) {
    updateTable(tableName, (prev) => {
      const nk = prev.naturalKey === columnName ? null : columnName;
      const columns = prev.columns.map((c) => ({ ...c, isNaturalKey: c.name === nk }));
      return { ...prev, naturalKey: nk, columns };
    });
  }

  function reset() {
    setTables(tablesFromInferred(inferred));
  }

  function download() {
    const schema = toSchema(tableList);
    const blob = new Blob([JSON.stringify(schema, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "schema.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  if (sources.length === 0) return null;

  const fkCount = tableList.reduce(
    (n, t) => n + t.columns.filter((c) => c.type === "FOREIGN_ID").length,
    0,
  );
  const nkCount = tableList.filter((t) => t.naturalKey).length;

  return (
    <section className="space-y-3 rounded-md border border-border p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold">Suggest a schema</h2>
          <p className="text-xs text-muted-foreground">
            Inferred from your uploads — override types below, then download{" "}
            <code className="rounded bg-muted px-1 font-mono text-[11px]">schema.json</code>{" "}
            and paste it into the portal&apos;s schema planner. {tableList.length} table
            {tableList.length === 1 ? "" : "s"} · {nkCount} natural key{nkCount === 1 ? "" : "s"} ·{" "}
            {fkCount} foreign-key link{fkCount === 1 ? "" : "s"}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {expanded ? (
            <>
              <Button variant="outline" size="sm" onClick={reset}>
                Reset
              </Button>
              <Button size="sm" onClick={download}>
                Download schema.json
              </Button>
              <Button variant="outline" size="sm" onClick={() => setExpanded(false)}>
                Hide
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={() => setExpanded(true)}>
              Review + download
            </Button>
          )}
        </div>
      </header>

      {expanded ? (
        <div className="space-y-4">
          {tableList.map((t) => (
            <TableSection
              key={t.name}
              table={t}
              foreignChoices={foreignChoices}
              onLabelChange={(label) => updateTable(t.name, (prev) => ({ ...prev, label }))}
              onColumnChange={(col, patch) => updateColumn(t.name, col, patch)}
              onToggleNaturalKey={(col) => toggleNaturalKey(t.name, col)}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function TableSection({
  table,
  foreignChoices,
  onLabelChange,
  onColumnChange,
  onToggleNaturalKey,
}: {
  table: InferredTable;
  foreignChoices: readonly InferredTable[];
  onLabelChange: (label: string) => void;
  onColumnChange: (column: string, patch: Partial<InferredColumn>) => void;
  onToggleNaturalKey: (column: string) => void;
}) {
  return (
    <div className="space-y-2 rounded-md border border-border/60 bg-card/40 p-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {table.name}
        </span>
        <input
          type="text"
          value={table.label}
          onChange={(e) => onLabelChange(e.target.value)}
          className="h-9 min-w-[10rem] flex-1 rounded-md border border-input bg-background px-3 text-sm"
        />
        <span className="text-[11px] text-muted-foreground">
          natural key:{" "}
          {table.naturalKey ? (
            <code className="rounded bg-muted px-1 font-mono">{table.naturalKey}</code>
          ) : (
            <span className="italic">none picked — pick one column below</span>
          )}
        </span>
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-xs">
          <thead className="bg-muted/60 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Column</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Natural key</th>
              <th className="px-3 py-2 font-medium">FK target</th>
              <th className="px-3 py-2 font-medium">Why</th>
            </tr>
          </thead>
          <tbody>
            {table.columns.map((c) => (
              <ColumnRow
                key={c.name}
                column={c}
                naturalKey={table.naturalKey}
                foreignChoices={foreignChoices.filter((t2) => t2.name !== table.name)}
                onTypeChange={(type) =>
                  onColumnChange(c.name, {
                    type,
                    foreignTable: type === "FOREIGN_ID" ? c.foreignTable : undefined,
                    foreignColumn: type === "FOREIGN_ID" ? c.foreignColumn : undefined,
                  })
                }
                onForeignTableChange={(foreignTable) => {
                  const target = foreignChoices.find((t2) => t2.name === foreignTable);
                  onColumnChange(c.name, {
                    foreignTable,
                    foreignColumn: target?.naturalKey ?? undefined,
                  });
                }}
                onToggleNaturalKey={() => onToggleNaturalKey(c.name)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ColumnRow({
  column,
  naturalKey,
  foreignChoices,
  onTypeChange,
  onForeignTableChange,
  onToggleNaturalKey,
}: {
  column: InferredColumn;
  naturalKey: string | null;
  foreignChoices: readonly InferredTable[];
  onTypeChange: (type: InferredColumnType) => void;
  onForeignTableChange: (foreignTable: string) => void;
  onToggleNaturalKey: () => void;
}) {
  const isFk = column.type === "FOREIGN_ID";
  const isNk = naturalKey === column.name;
  return (
    <tr className="border-t border-border align-top">
      <td className="px-3 py-2 font-mono">{column.name}</td>
      <td className="px-3 py-2">
        <Select
          value={column.type}
          onValueChange={(v) => onTypeChange(v as InferredColumnType)}
        >
          <SelectTrigger size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>
      <td className="px-3 py-2">
        <label className="inline-flex items-center gap-1.5">
          <Checkbox
            className="size-3.5"
            checked={isNk}
            onChange={onToggleNaturalKey}
            disabled={isFk}
          />
          <span className="text-[11px] text-muted-foreground">{isNk ? "yes" : ""}</span>
        </label>
      </td>
      <td className="px-3 py-2">
        {isFk ? (
          foreignChoices.length === 0 ? (
            <span className="text-[11px] italic text-muted-foreground">
              no other table with a natural key
            </span>
          ) : (
            <Select
              value={column.foreignTable ?? ""}
              onValueChange={(v) => v && onForeignTableChange(v)}
              items={foreignChoices.map((t) => ({
                value: t.name,
                label: `${t.name} · ${t.naturalKey}`,
              }))}
            >
              <SelectTrigger size="sm">
                <SelectValue placeholder="pick target" />
              </SelectTrigger>
              <SelectContent>
                {foreignChoices.map((t) => (
                  <SelectItem key={t.name} value={t.name}>
                    {t.name} · {t.naturalKey}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )
        ) : (
          <span className="text-[11px] text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-3 py-2 text-[11px] text-muted-foreground">
        {column.reason ?? ""}
      </td>
    </tr>
  );
}

function cloneTable(t: InferredTable): InferredTable {
  return {
    ...t,
    columns: t.columns.map((c) => ({ ...c })),
  };
}

function tablesFromInferred(inferred: readonly InferredTable[]): Record<string, InferredTable> {
  const out: Record<string, InferredTable> = {};
  for (const t of inferred) out[t.name] = cloneTable(t);
  return out;
}
