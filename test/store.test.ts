import { describe, expect, it } from "vitest";
import type { CivicAction } from "../src/schema/civic_action.js";
import { dedupeRows, itemKey, toRow } from "../src/store/rows.js";
import { upsertCivicActions } from "../src/store/supabase.js";

const action: CivicAction = {
  date: "2026-10-05",
  municipality: "Fuquay-Varina",
  body: "Board of Commissioners",
  meeting_type: "Regular",
  document_type: "agenda",
  source_url: "https://www.fuquay-varina.org/AgendaCenter/ViewFile/Agenda/_10052026-587",
  item_number: "7.A",
  case_number: null,
  action_type: "Zoning",
  title: "Voluntary Annexation Petition - Town of Fuquay-Varina, 980 Wilbon Road",
  plain_english_summary: "Annexation of 980 Wilbon Road.",
  addresses: ["980 Wilbon Road"],
  parcel_pins: ["0657231047"],
  approval_status: "scheduled",
  vote_text: null,
  evidence_quote: "980 Wilbon Road",
  source_pages: [2],
  extraction_confidence: 0.904,
};

describe("rows", () => {
  it("maps an action to a civic_actions row with an EWKT point", () => {
    const row = toRow(action, "claude-haiku-5-5", { lat: 35.6, lng: -78.8, method: "pin", matched: "0657231047" });
    expect(row).toMatchObject({
      meeting_date: "2026-10-05",
      item_key: "7.A",
      extraction_confidence: 0.9,
      extraction_model: "claude-haiku-5-5",
      geom: "SRID=4326;POINT(-78.8 35.6)",
      geocode_method: "pin",
    });
    expect(toRow(action, null, null)).toMatchObject({ geom: null, geocode_method: null });
  });

  it("keys unnumbered items by normalized title", () => {
    expect(itemKey({ item_number: "2.", title: "x" })).toBe("2");
    expect(itemKey({ item_number: null, title: "Closed Session: $195,000 Settlement" })).toBe(
      "title:closed session 195 000 settlement",
    );
  });

  it("drops duplicate upsert keys, keeping the most confident row", () => {
    const a = toRow(action, null, null);
    const b = toRow({ ...action, extraction_confidence: 0.95, title: "better" }, null, null);
    const minutes = toRow({ ...action, document_type: "minutes" }, null, null);
    expect(dedupeRows([a, b, minutes]).map((r) => [r.document_type, r.title])).toEqual([
      ["agenda", "better"],
      ["minutes", action.title],
    ]);
  });
});

describe("upsertCivicActions", () => {
  it("POSTs to PostgREST with merge-duplicates on the table's unique key", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch;
    await upsertCivicActions([toRow(action, null, null)], { url: "https://p.supabase.co/", serviceRoleKey: "k", fetchImpl });
    expect(calls[0]!.url).toBe("https://p.supabase.co/rest/v1/civic_actions?on_conflict=source_url,document_type,item_key");
    expect((calls[0]!.init.headers as Record<string, string>).prefer).toMatch(/resolution=merge-duplicates/);
  });
});
