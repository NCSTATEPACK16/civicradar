import { z } from "zod";

export const ACTION_TYPES = ["Zoning", "Infrastructure", "Budget", "Other"] as const;
export const APPROVAL_STATUSES = ["scheduled", "approved", "denied", "continued", "withdrawn", "unknown"] as const;
export const DOCUMENT_TYPES = ["agenda", "packet", "minutes", "action_agenda"] as const;

/** Fields the LLM extracts for one agenda item. */
export const ExtractedItemSchema = z.object({
  item_number: z.string().nullable().describe("Agenda item number exactly as printed, e.g. '5.b' or 'S.5'"),
  case_number: z.string().nullable().describe("Case/petition number verbatim, e.g. RZ-25-03"),
  action_type: z.enum(ACTION_TYPES),
  title: z.string(),
  plain_english_summary: z.string().describe("Max 2 sentences, neutral, no speculation"),
  addresses: z.array(z.string()).describe("Street addresses verbatim"),
  parcel_pins: z.array(z.string()).describe("Wake County 10-digit PINs verbatim"),
  approval_status: z.enum(APPROVAL_STATUSES),
  vote_text: z.string().nullable().describe("Recorded vote, verbatim, only from minutes/action agendas"),
  evidence_quote: z.string().nullable().describe("Verbatim quote from the document supporting the item / its status"),
  source_pages: z.array(z.number().int()).describe("1-based page numbers from the --- page N --- markers"),
  extraction_confidence: z.number().describe("0 to 1"),
});
export type ExtractedItem = z.infer<typeof ExtractedItemSchema>;

export const ExtractionResponseSchema = z.object({ items: z.array(ExtractedItemSchema) });
export type ExtractionResponse = z.infer<typeof ExtractionResponseSchema>;

/** Full civic_action record (blueprint schema): extracted fields + document metadata. */
export const CivicActionSchema = ExtractedItemSchema.extend({
  date: z.string(),
  municipality: z.string(),
  body: z.string(),
  meeting_type: z.string().nullable(),
  document_type: z.enum(DOCUMENT_TYPES),
  source_url: z.string(),
});
export type CivicAction = z.infer<typeof CivicActionSchema>;

/** Pass-1 triage output for long packets: which pages hold relevant items. */
export const TriageResponseSchema = z.object({
  relevant: z.array(
    z.object({
      item_number: z.string().nullable(),
      title: z.string(),
      start_page: z.number().int(),
      end_page: z.number().int(),
    }),
  ),
});
export type TriageResponse = z.infer<typeof TriageResponseSchema>;
