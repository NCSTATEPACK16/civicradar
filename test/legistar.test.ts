import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { eventDocuments, toMeeting, type LegistarEvent } from "../src/adapters/legistar.js";

// Real response excerpt from webapi.legistar.com/v1/wake/events (fetched 2026-10-18).
const events = JSON.parse(readFileSync("test/fixtures/legistar-wake-events.json", "utf8")) as LegistarEvent[];

describe("legistar adapter", () => {
  it("maps events to meetings", () => {
    const m = toMeeting("wake-county-boc", "Wake County", events.find((e) => e.EventId === 6242)!);
    expect(m).toMatchObject({
      id: "6242",
      date: "2026-08-17",
      body: "Board of Commissioners",
      municipality: "Wake County",
      meetingType: "Regular Meeting",
    });
    expect(m.sourceUrl).toContain("wake.legistar.com/MeetingDetail.aspx");
  });

  it("lists agenda and minutes PDFs when present", () => {
    const withMinutes = eventDocuments("6242", events.find((e) => e.EventId === 6242)!);
    expect(withMinutes.map((d) => d.type)).toEqual(["agenda", "minutes"]);
    const agendaOnly = eventDocuments("6254", events.find((e) => e.EventId === 6254)!);
    expect(agendaOnly.map((d) => d.type)).toEqual(["agenda"]);
    expect(agendaOnly[0]!.url).toMatch(/\.pdf$/);
  });
});
