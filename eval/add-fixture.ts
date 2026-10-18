// Downloads a document into eval/fixtures/<id>/ (source.pdf, meta.json, pages.txt for hand-labeling).
// Usage: npm run eval:add -- <id> <url> --municipality "Wake County" --body "Board of Commissioners" \
//          --date 2026-08-17 --type minutes [--meeting-type "Regular Meeting"]
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { PoliteFetcher } from "../src/http/politeFetch.js";
import type { DocMeta } from "../src/llm/index.js";
import { extractPages } from "../src/pdf/text.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    municipality: { type: "string" },
    body: { type: "string" },
    date: { type: "string" },
    type: { type: "string" },
    "meeting-type": { type: "string" },
  },
});
const [id, url] = positionals;
if (!id || !url || !values.municipality || !values.body || !values.date || !values.type) {
  console.error("usage: add-fixture <id> <url> --municipality M --body B --date YYYY-MM-DD --type agenda|packet|minutes|action_agenda");
  process.exit(1);
}

const dir = join("eval/fixtures", id);
await mkdir(dir, { recursive: true });
const res = await new PoliteFetcher().get(url);
const pages = await extractPages(res.body);
const meta: DocMeta = {
  docId: id,
  municipality: values.municipality,
  body: values.body,
  date: values.date,
  meetingType: values["meeting-type"] ?? null,
  documentType: values.type as DocMeta["documentType"],
  sourceUrl: url,
};
await writeFile(join(dir, "source.pdf"), res.body);
await writeFile(join(dir, "meta.json"), JSON.stringify(meta, null, 2) + "\n");
await writeFile(
  join(dir, "pages.txt"),
  pages.map((p) => `--- page ${p.page} ---${p.imageOnly ? " [IMAGE-ONLY]" : ""}\n${p.text}`).join("\n\n"),
);
console.log(`${dir}: ${pages.length} pages (${pages.filter((p) => p.imageOnly).length} image-only)`);
