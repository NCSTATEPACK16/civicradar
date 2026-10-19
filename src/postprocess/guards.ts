import type { ExtractedItem } from "../schema/civic_action.js";
import type { DocumentType } from "../adapters/types.js";

export interface GuardContext {
  documentType: DocumentType;
  /** Source text per 1-based page for the chunk the item came from. */
  pageText: Map<number, string>;
  /** Pages whose text came from OCR; quotes on them are matched tolerantly. */
  ocrPages?: Set<number>;
}

const DECIDED = new Set(["approved", "denied", "continued", "withdrawn"]);
const VOTE_DOCS = new Set<DocumentType>(["minutes", "action_agenda"]);
/** Confidence ceiling for items whose evidence_quote can't be found in the source. */
const UNVERIFIED_CONFIDENCE_CAP = 0.5;
/** Confidence ceiling when the quote was only matched approximately against OCR text. */
const OCR_CONFIDENCE_CAP = 0.8;
/** Edits allowed per character when matching against OCR text (OCR misreads dashes, case, punctuation). */
const OCR_MAX_ERROR_RATE = 0.08;
/** Shorter quotes must match OCR text exactly; a few edits could make a short fake quote match. */
const OCR_MIN_FUZZY_LENGTH = 30;

/** Normalizes text for verbatim comparison: case, whitespace, quotes and dashes. */
export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Letters and digits only, single-spaced: what OCR reliably preserves. */
function normalizeForOcr(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Approximate substring search (Sellers' algorithm): is there a span of `text` within
 * `maxErrors` insertions/deletions/substitutions of `pattern`?
 */
export function approxContains(pattern: string, text: string, maxErrors: number): boolean {
  const m = pattern.length;
  let prev = Array.from({ length: m + 1 }, (_, i) => i);
  for (let j = 1; j <= text.length; j++) {
    const cur = [0];
    for (let i = 1; i <= m; i++) {
      const cost = pattern[i - 1] === text[j - 1] ? 0 : 1;
      cur[i] = Math.min(prev[i - 1]! + cost, prev[i]! + 1, cur[i - 1]! + 1);
    }
    if (cur[m]! <= maxErrors) return true;
    prev = cur;
  }
  return false;
}

/** Tolerant match for quotes on OCR'd pages. */
export function quoteMatchesOcr(quote: string, texts: string[]): boolean {
  const q = normalizeForOcr(quote);
  if (!q) return false;
  const exact = texts.some((t) => normalizeForOcr(t).includes(q));
  if (exact || q.length < OCR_MIN_FUZZY_LENGTH) return exact;
  const maxErrors = Math.floor(q.length * OCR_MAX_ERROR_RATE);
  return texts.some((t) => approxContains(q, normalizeForOcr(t), maxErrors));
}

export function quoteAppearsIn(quote: string, texts: string[]): boolean {
  const q = normalizeForMatch(quote);
  if (!q) return false;
  return texts.some((t) => normalizeForMatch(t).includes(q));
}

/**
 * Deterministic checks applied to every LLM item. The model's word is never trusted
 * for approval status: a decided status needs a vote document, vote text, and an
 * evidence quote that appears verbatim in the cited pages.
 */
export function guardItem(item: ExtractedItem, ctx: GuardContext): { item: ExtractedItem; warnings: string[] } {
  const warnings: string[] = [];
  const out: ExtractedItem = { ...item };
  const label = item.item_number ?? item.case_number ?? item.title.slice(0, 40);

  const validPages = item.source_pages.filter((p) => ctx.pageText.has(p));
  if (validPages.length !== item.source_pages.length) {
    warnings.push(`${label}: dropped source_pages outside chunk (${item.source_pages.join(",")})`);
  }
  out.source_pages = [...new Set(validPages)].sort((a, b) => a - b);

  const cited = out.source_pages.length ? out.source_pages.map((p) => ctx.pageText.get(p)!) : [...ctx.pageText.values()];
  // Quotes can run across a page break, so also search the cited pages joined in order.
  const searchTexts = cited.length > 1 ? [...cited, cited.join("\n")] : cited;
  const exactOk = !!item.evidence_quote && quoteAppearsIn(item.evidence_quote, searchTexts);
  const citesOcr = (out.source_pages.length ? out.source_pages : [...ctx.pageText.keys()]).some((p) => ctx.ocrPages?.has(p));
  const ocrOk = !exactOk && citesOcr && !!item.evidence_quote && quoteMatchesOcr(item.evidence_quote, searchTexts);
  const evidenceOk = exactOk || ocrOk;
  if (ocrOk) warnings.push(`${label}: evidence_quote matched approximately against OCR text`);
  if (item.evidence_quote && !evidenceOk) {
    warnings.push(`${label}: evidence_quote not found verbatim in source`);
  }

  if (!VOTE_DOCS.has(ctx.documentType)) {
    if (out.approval_status !== "scheduled") {
      warnings.push(`${label}: ${ctx.documentType} item forced from ${out.approval_status} to scheduled`);
    }
    out.approval_status = "scheduled";
    out.vote_text = null;
  } else if (DECIDED.has(out.approval_status) && !(item.vote_text?.trim() && evidenceOk)) {
    warnings.push(`${label}: ${out.approval_status} downgraded to unknown (no verified vote quote)`);
    out.approval_status = "unknown";
  }

  const pins: string[] = [];
  for (const pin of item.parcel_pins) {
    const digits = pin.replace(/[\s-]/g, "");
    if (/^\d{10}$/.test(digits)) pins.push(digits);
    else warnings.push(`${label}: dropped invalid PIN "${pin}"`);
  }
  out.parcel_pins = [...new Set(pins)];

  out.extraction_confidence = Math.min(1, Math.max(0, item.extraction_confidence));
  if (!evidenceOk) out.extraction_confidence = Math.min(out.extraction_confidence, UNVERIFIED_CONFIDENCE_CAP);
  else if (ocrOk) out.extraction_confidence = Math.min(out.extraction_confidence, OCR_CONFIDENCE_CAP);

  return { item: out, warnings };
}

function dedupeKey(i: ExtractedItem): string {
  const norm = (s: string | null) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (i.case_number) return `case:${norm(i.case_number)}`;
  return `item:${norm(i.item_number)}|${norm(i.title)}`;
}

/** Merges items that appear in more than one chunk, keeping the most confident one. */
export function dedupeItems(items: ExtractedItem[]): ExtractedItem[] {
  const byKey = new Map<string, ExtractedItem>();
  for (const item of items) {
    const key = dedupeKey(item);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, item);
      continue;
    }
    const [keep, other] = item.extraction_confidence > prev.extraction_confidence ? [item, prev] : [prev, item];
    byKey.set(key, {
      ...keep,
      addresses: [...new Set([...keep.addresses, ...other.addresses])],
      parcel_pins: [...new Set([...keep.parcel_pins, ...other.parcel_pins])],
      source_pages: [...new Set([...keep.source_pages, ...other.source_pages])].sort((a, b) => a - b),
    });
  }
  return [...byKey.values()];
}
