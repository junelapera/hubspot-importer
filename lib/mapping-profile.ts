import { z } from "zod";
import type { MappingState } from "./mapping";

// Envelope wrapped around a saved wizard state so exports can round-trip
// through disk / email / other portals without ambiguity. Bump `version`
// when the wire shape changes; leave older values readable via a migration
// step in `parseProfileExport`.
export const PROFILE_EXPORT_KIND = "hubdb-importer-mapping-profile" as const;
export const PROFILE_EXPORT_VERSION = 1 as const;

export type ProfileExport = {
  kind: typeof PROFILE_EXPORT_KIND;
  version: typeof PROFILE_EXPORT_VERSION;
  name: string;
  exportedAt?: string;
  state: Record<string, MappingState>;
};

// Zod checks the envelope only (kind/version/name/state has ≥1 key with an
// object value). Deeper state validation happens the moment the loaded
// profile hits the wizard / executor.
const MappingStateShape = z.object({}).passthrough();

const ProfileExportSchema = z.object({
  kind: z.literal(PROFILE_EXPORT_KIND),
  version: z.literal(PROFILE_EXPORT_VERSION),
  name: z.string().trim().min(1).max(120),
  exportedAt: z.string().optional(),
  state: z
    .record(z.string(), MappingStateShape)
    .refine((v) => Object.keys(v).length > 0, {
      message: "state must contain at least one source-table mapping",
    }),
});

export type ParseProfileResult =
  | { ok: true; profile: ProfileExport }
  | { ok: false; error: string };

export function serializeProfileExport(
  name: string,
  state: Record<string, MappingState>,
  exportedAt: string,
): ProfileExport {
  return {
    kind: PROFILE_EXPORT_KIND,
    version: PROFILE_EXPORT_VERSION,
    name,
    exportedAt,
    state,
  };
}

export function parseProfileExport(raw: unknown): ParseProfileResult {
  const parsed = ProfileExportSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.length ? issue.path.join(".") : "(root)";
    return { ok: false, error: `${path}: ${issue?.message ?? "invalid shape"}` };
  }
  return {
    ok: true,
    profile: {
      ...parsed.data,
      state: parsed.data.state as unknown as Record<string, MappingState>,
    },
  };
}

// Suggests the next available "Copy of X" name given the set of existing
// names in a portal. Predictable + collision-safe: "Copy of X", then
// "Copy of X (2)", "Copy of X (3)"… No fancy re-parsing when the base is
// itself already a copy — the caller sees the doubling and can rename.
export function nextCopyName(base: string, existing: readonly string[]): string {
  const taken = new Set(existing);
  const stem = `Copy of ${base}`;
  if (!taken.has(stem)) return stem;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${stem} (${i})`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error(`could not derive a non-colliding copy name for "${base}"`);
}
