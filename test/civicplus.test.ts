import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseAgendaCenter } from "../src/adapters/civicplus_agendacenter.js";

// Real copy of https://www.fuquay-varina.org/AgendaCenter saved 2026-10-18.
const html = readFileSync("test/fixtures/civicplus-agendacenter-fuquay.html", "utf8");
const BASE = "https://www.fuquay-varina.org";

describe("civicplus agendacenter parser (Fuquay-Varina page)", () => {
  const meetings = parseAgendaCenter(html, BASE);

  it("assigns every meeting to its category heading", () => {
    const counts: Record<string, number> = {};
    for (const m of meetings) counts[m.category] = (counts[m.category] ?? 0) + 1;
    expect(counts).toEqual({
      "Board of Commissioners": 19,
      "Board of Adjustment": 6,
      "Parks & Recreation Advisory Board": 8,
      "Planning Board": 9,
      "Public Safety Committee": 3,
    });
  });

  it("reads the date from the file id and groups agenda + minutes", () => {
    const m = meetings.find((x) => x.id === "_09082026-582")!;
    expect(m).toMatchObject({ date: "2026-09-08", category: "Board of Commissioners" });
    expect(m.title).toBe("Board of Commissioners Regular Meeting Agenda (PDF)");
    expect(m.docs).toEqual([
      { type: "agenda", url: `${BASE}/AgendaCenter/ViewFile/Agenda/_09082026-582`, mimeType: "application/pdf" },
      { type: "minutes", url: `${BASE}/AgendaCenter/ViewFile/Minutes/_09082026-582`, mimeType: "application/pdf" },
    ]);
  });

  it("lists agenda-only meetings when minutes are not yet posted", () => {
    expect(meetings.find((x) => x.id === "_10052026-587")!.docs.map((d) => d.type)).toEqual(["agenda"]);
  });

  it("ignores PreviousVersions links", () => {
    expect(meetings.every((m) => m.docs.every((d) => d.url.includes("/ViewFile/")))).toBe(true);
  });
});
