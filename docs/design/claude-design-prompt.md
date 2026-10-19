# CivicRadar: design prompt

Paste the prompt below into Claude's design tool. It builds on section 5 of `docs/BLUEPRINT.md`, updated to match what Phase 1 actually produces. The sample items are real outputs from the Phase 1 eval documents (Fuquay-Varina and Wake County, Aug–Oct 2026).

When you're happy with the design, see "Bringing it back to Claude Code" at the end.

---

```text
Design a desktop + mobile web app called "CivicRadar": a hyper-local civic data map for Wake County, NC.
It shows what local governments are deciding near a person's address: rezonings, annexations,
infrastructure contracts and budget actions, pulled from official agendas and minutes and summarized by AI.

PRODUCE
1. Desktop home, 1440px: map + feed split view with sample data (below).
2. Desktop with one action card expanded (detail view).
3. Mobile, 390px: map on top (~45% height) with a draggable bottom sheet holding the feed;
   also the sheet pulled up full-height.
4. Onboarding modal: save a home address, pick a radius, choose alert frequency (instant / weekly digest).
5. Empty state: "No actions within 2 miles in the last 30 days" with a "widen radius" suggestion.
6. A component sheet: action card (collapsed/expanded), category pill, status chip, confidence
   badge, map markers (exact / approximate / cluster), filter bar controls, buttons.
7. A small style guide: color tokens, type scale, spacing, radius, shadows (light mode; dark mode optional).

LAYOUT (desktop)
- Top bar: wordmark "CivicRadar"; address search ("Enter your address"); radius selector
  (0.5 / 1 / 2 / 5 mi); filters (Category, Jurisdiction, Status, Date range); primary button "Get alerts".
- Left panel (40%): scrolling feed of action cards, newest meeting first, with a result count
  ("23 actions within 2 mi").
- Right panel (60%): light, low-saturation basemap (MapLibre/OpenStreetMap style: muted roads, no POI
  clutter) with the user's radius drawn as a thin navy circle and a home marker.

ACTION CARD (collapsed)
- Bold plain-English title, max 2 lines.
- Category pill (text label + color, never color alone): Zoning (purple #6D28D9),
  Infrastructure (orange #EA580C), Budget (teal #0F766E), Other (slate #475569).
- Status chip: Scheduled (outline), Approved (solid green), Denied (solid red),
  Continued (amber, show the new date, e.g. "Continued to Sep 22"), Withdrawn (gray), Unknown (dotted outline).
- Meta line: "Fuquay-Varina Town Board • Aug 18, 2026 • REZ-2026-10".
- 2-sentence summary, then a small caption "AI summary. Verify with the official source."
- Buttons: "Source (p. 6–7)" (ghost; opens the official document or meeting page at the cited page) and "Follow".

ACTION CARD (expanded): this is what makes CivicRadar trustworthy
- "What the record says": the verbatim evidence quote in a quote block, with the page reference.
- Vote: the recorded result (e.g. "Passed unanimously (5-0)"); for Wake County, a roll-call list of
  names with Aye/No.
- Addresses and parcel IDs (PINs) as copyable chips; the case number.
- Confidence badge: hidden when high. When lower, show "Read from a scanned page", meaning the vote was read
  from a scanned PDF and matched against OCR text. It must look calm, not like an error.
- Link to the official agenda/minutes and "Report a problem".

MAP
- Circular markers color-coded by category with a small status ring (filled when decided, outlined when scheduled).
- Parcel outline appears when zoomed in.
- Items with an approximate location use a dashed-outline marker.
- Cluster markers with count badges at low zoom.
- Hovering a card enlarges and gently pulses its marker; clicking a marker scrolls to and highlights its card.
- Items with no location (countywide budgets, policies) appear in the feed with a "Countywide" or
  "Town-wide" tag but have no marker. Show one of these in the sample feed.

SAMPLE DATA (use these real items)
1. Zoning • Approved • Fuquay-Varina Town Board • Aug 18, 2026 • REZ-2026-10
   "Rezoning: 210 S West Street from Residential Medium Density to Town Center Residential"
   Summary: The Board approved rezoning 0.321 acres at 210 S West Street to Town Center Residential.
   The owner plans to replace an older home with a new building.
   Vote: Passed unanimously (5-0) • PIN 0656867994 • Source p. 6–7
2. Zoning • Continued to Sep 22 • Fuquay-Varina Town Board • Aug 18, 2026 • REZ-2026-11
   "Rezoning: 417 & 419 Raleigh Street (three homes on two lots) postponed"
   Summary: After residents spoke in opposition, the Board postponed the rezoning to Sep 22 and asked staff
   to research how similar towns handle downtown infill.
   PINs 0666173158, 0666174128 • Source p. 8–12
3. Zoning • Approved • Fuquay-Varina Town Board • Aug 18, 2026 • REZ-2026-12
   "Rezoning + land use change for a gas station at Piney Grove Wilbon Road"
   Addresses: 2201, 2205 & part of 2221 Piney Grove Wilbon Road • Vote 5-0
4. Infrastructure • Approved • Fuquay-Varina Town Board • Aug 18, 2026
   "$20.1M construction price approved for Public Service Center Phase II"
   Edifice General Contractors • Town-wide (no map marker)
5. Infrastructure • Approved • Wake County Board of Commissioners • Aug 17, 2026
   "$1.55M contract to build North Wake household hazardous waste facility" (consent agenda; roll call 7-0)
6. Infrastructure • Approved • Wake County Board of Commissioners • Aug 17, 2026
   "Easements to the City of Raleigh at 401 Capital Boulevard"
7. Budget • Approved • Wake County Board of Commissioners • Jul 6, 2026
   "Bond orders adopted; school and Wake Tech bond referendum set for Nov 3, 2026" • Countywide
8. Zoning • Scheduled • Fuquay-Varina Town Board • Oct 5, 2026 • REZ-2026-08
   "Hearing: WakeMed rezoning + land use change at 6126 Dwight Rowland Road"
9. Zoning • Scheduled • Wake County Board of Commissioners • Oct 19, 2026
   "Hearing: Neuse North Area Plan (comprehensive plan amendment)" • Approximate location
10. Zoning • Approved (recommended) • Fuquay-Varina Planning Board • Jul 20, 2026 • REZ-2025-18
   "Planning Board recommends 27.6-acre M/I Homes PUD on Sunset Lake Road"
   Vote 6-0 • Confidence badge: "Read from a scanned page"

STYLE
- No gradients, glows, or sci-fi "AI" aesthetics. Trustworthy civic utility: a modern government data
  portal crossed with Redfin.
- Deep navy (#0B1F3A) for text and chrome, white background, neutral borders (#E5E7EB).
- Inter (or Roboto) at 14/16/20/28; 8px spacing grid; 6px corner radius; subtle 1px shadows.
- WCAG AA contrast for all text and chips; visible keyboard focus states; status and category always
  carry a text label.
- Footer note: "Unofficial. Summaries are AI-generated from public records; always check the official source."
```

---

## Bringing it back to Claude Code

When the design is done:

1. Export or save what the design tool gives you: share link, images of each screen, and any code (HTML/React) it produced.
2. Put the files in the repo under `docs/design/` (for example `docs/design/export/`), or keep the share link handy.
3. Start a fresh Claude Code session on this repo, on the branch you want Phase 2 to start from, and send:

```text
Read CLAUDE.md, docs/BLUEPRINT.md (sections 4-5) and docs/design/claude-design-prompt.md.
The approved design is in docs/design/export/ [and/or: <share link>].

Plan Phase 2's frontend to match the design: MapLibre + OpenStreetMap tiles, hosted on Cloudflare Pages,
reading civic_actions through the actions_within RPC in supabase/migrations/0001_civic_actions.sql.
Keep the evidence quote, vote, page reference and confidence badge from the expanded card. Items without
a location go in the feed but not on the map. Don't touch any live Supabase project without asking.
Propose the plan and wait for my approval before writing code.
```
