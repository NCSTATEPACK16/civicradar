import type { z } from "zod";
import type { TokenUsage } from "../usage/cost.js";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** One provider-neutral request: a system prompt, page-marked text, optional PDF pages. */
export interface LlmRequest {
  id: string;
  model: string;
  effort: Effort;
  system: string;
  text: string;
  attachments: { title: string; pdf: Buffer }[];
  schema: z.ZodType;
  maxTokens: number;
}

export interface LlmResponse {
  id: string;
  model: string;
  /** Parsed JSON output, or null if the call failed or the output wasn't valid JSON. */
  json: unknown | null;
  /** True when the model finished normally (not truncated, refused, or errored). */
  complete: boolean;
  usage: TokenUsage;
  /** Set by providers that don't bill per token (e.g. a subscription plan): actual extra charge. */
  billedUsd?: number;
  error?: string;
}

export type RunMode = "sync" | "batch";

/** Everything provider-specific lives behind this interface. */
export interface LlmProvider {
  readonly name: string;
  readonly supportsBatch: boolean;
  countTokens(req: LlmRequest): Promise<number>;
  run(reqs: LlmRequest[], mode: RunMode): Promise<LlmResponse[]>;
}
