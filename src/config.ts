import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { z } from "zod";
import type { Jurisdiction } from "./adapters/types.js";

const JurisdictionSchema = z.object({
  id: z.string(),
  municipality: z.string(),
  body: z.string(),
  adapter: z.string(),
  options: z.record(z.string(), z.unknown()).default({}),
});

export function loadJurisdictions(path = "config/jurisdictions.yaml"): Jurisdiction[] {
  const doc = parse(readFileSync(path, "utf8")) as unknown;
  return z.object({ jurisdictions: z.array(JurisdictionSchema) }).parse(doc).jurisdictions;
}

const Effort = z.enum(["low", "medium", "high", "xhigh", "max"]);

const ModelPrice = z.object({
  input: z.number(),
  output: z.number(),
  longContextThreshold: z.number().optional(),
  longContext: z.object({ input: z.number(), output: z.number() }).optional(),
});

export const LlmConfigSchema = z.object({
  provider: z.string(),
  models: z.object({ default: z.string(), escalation: z.string() }),
  maxInputTokens: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(),
  maxPagesPerChunk: z.number().int().positive(),
  twoPassAbovePages: z.number().int().positive(),
  triagePages: z.number().int().positive(),
  imageOnlyCharThreshold: z.number().int().nonnegative(),
  ocr: z.object({ enabled: z.boolean(), language: z.string() }).default({ enabled: false, language: "eng" }),
  effort: z.object({ default: Effort, escalation: Effort }),
  escalation: z.object({ confidenceBelow: z.number(), imageOnlyConfidenceBelow: z.number() }),
  pricing: z.object({
    batchDiscount: z.number(),
    cacheWriteMultiplier: z.number(),
    cacheReadMultiplier: z.number(),
    models: z.record(z.string(), ModelPrice),
  }),
});

export type LlmConfig = z.infer<typeof LlmConfigSchema>;
export type Pricing = LlmConfig["pricing"];

export function loadLlmConfig(path = "config/llm.yaml"): LlmConfig {
  return LlmConfigSchema.parse(parse(readFileSync(path, "utf8")));
}

/** PDF extraction settings derived from the LLM config. */
export function extractOptions(cfg: LlmConfig) {
  return { imageOnlyCharThreshold: cfg.imageOnlyCharThreshold, ocr: cfg.ocr.enabled, ocrLanguage: cfg.ocr.language };
}
