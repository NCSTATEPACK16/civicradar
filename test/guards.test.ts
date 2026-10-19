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

  it("accepts a verbatim quote that runs across a page break", () => {
    const pageText = new Map([
      [4, "Recommendation - Table consideration of ANX-2023-13 to include property"],
      [5, "owned by the petitioners to the November 2, 2026 meeting.\nMOTION RESULTS: Passed Unanimously (5-0)"],
    ]);
    const { item: out } = guardItem(
      item({ approval_status: "continued", source_pages: [4, 5], vote_text: "Passed Unanimously (5-0)", evidence_quote: "to include property owned by the petitioners to the November 2, 2026 meeting." }),
      { documentType: "minutes", pageText },
    );
    expect(out.approval_status).toBe("continued");
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

describe("guardItem on OCR'd pages", () => {
  // Real tesseract output for page 3 of the scanned Fuquay-Varina Planning Board minutes (2026-07-20).
  const ocr =
    "Motion —- Recommend approval of REZ-2026-10, a zoning map amendment for 210 S West Street,\n" +
    "from the Residential Medium Density (RMD) Zoning District to the Town Center Residential (TCR)\n" +
    "Zoning District as it is reasonable and in the best interest of the public for the reasons identified by\nStaff.\n\n" +
    "MOTION: Nolan Perry\nSECOND: Tommy Pate\nMOTION RESULT: Motion Passed 6 - 0";
  const ctx = { documentType: "minutes" as const, pageText: new Map([[3, ocr]]), ocrPages: new Set([3]) };
  const scanned = (quote: string) =>
    item({ case_number: "REZ-2026-10", source_pages: [3], vote_text: "Motion Passed 6 - 0", evidence_quote: quote });

  it("keeps a decided status when the quote matches the OCR text despite OCR misreads", () => {
    const quote =
      "Motion – Recommend approval of REZ-2026-10, a zoning map amendment for 210 S West Street, from the Residential Medium Density (RMD) Zoning District to the Town Center Residential (TCR) Zoning District as it is reasonable and in the best interest of the public for the reasons identified by staff.";
    const { item: out, warnings } = guardItem(scanned(quote), ctx);
    expect(out.approval_status).toBe("approved");
    expect(out.extraction_confidence).toBeLessThanOrEqual(0.8);
    expect(warnings.some((w) => w.includes("approximately"))).toBe(true);
  });

  it("still rejects a quote that is not on the scanned page", () => {
    const { item: out } = guardItem(
      scanned("The Board voted unanimously to deny REZ-2026-10 after a lengthy public hearing on traffic."),
      ctx,
    );
    expect(out.approval_status).toBe("unknown");
  });

  it("does not use tolerant matching on pages with a real text layer", () => {
    const { item: out } = guardItem(scanned("Motion – Recommend approval of REZ-2026-10, a zoning map amendment for 210 S West Street"), {
      ...ctx,
      ocrPages: new Set<number>(),
    });
    expect(out.approval_status).toBe("unknown");
  });
});
