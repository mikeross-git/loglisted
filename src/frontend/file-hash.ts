import type { FileInspection } from "./types.js";

export interface FileCheckOptions {
  maximumBytes: number;
  maximumPages: number;
  minimumPages: number;
}

export class ClientFileError extends Error {
  constructor(
    readonly code: "invalid_pdf" | "empty" | "too_large" | "too_few_pages" | "too_many_pages",
    message: string,
  ) {
    super(message);
    this.name = "ClientFileError";
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function approximatePdfDetails(bytes: Uint8Array): {
  approximatePageCount: number | null;
  readableTextWarning: boolean;
} {
  const sample = new TextDecoder("latin1").decode(bytes);
  const pages = sample.match(/\/Type\s*\/Page\b/g)?.length ?? 0;
  const hasLikelyText = /(?:\bBT\b[\s\S]{0,10000}\bET\b|\((?:[^()\\]|\\.){8,}\)\s*Tj)/.test(sample);
  return {
    approximatePageCount: pages > 0 ? pages : null,
    readableTextWarning: !hasLikelyText,
  };
}

export function validatePdfSelection(file: File, options: FileCheckOptions): void {
  if (file.size <= 0) throw new ClientFileError("empty", "The selected file is empty.");
  if (file.size > options.maximumBytes) {
    throw new ClientFileError("too_large", "The selected file exceeds the size limit.");
  }
  if (file.type.toLowerCase() !== "application/pdf" || !file.name.toLowerCase().endsWith(".pdf")) {
    throw new ClientFileError("invalid_pdf", "Only PDF files are accepted.");
  }
}

export async function inspectAndHashPdf(
  file: File,
  options: FileCheckOptions,
  onProgress: (progress: number) => void,
): Promise<FileInspection> {
  validatePdfSelection(file, options);
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.min(0.9, (event.loaded / event.total) * 0.9));
    };
    reader.onerror = () => reject(reader.error ?? new Error("The PDF could not be read."));
    reader.onload = () =>
      reader.result instanceof ArrayBuffer
        ? resolve(reader.result)
        : reject(new Error("The PDF could not be read."));
    reader.readAsArrayBuffer(file);
  });
  const bytes = new Uint8Array(buffer);
  if (
    bytes.length < 5 ||
    bytes[0] !== 0x25 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x44 ||
    bytes[3] !== 0x46 ||
    bytes[4] !== 0x2d
  ) {
    throw new ClientFileError("invalid_pdf", "The file does not have a PDF signature.");
  }
  const details = approximatePdfDetails(bytes);
  if (
    details.approximatePageCount !== null &&
    details.approximatePageCount < options.minimumPages
  ) {
    throw new ClientFileError("too_few_pages", "The PDF is below the minimum page count.");
  }
  if (
    details.approximatePageCount !== null &&
    details.approximatePageCount > options.maximumPages
  ) {
    throw new ClientFileError("too_many_pages", "The PDF exceeds the page limit.");
  }
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  onProgress(1);
  return {
    fileHash: bytesToHex(new Uint8Array(digest)),
    fileSize: file.size,
    ...details,
  };
}
