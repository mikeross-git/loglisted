import { describe, expect, it } from "vitest";
import { screenplayPages } from "../fixtures/screenplay-fixtures.js";
import { parseScreenplay } from "../src/lib/parser.js";

describe("screenplay metadata", () => {
  it("separates objective values from confidence-bearing inferred values", () => {
    const pages = screenplayPages(12, { title: "NIGHT TRAIN", acts: true });
    const result = parseScreenplay({
      extractedText: pages.join("\n\f\n"),
      textByPage: pages,
      pageCount: pages.length,
    });
    expect(result.inferred.title.value).toBe("NIGHT TRAIN");
    expect(result.inferred.title.confidence).toBeGreaterThan(0);
    expect(result.inferred.protagonistCandidates.confidence).toBeGreaterThan(0);
    expect(result.objective.wordCount).toBeGreaterThan(0);
    expect(result.objective.uniqueLocationCount).toBe(12);
    expect(result.objective.interiorSceneCount + result.objective.exteriorSceneCount).toBe(12);
    expect(result.objective.daySceneCount + result.objective.nightSceneCount).toBe(12);
  });

  it("reports page-level blank and low-text warnings", () => {
    const pages = [
      "TITLE\n\nINT. ROOM - DAY\nA sufficiently long action passage keeps this page above the low-text threshold.",
      "",
      "x",
    ];
    const result = parseScreenplay({
      extractedText: pages.join("\n\f\n"),
      textByPage: pages,
      pageCount: 3,
    });
    expect(result.objective.blankPageWarnings).toEqual([2]);
    expect(result.objective.lowTextPageWarnings).toEqual([3]);
  });

  it("calculates dialogue/action and scene-length statistics deterministically", () => {
    const pages = screenplayPages(6);
    const first = parseScreenplay({
      extractedText: pages.join("\n\f\n"),
      textByPage: pages,
      pageCount: pages.length,
    });
    const second = parseScreenplay({
      extractedText: pages.join("\n\f\n"),
      textByPage: pages,
      pageCount: pages.length,
    });
    expect(first.objective).toEqual(second.objective);
    expect(first.objective.dialogueToActionRatio).toBeGreaterThan(0);
    expect(first.objective.longestSceneLength).toBeGreaterThanOrEqual(
      first.objective.shortestNonemptySceneLength,
    );
  });
});
