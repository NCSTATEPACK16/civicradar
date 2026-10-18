import * as cheerio from "cheerio";
import type { AdapterFactory, Doc, Meeting } from "./types.js";

/**
 * CivicPlus CivicEngage AgendaCenter (e.g. https://www.fuquay-varina.org/AgendaCenter).
 *
 * File links follow a fixed pattern regardless of theme:
 *   /AgendaCenter/ViewFile/Agenda/_MMDDYYYY-NNN            agenda
 *   /AgendaCenter/ViewFile/Agenda/_MMDDYYYY-NNN?packet=true agenda packet
 *   /AgendaCenter/ViewFile/Minutes/_MMDDYYYY-NNN           minutes
 * so parsing keys off those hrefs and only uses the surrounding markup to find the
 * category heading and meeting title.
 *
 * Options: baseUrl, category (heading text on the AgendaCenter page).
 */
export const civicplusAgendaCenter: AdapterFactory = (j, http) => {
  const baseUrl = String(j.options.baseUrl ?? "").replace(/\/$/, "");
  const category = String(j.options.category ?? "");
  if (!baseUrl) throw new Error(`${j.id}: civicplus_agendacenter needs options.baseUrl`);

  return {
    async listMeetings(since: Date): Promise<Meeting[]> {
      const html = await http.getText(`${baseUrl}/AgendaCenter`, "text/html");
      const sinceDay = since.toISOString().slice(0, 10);
      return parseAgendaCenter(html, baseUrl)
        .filter((m) => !category || m.category.toLowerCase() === category.toLowerCase())
        .filter((m) => m.date >= sinceDay)
        .map((m) => ({
          id: m.id,
          jurisdictionId: j.id,
          municipality: j.municipality,
          body: j.body,
          date: m.date,
          title: m.title,
          meetingType: null,
          sourceUrl: `${baseUrl}/AgendaCenter`,
          raw: m,
        }));
    },

    async listDocuments(meeting: Meeting): Promise<Doc[]> {
      return (meeting.raw as ParsedMeeting).docs.map((d) => ({ ...d, meetingId: meeting.id }));
    },
  };
};

export interface ParsedMeeting {
  /** The _MMDDYYYY-NNN identifier shared by a meeting's agenda/minutes files. */
  id: string;
  date: string;
  title: string;
  category: string;
  docs: Omit<Doc, "meetingId">[];
}

const FILE_RE = /\/AgendaCenter\/ViewFile\/(Agenda|Minutes)\/_(\d{2})(\d{2})(\d{4})-(\d+)/i;

export function parseAgendaCenter(html: string, baseUrl: string): ParsedMeeting[] {
  const $ = cheerio.load(html);
  const meetings = new Map<string, ParsedMeeting>();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href")!;
    const m = FILE_RE.exec(href);
    if (!m) return;
    const [, kind, mm, dd, yyyy, seq] = m;
    const id = `_${mm}${dd}${yyyy}-${seq}`;
    const url = new URL(href, baseUrl);
    const isPacket = url.searchParams.get("packet") === "true";
    // html=true links are the same agenda rendered as HTML; the PDF is canonical.
    if (url.searchParams.get("html") === "true") return;

    let meeting = meetings.get(id);
    if (!meeting) {
      meeting = {
        id,
        date: `${yyyy}-${mm}-${dd}`,
        title: "",
        category: categoryOf($, el),
        docs: [],
      };
      meetings.set(id, meeting);
    }
    if (!meeting.title && kind!.toLowerCase() === "agenda" && !isPacket) {
      meeting.title = cleanTitle($(el).text());
    }

    const type = kind!.toLowerCase() === "minutes" ? "minutes" : isPacket ? "packet" : "agenda";
    const canonical = new URL(url.pathname + (isPacket ? "?packet=true" : ""), baseUrl).toString();
    if (!meeting.docs.some((d) => d.url === canonical)) {
      meeting.docs.push({ type, url: canonical, mimeType: "application/pdf" });
    }
  });

  return [...meetings.values()].map((m) => ({ ...m, title: m.title || m.category || m.id }));
}

/** Category heading for a link: nearest enclosing AgendaCenter listing's <h2>. */
function categoryOf($: cheerio.CheerioAPI, el: Parameters<cheerio.CheerioAPI>[0]): string {
  const listing = $(el).closest("div.listing, div[id^='cat'], section");
  const heading = listing.find("h2").first().text() || listing.prevAll("h2").first().text();
  return cleanTitle(heading);
}

function cleanTitle(s: string): string {
  return s.replace(/\s+/g, " ").replace(/^(Download|View)\s+/i, "").trim();
}
