import type { Pricing } from "../config.js";

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/**
 * USD cost of one request. The long-context tier is chosen from the request's total
 * input (uncached + cache write + cache read), matching how the API bills it.
 */
export function computeCost(model: string, usage: TokenUsage, pricing: Pricing, batch = false): number {
  const price = pricing.models[model];
  if (!price) throw new Error(`no pricing configured for model ${model}`);
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const totalInput = usage.input_tokens + cacheWrite + cacheRead;
  const tier =
    price.longContext && price.longContextThreshold !== undefined && totalInput > price.longContextThreshold
      ? price.longContext
      : price;
  const perToken = (perMillion: number) => perMillion / 1_000_000;
  const cost =
    usage.input_tokens * perToken(tier.input) +
    cacheWrite * perToken(tier.input) * pricing.cacheWriteMultiplier +
    cacheRead * perToken(tier.input) * pricing.cacheReadMultiplier +
    usage.output_tokens * perToken(tier.output);
  return batch ? cost * pricing.batchDiscount : cost;
}
