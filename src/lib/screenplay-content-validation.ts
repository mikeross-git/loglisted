import type { ParsedScreenplay } from "../types/screenplay.js";
import { UnsupportedFileError } from "./errors.js";

/**
 * Rejects readable documents that lack the two strongest deterministic signs
 * of screenplay structure. This runs locally before chunking or any LLM call.
 */
export function assertScreenplayContent(screenplay: ParsedScreenplay): void {
  const { dialogueBlockCount, sceneHeadings } = screenplay.objective;

  if (sceneHeadings.length === 0 && dialogueBlockCount === 0) {
    throw new UnsupportedFileError("The PDF does not contain recognizable screenplay structure.", {
      details: {
        reasonCode: "screenplay_structure_missing",
        dialogueBlockCount,
        sceneHeadingCount: sceneHeadings.length,
      },
    });
  }
}
