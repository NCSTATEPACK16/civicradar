import { describe, expect, it } from "vitest";
import { loadLlmConfig } from "../src/config.js";
import { computeCost } from "../src/usage/cost.js";

const { pricing } = loadLlmConfig();

describe("computeCost", () => {
  it("prices Haiku under 100K input at the base tier", () => {
    // 90K in * $0.10/M + 2K out * $0.50/M
    expect(computeCost("claude-haiku-5-5", { input_tokens: 90_000, output_tokens: 2_000 }, pricing)).toBeCloseTo(0.01, 6);
  });

  it("prices Haiku over 100K input at the long-context tier", () => {
    // 120K * $0.50/M + 2K * $2.50/M
    expect(computeCost("claude-haiku-5-5", { input_tokens: 120_000, output_tokens: 2_000 }, pricing)).toBeCloseTo(0.065, 6);
  });

  it("counts cached tokens toward the tier and applies cache multipliers", () => {
    const usage = { input_tokens: 10_000, output_tokens: 0, cache_creation_input_tokens: 1_000, cache_read_input_tokens: 95_000 };
    // total input 106K -> long tier ($0.50/M): 10K*0.5 + 1K*0.5*1.25 + 95K*0.5*0.1 (all per M)
    expect(computeCost("claude-haiku-5-5", usage, pricing)).toBeCloseTo((5_000 + 625 + 4_750) / 1e6, 9);
  });

  it("halves batch requests", () => {
    const u = { input_tokens: 50_000, output_tokens: 4_000 };
    expect(computeCost("claude-sonnet-5-5", u, pricing, true)).toBeCloseTo(computeCost("claude-sonnet-5-5", u, pricing) / 2, 9);
  });

  it("throws for models without pricing", () => {
    expect(() => computeCost("unknown-model", { input_tokens: 1, output_tokens: 1 }, pricing)).toThrow();
  });
});
