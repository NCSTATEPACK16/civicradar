import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  eventDocuments,
  renderItems,
  toMeeting,
  type LegistarEvent,
  type LegistarEventItem,
  type LegistarVote,
} from "../src/adapters/legistar.js";

// Real Legistar Web API responses for Wake County (fetched 2026-10-18).
const load = <T>(f: string) => JSON.parse(readFileSync(`test/fixtures/${f}`, "utf8")) as T;
const events = load<LegistarEvent[]>("legistar-wake-events.json");
const items = load<LegistarEventItem[]>("legistar-wake-eventitems-6242.json");
const votes = load<LegistarVote[]>("legistar-wake-votes-55346.json");
const ITEMS_URL = "https://webapi.legistar.com/v1/wake/events/6242/eventitems";

describe("legistar adapter", () => {
  const meeting = toMeeting("wake-county-boc", "Wake County", events.find((e) => e.EventId === 6242)!);

  it("maps events to meetings", () => {
    expect(meeting).toMatchObject({ id: "6242", date: "2026-08-17", body: "Board of Commissioners", meetingType: "Regular Meeting" });
    expect(meeting.sourceUrl).toContain("wake.legistar.com/MeetingDetail.aspx");
  });

  it("offers agenda and (final) minutes documents built from the API, never the PDF host", () => {
    const docs = eventDocuments("6242", events.find((e) => e.EventId === 6242)!, ITEMS_URL);
    expect(docs.map((d) => d.type)).toEqual(["agenda", "minutes"]);
    expect(docs.every((d) => d.url === ITEMS_URL && d.mimeType === "application/json")).toBe(true);
    // Draft minutes are not offered.
    expect(eventDocuments("6254", events.find((e) => e.EventId === 6254)!, ITEMS_URL).map((d) => d.type)).toEqual(["agenda"]);
  });

  it("renders minutes with motion text, result and roll-call votes", () => {
    const pages = renderItems(items, "minutes", new Map([[55346, votes]]), meeting);
    const hearing = pages.find((p) => p.text.includes("Agenda item: 26."))!;
    expect(hearing.text).toContain("File number: 16-7284");
    expect(hearing.text).toContain("Vice-Chair Jackson moved, seconded by Commissioner Evans");
    expect(hearing.text).toContain("Result: Pass");
    expect(hearing.text).toMatch(/Vote: Don Mial: Aye/);
    expect(pages.map((p) => p.page)).toEqual(pages.map((_, i) => i + 1));
  });

  it("copies the consent motion and its votes onto every item in the consent block", () => {
    const consentHeading = items.find((i) => i.EventItemTitle === "Consent Agenda")!;
    const pages = renderItems(items, "minutes", new Map([[consentHeading.EventItemId, votes]]), meeting);
    const consentItem = pages.find((p) => p.text.includes("Type: Consent Item"))!;
    expect(consentItem.text).toContain("Consent agenda action: Commissioner Stallings moved, seconded by Commissioner Waters, to approve the Consent Agenda.");
    expect(consentItem.text).toMatch(/Consent agenda action: .*Don Mial: Aye/);
    // Item 9 is typed "Regular Item" but sits inside the consent block, so it gets the consent action too.
    expect(pages.find((p) => p.text.includes("Agenda item: 9."))!.text).toContain("Consent agenda action:");
    // Items after the next section heading do not.
    expect(pages.find((p) => p.text.includes("Agenda item: 26."))!.text).not.toContain("Consent agenda action:");
  });

  it("leaves actions out of agenda documents", () => {
    const pages = renderItems(items, "agenda", new Map(), meeting);
    expect(pages.some((p) => p.text.includes("Action text:"))).toBe(false);
    expect(pages.some((p) => p.text.includes("File number: 16-7284"))).toBe(true);
  });
});
