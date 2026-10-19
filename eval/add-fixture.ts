// Saves one real document into eval/fixtures/<id>/ through the same adapter the pipeline uses.
// Usage: npm run eval:add -- <id> --jurisdiction <jurisdiction id> --meeting <meeting id> --type agenda|minutes
// Writes meta.json, source.pdf (PDF sources) or pages.json (API sources), and pages.txt for hand-labeling.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { createAdapter } from "../src/adapters/registry.js";
import { extractOptions, loadJurisdictions, loadLlmConfig } from "../src/config.js";
import { PoliteFetcher } from "../src/http/politeFetch.js";
import type { DocMeta } from "../src/llm/index.js";
import { loadDocument } from "../src/pipeline/load.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    jurisdiction: { type: "string" },
    meeting: { type: "string" },
    type: { type: "string" },
    since: { type: "string", default: "2026-01-01" },
  },
});
const [id] = positionals;
if (!id || !values.jurisdiction || !values.meeting || !values.type) {
  console.error("usage: add-fixture <id> --jurisdiction <id> --meeting <meeting id> --type agenda|packet|minutes [--since YYYY-MM-DD]");
  process.exit(1);
}

const j = loadJurisdictions().find((x) => x.id === values.jurisdiction);
if (!j) throw new Error(`unknown jurisdiction ${values.jurisdiction}`);
const http = new PoliteFetcher();
const adapter = createAdapter(j, http);
const meeting = (await adapter.listMeetings(new Date(values.since!))).find((m) => m.id === values.meeting);
if (!meeting) throw new Error(`meeting ${values.meeting} not found for ${j.id} since ${values.since}`);
const doc = (await adapter.listDocuments(meeting)).find((d) => d.type === values.type);
if (!doc) throw new Error(`meeting ${meeting.id} has no ${values.type} document`);

const { pages, pdf } = await loadDocument(adapter, doc, meeting, http, extractOptions(loadLlmConfig()));
const meta: DocMeta = {
  docId: id,
  municipality: meeting.municipality,
  body: meeting.body,
  date: meeting.date,
  meetingType: meeting.meetingType,
  documentType: doc.type,
  sourceUrl: doc.mimeType === "application/pdf" ? doc.url : meeting.sourceUrl,
};

const dir = join("eval/fixtures", id);
await mkdir(dir, { recursive: true });
await writeFile(join(dir, "meta.json"), JSON.stringify(meta, null, 2) + "\n");
if (pdf) await writeFile(join(dir, "source.pdf"), pdf);
else await writeFile(join(dir, "pages.json"), JSON.stringify(pages, null, 2) + "\n");
await writeFile(
  join(dir, "pages.txt"),
  pages.map((p) => `--- page ${p.page} ---${p.imageOnly ? " [IMAGE-ONLY]" : ""}\n${p.text}`).join("\n\n") + "\n",
);
console.log(`${dir}: ${pages.length} pages (${pages.filter((p) => p.imageOnly).length} image-only) from ${doc.url}`);
