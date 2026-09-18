import type { SupabaseClient } from "@supabase/supabase-js";
import type { MappingState } from "../mapping";

/**
 * A named wizard-state snapshot. `state` is `Record<sourceTableName,
 * MappingState>` — the same shape the /import wizard holds in memory.
 */
export type MappingProfile = {
  id: string;
  portalId: string;
  name: string;
  state: Record<string, MappingState>;
  createdAt: string;
  updatedAt: string;
};

type MappingRow = {
  id: string;
  portal_id: string;
  name: string;
  state_json: Record<string, MappingState>;
  created_at: string;
  updated_at: string;
};

function toProfile(row: MappingRow): MappingProfile {
  return {
    id: row.id,
    portalId: row.portal_id,
    name: row.name,
    state: row.state_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type MappingCreateInput = {
  portalId: string;
  name: string;
  state: Record<string, MappingState>;
};

export class DuplicateMappingNameError extends Error {
  constructor(portalId: string, name: string) {
    super(`A profile named "${name}" already exists for portal ${portalId}`);
    this.name = "DuplicateMappingNameError";
  }
}

export async function createMapping(
  client: SupabaseClient,
  input: MappingCreateInput,
): Promise<MappingProfile> {
  const { data, error } = await client
    .from("mappings")
    .insert({
      portal_id: input.portalId,
      name: input.name,
      state_json: input.state,
    })
    .select()
    .single();
  if (error) {
    if (error.code === "23505") throw new DuplicateMappingNameError(input.portalId, input.name);
    throw new Error(`mappings.insert failed: ${error.message}`);
  }
  return toProfile(data as MappingRow);
}

export async function listMappingsForPortal(
  client: SupabaseClient,
  portalId: string,
): Promise<MappingProfile[]> {
  const { data, error } = await client
    .from("mappings")
    .select("*")
    .eq("portal_id", portalId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`mappings.list failed: ${error.message}`);
  return (data as MappingRow[]).map(toProfile);
}

export async function getMappingById(
  client: SupabaseClient,
  id: string,
): Promise<MappingProfile | null> {
  const { data, error } = await client.from("mappings").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`mappings.get failed: ${error.message}`);
  return data ? toProfile(data as MappingRow) : null;
}

export type MappingUpdateInput = {
  name?: string;
  state?: Record<string, MappingState>;
};

export async function updateMapping(
  client: SupabaseClient,
  id: string,
  input: MappingUpdateInput,
): Promise<MappingProfile> {
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.state !== undefined) patch.state_json = input.state;
  const { data, error } = await client
    .from("mappings")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) {
    if (error.code === "23505") throw new DuplicateMappingNameError("?", input.name ?? "?");
    throw new Error(`mappings.update failed: ${error.message}`);
  }
  return toProfile(data as MappingRow);
}

export async function deleteMapping(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.from("mappings").delete().eq("id", id);
  if (error) throw new Error(`mappings.delete failed: ${error.message}`);
}
