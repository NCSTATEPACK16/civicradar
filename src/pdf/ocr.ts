import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
let warned = false;

/**
 * OCRs one page of a PDF on disk: render with poppler's pdftoppm, read with tesseract.
 * Returns null (after one warning) when tesseract isn't installed, so OCR stays optional.
 */
export async function ocrPage(pdfPath: string, page: number, workDir: string, language = "eng"): Promise<string | null> {
  const base = join(workDir, `ocr-${page}`);
  try {
    await run("pdftoppm", ["-r", "300", "-f", String(page), "-l", String(page), "-singlefile", "-png", pdfPath, base]);
    const { stdout } = await run("tesseract", [`${base}.png`, "-", "-l", language], { maxBuffer: 64 * 1024 * 1024 });
    return stdout;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      if (!warned) console.error("tesseract/pdftoppm not found; scanned pages will not be OCR'd (votes on them can't be verified)");
      warned = true;
      return null;
    }
    throw err;
  } finally {
    await rm(`${base}.png`, { force: true });
  }
}
