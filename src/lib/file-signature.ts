const PDF_SIGNATURE = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

export function hasPdfSignature(buffer: Uint8Array): boolean {
  if (buffer.byteLength < PDF_SIGNATURE.byteLength) return false;
  return PDF_SIGNATURE.every((byte, index) => buffer[index] === byte);
}

export function hasPdfExtension(filename: string): boolean {
  return filename.toLowerCase().endsWith(".pdf");
}

export function isDeclaredPdfMimeType(mimeType: string): boolean {
  return mimeType.toLowerCase().split(";")[0]?.trim() === "application/pdf";
}
