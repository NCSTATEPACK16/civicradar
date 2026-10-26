import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { Geocoder, loadGeocodeConfig, type GeocodeResult } from "../geo/geocode.js";
import { CivicActionSchema } from "../schema/civic_action.js";
import { dedupeRows, toRow, type CivicActionRow } from "../store/rows.js";
import { upsertCivicActions } from "../store/supabase.js";

// Geocodes extracted actions (data/out/*.json from `ingest`) and upserts them into Supabase.
// --dry-run writes the rows to data/store/rows.json instead; --no-geocode skips lookups.
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "dry-run": { type: "boolean", default: false },
    "no-geocode": { type: "boolean", default: false },
  },
});

const OutputFileSchema = z.object({
  models: z.array(z.string()).optional(),
  actions: z.array(CivicActionSchema),
});

const files = positionals.length
  ? positionals
  : (await readdir("data/out")).filter((f) => f.endsWith(".json")).map((f) => join("data/out", f));

let url: string | undefined;
let serviceRoleKey: string | undefined;
if (!values["dry-run"]) {
  url = process.env.SUPABASE_URL;
  serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (or pass --dry-run)");
    process.exit(1);
  }
}

const geocoder = values["no-geocode"] ? null : new Geocoder(loadGeocodeConfig());
const rows: CivicActionRow[] = [];
const methods: Record<string, number> = {};
for (const file of files) {
  const out = OutputFileSchema.parse(JSON.parse(await readFile(file, "utf8")));
  const model = out.models?.length ? out.models.join("+") : null;
  for (const action of out.actions) {
    const hasLocation = action.parcel_pins.length > 0 || action.addresses.length > 0;
    const geo: GeocodeResult | null = geocoder && hasLocation ? await geocoder.geocode(action) : null;
    const tally = geo?.method ?? (hasLocation ? (geocoder ? "unmatched" : "not geocoded") : "no location");
    methods[tally] = (methods[tally] ?? 0) + 1;
    rows.push(toRow(action, model, geo));
  }
}

const unique = dedupeRows(rows);
console.error(`${files.length} files, ${unique.length} rows (${rows.length - unique.length} duplicates dropped)`);
console.error(`geocoding: ${Object.entries(methods).map(([k, n]) => `${k} ${n}`).join(", ")}`);
for (const w of new Set(geocoder?.warnings ?? [])) console.error(`  warning: ${w}`);

if (values["dry-run"]) {
  await mkdir("data/store", { recursive: true });
  await writeFile("data/store/rows.json", JSON.stringify(unique, null, 2));
  console.error("dry run: wrote data/store/rows.json; nothing sent to Supabase");
} else {
  await upsertCivicActions(unique, { url: url!, serviceRoleKey: serviceRoleKey! });
  console.error(`upserted ${unique.length} rows into civic_actions`);
}
