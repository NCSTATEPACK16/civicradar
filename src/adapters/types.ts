import type { PoliteFetcher } from "../http/politeFetch.js";
import type { PdfPage } from "../pdf/text.js";

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

/** A document's page text, plus the original PDF when there is one (needed to attach scanned pages). */
export interface LoadedDocument {
  pages: PdfPage[];
  pdf: Buffer | null;
}

export interface Adapter {
  listMeetings(since: Date): Promise<Meeting[]>;
  listDocuments(meeting: Meeting): Promise<Doc[]>;
  /**
   * Optional: build the document from a structured source (e.g. an API) instead of
   * downloading doc.url as a PDF. Adapters without it get the default PDF path.
   */
  loadDocument?(doc: Doc, meeting: Meeting): Promise<LoadedDocument>;
}

export type AdapterFactory = (j: Jurisdiction, http: PoliteFetcher) => Adapter;
