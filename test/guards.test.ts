import { describe, expect, it } from "vitest";
import { dedupeItems, guardItem } from "../src/postprocess/guards.js";
import type { ExtractedItem } from "../src/schema/civic_action.js";

const item = (over: Partial<ExtractedItem> = {}): ExtractedItem => ({
  item_number: "5.a",
  case_number: "RZ-26-04",
  action_type: "Zoning",
  title: "Rezoning 1405 Zeno Rd",
  plain_english_summary: "A rezoning request.",
  addresses: ["1405 Zeno Rd"],
  parcel_pins: ["0741-23-4567"],
  approval_status: "approved",
  vote_text: "Motion carried 5-0",
  evidence_quote: "the motion to approve RZ-26-04 carried 5–0",
  source_pages: [2],
  extraction_confidence: 0.9,
  ...over,
});

const minutesText = new Map([
  [1, "Call to order"],
  [2, "After discussion, the motion to approve RZ-26-04  carried 5-0. Motion carried 5-0"],
]);

describe("guardItem", () => {
  it("keeps a decided status from minutes when the vote quote is verbatim", () => {
    const { item: out, warnings } = guardItem(item(), { documentType: "minutes", pageText: minutesText });
    expect(out.approval_status).toBe("approved");
    expect(out.parcel_pins).toEqual(["0741234567"]);
    expect(warnings).toEqual([]);
  });

  it("downgrades a decided status whose quote is not in the source", () => {
    const { item: out } = guardItem(item({ evidence_quote: "approved unanimously" }), {
      documentType: "minutes",
      pageText: minutesText,
    });
    expect(out.approval_status).toBe("unknown");
    expect(out.extraction_confidence).toBeLessThanOrEqual(0.5);
  });

  it("downgrades a decided status with no vote text", () => {
    const { item: out } = guardItem(item({ vote_text: null }), { documentType: "minutes", pageText: minutesText });
    expect(out.approval_status).toBe("unknown");
  });

  it("forces agenda items to scheduled", () => {
    const { item: out, warnings } = guardItem(item(), { documentType: "agenda", pageText: minutesText });
    expect(out.approval_status).toBe("scheduled");
    expect(out.vote_text).toBeNull();
    expect(warnings[0]).toMatch(/forced/);
  });

  it("drops pages outside the chunk and invalid PINs", () => {
    const { item: out } = guardItem(item({ source_pages: [2, 99], parcel_pins: ["12345", "0741234567"] }), {
      documentType: "minutes",
      pageText: minutesText,
    });
    expect(out.source_pages).toEqual([2]);
    expect(out.parcel_pins).toEqual(["0741234567"]);
  });
});

describe("dedupeItems", () => {
  it("merges the same case across chunks, keeping the more confident copy", () => {
    const merged = dedupeItems([
      item({ extraction_confidence: 0.6, source_pages: [2], addresses: ["A"] }),
      item({ extraction_confidence: 0.9, source_pages: [30], addresses: ["B"], title: "Better title" }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.title).toBe("Better title");
    expect(merged[0]!.source_pages).toEqual([2, 30]);
    expect(merged[0]!.addresses.sort()).toEqual(["A", "B"]);
  });
});
