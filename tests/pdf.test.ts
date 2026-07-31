import { describe, expect, it } from "vitest";
import {
  createTextPdf,
  encryptedPdfMarker,
  malformedPdf,
  signatureMismatch,
} from "../fixtures/pdf-fixtures.js";
import { ParsingFailureError, UnsupportedFileError } from "../src/lib/errors.js";
import { extractPdf } from "../src/lib/pdf.js";

const permissiveLimits = {
  minPages: 1,
  minimumReadableTextLength: 10,
  lowTextPageThreshold: 3,
};

describe("local PDF validation and extraction", () => {
  it("extracts a valid text PDF and calculates SHA-256", async () => {
    const pdf = await createTextPdf([
      "THE TEST\nFADE IN:\nINT. HOUSE - DAY\nALEX\nThis is readable screenplay dialogue.",
      "EXT. STREET - NIGHT\nAction continues on another readable page.",
    ]);
    const result = await extractPdf(pdf, "screenplay.pdf", "application/pdf", permissiveLimits);
    expect(result.pageCount).toBe(2);
    expect(result.extractedText).toContain("INT. HOUSE - DAY");
    expect(result.fileHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.textByPage).toHaveLength(2);
    expect(result.textDensityByPage).toHaveLength(2);
  });

  it("rejects a blank file", async () => {
    await expect(
      extractPdf(new Uint8Array(), "blank.pdf", "application/pdf"),
    ).rejects.toBeInstanceOf(UnsupportedFileError);
  });

  it("rejects an image-only PDF", async () => {
    const pdf = await createTextPdf([""], { drawImageOnly: true });
    await expect(
      extractPdf(pdf, "scan.pdf", "application/pdf", permissiveLimits),
    ).rejects.toBeInstanceOf(UnsupportedFileError);
  });

  it("rejects malformed PDF data with a PDF signature", async () => {
    await expect(
      extractPdf(malformedPdf, "broken.pdf", "application/pdf", permissiveLimits),
    ).rejects.toBeInstanceOf(ParsingFailureError);
  });

  it("rejects an oversized PDF before parsing", async () => {
    const pdf = new Uint8Array(101);
    pdf.set(new TextEncoder().encode("%PDF-"));
    await expect(
      extractPdf(pdf, "large.pdf", "application/pdf", {
        ...permissiveLimits,
        maxFileBytes: 100,
      }),
    ).rejects.toBeInstanceOf(UnsupportedFileError);
  });

  it("rejects encrypted PDFs that cannot be read", async () => {
    await expect(
      extractPdf(encryptedPdfMarker, "locked.pdf", "application/pdf", permissiveLimits),
    ).rejects.toBeInstanceOf(UnsupportedFileError);
  });

  it("rejects a file-signature mismatch regardless of declarations", async () => {
    await expect(
      extractPdf(signatureMismatch, "looks-valid.pdf", "application/pdf", permissiveLimits),
    ).rejects.toBeInstanceOf(UnsupportedFileError);
  });

  it("rejects a low-text PDF using the configured threshold", async () => {
    const pdf = await createTextPdf(["Hi"]);
    await expect(
      extractPdf(pdf, "short.pdf", "application/pdf", {
        minPages: 1,
        minimumReadableTextLength: 100,
        lowTextPageThreshold: 1,
      }),
    ).rejects.toBeInstanceOf(UnsupportedFileError);
  });

  it("rejects PDFs below the configured minimum page count", async () => {
    const pdf = await createTextPdf(["A readable one-page screenplay fixture."]);
    await expect(
      extractPdf(pdf, "too-short.pdf", "application/pdf", {
        minPages: 25,
        minimumReadableTextLength: 10,
        lowTextPageThreshold: 3,
      }),
    ).rejects.toMatchObject({ details: { reasonCode: "pdf_page_minimum" } });
  });

  it("warns when filename and MIME declarations disagree with actual PDF bytes", async () => {
    const pdf = await createTextPdf(["Enough readable text for a valid local extraction fixture."]);
    const result = await extractPdf(pdf, "screenplay.txt", "text/plain", permissiveLimits);
    expect(result.warnings).toEqual(["filename_extension_mismatch", "declared_mime_type_mismatch"]);
  });
});
