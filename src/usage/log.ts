import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export interface UsageRecord {
  ts: string;
  docId: string;
  chunk: string;
  purpose: "extract" | "triage";
  model: string;
  mode: "sync" | "batch";
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  cost_usd: number;
  escalated: boolean;
}

export async function appendUsage(records: UsageRecord[], path = "data/usage.jsonl"): Promise<void> {
  if (records.length === 0) return;
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

export function totalCost(records: UsageRecord[]): number {
  return records.reduce((sum, r) => sum + r.cost_usd, 0);
}
