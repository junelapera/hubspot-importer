// HubDB SELECT / MULTISELECT cells. Verified against the API: a SELECT cell
// must be `{name, type: "option"}` (or `{id, type: "option"}`), a
// MULTISELECT cell a list of those; bare strings, `{name}` without `type`,
// and string arrays all 400. Values must already be options on the column
// ("Invalid option value") — the importer never adds options.
//
// Source cells are plain strings (CSV / XLSX / Sheets), so match them
// against the column's option labels (then names): trim + collapse
// whitespace + case-insensitive, then send the option's `name`.

export type OptionCell = { name: string; type: "option" };

// An option as HubDB stores it. Options created in the HubSpot UI get a
// slug `name` ("financial_wellness") and a display `label` ("Financial
// Wellness"); API-created ones often have only `name`. Cells must carry
// the `name`, but sheets hold what people see — the label.
export type ColumnOption = { name: string; label: string };

/** Options declared on a HubDB column's `options` (unknown-shaped). */
export function optionsOf(options: unknown): ColumnOption[] | null {
  if (!Array.isArray(options)) return null;
  const out: ColumnOption[] = [];
  for (const o of options) {
    if (!o || typeof o !== "object") continue;
    const { name, label } = o as { name?: unknown; label?: unknown };
    if (typeof name !== "string" || name.trim() === "") continue;
    out.push({ name, label: typeof label === "string" && label.trim() !== "" ? label : name });
  }
  return out.length > 0 ? out : null;
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** The option `name` to send for `value` (matched on label, then name), or null. */
export function matchOption(value: string, options: readonly ColumnOption[]): string | null {
  const n = norm(value);
  return (options.find((o) => norm(o.label) === n) ?? options.find((o) => norm(o.name) === n))?.name ?? null;
}

/** Display labels, for error messages. */
export function optionLabels(options: readonly ColumnOption[]): string {
  return options.map((o) => o.label).join(", ");
}

/**
 * Splits a multi-select cell into option names. Google Sheets' "allow
 * multiple selections" writes `Red, Blue`; `;` is accepted too. A cell
 * that exactly matches one option is never split, so labels containing
 * commas ("Planning, Retirement") still work.
 */
export function splitMultiSelect(
  value: string,
  options: readonly ColumnOption[] | null,
): { matched: string[]; unknown: string[] } {
  if (options) {
    const whole = matchOption(value, options);
    if (whole) return { matched: [whole], unknown: [] };
  }
  const delimiter = value.includes(";") ? ";" : ",";
  const matched: string[] = [];
  const unknown: string[] = [];
  for (const part of value.split(delimiter)) {
    const token = part.trim();
    if (!token) continue;
    const hit = options ? matchOption(token, options) : token;
    if (hit) {
      if (!matched.includes(hit)) matched.push(hit);
    } else {
      unknown.push(token);
    }
  }
  return { matched, unknown };
}

/** Source values in `values` that won't map to an option (deduped, in order). */
export function invalidOptionValues(
  values: readonly string[],
  columnType: string,
  options: unknown,
): string[] {
  const opts = optionsOf(options);
  if (!opts) return [];
  const bad: string[] = [];
  for (const v of values) {
    if (!v || !v.trim()) continue;
    const unknown =
      columnType === "MULTISELECT"
        ? splitMultiSelect(v, opts).unknown
        : matchOption(v, opts)
          ? []
          : [v.trim()];
    for (const u of unknown) if (!bad.includes(u)) bad.push(u);
  }
  return bad;
}
