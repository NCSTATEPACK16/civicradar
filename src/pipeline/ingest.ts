import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { createAdapter } from "../adapters/registry.js";
import { loadJurisdictions, loadLlmConfig } from "../config.js";
import { PoliteFetcher } from "../http/politeFetch.js";
import { createProvider, extract, type ExtractInput } from "../llm/index.js";
import { extractPages } from "../pdf/text.js";
import { appendUsage } from "../usage/log.js";

const { values } = parseArgs({
  options: {
    jurisdiction: { type: "string", multiple: true },
    since: { type: "string" },
    batch: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    "max-docs": { type: "string" },
    "doc-types": { type: "string", default: "agenda,packet,minutes,action_agenda" },
  },
});

const since = values.since ? new Date(values.since) : new Date(Date.now() - 14 * 86_400_000);
const docTypes = new Set(values["doc-types"]!.split(","));
const maxDocs = values["max-docs"] ? Number(values["max-docs"]) : Infinity;
const cfg = loadLlmConfig();
const http = new PoliteFetcher();
const jurisdictions = loadJurisdictions().filter((j) => !values.jurisdiction || values.jurisdiction.includes(j.id));

const inputs: ExtractInput[] = [];
for (const j of jurisdictions) {
  const adapter = createAdapter(j, http);
  const meetings = await adapter.listMeetings(since);
  console.error(`${j.id}: ${meetings.length} meetings since ${since.toISOString().slice(0, 10)}`);
  for (const meeting of meetings) {
    for (const doc of await adapter.listDocuments(meeting)) {
      if (!docTypes.has(doc.type) || inputs.length >= maxDocs) continue;
      let res;
      try {
        res = await http.get(doc.url);
      } catch (err) {
        console.error(`  ${meeting.date} ${doc.type.padEnd(8)} FAILED ${doc.url}: ${(err as Error).cause ?? err}`);
        continue;
      }
      const pages = await extractPages(res.body, cfg.imageOnlyCharThreshold);
      const imageOnly = pages.filter((p) => p.imageOnly).length;
      const chars = pages.reduce((n, p) => n + p.text.length, 0);
      console.error(
        `  ${meeting.date} ${doc.type.padEnd(8)} ${String(pages.length).padStart(4)}p` +
          ` (${imageOnly} image-only, ~${Math.round(chars / 4)} tok est.) ${doc.url}`,
      );
      inputs.push({
        pdf: res.body,
        pages,
        meta: {
          docId: `${j.id}:${meeting.id}:${doc.type}:${sha256(doc.url).slice(0, 8)}`,
          municipality: meeting.municipality,
          body: meeting.body,
          date: meeting.date,
          meetingType: meeting.meetingType,
          documentType: doc.type,
          sourceUrl: doc.url,
        },
      });
    }
  }
}

if (values["dry-run"]) {
  console.error(`dry run: ${inputs.length} documents found; no LLM calls made`);
  process.exit(0);
}

const results = await extract(inputs, createProvider(cfg), cfg, { mode: values.batch ? "batch" : "sync" });
await mkdir("data/out", { recursive: true });
let total = 0;
for (const r of results) {
  await appendUsage(r.usage);
  total += r.costUsd;
  const file = `data/out/${r.meta.docId.replace(/[^a-zA-Z0-9_-]+/g, "_")}.json`;
  await writeFile(file, JSON.stringify({ meta: r.meta, costUsd: r.costUsd, warnings: r.warnings, actions: r.actions }, null, 2));
  console.error(`${r.meta.docId}: ${r.actions.length} actions, $${r.costUsd.toFixed(4)}, ${r.warnings.length} warnings -> ${file}`);
}
console.error(`total: ${results.length} documents, $${total.toFixed(4)}`);

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}
