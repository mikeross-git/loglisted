import { getDocument, PasswordResponses } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { TextItem } from "pdfjs-dist/types/src/display/api.js";
import { z } from "zod";
import { ParsingFailureError, UnsupportedFileError, ValidationError } from "./errors.js";
import { calculateSha256 } from "./file-hash.js";
import { hasPdfExtension, hasPdfSignature, isDeclaredPdfMimeType } from "./file-signature.js";

export const PdfExtractionOptionsSchema = z
  .object({
    maxFileBytes: z
      .number()
      .int()
      .positive()
      .default(15 * 1024 * 1024),
    maxPages: z.number().int().positive().default(150),
    minPages: z.number().int().positive().default(25),
    minimumReadableTextLength: z.number().int().nonnegative().default(1000),
    lowTextPageThreshold: z.number().int().nonnegative().default(40),
  })
  .strict();

export const PdfInputMetadataSchema = z
  .object({
    declaredFilename: z.string().min(1).max(255),
    declaredMimeType: z.string().min(1).max(100),
  })
  .strict();

export interface PdfExtractionResult {
  fileHash: string;
  fileSize: number;
  pageCount: number;
  extractedText: string;
  textByPage: string[];
  textLength: number;
  textDensityByPage: number[];
  warnings: string[];
}

export type PdfExtractionOptions = z.input<typeof PdfExtractionOptionsSchema>;

function normalizePageText(items: TextItem[]): string {
  const lines: string[] = [];
  let line = "";
  for (const item of items) {
    const value = item.str.replace(/\s+/g, " ").trim();
    if (value) line += `${line ? " " : ""}${value}`;
    if (item.hasEOL && line) {
      lines.push(line);
      line = "";
    }
  }
  if (line) lines.push(line);
  return lines.join("\n").trim();
}

function looksEncrypted(buffer: Uint8Array, error: unknown): boolean {
  const leadingContent = Buffer.from(buffer.subarray(0, Math.min(buffer.length, 64_000))).toString(
    "latin1",
  );
  const message = error instanceof Error ? error.message : "";
  return (
    leadingContent.includes("/Encrypt") ||
    /password|encrypted|PasswordException/i.test(message) ||
    (typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error.code === PasswordResponses.NEED_PASSWORD ||
        error.code === PasswordResponses.INCORRECT_PASSWORD))
  );
}

export async function extractPdf(
  buffer: Uint8Array,
  declaredFilename: string,
  declaredMimeType: string,
  options: PdfExtractionOptions = {},
): Promise<PdfExtractionResult> {
  const metadata = PdfInputMetadataSchema.safeParse({ declaredFilename, declaredMimeType });
  if (!metadata.success) throw new ValidationError("Invalid PDF input metadata.");
  const limits = PdfExtractionOptionsSchema.parse(options);

  if (buffer.byteLength === 0) {
    throw new UnsupportedFileError("Blank file.", {
      details: { reasonCode: "pdf_blank_file" },
    });
  }
  if (buffer.byteLength > limits.maxFileBytes) {
    throw new UnsupportedFileError("PDF exceeds configured byte limit.", {
      details: {
        reasonCode: "pdf_file_size_limit",
        fileSize: buffer.byteLength,
        maxFileBytes: limits.maxFileBytes,
      },
    });
  }
  if (!hasPdfSignature(buffer)) {
    throw new UnsupportedFileError("File signature is not PDF.", {
      details: { reasonCode: "pdf_signature_invalid" },
    });
  }

  const warnings: string[] = [];
  if (!hasPdfExtension(declaredFilename)) warnings.push("filename_extension_mismatch");
  if (!isDeclaredPdfMimeType(declaredMimeType)) warnings.push("declared_mime_type_mismatch");

  let document;
  try {
    document = await getDocument({
      data: Uint8Array.from(buffer),
      disableFontFace: true,
      useSystemFonts: false,
    }).promise;
  } catch (error) {
    if (looksEncrypted(buffer, error)) {
      throw new UnsupportedFileError("Encrypted PDF cannot be read.", {
        cause: error,
        details: { reasonCode: "pdf_encrypted" },
      });
    }
    throw new ParsingFailureError("Malformed or unreadable PDF.", { cause: error });
  }

  try {
    if (document.numPages < limits.minPages) {
      throw new UnsupportedFileError("PDF is below the configured minimum page count.", {
        details: {
          reasonCode: "pdf_page_minimum",
          pageCount: document.numPages,
          minPages: limits.minPages,
        },
      });
    }
    if (document.numPages > limits.maxPages) {
      throw new UnsupportedFileError("PDF exceeds configured page limit.", {
        details: {
          reasonCode: "pdf_page_limit",
          pageCount: document.numPages,
          maxPages: limits.maxPages,
        },
      });
    }

    const textByPage: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const items = content.items.filter((item): item is TextItem => "str" in item);
      textByPage.push(normalizePageText(items));
      page.cleanup();
    }

    const extractedText = textByPage.join("\n\f\n").trim();
    const textLength = extractedText.replace(/\s/g, "").length;
    const readablePageCount = textByPage.filter(
      (text) => text.replace(/\s/g, "").length >= limits.lowTextPageThreshold,
    ).length;

    if (textLength === 0 || readablePageCount === 0) {
      throw new UnsupportedFileError("PDF contains no readable text layer.", {
        details: { reasonCode: "pdf_no_readable_text" },
      });
    }
    if (textLength < limits.minimumReadableTextLength) {
      throw new UnsupportedFileError("PDF contains too little readable text.", {
        details: {
          reasonCode: "pdf_insufficient_readable_text",
          textLength,
          minimumReadableTextLength: limits.minimumReadableTextLength,
        },
      });
    }

    const lowTextPages = textByPage
      .map((text, index) => ({ index, length: text.replace(/\s/g, "").length }))
      .filter(({ length }) => length < limits.lowTextPageThreshold)
      .map(({ index }) => index + 1);
    if (lowTextPages.length > 0) warnings.push("low_text_pages_detected");

    return {
      fileHash: calculateSha256(buffer),
      fileSize: buffer.byteLength,
      pageCount: document.numPages,
      extractedText,
      textByPage,
      textLength,
      textDensityByPage: textByPage.map(
        (text) =>
          Math.round((text.replace(/\s/g, "").length / Math.max(textLength, 1)) * 10000) / 10000,
      ),
      warnings,
    };
  } catch (error) {
    if (error instanceof UnsupportedFileError) throw error;
    throw new ParsingFailureError("PDF text extraction failed.", { cause: error });
  } finally {
    await document.destroy();
  }
}
