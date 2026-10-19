import type { PdfPage } from "../pdf/text.js";
import { rtfToText } from "./rtf.js";
import type { AdapterFactory, Doc, LoadedDocument, Meeting } from "./types.js";

/** Subset of the Legistar Web API Event object we use. */
export interface LegistarEvent {
  EventId: number;
  EventBodyId: number;
  EventBodyName: string;
  EventDate: string;
  EventTime: string | null;
  EventComment: string | null;
  EventAgendaFile: string | null;
  EventMinutesFile: string | null;
  EventAgendaStatusName: string | null;
  EventMinutesStatusName: string | null;
  EventInSiteURL: string | null;
}

/** Subset of the Legistar Web API EventItem object we use. */
export interface LegistarEventItem {
  EventItemId: number;
  EventItemAgendaSequence: number | null;
  EventItemMinutesSequence: number | null;
  EventItemAgendaNumber: string | null;
  EventItemTitle: string | null;
  EventItemMatterFile: string | null;
  EventItemMatterName: string | null;
  EventItemMatterType: string | null;
  EventItemAgendaNote: string | null;
  EventItemMinutesNote: string | null;
  EventItemActionName: string | null;
  EventItemActionText: string | null;
  EventItemPassedFlagName: string | null;
  EventItemMover: string | null;
  EventItemSeconder: string | null;
}

export interface LegistarVote {
  VotePersonName: string;
  VoteValueName: string;
}

const API = "https://webapi.legistar.com/v1";
const JSON_MIME = "application/json";

/**
 * Legistar via the public Web API (webapi.legistar.com/v1/{client}).
 *
 * Documents are built from API event items rather than the agenda/minutes PDFs: Wake's
 * PDF host (wake.legistar1.com) disallows all crawlers in robots.txt, while the API is
 * the official machine-readable source and carries motion text and roll-call votes.
 *
 * Options: client (e.g. "wake"), bodyId (from /bodies). LEGISTAR_TOKEN is appended if set.
 */
export const legistar: AdapterFactory = (j, http) => {
  const client = String(j.options.client);
  const bodyId = Number(j.options.bodyId);
  if (!client || !Number.isInteger(bodyId)) {
    throw new Error(`${j.id}: legistar adapter needs options.client and options.bodyId`);
  }
  const url = (path: string, params: Record<string, string> = {}) => {
    const q = new URLSearchParams(params);
    if (process.env.LEGISTAR_TOKEN) q.set("token", process.env.LEGISTAR_TOKEN);
    const qs = q.toString();
    return `${API}/${client}${path}${qs ? `?${qs}` : ""}`;
  };

  return {
    async listMeetings(since: Date): Promise<Meeting[]> {
      const day = since.toISOString().slice(0, 10);
      const events = await http.getJson<LegistarEvent[]>(
        url("/events", {
          $filter: `EventBodyId eq ${bodyId} and EventDate ge datetime'${day}'`,
          $orderby: "EventDate desc",
        }),
      );
      return events.map((e) => toMeeting(j.id, j.municipality, e));
    },

    async listDocuments(meeting: Meeting): Promise<Doc[]> {
      return eventDocuments(meeting.id, meeting.raw as LegistarEvent, url(`/events/${meeting.id}/eventitems`, ITEM_PARAMS));
    },

    async loadDocument(doc: Doc, meeting: Meeting): Promise<LoadedDocument> {
      const items = await http.getJson<LegistarEventItem[]>(doc.url);
      const votes = new Map<number, LegistarVote[]>();
      if (doc.type === "minutes") {
        for (const item of items.filter((i) => i.EventItemPassedFlagName)) {
          votes.set(item.EventItemId, await http.getJson<LegistarVote[]>(url(`/eventitems/${item.EventItemId}/votes`)));
        }
      }
      return { pages: renderItems(items, doc.type === "minutes" ? "minutes" : "agenda", votes, meeting), pdf: null };
    },
  };
};

const ITEM_PARAMS = { AgendaNote: "1", MinutesNote: "1" };

export function toMeeting(jurisdictionId: string, municipality: string, e: LegistarEvent): Meeting {
  return {
    id: String(e.EventId),
    jurisdictionId,
    municipality,
    body: e.EventBodyName,
    date: e.EventDate.slice(0, 10),
    title: [e.EventBodyName, e.EventComment].filter(Boolean).join(" — "),
    meetingType: e.EventComment,
    sourceUrl: e.EventInSiteURL ?? `${API}/events/${e.EventId}`,
    raw: e,
  };
}

/**
 * An agenda document once the agenda is published, and a minutes document once the
 * minutes are final (draft minutes can still change, so their actions aren't used).
 */
export function eventDocuments(meetingId: string, e: LegistarEvent, itemsUrl: string): Doc[] {
  const docs: Doc[] = [];
  if (e.EventAgendaStatusName?.toLowerCase().startsWith("final")) {
    docs.push({ meetingId, type: "agenda", url: itemsUrl, mimeType: JSON_MIME });
  }
  if (e.EventMinutesStatusName?.toLowerCase().startsWith("final")) {
    docs.push({ meetingId, type: "minutes", url: itemsUrl, mimeType: JSON_MIME });
  }
  return docs;
}

/**
 * Renders event items as "pages" (one per item, in agenda or minutes order) so the
 * extraction pipeline can treat them like document pages. Every line is copied from
 * an API field, so evidence quotes can be checked against it verbatim.
 */
export function renderItems(
  items: LegistarEventItem[],
  kind: "agenda" | "minutes",
  votes: Map<number, LegistarVote[]>,
  meeting: Pick<Meeting, "body" | "date" | "title" | "sourceUrl">,
): PdfPage[] {
  const seq = (i: LegistarEventItem) => (kind === "minutes" ? i.EventItemMinutesSequence : i.EventItemAgendaSequence);
  const ordered = items
    .filter((i) => seq(i) !== null && (i.EventItemTitle?.trim() || i.EventItemActionText?.trim()))
    .sort((a, b) => seq(a)! - seq(b)!);

  // Consent membership is positional: items between the "Consent Agenda" heading and the
  // next section heading were disposed of by the consent motion (matter types are unreliable).
  const isHeading = (i: LegistarEventItem) => !i.EventItemAgendaNumber;
  let consentAction: LegistarEventItem | null = null;
  const inConsent = new Set<number>();
  for (const item of ordered) {
    if (isHeading(item)) {
      consentAction = /^consent agenda/i.test(item.EventItemTitle ?? "") && item.EventItemActionText ? item : null;
    } else if (consentAction) {
      inConsent.add(item.EventItemId);
    }
  }
  const consent = ordered.find((i) => isHeading(i) && /^consent agenda/i.test(i.EventItemTitle ?? "") && i.EventItemActionText);

  const pages: PdfPage[] = [];
  for (const item of ordered) {
    const lines: string[] = [];
    if (pages.length === 0) {
      lines.push(`${meeting.title}, ${meeting.date} (${kind}; one page per agenda item, from the Legistar API)`);
      lines.push(`Source: ${meeting.sourceUrl}`, "");
    }
    lines.push(`Agenda item: ${item.EventItemAgendaNumber ?? "(section heading)"}`);
    if (item.EventItemMatterFile) lines.push(`File number: ${item.EventItemMatterFile}`);
    if (item.EventItemMatterType) lines.push(`Type: ${item.EventItemMatterType}`);
    lines.push(`Title: ${clean(item.EventItemTitle)}`);
    if (item.EventItemMatterName && item.EventItemMatterName !== item.EventItemTitle) {
      lines.push(`Matter name: ${clean(item.EventItemMatterName)}`);
    }
    const note = kind === "minutes" ? item.EventItemMinutesNote : item.EventItemAgendaNote;
    if (note?.trim()) lines.push(`Note: ${rtfToText(note).trim()}`);

    if (kind === "minutes") {
      if (item.EventItemActionText?.trim()) lines.push(`Action text: ${clean(item.EventItemActionText)}`);
      if (item.EventItemActionName) lines.push(`Action: ${item.EventItemActionName}`);
      if (item.EventItemPassedFlagName) lines.push(`Result: ${item.EventItemPassedFlagName}`);
      if (item.EventItemMover) lines.push(`Mover: ${item.EventItemMover}`);
      if (item.EventItemSeconder) lines.push(`Seconder: ${item.EventItemSeconder}`);
      const v = votes.get(item.EventItemId);
      if (v?.length) lines.push(`Vote: ${v.map((x) => `${x.VotePersonName}: ${x.VoteValueName}`).join("; ")}`);
      if (consent && inConsent.has(item.EventItemId)) {
        const cv = votes.get(consent.EventItemId);
        lines.push(
          `Consent agenda action: ${clean(consent.EventItemActionText)}` +
            (cv?.length ? ` ${cv.map((x) => `${x.VotePersonName}: ${x.VoteValueName}`).join("; ")}` : "") +
            ` Result: ${consent.EventItemPassedFlagName ?? "unknown"}`,
        );
      }
    }
    pages.push({ page: pages.length + 1, text: lines.join("\n"), imageOnly: false });
  }
  return pages;
}

function clean(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}
