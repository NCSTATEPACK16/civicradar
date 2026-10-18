import { PDFDocument, StandardFonts } from "pdf-lib";

/** Builds a PDF where each entry is a page's text lines; null makes a blank (image-only-like) page. */
export async function makePdf(pages: (string[] | null)[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = doc.addPage([612, 792]);
    (lines ?? []).forEach((line, i) => page.drawText(line, { x: 50, y: 740 - i * 16, size: 11, font }));
  }
  return Buffer.from(await doc.save());
}
