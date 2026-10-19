import { describe, expect, it } from "vitest";
import { scoreDocument, setF1, type ExpectedItem } from "../eval/score.js";
import type { CivicAction } from "../src/schema/civic_action.js";

const pred = (over: Partial<CivicAction>): CivicAction => ({
  item_number: null, case_number: null, action_type: "Zoning", title: "", plain_english_summary: "",
  addresses: [], parcel_pins: [], approval_status: "scheduled", vote_text: null, evidence_quote: null,
  source_pages: [], extraction_confidence: 0.9, date: "2026-10-07", municipality: "M", body: "B",
  meeting_type: null, document_type: "minutes", source_url: "u", ...over,
});

describe("scoreDocument", () => {
  it("matches by case number, then item number, then title", () => {
    const expected: ExpectedItem[] = [
      { title: "Rezoning Zeno Rd", case_number: "RZ-26-04", action_type: "Zoning", approval_status: "approved" },
      { title: "Budget amendment #3", item_number: "8", action_type: "Budget", approval_status: "approved" },
      { title: "Water line contract award", action_type: "Infrastructure", approval_status: "approved" },
    ];
    const s = scoreDocument(
      expected,
      [
        pred({ title: "Different wording", case_number: "rz 26 04", approval_status: "approved", evidence_quote: "motion carried" }),
        pred({ title: "Budget Amendment", item_number: "8.", action_type: "Budget", approval_status: "denied" }),
        pred({ title: "Award of water line contract", action_type: "Other" }),
        pred({ title: "Unrelated proclamation" }),
      ],
      "The motion carried unanimously.",
    );
    expect([s.tp, s.fp, s.fn]).toEqual([3, 1, 0]);
    expect(s.field.action_type).toEqual({ correct: 2, total: 3 });
    expect(s.approvalFalsePositives).toBe(1); // "denied" where the label says approved
    expect(s.evidence).toEqual({ verbatim: 1, total: 1 });
  });

  it("neither rewards nor penalizes optional items", () => {
    const expected: ExpectedItem[] = [
      { title: "Rezoning Zeno Rd", case_number: "RZ-26-04", action_type: "Zoning", approval_status: "scheduled" },
      { title: "Special event permit movie night", action_type: "Other", approval_status: "scheduled", optional: true },
      { title: "Meeting schedule for 2027", approval_status: "scheduled", optional: true },
    ];
    const s = scoreDocument(
      expected,
      [pred({ title: "Rezoning", case_number: "RZ-26-04" }), pred({ title: "Special event permit for movie night", action_type: "Budget" })],
      "",
    );
    expect([s.tp, s.fp, s.fn]).toEqual([1, 0, 0]);
    expect(s.field.action_type).toEqual({ correct: 1, total: 1 });
  });

  it("computes set F1 on normalized values", () => {
    expect(setF1(["0741-23-4567"], ["0741234567"])).toBe(1);
    expect(setF1(["a", "b"], ["a"])).toBeCloseTo(2 / 3);
    expect(setF1([], [])).toBe(1);
  });
});
