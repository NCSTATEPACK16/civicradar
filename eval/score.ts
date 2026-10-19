import { quoteAppearsIn } from "../src/postprocess/guards.js";
import type { CivicAction, ExtractedItem } from "../src/schema/civic_action.js";

/** Expected items are hand-labeled; fields the labeler can't judge may be omitted. */
export type ExpectedItem = Pick<ExtractedItem, "title" | "approval_status"> &
  Partial<Pick<ExtractedItem, "action_type" | "item_number" | "case_number" | "addresses" | "parcel_pins" | "source_pages">> & {
    /** Borderline item: matching it is fine, missing it isn't penalized, and it isn't field-scored. */
    optional?: boolean;
  };

export interface DocScore {
  tp: number;
  fp: number;
  fn: number;
  matched: { expected: ExpectedItem; predicted: CivicAction }[];
  missed: ExpectedItem[];
  extra: CivicAction[];
  field: Record<FieldName, { correct: number; total: number }>;
  setF1: { addresses: number[]; parcel_pins: number[] };
  /** Predicted a decided status (approved/denied/...) that the label doesn't have. */
  approvalFalsePositives: number;
  evidence: { verbatim: number; total: number };
}

type FieldName = "action_type" | "approval_status" | "case_number" | "item_number";
const FIELDS: FieldName[] = ["action_type", "approval_status", "case_number", "item_number"];
const DECIDED = new Set(["approved", "denied", "continued", "withdrawn"]);

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const tokens = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]+/g) ?? []);

function titleSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  const inter = [...ta].filter((t) => tb.has(t)).length;
  return inter / Math.max(1, new Set([...ta, ...tb]).size);
}

function matchScore(e: ExpectedItem, p: CivicAction): number {
  if (e.case_number && p.case_number && norm(e.case_number) === norm(p.case_number)) return 3;
  if (e.item_number && p.item_number && norm(e.item_number) === norm(p.item_number)) return 2 + titleSimilarity(e.title, p.title);
  const sim = titleSimilarity(e.title, p.title);
  return sim >= 0.4 ? sim : 0;
}

export function setF1(expected: string[], predicted: string[]): number {
  const e = new Set(expected.map(norm));
  const p = new Set(predicted.map(norm));
  if (e.size === 0 && p.size === 0) return 1;
  const tp = [...p].filter((x) => e.has(x)).length;
  return (2 * tp) / (e.size + p.size);
}

/** Greedy best-first matching of predicted to expected items, then field-level scoring. */
export function scoreDocument(expected: ExpectedItem[], predicted: CivicAction[], sourceText: string): DocScore {
  const pairs: { i: number; j: number; s: number }[] = [];
  expected.forEach((e, i) => predicted.forEach((p, j) => {
    const s = matchScore(e, p);
    if (s > 0) pairs.push({ i, j, s });
  }));
  pairs.sort((a, b) => b.s - a.s);
  const usedE = new Set<number>();
  const usedP = new Set<number>();
  const matched: DocScore["matched"] = [];
  for (const { i, j } of pairs) {
    if (usedE.has(i) || usedP.has(j)) continue;
    usedE.add(i);
    usedP.add(j);
    matched.push({ expected: expected[i]!, predicted: predicted[j]! });
  }

  const field = Object.fromEntries(FIELDS.map((f) => [f, { correct: 0, total: 0 }])) as DocScore["field"];
  const sets: DocScore["setF1"] = { addresses: [], parcel_pins: [] };
  for (const { expected: e, predicted: p } of matched) {
    if (e.optional) continue;
    for (const f of FIELDS) {
      if (e[f] === undefined) continue;
      field[f].total++;
      if (norm(e[f] as string | null) === norm(p[f] as string | null)) field[f].correct++;
    }
    if (e.addresses) sets.addresses.push(setF1(e.addresses, p.addresses));
    if (e.parcel_pins) sets.parcel_pins.push(setF1(e.parcel_pins, p.parcel_pins));
  }

  const expectedStatus = new Map(matched.map((m) => [m.predicted, m.expected.approval_status]));
  const approvalFalsePositives = predicted.filter(
    (p) => DECIDED.has(p.approval_status) && expectedStatus.get(p) !== p.approval_status,
  ).length;

  const missed = expected.filter((_, i) => !usedE.has(i));
  const required = matched.filter((m) => !m.expected.optional);
  const withQuote = predicted.filter((p) => p.evidence_quote);
  // Optional items are neither required (no FN when missed) nor extra (no FP when matched).
  return {
    tp: required.length,
    fp: predicted.length - matched.length,
    fn: missed.filter((e) => !e.optional).length,
    matched,
    missed,
    extra: predicted.filter((_, j) => !usedP.has(j)),
    field,
    setF1: sets,
    approvalFalsePositives,
    evidence: {
      verbatim: withQuote.filter((p) => quoteAppearsIn(p.evidence_quote!, [sourceText])).length,
      total: withQuote.length,
    },
  };
}
