# Unit-test fixtures

- `legistar-wake-events.json`: real excerpt of `webapi.legistar.com/v1/wake/events` (Board of Commissioners), fetched 2026-10-18.
- `civicplus-agendacenter.synthetic.html`: **synthetic** markup that mirrors the CivicPlus AgendaCenter link
  structure, written while `www.fuquay-varina.org` was unreachable from the dev environment. Replace it with a
  saved copy of the real page once that host is reachable (the parser keys off `/AgendaCenter/ViewFile/...` hrefs).

Eval documents (real PDFs + hand-checked expected output) live in `eval/fixtures/`, not here.
