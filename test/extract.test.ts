import { describe, expect, it } from "vitest";
import { loadLlmConfig } from "../src/config.js";
import { extract, type ExtractInput } from "../src/llm/extract.js";
import type { LlmProvider, LlmRequest, LlmResponse, RunMode } from "../src/llm/provider.js";
import type { ExtractedItem } from "../src/schema/civic_action.js";

const cfg = loadLlmConfig();

const baseItem: ExtractedItem = {
  item_number: "7",
  case_number: "RZ-26-04",
  action_type: "Zoning",
  title: "Rezoning on Zeno Road",
  plain_english_summary: "Rezoning request.",
  addresses: [],
  parcel_pins: [],
  approval_status: "approved",
  vote_text: "carried 4-1",
  evidence_quote: "Motion carried 4-1",
  source_pages: [2],
  extraction_confidence: 0.9,
};

class FakeProvider implements LlmProvider {
  readonly name = "fake";
  readonly supportsBatch = true;
  calls: { req: LlmRequest; mode: RunMode }[] = [];
  constructor(private readonly respond: (req: LlmRequest) => Partial<LlmResponse>) {}
  async countTokens(req: LlmRequest) {
    return Math.ceil(req.text.length / 4);
  }
  async run(reqs: LlmRequest[], mode: RunMode) {
    return reqs.map((req) => {
      this.calls.push({ req, mode });
      return { id: req.id, model: req.model, json: null, complete: true, usage: { input_tokens: 1000, output_tokens: 100 }, ...this.respond(req) };
    });
  }
}

const doc = (documentType: ExtractInput["meta"]["documentType"]): ExtractInput => ({
  pdf: Buffer.alloc(0),
  pages: [
    { page: 1, text: "Agenda", imageOnly: false },
    { page: 2, text: "Item 7 RZ-26-04. Motion carried 4-1.", imageOnly: false },
  ],
  meta: {
    docId: `test:${documentType}`,
    municipality: "Fuquay-Varina",
    body: "Board of Commissioners",
    date: "2026-10-07",
    meetingType: "regular",
    documentType,
    sourceUrl: "https://example.org/doc.pdf",
  },
});

describe("extract()", () => {
  it("extracts, guards, attaches metadata and logs cost", async () => {
    const provider = new FakeProvider(() => ({ json: { items: [baseItem] } }));
    const [minutes, agenda] = await extract([doc("minutes"), doc("agenda")], provider, cfg);
    expect(minutes!.actions[0]).toMatchObject({ approval_status: "approved", municipality: "Fuquay-Varina", document_type: "minutes" });
    expect(agenda!.actions[0]!.approval_status).toBe("scheduled");
    expect(minutes!.usage).toHaveLength(1);
    expect(minutes!.usage[0]).toMatchObject({ model: "claude-haiku-5-5", mode: "sync", escalated: false });
    expect(minutes!.costUsd).toBeCloseTo((1000 * 0.1 + 100 * 0.5) / 1e6, 9);
  });

  it("escalates low-confidence chunks to the escalation model", async () => {
    const provider = new FakeProvider((req) => ({
      json: { items: [{ ...baseItem, extraction_confidence: req.model === "claude-haiku-5-5" ? 0.3 : 0.85 }] },
    }));
    const [r] = await extract([doc("minutes")], provider, cfg);
    expect(provider.calls.map((c) => c.req.model)).toEqual(["claude-haiku-5-5", "claude-sonnet-5-5"]);
    expect(r!.actions[0]!.extraction_confidence).toBe(0.85);
    expect(r!.usage.map((u) => u.escalated)).toEqual([false, true]);
  });

  it("escalates invalid output and reports when escalation also fails", async () => {
    const provider = new FakeProvider(() => ({ json: { nope: true } }));
    const [r] = await extract([doc("agenda")], provider, cfg);
    expect(r!.actions).toEqual([]);
    expect(r!.warnings.some((w) => w.includes("escalation also failed"))).toBe(true);
  });

  it("passes batch mode through and prices at the batch discount", async () => {
    const provider = new FakeProvider(() => ({ json: { items: [baseItem] } }));
    const [r] = await extract([doc("minutes")], provider, cfg, { mode: "batch" });
    expect(provider.calls[0]!.mode).toBe("batch");
    expect(r!.costUsd).toBeCloseTo((1000 * 0.1 + 100 * 0.5) / 2e6, 9);
  });

  it("runs triage first for long packets and extracts only relevant pages", async () => {
    const pages = Array.from({ length: 150 }, (_, i) => ({ page: i + 1, text: `page ${i + 1} text`, imageOnly: false }));
    const provider = new FakeProvider((req) =>
      req.system.includes("triage")
        ? { json: { relevant: [{ item_number: "7", title: "Rezoning", start_page: 80, end_page: 85 }] } }
        : { json: { items: [] } },
    );
    await extract([{ ...doc("packet"), pages }], provider, cfg);
    const extraction = provider.calls.filter((c) => !c.req.system.includes("triage"));
    const text = extraction.map((c) => c.req.text).join("\n");
    expect(text).toContain("--- page 82 ---");
    expect(text).toContain("--- page 15 ---");
    expect(text).not.toContain("--- page 50 ---");
  });
});
