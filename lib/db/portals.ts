import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt, encrypt } from "../crypto";

export type PortalEnv = "sandbox" | "production";

/**
 * Row shape as it lives in the `portals` table. Never return this to a
 * client — `token_ciphertext` is server-only.
 */
export type PortalRow = {
  id: string;
  label: string;
  env: PortalEnv;
  hub_id: string | null;
  token_ciphertext: string;
  scopes: string[] | null;
  created_at: string;
  updated_at: string;
};

/**
 * Public-safe projection. Sent to the browser; the token is not present.
 */
export type PortalSummary = {
  id: string;
  label: string;
  env: PortalEnv;
  hubId: string | null;
  scopes: string[] | null;
  createdAt: string;
  updatedAt: string;
};

export type PortalCreateInput = {
  label: string;
  env: PortalEnv;
  token: string;
  hubId?: string | null;
  scopes?: string[] | null;
};

function toSummary(row: PortalRow): PortalSummary {
  return {
    id: row.id,
    label: row.label,
    env: row.env,
    hubId: row.hub_id,
    scopes: row.scopes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createPortal(
  client: SupabaseClient,
  input: PortalCreateInput,
): Promise<PortalSummary> {
  const token_ciphertext = encrypt(input.token);
  const { data, error } = await client
    .from("portals")
    .insert({
      label: input.label,
      env: input.env,
      hub_id: input.hubId ?? null,
      token_ciphertext,
      scopes: input.scopes ?? null,
    })
    .select()
    .single();
  if (error) throw new Error(`portals.insert failed: ${error.message}`);
  return toSummary(data as PortalRow);
}

export async function listPortals(client: SupabaseClient): Promise<PortalSummary[]> {
  const { data, error } = await client
    .from("portals")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`portals.list failed: ${error.message}`);
  return (data as PortalRow[]).map(toSummary);
}

export async function getPortalById(
  client: SupabaseClient,
  id: string,
): Promise<PortalSummary | null> {
  const { data, error } = await client.from("portals").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`portals.get failed: ${error.message}`);
  return data ? toSummary(data as PortalRow) : null;
}

/**
 * Decrypts and returns the raw HubSpot token. Server-only. Do not send the
 * result to the client — use it to build a `HubdbClient` inside an API
 * route or worker and pass the client to downstream functions.
 */
export async function getPortalToken(client: SupabaseClient, id: string): Promise<string> {
  const { data, error } = await client
    .from("portals")
    .select("token_ciphertext")
    .eq("id", id)
    .single();
  if (error) throw new Error(`portals.getToken failed: ${error.message}`);
  return decrypt((data as { token_ciphertext: string }).token_ciphertext);
}

export async function deletePortal(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.from("portals").delete().eq("id", id);
  if (error) throw new Error(`portals.delete failed: ${error.message}`);
}
