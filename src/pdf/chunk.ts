import type { PdfPage } from "./text.js";

export interface Chunk {
  /** First and last 1-based source pages (inclusive). */
  startPage: number;
  endPage: number;
  /** Every source page included (may be non-contiguous after triage). */
  pages: number[];
  /** Page-marked text for every page in range. */
  text: string;
  /** Pages with no text layer; providers attach these as real PDF pages. */
  imagePages: number[];
}

export function pageMarker(page: number): string {
  return `--- page ${page} ---`;
}

export function buildChunk(pages: PdfPage[]): Chunk {
  const text = pages
    .map((p) =>
      p.imageOnly
        ? `${pageMarker(p.page)}\n[no text layer: this page is attached as a PDF titled "page ${p.page}"]`
        : `${pageMarker(p.page)}\n${p.text}`,
    )
    .join("\n\n");
  return {
    startPage: pages[0]!.page,
    endPage: pages[pages.length - 1]!.page,
    pages: pages.map((p) => p.page),
    text,
    imagePages: pages.filter((p) => p.imageOnly).map((p) => p.page),
  };
}

/**
 * Splits pages into chunks of at most maxPages, then keeps halving any chunk whose
 * token count (from the provider's counter) exceeds maxTokens.
 */
export async function chunkPages(
  pages: PdfPage[],
  opts: { maxPages: number; maxTokens: number; countTokens: (c: Chunk) => Promise<number> },
): Promise<{ chunk: Chunk; tokens: number }[]> {
  const out: { chunk: Chunk; tokens: number }[] = [];
  const fit = async (group: PdfPage[]): Promise<void> => {
    const chunk = buildChunk(group);
    const tokens = await opts.countTokens(chunk);
    if (tokens <= opts.maxTokens) {
      out.push({ chunk, tokens });
      return;
    }
    if (group.length === 1) {
      throw new Error(`page ${group[0]!.page} alone is ${tokens} tokens (limit ${opts.maxTokens})`);
    }
    const mid = Math.ceil(group.length / 2);
    await fit(group.slice(0, mid));
    await fit(group.slice(mid));
  };
  for (let i = 0; i < pages.length; i += opts.maxPages) {
    await fit(pages.slice(i, i + opts.maxPages));
  }
  return out;
}

/** Selects pages by inclusive 1-based ranges, de-duplicated and in order. */
export function selectPages(pages: PdfPage[], ranges: { start: number; end: number }[]): PdfPage[] {
  const want = new Set<number>();
  for (const r of ranges) for (let p = Math.max(1, r.start); p <= r.end; p++) want.add(p);
  return pages.filter((p) => want.has(p.page));
}
