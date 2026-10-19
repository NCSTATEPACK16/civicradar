import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { buildChunk, chunkPages, selectPages } from "../src/pdf/chunk.js";
import { slicePdf } from "../src/pdf/slice.js";
import { extractPages, type PdfPage } from "../src/pdf/text.js";
import { makePdf } from "./helpers.js";

describe("pdf text extraction", () => {
  it("extracts text per page and flags pages with no text layer", async () => {
    const pdf = await makePdf([["Item 5.a Rezoning RZ-26-04", "1405 Zeno Road"], null, ["Item 6 Budget amendment"]]);
    const pages = await extractPages(pdf);
    expect(pages).toHaveLength(3);
    expect(pages[0]!.text).toContain("RZ-26-04");
    expect(pages[0]!.imageOnly).toBe(false);
    expect(pages[1]!.imageOnly).toBe(true);
    expect(pages[2]!.page).toBe(3);
  });

  const hasTesseract = (() => {
    try {
      execFileSync("tesseract", ["--version"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();

  it.skipIf(!hasTesseract)("OCRs image-only pages of a real scanned PDF", async () => {
    const scanned = readFileSync("eval/fixtures/fv-pb-minutes-2026-07-20/source.pdf");
    const page3 = await PDFDocument.load(await slicePdf(scanned, [3])).then((d) => d.save());
    const [p] = await extractPages(Buffer.from(page3), { ocr: true });
    expect(p!.imageOnly).toBe(true);
    expect(p!.text).toBe("");
    expect(p!.ocrText).toContain("REZ-2026-10");
    expect(p!.ocrText).toMatch(/Motion Passed 6 - 0/);
  }, 60_000);

  it("slices selected pages into a new PDF", async () => {
    const pdf = await makePdf([["a"], ["b"], ["c"]]);
    const out = await PDFDocument.load(await slicePdf(pdf, [2, 3]));
    expect(out.getPageCount()).toBe(2);
  });
});

const fakePages = (n: number): PdfPage[] =>
  Array.from({ length: n }, (_, i) => ({ page: i + 1, text: `page body ${i + 1}`, imageOnly: i === 2 }));

describe("chunking", () => {
  it("marks pages and lists image-only pages", () => {
    const c = buildChunk(fakePages(4));
    expect(c.text).toContain("--- page 1 ---\npage body 1");
    expect(c.text).toContain("--- page 3 ---\n[no text layer");
    expect(c.imagePages).toEqual([3]);
    expect([c.startPage, c.endPage]).toEqual([1, 4]);
  });

  it("caps chunks at maxPages", async () => {
    const chunks = await chunkPages(fakePages(60), { maxPages: 25, maxTokens: 1e9, countTokens: async () => 1 });
    expect(chunks.map((c) => [c.chunk.startPage, c.chunk.endPage])).toEqual([[1, 25], [26, 50], [51, 60]]);
  });

  it("halves chunks that exceed the token ceiling", async () => {
    // 10 tokens per page, ceiling 60 -> a 25-page chunk splits until each piece is <= 6 pages.
    const chunks = await chunkPages(fakePages(25), {
      maxPages: 25,
      maxTokens: 60,
      countTokens: async (c) => c.pages.length * 10,
    });
    expect(chunks.every((c) => c.tokens <= 60)).toBe(true);
    expect(chunks.flatMap((c) => c.chunk.pages)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
  });

  it("selects page ranges for two-pass extraction", () => {
    const sel = selectPages(fakePages(30), [{ start: 1, end: 3 }, { start: 10, end: 12 }, { start: 2, end: 4 }]);
    expect(sel.map((p) => p.page)).toEqual([1, 2, 3, 4, 10, 11, 12]);
  });
});
