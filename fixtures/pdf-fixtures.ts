import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export async function createTextPdf(
  pages: readonly string[],
  options: { drawImageOnly?: boolean } = {},
): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Courier);
  for (const pageText of pages) {
    const page = document.addPage([612, 792]);
    if (options.drawImageOnly) {
      page.drawRectangle({ x: 72, y: 500, width: 300, height: 100, color: rgb(0.1, 0.1, 0.1) });
      continue;
    }
    const lines = pageText.split("\n");
    lines.forEach((line, index) => {
      page.drawText(line, {
        x: 72,
        y: 730 - index * 14,
        size: 10,
        font,
      });
    });
  }
  return document.save({ useObjectStreams: false });
}

export const malformedPdf = new TextEncoder().encode("%PDF-1.7\nthis is not a valid pdf");
export const encryptedPdfMarker = new TextEncoder().encode(
  "%PDF-1.7\n1 0 obj\n<< /Encrypt 2 0 R >>\nendobj\n%%EOF",
);
export const signatureMismatch = new TextEncoder().encode("not a PDF");
