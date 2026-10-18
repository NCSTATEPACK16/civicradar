import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseAgendaCenter } from "../src/adapters/civicplus_agendacenter.js";

const html = readFileSync("test/fixtures/civicplus-agendacenter.synthetic.html", "utf8");
const BASE = "https://www.fuquay-varina.org";

describe("civicplus agendacenter parser", () => {
  const meetings = parseAgendaCenter(html, BASE);

  it("groups agenda, packet and minutes by file id and reads the date from it", () => {
    const m = meetings.find((x) => x.id === "_10072026-901")!;
    expect(m.date).toBe("2026-10-07");
    expect(m.category).toBe("Board of Commissioners");
    expect(m.title).toBe("Regular Meeting");
    expect(m.docs).toEqual([
      { type: "agenda", url: `${BASE}/AgendaCenter/ViewFile/Agenda/_10072026-901`, mimeType: "application/pdf" },
      { type: "minutes", url: `${BASE}/AgendaCenter/ViewFile/Minutes/_10072026-901`, mimeType: "application/pdf" },
      { type: "packet", url: `${BASE}/AgendaCenter/ViewFile/Agenda/_10072026-901?packet=true`, mimeType: "application/pdf" },
    ]);
  });

  it("assigns each meeting to its category heading", () => {
    expect(meetings.find((x) => x.id === "_10132026-905")!.category).toBe("Planning Board");
    expect(meetings).toHaveLength(3);
  });
});
