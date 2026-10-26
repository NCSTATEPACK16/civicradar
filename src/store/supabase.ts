import type { CivicActionRow } from "./rows.js";

const ON_CONFLICT = "source_url,document_type,item_key";
const BATCH = 500;

/**
 * Upserts rows into public.civic_actions through PostgREST with the service role key
 * (which bypasses RLS). Re-running on the same documents updates rows in place.
 */
export async function upsertCivicActions(
  rows: CivicActionRow[],
  opts: { url: string; serviceRoleKey: string; fetchImpl?: typeof fetch },
): Promise<number> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const endpoint = `${opts.url.replace(/\/$/, "")}/rest/v1/civic_actions?on_conflict=${ON_CONFLICT}`;
  for (let i = 0; i < rows.length; i += BATCH) {
    const res = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        apikey: opts.serviceRoleKey,
        authorization: `Bearer ${opts.serviceRoleKey}`,
        "content-type": "application/json",
        prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(rows.slice(i, i + BATCH)),
    });
    if (!res.ok) throw new Error(`Supabase upsert failed: HTTP ${res.status} ${await res.text()}`);
  }
  return rows.length;
}
