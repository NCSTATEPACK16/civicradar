# Eval fixtures

Each fixture is a folder holding one real document:

```
eval/fixtures/<id>/
  source.pdf      the original document, unmodified
  meta.json       DocMeta: municipality, body, date, meetingType, documentType, sourceUrl
  pages.txt       pdftotext output with page markers (labeling aid; not used by the eval)
  expected.json   { "reviewed": false, "items": [ExpectedItem, ...] }
```

Add a fixture with `npm run eval:add -- <id> <url> --municipality ... --body ... --date ... --type ...`.

`expected.json` items need `title`, `action_type` and `approval_status`. Add `item_number`, `case_number`, `addresses`, `parcel_pins` and `source_pages` wherever the document states them. Leave out any field you can't judge; it won't be scored.

Drafts start with `"reviewed": false`. Set it to `true` only after a person has checked every item against the PDF. `npm run eval` warns about any fixture that isn't reviewed yet.

Target set (10): 5 Fuquay-Varina (2 BOC agendas, 1 packet, 1 BOC minutes, 1 Planning Board agenda) and 5 Wake County BOC (2 agendas, 2 minutes, 1 with an image-only page if one can be found).
