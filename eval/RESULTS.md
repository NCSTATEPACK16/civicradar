# Eval results

## 2026-10-19: provisional (labels drafted by Claude, not yet human-reviewed)

Provider: `claude-code` (owner's Claude subscription). 10 real documents: 5 Fuquay-Varina PDFs (1 fully scanned) and 5 Wake County BOC documents from the Legistar API.

| Metric | Value |
|---|---|
| Items: precision / recall / F1 | 100% / 100% / 100% (82 required items) |
| action_type accuracy | 98.6% |
| approval_status accuracy | 95.6% |
| case_number / item_number | 100% / 100% |
| addresses F1 / parcel_pins F1 | 100% / 99.3% |
| Approval false positives | 0 |
| Evidence quotes verbatim | 96.4% |
| Calls / escalations | 18 / 2 (Sonnet) |
| Billed cost | $0 (subscription) |
| API-rate equivalent | $0.12 (181K input / 63K output tokens) |

**Remaining errors:**
- **Scanned minutes (`fv-pb-minutes-2026-07-20`):** all 4 votes came back as `unknown` instead of `approved`. The model read them correctly, but the guard can't verify a quote on a page with no text layer, so it downgrades by design. Fix: OCR image-only pages locally to get text for verification (pending the owner's decision).
- **`fv-boc-agenda-2026-08-18` 10.A:** a GMP construction contract with a budget amendment was labeled Infrastructure; the model said Budget. It is defensible either way.

**Changes after run 1:**
- A label the draft missed was added: the closed-session $195,000 settlement on the 8/17 Wake minutes. The model had found it.
- The guard now accepts verbatim quotes that run across a page break.

Re-run after the owner reviews the labels (`"reviewed": true`).
