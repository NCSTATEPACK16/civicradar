import type { AdapterFactory, Doc, Meeting } from "./types.js";

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

const API = "https://webapi.legistar.com/v1";

/**
 * Legistar via the public Web API (webapi.legistar.com/v1/{client}).
 * Options: client (e.g. "wake"), bodyId (from /bodies). LEGISTAR_TOKEN is appended if set.
 */
export const legistar: AdapterFactory = (j, http) => {
  const client = String(j.options.client);
  const bodyId = Number(j.options.bodyId);
  if (!client || !Number.isInteger(bodyId)) {
    throw new Error(`${j.id}: legistar adapter needs options.client and options.bodyId`);
  }

  return {
    async listMeetings(since: Date): Promise<Meeting[]> {
      const day = since.toISOString().slice(0, 10);
      const params = new URLSearchParams({
        $filter: `EventBodyId eq ${bodyId} and EventDate ge datetime'${day}'`,
        $orderby: "EventDate desc",
      });
      if (process.env.LEGISTAR_TOKEN) params.set("token", process.env.LEGISTAR_TOKEN);
      const events = await http.getJson<LegistarEvent[]>(`${API}/${client}/events?${params}`);
      return events.map((e) => toMeeting(j.id, j.municipality, e));
    },

    async listDocuments(meeting: Meeting): Promise<Doc[]> {
      return eventDocuments(meeting.id, meeting.raw as LegistarEvent);
    },
  };
};

export function toMeeting(jurisdictionId: string, municipality: string, e: LegistarEvent): Meeting {
  return {
    id: String(e.EventId),
    jurisdictionId,
    municipality,
    body: e.EventBodyName,
    date: e.EventDate.slice(0, 10),
    title: [e.EventBodyName, e.EventComment].filter(Boolean).join(" — "),
    meetingType: e.EventComment,
    sourceUrl: e.EventInSiteURL ?? `https://webapi.legistar.com/v1/events/${e.EventId}`,
    raw: e,
  };
}

export function eventDocuments(meetingId: string, e: LegistarEvent): Doc[] {
  const docs: Doc[] = [];
  if (e.EventAgendaFile) {
    docs.push({ meetingId, type: "agenda", url: e.EventAgendaFile, mimeType: "application/pdf" });
  }
  if (e.EventMinutesFile) {
    docs.push({ meetingId, type: "minutes", url: e.EventMinutesFile, mimeType: "application/pdf" });
  }
  return docs;
}
