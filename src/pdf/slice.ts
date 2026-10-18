import { PDFDocument } from "pdf-lib";

/** Returns a new PDF containing only the given 1-based pages, in order. */
export async function slicePdf(pdf: Buffer, pages: number[]): Promise<Buffer> {
  const src = await PDFDocument.load(pdf, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, pages.map((p) => p - 1));
  for (const p of copied) out.addPage(p);
  return Buffer.from(await out.save());
}
