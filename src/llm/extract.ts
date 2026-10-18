import type { DocumentType } from "../adapters/types.js";
import type { LlmConfig } from "../config.js";
import { chunkPages, selectPages, type Chunk } from "../pdf/chunk.js";
import { slicePdf } from "../pdf/slice.js";
import type { PdfPage } from "../pdf/text.js";
import { dedupeItems, guardItem } from "../postprocess/guards.js";
import {
  ExtractionResponseSchema,
  TriageResponseSchema,
  type CivicAction,
  type ExtractedItem,
} from "../schema/civic_action.js";
import { computeCost } from "../usage/cost.js";
import type { UsageRecord } from "../usage/log.js";
import { EXTRACTION_SYSTEM_PROMPT, TRIAGE_SYSTEM_PROMPT, extractionUserText } from "./prompt.js";
import type { LlmProvider, LlmRequest, LlmResponse, RunMode } from "./provider.js";

export interface DocMeta {
  docId: string;
  municipality: string;
  body: string;
  /** YYYY-MM-DD */
  date: string;
  meetingType: string | null;
  documentType: DocumentType;
  sourceUrl: string;
}

export interface ExtractInput {
  meta: DocMeta;
  pdf: Buffer;
  pages: PdfPage[];
}

export interface ExtractResult {
  meta: DocMeta;
  actions: CivicAction[];
  usage: UsageRecord[];
  warnings: string[];
  costUsd: number;
}

interface ChunkJob {
  doc: number;
  chunk: Chunk;
  label: string;
  items: ExtractedItem[];
  escalated: boolean;
}

/**
 * Extracts civic actions from documents. Provider-agnostic: chunking, two-pass triage,
 * escalation, guards and cost accounting happen here; the provider only counts tokens
 * and runs requests (synchronously or as one batch per round).
 */
export async function extract(
  inputs: ExtractInput[],
  provider: LlmProvider,
  cfg: LlmConfig,
  opts: { mode?: RunMode } = {},
): Promise<ExtractResult[]> {
  const mode = opts.mode ?? "sync";
  const results: ExtractResult[] = inputs.map((i) => ({ meta: i.meta, actions: [], usage: [], warnings: [], costUsd: 0 }));
  const record = (doc: number, label: string, purpose: UsageRecord["purpose"], res: LlmResponse, escalated: boolean) => {
    const cost = computeCost(res.model, res.usage, cfg.pricing, mode === "batch");
    results[doc]!.usage.push({
      ts: new Date().toISOString(),
      docId: inputs[doc]!.meta.docId,
      chunk: label,
      purpose,
      model: res.model,
      mode,
      input_tokens: res.usage.input_tokens,
      output_tokens: res.usage.output_tokens,
      cache_creation_input_tokens: res.usage.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: res.usage.cache_read_input_tokens ?? 0,
      cost_usd: cost,
      escalated,
    });
    if (res.error) results[doc]!.warnings.push(`${label}: ${res.error}`);
  };

  // Round 1 (long packets only): triage to find the pages worth extracting.
  const pageSets = inputs.map((i) => i.pages);
  const triage = inputs
    .map((input, doc) => ({ input, doc }))
    .filter(({ input }) => input.pages.length > cfg.twoPassAbovePages);
  if (triage.length) {
    const reqs = await Promise.all(
      triage.map(({ input, doc }) => fittedTriageRequest(`d${doc}-triage`, input.pages, cfg, provider)),
    );
    const responses = await provider.run(reqs, mode);
    responses.forEach((res, k) => {
      const { input, doc } = triage[k]!;
      record(doc, "triage", "triage", res, false);
      const parsed = TriageResponseSchema.safeParse(res.json);
      if (!res.complete || !parsed.success) {
        results[doc]!.warnings.push("triage failed; extracting every page");
        return;
      }
      const ranges = [
        { start: 1, end: cfg.triagePages },
        ...parsed.data.relevant.map((r) => ({ start: r.start_page, end: r.end_page })),
      ];
      pageSets[doc] = selectPages(input.pages, ranges);
    });
  }

  // Round 2: chunk under the token ceiling and extract with the default model.
  const jobs: ChunkJob[] = [];
  for (const [doc, input] of inputs.entries()) {
    const chunks = await chunkPages(pageSets[doc]!, {
      maxPages: cfg.maxPagesPerChunk,
      maxTokens: cfg.maxInputTokens,
      countTokens: async (chunk) =>
        provider.countTokens(await extractionRequest("count", input, chunk, "count", cfg.models.default, cfg)),
    });
    chunks.forEach(({ chunk }, n) =>
      jobs.push({ doc, chunk, label: `pages ${chunk.startPage}-${chunk.endPage} (part ${n + 1}/${chunks.length})`, items: [], escalated: false }),
    );
  }
  const firstPass = await runJobs(jobs, inputs, provider, cfg, mode, false);

  // Round 3: re-run weak or failed chunks on the escalation model.
  const retry: ChunkJob[] = [];
  firstPass.forEach(({ job, res, items }) => {
    record(job.doc, job.label, "extract", res, false);
    if (needsEscalation(res, items, job.chunk, cfg)) retry.push(job);
    else job.items = items ?? [];
  });
  if (retry.length) {
    const secondPass = await runJobs(retry, inputs, provider, cfg, mode, true);
    secondPass.forEach(({ job, res, items }) => {
      record(job.doc, job.label, "extract", res, true);
      job.escalated = true;
      if (items) job.items = items;
      else results[job.doc]!.warnings.push(`${job.label}: escalation also failed; no items`);
    });
  }

  // Guards, dedupe, metadata.
  for (const [doc, input] of inputs.entries()) {
    const guarded: ExtractedItem[] = [];
    for (const job of jobs.filter((j) => j.doc === doc)) {
      const pageText = new Map(input.pages.filter((p) => job.chunk.pages.includes(p.page)).map((p) => [p.page, p.text]));
      for (const item of job.items) {
        const { item: safe, warnings } = guardItem(item, { documentType: input.meta.documentType, pageText });
        guarded.push(safe);
        results[doc]!.warnings.push(...warnings);
      }
    }
    const m = input.meta;
    results[doc]!.actions = dedupeItems(guarded).map((item) => ({
      ...item,
      date: m.date,
      municipality: m.municipality,
      body: m.body,
      meeting_type: m.meetingType,
      document_type: m.documentType,
      source_url: m.sourceUrl,
    }));
    results[doc]!.costUsd = results[doc]!.usage.reduce((s, u) => s + u.cost_usd, 0);
  }
  return results;
}

async function runJobs(
  jobs: ChunkJob[],
  inputs: ExtractInput[],
  provider: LlmProvider,
  cfg: LlmConfig,
  mode: RunMode,
  escalate: boolean,
) {
  const model = escalate ? cfg.models.escalation : cfg.models.default;
  const reqs = await Promise.all(
    jobs.map((job, k) => extractionRequest(`j${k}-${escalate ? "esc" : "base"}`, inputs[job.doc]!, job.chunk, job.label, model, cfg, escalate)),
  );
  const responses = await provider.run(reqs, mode);
  return responses.map((res, k) => {
    const parsed = res.complete ? ExtractionResponseSchema.safeParse(res.json) : null;
    return { job: jobs[k]!, res, items: parsed?.success ? parsed.data.items : null };
  });
}

export function needsEscalation(res: LlmResponse, items: ExtractedItem[] | null, chunk: Chunk, cfg: LlmConfig): boolean {
  if (!res.complete || !items) return true;
  const threshold = chunk.imagePages.length ? cfg.escalation.imageOnlyConfidenceBelow : cfg.escalation.confidenceBelow;
  return items.some((i) => i.extraction_confidence < threshold);
}

async function extractionRequest(
  id: string,
  input: ExtractInput,
  chunk: Chunk,
  part: string,
  model: string,
  cfg: LlmConfig,
  escalate = false,
): Promise<LlmRequest> {
  const attachments = await Promise.all(
    chunk.imagePages.map(async (page) => ({ title: `page ${page}`, pdf: await slicePdf(input.pdf, [page]) })),
  );
  return {
    id,
    model,
    effort: escalate ? cfg.effort.escalation : cfg.effort.default,
    system: EXTRACTION_SYSTEM_PROMPT,
    text: extractionUserText(input.meta, chunk.text, part),
    attachments,
    schema: ExtractionResponseSchema,
    maxTokens: cfg.maxOutputTokens,
  };
}

/** Shrinks per-page excerpts until the triage request fits under the token ceiling. */
async function fittedTriageRequest(id: string, pages: PdfPage[], cfg: LlmConfig, provider: LlmProvider): Promise<LlmRequest> {
  for (const excerptChars of [300, 150, 60]) {
    const req = triageRequest(id, pages, cfg, excerptChars);
    if ((await provider.countTokens(req)) <= cfg.maxInputTokens) return req;
  }
  throw new Error(`${id}: triage request exceeds ${cfg.maxInputTokens} tokens even with minimal excerpts`);
}

/** Agenda pages in full plus a short excerpt of every later page. */
function triageRequest(id: string, pages: PdfPage[], cfg: LlmConfig, excerptChars: number): LlmRequest {
  const excerpt = (p: PdfPage) => (p.imageOnly ? "[no text layer]" : p.text.replace(/\s+/g, " ").slice(0, excerptChars));
  const text = pages
    .map((p) => `--- page ${p.page} ---\n${p.page <= cfg.triagePages ? p.text : excerpt(p)}`)
    .join("\n\n");
  return {
    id,
    model: cfg.models.default,
    effort: cfg.effort.default,
    system: TRIAGE_SYSTEM_PROMPT,
    text: `Packet with ${pages.length} pages.\n\n${text}`,
    attachments: [],
    schema: TriageResponseSchema,
    maxTokens: 8000,
  };
}
