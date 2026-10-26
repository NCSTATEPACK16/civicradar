import type { GeocodeResult } from "../geo/geocode.js";
import type { CivicAction } from "../schema/civic_action.js";

/** One row of public.civic_actions (supabase/migrations/0001_civic_actions.sql). */
export interface CivicActionRow {
  meeting_date: string;
  municipality: string;
  body: string;
  meeting_type: string | null;
  document_type: CivicAction["document_type"];
  item_number: string | null;
  item_key: string;
  case_number: string | null;
  action_type: CivicAction["action_type"];
  title: string;
  plain_english_summary: string;
  addresses: string[];
  parcel_pins: string[];
  approval_status: CivicAction["approval_status"];
  vote_text: string | null;
  evidence_quote: string | null;
  source_url: string;
  source_pages: number[];
  extraction_confidence: number;
  extraction_model: string | null;
  /** EWKT, e.g. SRID=4326;POINT(-78.8 35.58); PostGIS parses it into the geography column. */
  geom: string | null;
  geocode_method: GeocodeResult["method"] | null;
}

/** Stable per-document key: the printed item number, or the normalized title when unnumbered. */
export function itemKey(a: Pick<CivicAction, "item_number" | "title">): string {
  const num = a.item_number?.trim().replace(/\.$/, "");
  if (num) return num;
  return `title:${a.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 120)}`;
}

export function toRow(a: CivicAction, model: string | null, geo: GeocodeResult | null): CivicActionRow {
  return {
    meeting_date: a.date,
    municipality: a.municipality,
    body: a.body,
    meeting_type: a.meeting_type,
    document_type: a.document_type,
    item_number: a.item_number,
    item_key: itemKey(a),
    case_number: a.case_number,
    action_type: a.action_type,
    title: a.title,
    plain_english_summary: a.plain_english_summary,
    addresses: a.addresses,
    parcel_pins: a.parcel_pins,
    approval_status: a.approval_status,
    vote_text: a.vote_text,
    evidence_quote: a.evidence_quote,
    source_url: a.source_url,
    source_pages: a.source_pages,
    extraction_confidence: Math.round(a.extraction_confidence * 100) / 100,
    extraction_model: model,
    geom: geo ? `SRID=4326;POINT(${geo.lng} ${geo.lat})` : null,
    geocode_method: geo?.method ?? null,
  };
}

/**
 * Drops rows that share an upsert key, keeping the most confident. Postgres rejects an
 * ON CONFLICT upsert that would touch the same row twice in one statement.
 */
export function dedupeRows(rows: CivicActionRow[]): CivicActionRow[] {
  const byKey = new Map<string, CivicActionRow>();
  for (const r of rows) {
    const key = `${r.source_url}\u0000${r.document_type}\u0000${r.item_key}`;
    const prev = byKey.get(key);
    if (!prev || r.extraction_confidence > prev.extraction_confidence) byKey.set(key, r);
  }
  return [...byKey.values()];
}
