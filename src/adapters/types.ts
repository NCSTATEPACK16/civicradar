import type { PoliteFetcher } from "../http/politeFetch.js";

export type DocumentType = "agenda" | "packet" | "minutes" | "action_agenda";

export interface Jurisdiction {
  id: string;
  municipality: string;
  body: string;
  adapter: string;
  options: Record<string, unknown>;
}

export interface Meeting {
  /** Stable ID within the jurisdiction (platform's own ID where one exists). */
  id: string;
  jurisdictionId: string;
  municipality: string;
  body: string;
  /** ISO date, YYYY-MM-DD (local meeting date). */
  date: string;
  title: string;
  meetingType: string | null;
  sourceUrl: string;
  /** Adapter-private data needed by listDocuments. */
  raw?: unknown;
}

export interface Doc {
  meetingId: string;
  type: DocumentType;
  url: string;
  mimeType: string;
  title?: string;
}

export interface Adapter {
  listMeetings(since: Date): Promise<Meeting[]>;
  listDocuments(meeting: Meeting): Promise<Doc[]>;
}

export type AdapterFactory = (j: Jurisdiction, http: PoliteFetcher) => Adapter;
