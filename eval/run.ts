import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { loadLlmConfig } from "../src/config.js";
import { createProvider, extract, type DocMeta, type ExtractInput } from "../src/llm/index.js";
import { extractPages } from "../src/pdf/text.js";
import { appendUsage } from "../src/usage/log.js";
import { scoreDocument, type DocScore, type ExpectedItem } from "./score.js";

const { values } = parseArgs({
  options: {
    fixture: { type: "string", multiple: true },
    batch: { type: "boolean", default: false },
  },
});

const ROOT = "eval/fixtures";
const ids = readdirSync(ROOT, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(ROOT, d.name, "expected.json")))
  .map((d) => d.name)
  .filter((id) => !values.fixture || values.fixture.includes(id))
  .sort();
if (ids.length === 0) {
  console.error(`no fixtures with expected.json under ${ROOT}`);
  process.exit(1);
}

const cfg = loadLlmConfig();
const inputs: ExtractInput[] = [];
const expected: { reviewed: boolean; items: ExpectedItem[] }[] = [];
for (const id of ids) {
  const dir = join(ROOT, id);
  const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) as DocMeta;
  const pdf = readFileSync(join(dir, "source.pdf"));
  inputs.push({ meta: { ...meta, docId: `eval:${id}` }, pdf, pages: await extractPages(pdf, cfg.imageOnlyCharThreshold) });
  expected.push(JSON.parse(readFileSync(join(dir, "expected.json"), "utf8")));
}

const unreviewed = ids.filter((_, k) => !expected[k]!.reviewed);
if (unreviewed.length) console.error(`WARNING: expected output not yet hand-checked for: ${unreviewed.join(", ")}`);

const started = Date.now();
const results = await extract(inputs, createProvider(cfg), cfg, { mode: values.batch ? "batch" : "sync" });
for (const r of results) await appendUsage(r.usage, "data/eval-usage.jsonl");

const scores: DocScore[] = results.map((r, k) =>
  scoreDocument(expected[k]!.items, r.actions, inputs[k]!.pages.map((p) => p.text).join("\n")),
);

const sum = (f: (s: DocScore) => number) => scores.reduce((n, s) => n + f(s), 0);
const tp = sum((s) => s.tp);
const fp = sum((s) => s.fp);
const fn = sum((s) => s.fn);
const precision = tp / Math.max(1, tp + fp);
const recall = tp / Math.max(1, tp + fn);
const f1 = (2 * precision * recall) / Math.max(1e-9, precision + recall);
const fieldAcc = (f: keyof DocScore["field"]) => {
  const c = sum((s) => s.field[f].correct);
  const t = sum((s) => s.field[f].total);
  return t ? c / t : null;
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const usage = results.flatMap((r) => r.usage);
const totalCost = results.reduce((n, r) => n + r.costUsd, 0);

const summary = {
  fixtures: ids.length,
  unreviewed,
  mode: values.batch ? "batch" : "sync",
  items: { expected: tp + fn, predicted: tp + fp, matched: tp, precision, recall, f1 },
  fieldAccuracy: {
    action_type: fieldAcc("action_type"),
    approval_status: fieldAcc("approval_status"),
    case_number: fieldAcc("case_number"),
    item_number: fieldAcc("item_number"),
    addresses_f1: mean(scores.flatMap((s) => s.setF1.addresses)),
    parcel_pins_f1: mean(scores.flatMap((s) => s.setF1.parcel_pins)),
  },
  approvalFalsePositives: sum((s) => s.approvalFalsePositives),
  evidenceVerbatimRate: sum((s) => s.evidence.verbatim) / Math.max(1, sum((s) => s.evidence.total)),
  escalatedCalls: usage.filter((u) => u.escalated).length,
  tokens: {
    input: usage.reduce((n, u) => n + u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens, 0),
    output: usage.reduce((n, u) => n + u.output_tokens, 0),
  },
  totalCostUsd: totalCost,
  seconds: Math.round((Date.now() - started) / 1000),
};

const pct = (x: number | null) => (x === null ? "  n/a" : `${(x * 100).toFixed(1).padStart(5)}%`);
console.log(`\nfixture                              exp pred  tp   cost      warnings`);
ids.forEach((id, k) => {
  const s = scores[k]!;
  console.log(
    `${id.padEnd(36)} ${String(s.tp + s.fn).padStart(3)} ${String(s.tp + s.fp).padStart(4)} ${String(s.tp).padStart(3)}  $${results[k]!.costUsd.toFixed(4)}  ${results[k]!.warnings.length}`,
  );
});
console.log(`
items      precision ${pct(precision)}  recall ${pct(recall)}  F1 ${pct(f1)}
fields     action_type ${pct(summary.fieldAccuracy.action_type)}  approval_status ${pct(summary.fieldAccuracy.approval_status)}  case_number ${pct(summary.fieldAccuracy.case_number)}  item_number ${pct(summary.fieldAccuracy.item_number)}
sets       addresses F1 ${pct(summary.fieldAccuracy.addresses_f1)}  parcel_pins F1 ${pct(summary.fieldAccuracy.parcel_pins_f1)}
safety     approval false positives: ${summary.approvalFalsePositives}   evidence verbatim: ${pct(summary.evidenceVerbatimRate)}
usage      ${summary.tokens.input} in / ${summary.tokens.output} out tokens, ${summary.escalatedCalls} escalated calls
TOTAL COST $${totalCost.toFixed(4)} (${summary.mode})`);

await mkdir("eval/results", { recursive: true });
const out = join("eval/results", `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
await writeFile(
  out,
  JSON.stringify(
    {
      summary,
      documents: ids.map((id, k) => ({
        id,
        costUsd: results[k]!.costUsd,
        warnings: results[k]!.warnings,
        missed: scores[k]!.missed,
        extra: scores[k]!.extra,
        matched: scores[k]!.matched,
      })),
    },
    null,
    2,
  ),
);
console.log(`details: ${out}`);
