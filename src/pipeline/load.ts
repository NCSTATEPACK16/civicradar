import type { Adapter, Doc, LoadedDocument, Meeting } from "../adapters/types.js";
import type { PoliteFetcher } from "../http/politeFetch.js";
import { extractPages } from "../pdf/text.js";

/** Loads a document's pages: via the adapter when it builds documents itself, else as a PDF. */
export async function loadDocument(
  adapter: Adapter,
  doc: Doc,
  meeting: Meeting,
  http: PoliteFetcher,
  imageOnlyCharThreshold: number,
): Promise<LoadedDocument> {
  if (adapter.loadDocument) return adapter.loadDocument(doc, meeting);
  const res = await http.get(doc.url, { expect: "pdf" });
  return { pages: await extractPages(res.body, imageOnlyCharThreshold), pdf: res.body };
}
