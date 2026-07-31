import { describe, expect, it } from "vitest";

import { UnsupportedFileError } from "../src/lib/errors.js";
import { assertScreenplayContent } from "../src/lib/screenplay-content-validation.js";
import { parseScreenplay } from "../src/lib/parser.js";

function parse(text: string) {
  return parseScreenplay({ extractedText: text, textByPage: [text], pageCount: 1 });
}

describe("screenplay content validation", () => {
  it("accepts recognizable screenplay structure", () => {
    const screenplay = parse("INT. KITCHEN - DAY\n\nMAYA\nWe need to leave.\n");

    expect(() => assertScreenplayContent(screenplay)).not.toThrow();
  });

  it("rejects a readable document with neither scene headings nor dialogue", () => {
    const document = parse(
      "PROJECT LOOKBOOK\n\nA visual guide to the characters, costumes, locations, and color palette.",
    );

    try {
      assertScreenplayContent(document);
      expect.fail("Expected document-like content to be rejected.");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(UnsupportedFileError);
      if (!(error instanceof UnsupportedFileError)) return;
      expect(error.code).toBe("UNSUPPORTED_FILE");
      expect(error.details?.["reasonCode"]).toBe("screenplay_structure_missing");
    }
  });
});
