# CivicRadar — Blueprint (Wake County → North Carolina), verified October 2026

CivicRadar is buildable cheaply, but the original draft's core "moat" is wrong: Wake County alone runs on at least seven different agenda pipelines, Raleigh has moved from BoardDocs to eSCRIBE, the school board uses Simbli rather than BoardDocs, and Gemini 1.5 Flash was shut down in September 2025, so the scraper plan, model choice and cost assumptions all need the corrections below.

## TL;DR

- **Platform reality:** Of 14 Wake County public bodies checked, the platforms are eSCRIBE (Raleigh, Knightdale), CivicPlus AgendaCenter (Fuquay-Varina), CivicClerk (Holly Springs), Municode Meetings (Apex), iQM2 (Cary), Legistar (Wake County), Simbli (WCPSS), a Granicus product (Wendell, likely), and plain PDFs on town websites (Garner, Morrisville, Rolesville, Wake Forest, Zebulon). That is an adapter-per-platform problem, not a "four scrapers cover NC" problem. Prefer official feeds (Legistar Web API, CivicClerk OData API, eSCRIBE/Granicus RSS) over headless scraping.
- **Stack update:** Replace `gemini-1.5-flash` (shut down September 29, 2025) with a current Flash-Lite model (`gemini-3.5-flash-lite` or `gemini-3.1-flash-lite`) and escalate hard documents to `gemini-3.8-flash`. A 50–200 page packet should cost roughly $0.02–$0.05 on Flash-Lite (about half that via the Batch API). GitHub Actions is unlimited on public repos (2,000 min/month on private), and Supabase Free is still 500 MB but pauses after 1 week of inactivity.
- **Business:** The free consumer radius-alert product is a good wedge, but revenue will come from B2B. Validate $50–$200/month with journalists, small contractors and advocacy groups first. Note that a direct local competitor (MyTownView) already publishes AI meeting summaries for Wake County towns, so differentiate on maps, parcel-level geocoding and alerts.

---

## Corrections to the original draft

| # | Original claim | Corrected (October 2026) |
|---|---|---|
| 1 | Raleigh uses BoardDocs | Raleigh now publishes on **eSCRIBE** (`pub-raleighnc.escribemeetings.com`); BoardDocs (`go.boarddocs.com/nc/raleigh`) is a historical archive. eSCRIBE was in use by at least the December 2, 2025 council meeting, and the City Manager's March 13, 2026 update directs readers to eScribe.\[1\]\[2\] Some raleighnc.gov pages still mention BoardDocs (stale). |
| 2 | "Most public school boards" use BoardDocs (implied for WCPSS) | WCPSS uses **Simbli (eBoard Solutions)** at `simbli.eboardsolutions.com/nc/wake`, not BoardDocs. |
| 3 | Fuquay-Varina uses CivicPlus AgendaCenter | **Confirmed.** `fuquay-varina.org/AgendaCenter` (CivicPlus CivicEngage), with 2026 Board of Commissioners and Planning Board agendas posted.\[3\] |
| 4 | Wake Forest uses CivicPlus/Municode | **Not supported.** Wake Forest posts agenda PDFs on its own site (`wakeforestnc.gov/sites/default/files/uploads/agendas/...`) plus a video "Public Meetings Portal."\[4\]\[5\] |
| 5 | Four vendors cover nearly every NC municipality; ~4 scrapers needed | **False for Wake County alone:** 7+ distinct pipelines across 14 bodies, and 5 towns use no agenda vendor at all (PDFs on CMS sites). |
| 6 | A Raleigh BoardDocs scraper works for Asheville/Wilmington with URL tweaks | Invalid, because Raleigh is no longer on BoardDocs. Other cities' platforms were not verified here; check each one. |
| 7 | Wake County has 12 municipalities | **12 is right** for towns primarily in Wake (Apex, Cary, Fuquay-Varina, Garner, Holly Springs, Knightdale, Morrisville, Raleigh, Rolesville, Wake Forest, Wendell, Zebulon). Small portions of Durham and Angier also lie in Wake. Several Wake towns straddle lines (e.g., Wake Forest levies taxes in Franklin County too). |
| 8 | NC has 550+ municipalities | Roughly right: NC Office of State Budget and Management counts **551** active municipalities (July 1, 2025), and the NC League of Municipalities says "more than 540." **100 counties** is correct.\[6\]\[7\] |
| 9 | `gemini-1.5-flash` "for cost efficiency" | **Shut down September 29, 2025** (Gemini API release notes).\[8\] Use `gemini-3.5-flash-lite` / `gemini-3.1-flash-lite`, with `gemini-3.8-flash` as fallback. |
| 10 | "Claude 3.5 Sonnet or GPT-4o" as the heavy alternatives | Outdated model names. Compare against current low-cost tiers (Claude Haiku-class, OpenAI "mini" models) and current Gemini Flash. |
| 11 | GitHub Actions free tier = 2,000 minutes/month | Only for **private** repos on GitHub Free. Standard runners on **public** repos are free and unlimited.\[9\] |
| 12 | Supabase free = 500 MB incl. PostGIS | 500 MB still correct, but add: **projects pause after 1 week of inactivity**, 2 active projects, no automatic backups, 500,000 Edge Function invocations/month.\[10\]\[11\] |
| 13 | Cron "every Tuesday at 2:00 AM EST" | GitHub cron runs in **UTC**: `0 7 * * 2` = 2 AM EST / 3 AM EDT. Scheduled runs can be delayed at busy times.\[12\] |
| 14 | Mapbox-style map | Fine, but MapLibre GL + OpenStreetMap vector tiles (Protomaps/OpenFreeMap) avoids per-load billing. |

---

## 1. The Builder Prompt (for Cursor, Claude Code, or Gemini)

Key changes from the original: current model IDs, platform adapters that match reality, official APIs before scraping, a confidence/evidence field to fight hallucination, and a UTC-correct schedule.

```text
You are a senior full-stack engineer. Build "CivicRadar", a Node.js (TypeScript, Node 22 LTS) backend
that ingests municipal meeting agendas/packets for Wake County, NC, extracts structured "civic actions"
with an LLM, geocodes them, and stores them in Supabase (Postgres + PostGIS).

ARCHITECTURE
- /adapters: one adapter per publishing platform, each implementing:
    listMeetings(since: Date) -> Meeting[]   (id, body, date, title, sourceUrl)
    listDocuments(meeting) -> Doc[]          (type: agenda|packet|minutes, url, mimeType)
- Prefer official machine-readable sources over HTML scraping, in this order:
    1) Official APIs/feeds (Legistar Web API JSON; CivicClerk public OData API; eSCRIBE/Granicus RSS)
    2) Static HTML lists parsed with Cheerio
    3) Puppeteer ONLY when content is JS-rendered
- Respect robots.txt, identify with a descriptive User-Agent + contact email, rate-limit to
  <= 1 request/second per host, cache by URL + ETag/Last-Modified, never re-download unchanged PDFs.

PHASE 1 ADAPTERS (Wake County) — build in this order:
  a) escribe      -> Raleigh: https://pub-raleighnc.escribemeetings.com/
                     Knightdale: https://pub-knightdalenc.escribemeetings.com/
                     (meeting pages expose Agenda / "Agenda Full Package" PDFs via FileStream.ashx?DocumentId=)
  b) legistar     -> Wake County Board of Commissioners: client "wake" (wake.legistar.com);
                     use the Legistar Web API (webapi.legistar.com/v1/wake/...) for events, items, attachments
  c) civicplus_agendacenter -> Fuquay-Varina: https://www.fuquay-varina.org/AgendaCenter
                     (files at /AgendaCenter/ViewFile/Agenda/_MMDDYYYY-NNN)
  d) civicclerk   -> Holly Springs: https://hollyspringsnc.portal.civicclerk.com/
                     (use {tenant}.api.civicclerk.com OData endpoints)
  e) municode_meetings -> Apex: https://apex-nc.municodemeetings.com/
  f) iqm2         -> Cary: https://carync.iqm2.com/Citizens/calendar.aspx
  g) simbli       -> WCPSS Board of Education: https://simbli.eboardsolutions.com/nc/wake
  h) static_pdf_list (generic, config-driven CSS selectors) -> Garner, Morrisville, Rolesville,
                     Wake Forest, Zebulon, Wendell, Wake County Planning Board pages on wake.gov
Write a config file (jurisdictions.yaml) mapping each body -> adapter + URL + selectors, so new
NC jurisdictions are added by config, not code.

PHASE 1b: PDF HANDLING
- Download PDFs to Supabase Storage (or keep only hashes + source URLs if storage is tight).
- For packets > 100 pages, first send only the agenda (or the first ~15 pages) to classify which items
  matter (zoning, rezoning, annexation, site plans, infrastructure contracts, budget amendments),
  then send only the relevant page ranges for detailed extraction.
- Detect scanned/image-only PDFs (no text layer) and flag them; the LLM can read images, but mark
  extraction_confidence lower.

PHASE 1c: LLM EXTRACTION
- Use the Google Gen AI SDK (@google/genai). Default model: "gemini-3.5-flash-lite"
  (alt: "gemini-3.1-flash-lite"); escalate low-confidence docs to "gemini-3.8-flash".
- Upload PDFs via the Files API and request structured output with a JSON schema (responseSchema).
- Use the Batch API for the weekly backfill (50% cheaper); synchronous calls only for new items.
- System prompt:
  "You extract actionable local-government items from North Carolina meeting agendas, packets, and
   minutes. Return ONLY JSON matching the schema. One object per distinct agenda item that concerns
   land use (rezoning, conditional zoning, annexation, special use permit, variance, site/subdivision
   plan, text amendment), infrastructure (roads, water/sewer, stormwater, parks, capital projects,
   contracts), or budget (amendments, capital project ordinances, fees/taxes).
   Rules: (1) Never invent facts. If a field is not stated, use null. (2) approval_status must be
   'scheduled' for agendas; only use 'approved'/'denied'/'continued'/'withdrawn' when the document is
   minutes or an action agenda that explicitly records the vote, and quote the vote text in
   evidence_quote. (3) Extract every address, Wake County PIN (10-digit parcel ID), and case number
   (e.g., RZ-25-03, Z-12-25, TCZ-14-25) verbatim. (4) plain_english_summary: max 2 sentences, neutral,
   no speculation. (5) Include source page numbers."
- Output schema (array): see /schema/civic_action.json (date, municipality, body, meeting_type,
  document_type, item_number, case_number, action_type, title, plain_english_summary,
  addresses[], parcel_pins[], approval_status, vote_text, evidence_quote, source_url, source_pages[],
  extraction_confidence 0-1).

PHASE 1d: GEOCODING
- Order of preference: (1) PIN -> Wake County parcel centroid (Wake County GIS / NC OneMap parcels),
  (2) address -> US Census Geocoder (free, batch), (3) fallback Nominatim (<= 1 req/s, cache results).
- Store a point geometry + geocode_method + geocode_confidence. Do not use geohash as the primary key.

PHASE 1e: DATABASE
- Create Supabase SQL migration: enable PostGIS, create civic_actions with geography(Point,4326),
  GiST index, unique constraint on (source_url, item_number), and an RPC
  actions_within(lat, lng, meters) for radius alerts. Map pins are just rows with geom; the frontend
  queries via RPC — no separate "pin generation" function is needed. Use a Postgres trigger to enqueue
  alert jobs (pgmq or a jobs table) when a new row with geom is inserted.

PHASE 1f: SCHEDULING
- GitHub Actions workflow (.github/workflows/ingest.yml): cron "0 7 * * 2" (Tue 07:00 UTC = 2 AM EST /
  3 AM EDT) plus workflow_dispatch; add a lighter daily run for agenda-posting days (Thu/Fri).
  Use ubuntu-latest, Node 22, cache npm and the Puppeteer browser; timeout-minutes: 30.
  Secrets: GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

DELIVERABLES: runnable repo, README with setup, unit tests per adapter using saved HTML/JSON fixtures,
a health report (per jurisdiction: last success, docs found, items extracted), and structured logs.
```

### Sample JSON output (one item)

```json
{
  "date": "2026-04-07",
  "municipality": "Raleigh",
  "body": "City Council",
  "meeting_type": "regular",
  "document_type": "minutes",
  "item_number": "S.5",
  "case_number": "TCZ-14-25",
  "action_type": "Zoning",
  "title": "Text Change to Zoning Conditions – 2211, 2221, 2231 S New Hope Rd",
  "plain_english_summary": "Council voted on changing the zoning conditions for three parcels on S New Hope Road. Staff noted the request would support density near the future New Bern Avenue BRT.",
  "addresses": ["2211 S New Hope Rd, Raleigh, NC", "2221 S New Hope Rd, Raleigh, NC", "2231 S New Hope Rd, Raleigh, NC"],
  "parcel_pins": [],
  "approval_status": "approved",
  "vote_text": "Against (2): Council Member Forte, and Council Member Jones",
  "evidence_quote": "See Ordinance (2026) 867 ZC 916.",
  "source_url": "https://pub-raleighnc.escribemeetings.com/FileStream.ashx?DocumentId=11948",
  "source_pages": [],
  "extraction_confidence": 0.8
}
```

(Example values are drawn from Raleigh's published April 7, 2026 minutes on eSCRIBE; page numbers intentionally left empty.)\[13\]

### Starter Supabase / PostGIS SQL

```sql
create extension if not exists postgis;

create table if not exists public.civic_actions (
  id                    bigint generated always as identity primary key,
  meeting_date          date not null,
  municipality          text not null,
  body                  text,
  document_type         text check (document_type in ('agenda','packet','minutes','action_agenda')),
  item_number           text,
  case_number           text,
  action_type           text check (action_type in ('Zoning','Infrastructure','Budget','Other')),
  title                 text not null,
  plain_english_summary text,
  addresses             text[],
  parcel_pins           text[],
  approval_status       text check (approval_status in ('scheduled','approved','denied','continued','withdrawn','unknown')),
  vote_text             text,
  evidence_quote        text,
  source_url            text not null,
  source_pages          int[],
  extraction_confidence numeric(3,2),
  geom                  geography(Point, 4326),
  geocode_method        text,           -- 'pin' | 'census' | 'nominatim' | 'manual'
  created_at            timestamptz default now(),
  unique (source_url, item_number)
);

create index if not exists civic_actions_geom_idx on public.civic_actions using gist (geom);
create index if not exists civic_actions_date_idx on public.civic_actions (meeting_date desc);

-- Radius query for the map + alerts (meters; 2 miles ≈ 3219 m)
create or replace function public.actions_within(lat double precision, lng double precision, meters int default 3219)
returns setof public.civic_actions language sql stable as $$
  select * from public.civic_actions
  where geom is not null
    and st_dwithin(geom, st_setsrid(st_makepoint(lng, lat), 4326)::geography, meters)
  order by meeting_date desc;
$$;

alter table public.civic_actions enable row level security;
create policy "public read" on public.civic_actions for select using (true);
```

### GitHub Actions schedule

```yaml
name: ingest
on:
  schedule:
    - cron: "0 7 * * 2"    # Tue 07:00 UTC = 2:00 AM EST (Nov–Mar) / 3:00 AM EDT (Mar–Nov)
    - cron: "23 12 * * 4,5" # light Thu/Fri pass when agendas post; off-the-hour to avoid queue delays
  workflow_dispatch:
jobs:
  run:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run ingest
        env:
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
```

Scheduling caveats: GitHub cron is UTC only, so a single expression cannot be exactly 2:00 AM Eastern all year. Use `0 7 * * 2` (2 AM EST / 3 AM EDT) or add `0 6 * * 2` for EDT months. GitHub also warns that scheduled runs can be delayed during high load, especially at the top of the hour.\[12\] Puppeteer runs on `ubuntu-latest`, but newer Ubuntu images may require launching Chrome with `--no-sandbox`; the official API adapters avoid this entirely for Legistar and CivicClerk.

---

## 2. Feasibility — Scaling from Wake County to all of NC

### Wake County platform map (verified October 2026)

| Body | Platform | Public URL | Confidence / notes |
|---|---|---|---|
| Raleigh (City Council, Planning Commission, boards) | **eSCRIBE** | pub-raleighnc.escribemeetings.com | Confirmed; 2026 meetings and "Agenda Full Package" PDFs posted.\[14\] BoardDocs (go.boarddocs.com/nc/raleigh) = archive. |
| Cary | **iQM2** (launched via Accela MinuteTraq) | carync.iqm2.com/Citizens | Confirmed; Cary also maintains a backup agenda page during outages.\[15\]\[16\] |
| Apex | **Municode Meetings** (CivicPlus) | apex-nc.municodemeetings.com | Confirmed; 2026 agendas/packets in PDF + HTML.\[17\] |
| Fuquay-Varina | **CivicPlus AgendaCenter** | fuquay-varina.org/AgendaCenter | Confirmed; 2026 agendas posted.\[3\] |
| Garner | Town website (likely Granicus govAccess CMS) | garnernc.gov/government/town-council/town-council-agendas-and-minutes | Not confirmed; posting method changed Sept 16, 2025; list is JS-loaded.\[18\] |
| Holly Springs | **CivicClerk** (CivicPlus) | hollyspringsnc.portal.civicclerk.com | Confirmed; files served from hollyspringsnc.api.civicclerk.com.\[19\]\[20\] |
| Knightdale | **eSCRIBE** | pub-knightdalenc.escribemeetings.com | Confirmed; Council, Work Session, Land Use Review Board, BOA.\[21\] |
| Morrisville | Town website PDFs (Granicus OpenCities CMS) | morrisvillenc.gov/Government/Town-Council-Advisory-Committee-Meetings | Confirmed as PDFs; packets can be very large (e.g., 61 MB).\[22\] |
| Rolesville | Town website PDFs | rolesvillenc.gov/agendas-minutes | Confirmed; table of Agenda / Agenda Packet / Minutes.\[23\] |
| Wake Forest | Town website PDFs + video portal | wakeforestnc.gov/board-commissioners | Confirmed; agendas at /sites/default/files/uploads/agendas/.\[4\]\[24\] |
| Wendell | Granicus product (likely Peak Agenda/OneMeeting) | townofwendellnc.gov/agendas | Likely; packets hosted on Granicus S3/CloudFront.\[25\]\[26\] |
| Zebulon | Town website (Apptegy/Thrillshare file hosting) | townofzebulon.org | Confirmed as PDFs; no agenda vendor.\[27\] |
| Wake County Board of Commissioners | **Granicus Legistar** | wake.legistar.com | Confirmed; county says Legistar holds minutes back to 1901 and video since 2007. Legacy archive at wake.granicus.com.\[28\]\[29\] |
| Wake County Planning Board / BOA | wake.gov pages | wake.gov/.../planning-board-agendas-minutes | Confirmed; PDF links per meeting.\[30\] |
| WCPSS Board of Education | **Simbli** (eBoard Solutions) | simbli.eboardsolutions.com/nc/wake | Confirmed; not BoardDocs.\[31\] |

**What this means:** the "vendor monopoly" moat does not exist. Even in one county, the most common "platform" is *no platform* (a PDF list on a CMS). The real moat is operational: a config-driven adapter framework, robust PDF handling, parcel-level geocoding, and a clean history that compounds over time.

### NC-wide counts

- Counties: **100**.
- Municipalities: **551** active (NC OSBM, July 1, 2025); NCLM says "more than 540."\[6\]\[7\] Treat "~550" as correct.

### NC vendor landscape (agenda/meeting management)

| Vendor / product | Owner | Seen in NC (evidence from this research) | Machine-readable access | Scraping notes |
|---|---|---|---|---|
| Legistar (Agenda LE) | Granicus | Wake County | **Legistar Web API** (public JSON: events, items, votes, attachments)\[32\] | Best-case source; use the API, not HTML. |
| Granicus ViewPublisher / Peak Agenda / OneMeeting | Granicus | Wake County legacy video archive; Wendell (likely) | ViewPublisher RSS feeds; PDFs | RSS + PDF fetch is usually enough. |
| iQM2 | Granicus (originally Accela MinuteTraq) | Cary | RSS on some sites; HTML calendar | Static HTML; Cheerio works. |
| eSCRIBE | OnBoard (Passageways, OnBoard's parent, announced its acquisition of eSCRIBE Software Ltd. on Aug 4, 2021; not a Diligent product) | Raleigh, Knightdale | Public portal + FileStream PDF links; some sites expose RSS | JS-heavy listing; meeting pages are stable. |
| CivicClerk (now CivicPlus "Agenda & Meeting Management") | CivicPlus | Holly Springs, Clayton, Harrisburg, Brunswick County\[33\] | **Public OData API** at {tenant}.api.civicclerk.com\[34\]\[35\] | Use the API; portal is a SPA. |
| CivicPlus AgendaCenter (CivicEngage CMS) | CivicPlus | Fuquay-Varina | Predictable ViewFile URLs | Static HTML; easy. |
| Municode Meetings | CivicPlus (Municode) | Apex | HTML list + PDF/HTML packets | Static; easy. |
| BoardDocs | Diligent | Raleigh (archive only) | No public API; JS-heavy | Use only for historical backfill. |
| Simbli | eBoard Solutions | WCPSS | No documented public API | ASP.NET pages; Puppeteer likely. |
| Self-hosted PDFs on CMS (Drupal, OpenCities, Apptegy) | n/a | Garner, Morrisville, Rolesville, Wake Forest, Zebulon | None | Generic config-driven list scraper. |
| NovusAGENDA, iCompass, ClerkBase, PrimeGov, CivicWeb | various | Not verified in Wake; present elsewhere in the U.S. | Varies | Inventory per county before building. |

Statewide plan: build the six or seven adapters needed for Wake, then run a cheap "platform census" across all ~551 municipalities and 100 counties by fetching each government's agendas page and fingerprinting vendor domains (`legistar.com`, `civicclerk.com`, `escribemeetings.com`, `municodemeetings.com`, `iqm2.com`, `boarddocs.com`, `eboardsolutions.com`, `/AgendaCenter`). Prioritize by population and development activity (Triangle, Charlotte metro, Wilmington, Asheville) rather than by vendor.

### Existing projects and competitors

- **MyTownView** already publishes AI-generated meeting summaries for Holly Springs and other Wake County towns. Its Wake County page (October 2026) says it tracks 14 municipalities, lists 78 meetings from the previous 30 days, and offers a county RSS feed. Its contact page says agendas and minutes are "checked multiple times per day." This is the most direct local competitor; evaluate it before building.
- **Apify marketplace actors** already scrape or query Legistar, CivicClerk, Granicus and PrimeGov agendas (one even advertises keyword alerts for "zoning, data centers, short-term rentals").\[36\] The commodity layer is cheap; your value must sit above it.
- **Hyperlocal newsletters** (e.g., Holly Springs Update covering Apex council meetings) are both competitors for attention and potential customers.\[37\]
- Open-source civic tech such as **Councilmatic** (Legistar-based council sites), **CivicBand**, and **citymeetings.nyc** show demand and patterns, but none of these were verified to cover Wake County in this research.
- Commercial zoning/permit-intelligence vendors (e.g., Zoneomics, Cititrack and similar planning-data products) target developers and appraisers. Their pricing was not verified in this research.

### Legal: NC public records and redistribution

- Agendas, packets and minutes are public records under the NC Public Records Act (N.C.G.S. Chapter 132), and meetings are governed by the Open Meetings Law (N.C.G.S. 143-318.9 et seq.; Apex's 2026 recap cites G.S. 143-318.11 for closed sessions).\[38\] Redistributing and summarizing them is generally permissible.
- Caveats: (1) vendor portals (eSCRIBE, Simbli, BoardDocs, CivicClerk) have their own terms of use, so prefer official APIs/feeds, honor robots.txt, and rate-limit; (2) packets may include third-party copyrighted material (consultant reports, site plans) — summarize and link to the official source rather than re-hosting whole packets; (3) packets and comment cards can contain personal information (names, addresses, emails) — do not index or surface personal contact data; (4) label AI summaries as unofficial, as MyTownView does.\[39\]

---

## 3. Low-Cost Infrastructure

### Gemini model choice (as of October 2026)

| Model | Input / output per 1M tokens (standard) | Notes |
|---|---|---|
| `gemini-1.5-flash` | — | **Shut down September 29, 2025** (Gemini API release notes). |
| `gemini-2.5-flash-lite` | $0.10 / $0.40 | Cheapest on the rate card, but limited to projects that already used it; Vertex AI retirement October 20, 2026.\[40\]\[41\] Do not build on it. |
| `gemini-3.1-flash-lite` | $0.25 / $1.50 | Third-party pricing trackers; 1M context. Batch: $0.125 / $0.75.\[42\]\[43\] |
| `gemini-3.5-flash-lite` | $0.30 / $2.50 | Released July 21, 2026 per pricing trackers; 1,048,576-token context.\[44\] **Recommended default.** |
| `gemini-3.8-flash` | $0.75 / $3.75 through Dec 31, 2026; $1.50 / $7.50 from Jan 1, 2027 | Google's official pricing page; free tier available; Batch half price.\[45\] Use as escalation model. |
| `gemini-4-argon` | $2 / $10 through Nov 30, 2026; $4 / $20 after | Flagship; overkill for extraction.\[46\] |

Flash-Lite prices come from third-party trackers that agree with each other; confirm on Google's pricing page before launch. Also note Google's free tier uses your content to improve its products,\[45\] and since March 2026 the Google Cloud $300 trial credit no longer covers Gemini API usage\[47\] — use a paid key for production.

**Per-document cost estimate (50–200 page packet):** Gemini processes PDFs natively (text plus page images). Budget roughly 15K–150K input tokens per packet depending on page count and density, plus 2K–5K output tokens. On `gemini-3.5-flash-lite` that is about **$0.01–$0.05 per packet** (about half via Batch); on `gemini-3.8-flash` about **$0.02–$0.13**. At 15 bodies × ~4 meetings/month, monthly LLM spend is in the **low single-digit dollars** even with re-processing. The two-pass approach (classify the agenda, then extract only relevant pages) cuts this further and improves accuracy.

**Alternatives:** Anthropic's Haiku-class and OpenAI's "mini" models are the current low-cost peers to replace the draft's "Claude 3.5 Sonnet / GPT-4o" references. Check current names and prices on each vendor's pricing page; they were not verified in this research. Gemini remains the pragmatic default for very long PDFs because of the 1M-token context and native PDF input.

### Infrastructure cost table

| Layer | Choice | Free-tier terms (October 2026) | Watch-outs |
|---|---|---|---|
| Scheduler/compute | GitHub Actions | Public repos: standard runners free and unlimited. Private repos (GitHub Free): 2,000 min/month, 500 MB artifacts (GitHub Docs).\[9\] | UTC cron; delayed scheduled runs; 6-hour job limit.\[12\] Keep the repo public, or move secrets-heavy code to a private repo and budget minutes. |
| Database | Supabase Free | 500 MB DB (shared CPU, 500 MB RAM), 1 GB file storage, 5 GB egress, 50K MAUs, 2 active projects, 500K Edge Function invocations;\[10\]\[11\] PostGIS available as an extension. | **Pauses after 1 week of inactivity**; no automatic backups.\[10\]\[48\] A weekly-only cron risks pauses — run something daily, or move to Pro ($25/month, 8 GB, never paused)\[10\] once you have users. Store PDF hashes and URLs, not PDFs, to stay under 500 MB. |
| LLM | Gemini 3.5/3.1 Flash-Lite | Paid tier usage-based; free tier exists for some models. | Model churn is fast (1.5 → 2.0 → 2.5 retired within ~18 months);\[8\]\[41\] put the model ID in config. |
| Frontend hosting | Cloudflare Pages (preferred) or Vercel Hobby | Both have free tiers. | **Vercel Hobby is limited to non-commercial use** — once you charge, move to Vercel Pro or use Cloudflare. |
| Maps | MapLibre GL JS + OSM vector tiles (Protomaps/OpenFreeMap) | Open source; self-host a PMTiles file on Cloudflare R2/Pages. | Mapbox GL JS includes 50,000 free map loads per month. After that it charges $5.00 per 1,000 loads up to 100,000, $4.00 up to 200,000 and $3.00 up to 1,000,000 (rates a third party said it checked on 10 Oct 2026; confirm on mapbox.com/pricing). Start with MapLibre to avoid surprise bills. |
| Geocoding | Wake County parcels (PIN) → US Census Geocoder → Nominatim | Census Geocoder is free with batch mode. The OSM Foundation's Nominatim Usage Policy sets "an absolute maximum of 1 request per second," says bulk geocoding "is not encouraged," and limits scripts run at regular intervals to 4 requests per minute. | Cache everything; prefer PIN-to-parcel joins. |

### Geocoding approach

1. **Parcel PINs first.** NC rezoning and annexation items routinely include addresses and Wake County PINs (e.g., Apex's 2026 agenda lists "Annexation No. 797 – 1405 and 1407 Zeno Road – 3.60 acres").\[49\] Join PINs to Wake County's public parcel layer (Wake County GIS open data / NC OneMap statewide parcels) to get exact polygons and centroids — far better than a geohash.
2. **Addresses second** via the US Census Geocoder (free, batch).
3. **Fallback** to Nominatim with caching, staying within its usage policy (1 request/second at most, and 4 requests/minute for scheduled scripts such as this cron job), or flag for manual review.
4. Store `geocode_method` and show lower-confidence pins differently in the UI. Many budget and infrastructure items (e.g., "Pay & Classification study") have no location and should appear in the feed but not on the map.

---

## 4. Monetization

**Free consumer tier:** email/push alerts for zoning and infrastructure actions within a chosen radius (default 2 miles ≈ 3,219 m) of a saved address, a weekly digest, and links to the official source document. This builds the audience and the historical dataset.

**B2B tiers (hypotheses to validate, not proven price points):**

| Segment | Job to be done | Suggested starting price | Rationale |
|---|---|---|---|
| Local journalists / newsletters | Never miss a rezoning, contract or budget amendment across 12+ towns | $25–$75/month (or newsroom site license) | Budget-constrained but high-intent; good for testimonials. |
| Advocacy groups / PACs / HOAs | Track votes and patterns, e.g., multi-family approvals/denials by council member over 5 years | $50–$150/month | Historical vote analytics need minutes extraction (vote_text), which is your differentiator. |
| General contractors and trades | Early signal on approved subdivisions, site plans, capital projects and bids | $50–$200/month | Pair with town bid postings; value is lead flow. |
| CRE developers, brokers, appraisers | Pipeline of rezonings/annexations near assets; comps on approval odds | $150–$500+/month or per-seat | Highest willingness to pay, but they compare against established permit/zoning data vendors; you need statewide coverage plus parcel joins to compete. |

**Validation steps:** (1) hand-curate a free weekly "Southern Wake rezonings" email for 4–6 weeks; (2) interview 10 people per segment; (3) pre-sell a $49/month "pro alerts + CSV export" tier before building analytics; (4) price developer tiers only after you can show multi-county coverage.

---

## 5. UI/Design Strategy & Figma Prompt

The original strategy holds: avoid a chat UI for spatial data, and use a Zillow/Redfin-style split view. Additions: a confidence/"official source" affordance, separate status for "scheduled" vs "decided," accessible colors, and a mobile layout.

```text
Design a desktop + mobile web app called "CivicRadar" — a hyper-local civic data map for Wake County, NC.

LAYOUT (desktop, 1440px):
- Top bar: logo wordmark "CivicRadar", address search ("Enter your address"), radius selector
  (0.5 / 1 / 2 / 5 mi), filters (Category, Municipality, Status, Date range), "Get alerts" primary button.
- Left panel (40% width): scrolling feed of "Action Cards".
- Right panel (60% width): light, low-saturation basemap (MapLibre/OSM style, muted roads, no POI clutter),
  with the user's radius drawn as a thin navy circle.

ACTION CARD:
- Bold plain-English title (max 2 lines), e.g., "Rezoning: 22 acres off Camp Branch Ln for 60 homes".
- Category pill: Zoning (purple #6D28D9), Infrastructure (orange #EA580C), Budget (teal #0F766E),
  Commercial (blue #2563EB). Use text labels + color (not color alone) for accessibility.
- Status chip: Scheduled (outline), Approved (solid green), Denied (solid red), Continued (amber).
- Meta line: "Fuquay-Varina Town Board • Oct 20, 2026 • Case RZ-2026-07".
- 2-sentence summary in regular weight; small "AI summary — verify with source" caption.
- Buttons: "Read source PDF" (ghost, opens official document at the cited page), "Follow" (bookmark icon).

MAP INTERACTIONS:
- Custom circular markers color-coded by category; parcel polygon outline appears when zoomed in.
- Hovering a card enlarges and gently pulses its marker; clicking a marker scrolls to and highlights its card.
- Items with approximate locations show a dashed-outline marker.
- Cluster markers at low zoom with count badges.

MOBILE (390px): map on top (45% height) with a draggable bottom sheet containing the card feed.

STYLE: no gradients, glow, or sci-fi "AI" aesthetics. Deep navy (#0B1F3A) for text and chrome, stark white
background, neutral gray borders (#E5E7EB), Inter (or Roboto) at 14/16/20/28 sizes, 8px spacing grid,
6px corner radius, subtle 1px shadows. Tone: trustworthy, well-funded civic utility (think a modern
government data portal crossed with Redfin). Include empty states ("No actions within 2 miles in the
last 30 days") and an onboarding modal for saving a home address and choosing alert frequency.
```

---

## Risks & open questions

- **Legal/ToS:** Public records status covers the content, not unlimited automated access to vendor portals. Use official APIs/RSS where they exist, throttle, identify your bot, and link back to official sources. Avoid re-hosting full packets containing third-party copyrighted material or personal data.
- **Scraping fragility:** Platforms change. Raleigh moved from BoardDocs to eSCRIBE, Garner changed its posting method in September 2025,\[18\]\[50\] and Zebulon's site moved to Apptegy. Build per-jurisdiction health checks and alert yourself when a source returns zero documents.
- **Platform census gaps:** Garner and Wendell platforms are not fully confirmed; Morrisville's back-end agenda tool is unidentified. Verify manually in a browser before writing those adapters.
- **PDF quality/OCR:** Packets can be very large (Morrisville posted a 61 MB packet)\[22\] and include scanned maps and signatures. Use page-range extraction, detect image-only pages, and cap per-document tokens.
- **LLM hallucination:** The biggest product risk is wrong approval status. Only mark "approved/denied" from minutes or action agendas with a verbatim vote quote; otherwise "scheduled." Store `evidence_quote` and `source_pages`, sample-audit 5–10% of items weekly, and show "AI summary — verify with source" in the UI.
- **Geocoding accuracy:** Addresses in agendas are often ranges, "0" addresses (vacant land, e.g., "0 & ... Road"), or multiple parcels. PIN-to-parcel joins are the fix; mark approximate pins visibly.
- **Model churn:** Gemini 1.5, 2.0 and (on Vertex) 2.5 have all been retired within about two years.\[8\]\[41\] Keep model IDs in config and run a regression set of 20–30 labeled agendas whenever you switch.
- **Supabase pausing and backups:** The free tier pauses after a week of inactivity and has no automatic backups.\[11\] Export a weekly `pg_dump` to GitHub artifacts or R2, or upgrade to Pro once users depend on alerts.
- **Competition:** MyTownView already covers Wake County meeting summaries.\[39\] Your differentiation must be the map, parcel-level precision, radius alerts, and vote-history analytics.

## Sources

1. [Raleigh City Council Afternoon Meeting - JuLy 7, 2026 - YouTube](https://www.youtube.com/watch?v=eApMinoWWwU)
2. [Issue 2026-10 March 13, 2026 IN THIS ISSUE Weekly Digest of Special Events](https://cityofraleigh0drupal.blob.core.usgovcloudapi.net/drupal-prod/COR13/managers-update-2026-10.pdf)
3. [Agenda Center • Fuquay-Varina, NC • CivicEngage](https://www.fuquay-varina.org/agendacenter)
4. [Wake Forest Board of Commissioners Work Session Meeting Agenda](https://www.wakeforestnc.gov/sites/default/files/uploads/agendas/8-4-26_bocwsagenda.pdf)
5. [Board of Commissioners Meeting](https://www.wakeforestnc.gov/event/board-commissioners-meeting)
6. [NC League of Municipalities](https://wraldigitalsolutions.com/project/nc-league-of-municipalities/)
7. [List of municipalities in North Carolina — Grokipedia](https://grokipedia.com/page/List_of_municipalities_in_North_Carolina)
8. [Release notes | Gemini API | Google AI for Developers](https://ai.google.dev/gemini-api/docs/changelog)
9. [GitHub Actions billing - GitHub Docs](https://docs.github.com/billing/managing-billing-for-github-actions/about-billing-for-github-actions)
10. [Pricing & Fees](https://supabase.com/pricing)
11. [Supabase Free Tier Limits (2026): What You Get and How Pausing Works - MyKavo](https://mykavo.app/blog/supabase-free-tier-limits)
12. [How to Stay Within GitHub Actions' Free Minutes - DEV Community](https://dev.to/procwire/how-to-stay-within-github-actions-free-minutes-1g52)
13. [PostMinutes - Package City Council Meeting - First Tuesday](https://pub-raleighnc.escribemeetings.com/FileStream.ashx?DocumentId=11948)
14. [eSCRIBE Published Meetings](https://pub-raleighnc.escribemeetings.com/)
15. [Cary Enhances Online Council Meeting Experience](https://www.carync.gov/Home/Components/News/News/11906/)
16. [Agenda and Minutes Backup Site](https://www.carync.gov/mayor-council/agenda-and-minutes-backup-site)
17. [Agendas/Minutes](https://apex-nc.municodemeetings.com/)
18. [Agendas and Minutes Archive (Prior to September 16, 2025)](https://www.garnernc.gov/government/town-council/agendas-minutes-archive)
19. [April 14, 2026 Town Council Workshop Minutes - Agenda and ...](<https://hollyspringsnc.api.civicclerk.com/v1/Meetings/GetMeetingFileStream(fileId=2174,plainText=false)>)
20. [Town Council Business Meeting - July 16, 2024 - CivicClerk](https://hollyspringsnc.portal.civicclerk.com/event/395/overview)
21. [Knightdale Town Council Work Session](https://pub-knightdalenc.escribemeetings.com/meetingscalendarview.aspx?Expanded=Knightdale+Town+Council+Work+Session)
22. [Town Council & Advisory Committee Meetings](https://www.morrisvillenc.gov/Government/Town-Council-Advisory-Committee-Meetings)
23. [Agendas & Minutes](https://www.rolesvillenc.gov/agendas-minutes)
24. [Board of Commissioners](https://www.wakeforestnc.gov/board-commissioners)
25. [Wendell Town Board of Commissioners Town Hall, Board Room](https://granicus_production_attachments.s3.amazonaws.com/townofwendellnc/cf7c0f321153281c490afb96b03739880.pdf)
26. [Wendell Town Board of Commissioners Town Hall, Board Room](https://granicus_production_attachments.s3.amazonaws.com/townofwendellnc/0a6a0337391c00c2763ad9bedf843ade0.pdf)
27. [BOARD OF COMMISSIONERS AGENDA SEPTEMBER 8, 2026 6:00 PM 1. CALL TO ORDER](https://files-backend.assets.thrillshare.com/documents/asset/uploaded_file/5888/Toz/81c3586c-3bde-4900-8992-838464187c56/09.08.2026-Agenda-Packet-2.pdf?disposition=inline)
28. [Meetings](https://www.wake.gov/departments-government/board-commissioners/meetings)
29. [WakeGOV Videos, Agenda & Minutes View - Powered by Granicus.com](https://wake.granicus.com/ViewPublisher.php?view_id=18)
30. [Planning Board Meeting Materials](https://www.wake.gov/departments-government/planning-development-inspections/advisory-boards/planning-board-agendas-minutes)
31. [Wake County Board of Education 2026 Meeting Schedule](https://assets.nationbuilder.com/ocjusticeunited/pages/4352/attachments/original/1768501105/Wake_County_BOE_2026_Meeting_Schedule.pdf?1768501105=)
32. [Agenda LE (Legistar Agenda Management)](https://granicus.com/product/agenda-management-legistar/)
33. [Town Council Meeting • • CivicClerk](https://harrisburgnc.portal.civicclerk.com/event/1554/files)
34. [Agenda and Meeting Management Software for Local Government - CivicPlus](https://www.civicplus.com/agenda-meeting-management/)
35. [City Council & County Agenda Search · Apify](https://apify.com/civic-data-tools/meeting-agenda-search)
36. [City Council & County Agenda Search API through CLI · Apify](https://apify.com/civic-data-tools/meeting-agenda-search/api/cli)
37. [Lengthy Apex (NC) Town Council Meeting Opens With Recognition, Then Shifts to Public Pushback](https://www.hollyspringsupdate.com/p/lengthy-apex-nc-town-council-meeting)
38. [RECAP](https://www.apexnc.org/DocumentCenter/View/56752/20260922---Recap---Regular-Town-Council-Meeting)
39. [Holly Springs, North Carolina Meeting Minutes & Agendas](https://mytownview.com/north-carolina/wake/holly-springs/government/meetings)
40. [Gemini API Pricing May 2026: 3.5 Flash, 3.1 Pro, 2.5 Lite](https://www.metacto.com/blogs/the-true-cost-of-google-gemini-a-guide-to-api-pricing-and-integration)
41. [Learn about supported models | Firebase AI Logic](https://firebase.google.com/docs/ai-logic/models)
42. [Gemini API Pricing 2026: Models, Tokens, and Costs](https://mem0.ai/library/llms-and-models/gemini-api-pricing)
43. [Gemini API Pricing 2026: Flash-Lite \$0.10 to Pro \$2, Free Tier - TokenMix Blog](https://tokenmix.ai/blog/gemini-api-pricing)
44. [Gemini 3.5 Flash Lite API Pricing 2026 - Costs, Performance & Providers](https://pricepertoken.com/pricing-page/model/google-gemini-3.5-flash-lite)
45. [Gemini Developer API pricing | Gemini API | Google AI for Developers](https://ai.google.dev/gemini-api/docs/pricing)
46. [What's new in Gemini 4 Argon | Gemini API | Google AI for Developers](https://ai.google.dev/gemini-api/docs/latest-model)
47. [Billing | Gemini API | Google AI for Developers](https://ai.google.dev/gemini-api/docs/billing)
48. [Supabase Free Tier Limits: What You Actually Get In 2026](https://aiagencyplus.com/supabase-free-tier-limits/)
49. [Regular Town Council Meeting 09/22/2026 06:00 PM| Apex, NC](https://meetings.municode.com/adaHtmlDocument/index?cc=APEXNC&me=68820ccbae3e42c6b579bf0ecbf902d4&ip=True)
50. [Raleigh City Council Budget Work Session - June 1, 2026 : City of Raleigh Municipal Government : Free Download, Borrow, and Streaming : Internet Archive](https://archive.org/details/crnc-Raleigh_City_Council_Budget_Work_Session_-_June_1_2026)
