# CivicRadar

Wake County, NC civic data pipeline. It ingests meeting agendas, packets and minutes, extracts structured "civic actions" with an LLM, and (in Phase 2) geocodes them and stores them in Supabase/PostGIS.

**Source of truth:** `docs/BLUEPRINT.md` (verified research, October 2026). Where this file conflicts with the blueprint, the overrides below win.

## Overrides to the blueprint
- **LLM provider is Anthropic, not Gemini.**
  - Default model: `claude-haiku-5-5`. Escalate low-confidence or invalid results to `claude-sonnet-5-5`.
  - Model IDs, thresholds and prices live in `config/llm.yaml`. Never hard-code them.
- **Every request stays under 100K input tokens**, Haiku's cheaper price tier: $0.10/$0.50 per MTok, versus $0.50/$2.50 above 100K.
  - Extract PDF text locally first (`pdftotext`, page by page) and send text.
  - Send actual PDF pages (sliced with `pdf-lib`) only for pages with no text layer.
  - Split anything over ~25 pages.
  - Call the token-counting endpoint (`messages.countTokens`) before every send. Split again if the count is over the limit (default 95K).
- **The weekly run uses the Message Batches API** (50% off). Sync calls are for small runs and evals.
- **All LLM access goes through one `extract()` interface** (`src/llm/extract.ts`). Provider-specific code stays in its own module, such as `src/llm/anthropic.ts`.
- Use structured outputs (`output_config.format`) with a JSON schema. No assistant prefill and no forced `tool_choice`, since current models reject both. Validate the response again with zod.

## Stack
- Node 22, TypeScript (ESM, strict), `tsx` to run, Vitest to test.
- Cheerio for HTML. Puppeteer only if a page is JS-rendered; not used in Phase 1.
- `@anthropic-ai/sdk`, `zod`, `yaml`, `pdf-lib`, and the poppler `pdftotext` CLI.

## Layout
```
config/jurisdictions.yaml   body → adapter + URLs + options (add towns by config, not code)
config/llm.yaml             provider, models, thresholds, token limits, pricing
docs/BLUEPRINT.md           research / source of truth
src/http/                   politeFetch: robots.txt, User-Agent, 1 req/s per host, URL cache
src/adapters/               one adapter per platform: listMeetings(since), listDocuments(meeting)
src/pdf/                    page text extraction, image-only page detection, chunking
src/llm/                    extract() interface + providers + prompt
src/schema/                 civic_action zod schema (+ exported JSON Schema in schema/)
src/postprocess/            deterministic guards (approval status, pages, PINs, dedupe)
src/usage/                  token/cost accounting, data/usage.jsonl
src/pipeline/               ingest CLI
eval/fixtures/              10 real documents + hand-checked expected.json
supabase/migrations/        SQL for review; never auto-applied
test/                       unit tests on saved fixtures (no network)
data/                       cache, outputs, usage logs (gitignored)
```

## Conventions
- **Polite scraping.**
  - Honor robots.txt.
  - Use a descriptive User-Agent with a contact address.
  - Send at most 1 request/sec per host.
  - Cache by URL with ETag/Last-Modified, and never re-download unchanged files.
- **Prefer official feeds over scraping**, in this order: APIs (Legistar Web API), then RSS, then static HTML (Cheerio), then Puppeteer.
- **Never invent facts.** Use null when a value isn't stated.
- **`approval_status`:** only `approved`/`denied`/`continued`/`withdrawn` when it comes from minutes or an action agenda with a quoted vote.
  - The quote must be in `evidence_quote` and appear verbatim in the source text. Code checks this.
  - Agendas are always `scheduled`.
- Every extracted item carries `evidence_quote` and `source_pages`.
- **Log usage for every LLM call:** input/output/cache tokens, model, mode (sync/batch) and computed cost, per document.
- **Supabase:** never touch a live project without asking. Migrations are files for review.
- **Tests:** unit tests use saved HTML/JSON/PDF fixtures and no network. `npm run eval` is the only thing that calls the LLM.

## Commands
- `npm run typecheck`, `npm test`
- `npm run ingest -- [--jurisdiction <id>] [--since YYYY-MM-DD] [--batch] [--dry-run]`
- `npm run eval`: accuracy + total cost over `eval/fixtures/`

## Phase 1 scope
In scope:
- Adapters: Fuquay-Varina (CivicPlus AgendaCenter) and Wake County BOC (Legistar Web API).
- `jurisdictions.yaml`.
- Extraction to the `civic_action` schema.
- Usage/cost logging.
- Supabase migration file.
- 10-document eval.

Not in Phase 1: frontend, geocoding, GitHub Actions (all Phase 2).

## Secrets (env)
`ANTHROPIC_API_KEY`, optionally `LEGISTAR_TOKEN`. Phase 2 adds `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

## Cloud dev sessions
Node's built-in `fetch` ignores `HTTPS_PROXY`. In Claude Code cloud sessions, run network commands with `NODE_USE_ENV_PROXY=1`, for example `NODE_USE_ENV_PROXY=1 npm run ingest -- --dry-run`. This isn't needed locally or in GitHub Actions.
