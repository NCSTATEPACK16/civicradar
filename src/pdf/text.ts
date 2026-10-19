import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { ocrPage } from "./ocr.js";

const run = promisify(execFile);

export interface PdfPage {
  /** 1-based page number in the source PDF. */
  page: number;
  text: string;
  /** True when the page has no usable text layer (scanned image, map, signature page). */
  imageOnly: boolean;
  /** Tesseract text for image-only pages. Used only to verify quotes, never sent as the page text. */
  ocrText?: string;
}

export interface ExtractOptions {
  imageOnlyCharThreshold?: number;
  /** OCR image-only pages with tesseract (skipped with a warning if it isn't installed). */
  ocr?: boolean;
  ocrLanguage?: string;
}

/**
 * Extracts text per page with poppler's pdftotext (form feeds separate pages).
 * Pages with fewer than `imageOnlyCharThreshold` non-whitespace chars are flagged image-only.
 */
export async function extractPages(pdf: Buffer, opts: ExtractOptions = {}): Promise<PdfPage[]> {
  const imageOnlyCharThreshold = opts.imageOnlyCharThreshold ?? 20;
  const dir = await mkdtemp(join(tmpdir(), "civicradar-pdf-"));
  try {
    const file = join(dir, "doc.pdf");
    await writeFile(file, pdf);
    const { stdout } = await run("pdftotext", ["-layout", "-enc", "UTF-8", file, "-"], {
      maxBuffer: 256 * 1024 * 1024,
    });
    const parts = stdout.split("\f");
    // pdftotext ends every page with \f, leaving one empty trailing element.
    if (parts.length > 1 && parts[parts.length - 1]!.trim() === "") parts.pop();
    const pages: PdfPage[] = parts.map((text, i) => ({
      page: i + 1,
      text: tidy(text),
      imageOnly: text.replace(/\s+/g, "").length < imageOnlyCharThreshold,
    }));
    if (opts.ocr) {
      for (const p of pages.filter((x) => x.imageOnly)) {
        const ocr = await ocrPage(file, p.page, dir, opts.ocrLanguage);
        if (ocr === null) break;
        p.ocrText = tidy(ocr);
      }
    }
    return pages;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Collapse runs of blank lines and trailing spaces; layout spacing within lines is kept. */
function tidy(text: string): string {
  return text
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
