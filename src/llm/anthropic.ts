import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { LlmProvider, LlmRequest, LlmResponse, RunMode } from "./provider.js";

const EMPTY_USAGE = { input_tokens: 0, output_tokens: 0 };

export interface AnthropicProviderOptions {
  client?: Anthropic;
  /** Parallel requests in sync mode. */
  concurrency?: number;
  batchPollMs?: number;
  log?: (msg: string) => void;
}

/** Claude via the Anthropic Messages API (sync) or Message Batches API (batch, 50% off). */
export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic";
  private clientInstance: Anthropic | undefined;
  private readonly concurrency: number;
  private readonly batchPollMs: number;
  private readonly log: (msg: string) => void;

  constructor(opts: AnthropicProviderOptions = {}) {
    this.clientInstance = opts.client;
    this.concurrency = opts.concurrency ?? 4;
    this.batchPollMs = opts.batchPollMs ?? 30_000;
    this.log = opts.log ?? ((m) => console.error(m));
  }

  private get client(): Anthropic {
    this.clientInstance ??= new Anthropic();
    return this.clientInstance;
  }

  async countTokens(req: LlmRequest): Promise<number> {
    const res = await this.client.messages.countTokens({
      model: req.model,
      system: req.system,
      messages: [{ role: "user", content: content(req) }],
    });
    return res.input_tokens;
  }

  async run(reqs: LlmRequest[], mode: RunMode): Promise<LlmResponse[]> {
    if (reqs.length === 0) return [];
    return mode === "batch" ? this.runBatch(reqs) : this.runSync(reqs);
  }

  private async runSync(reqs: LlmRequest[]): Promise<LlmResponse[]> {
    const out: LlmResponse[] = new Array(reqs.length);
    let next = 0;
    const worker = async () => {
      while (next < reqs.length) {
        const k = next++;
        const req = reqs[k]!;
        try {
          out[k] = toResponse(req, await this.client.messages.create(params(req)));
        } catch (err) {
          out[k] = failed(req, err instanceof Anthropic.APIError ? `${err.status} ${err.message}` : String(err));
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, reqs.length) }, worker));
    return out;
  }

  private async runBatch(reqs: LlmRequest[]): Promise<LlmResponse[]> {
    // custom_id must match ^[a-zA-Z0-9_-]{1,64}$, so map positions instead of reusing req.id.
    const batch = await this.client.messages.batches.create({
      requests: reqs.map((req, k) => ({ custom_id: `r${k}`, params: params(req) })),
    });
    this.log(`batch ${batch.id}: submitted ${reqs.length} requests`);
    let status = batch;
    while (status.processing_status !== "ended") {
      await new Promise((r) => setTimeout(r, this.batchPollMs));
      status = await this.client.messages.batches.retrieve(batch.id);
      const c = status.request_counts;
      this.log(`batch ${batch.id}: ${status.processing_status} (${c.succeeded} ok, ${c.errored} err, ${c.processing} processing)`);
    }
    const out: (LlmResponse | undefined)[] = new Array(reqs.length);
    for await (const r of await this.client.messages.batches.results(batch.id)) {
      const k = Number(r.custom_id.slice(1));
      const req = reqs[k]!;
      out[k] = r.result.type === "succeeded" ? toResponse(req, r.result.message) : failed(req, `batch result ${r.result.type}`);
    }
    return out.map((r, k) => r ?? failed(reqs[k]!, "missing from batch results"));
  }
}

function content(req: LlmRequest): Anthropic.ContentBlockParam[] {
  const docs: Anthropic.ContentBlockParam[] = req.attachments.map((a) => ({
    type: "document",
    title: a.title,
    source: { type: "base64", media_type: "application/pdf", data: a.pdf.toString("base64") },
  }));
  return [...docs, { type: "text", text: req.text }];
}

function params(req: LlmRequest): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: req.model,
    max_tokens: req.maxTokens,
    system: req.system,
    messages: [{ role: "user", content: content(req) }],
    output_config: { effort: req.effort, format: zodOutputFormat(req.schema) },
  };
}

function toResponse(req: LlmRequest, msg: Anthropic.Message): LlmResponse {
  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  let json: unknown = null;
  let error: string | undefined;
  try {
    json = JSON.parse(text);
  } catch {
    error = `invalid JSON output (stop_reason ${msg.stop_reason})`;
  }
  const complete = msg.stop_reason === "end_turn" && json !== null;
  if (!complete && !error) error = `stop_reason ${msg.stop_reason}`;
  // Price by the configured ID; the API may echo a different alias.
  return { id: req.id, model: req.model, json, complete, usage: msg.usage, error };
}

function failed(req: LlmRequest, error: string): LlmResponse {
  return { id: req.id, model: req.model, json: null, complete: false, usage: EMPTY_USAGE, error };
}
