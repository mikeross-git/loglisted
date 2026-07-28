import { describe, expect, it } from "vitest";
import { screenplayPages } from "../fixtures/screenplay-fixtures.js";
import { parseScreenplay } from "../src/lib/parser.js";

function parsePages(pages: string[]) {
  return parseScreenplay({
    extractedText: pages.join("\n\f\n"),
    textByPage: pages,
    pageCount: pages.length,
  });
}

describe("deterministic screenplay parser", () => {
  it.each([
    ["half-hour pilot", 30, { television: true, acts: true }, "half_hour_pilot"],
    ["hour pilot", 60, { television: true, acts: true }, "hour_pilot"],
    ["feature", 110, {}, "feature"],
    ["short", 15, {}, "short"],
  ] as const)("recognizes a %s", (_label, pages, options, expectedFormat) => {
    const result = parsePages(screenplayPages(pages, options));
    expect(result.inferred.detectedFormat.value).toBe(expectedFormat);
    expect(result.objective.pageCount).toBe(pages);
    expect(result.objective.sceneCount).toBeGreaterThanOrEqual(pages);
    expect(result.objective.dialogueBlockCount).toBeGreaterThan(0);
  });

  it("handles missing scene headings without inventing headings", () => {
    const result = parsePages(screenplayPages(8, { missingHeadings: true }));
    expect(result.objective.sceneHeadings).toEqual([]);
    expect(result.objective.formattingWarnings).toContain("no_scene_headings");
    expect(result.scenes).toHaveLength(1);
  });

  it("recognizes unusual I/E formatting and transitions", () => {
    const pages = [
      "ODD STORY\n\nI/E. MOVING CAR - DUSK\nRoad noise surrounds them.\n\nSAM\nKeep driving.\n\nSMASH CUT TO:\n\nEXT. FIELD - NIGHT\nDarkness.",
    ];
    const result = parsePages(pages);
    expect(result.objective.sceneHeadings).toEqual([
      "I/E. MOVING CAR - DUSK",
      "EXT. FIELD - NIGHT",
    ]);
    expect(result.blocks.some((block) => block.type === "transition")).toBe(true);
  });

  it("does not treat every uppercase action line as a character cue", () => {
    const pages = [
      "TEST\n\nINT. WAREHOUSE - DAY\n\nTHE CAR EXPLODES\nFlames consume the room.\n\nALEX\nRun!",
    ];
    const result = parsePages(pages);
    const falseCue = result.blocks.find((block) => block.text === "THE CAR EXPLODES");
    expect(falseCue?.type).toBe("action");
    expect(result.objective.namedCharacterList).toEqual(["ALEX"]);
  });

  it("keeps long action passages classified as action", () => {
    const action = Array.from({ length: 100 }, (_, index) => `Action passage ${index}.`).join(" ");
    const result = parsePages([`TEST\n\nINT. ROOM - DAY\n${action}`]);
    expect(result.objective.actionWordCount).toBeGreaterThan(200);
    expect(result.objective.dialogueWordCount).toBe(0);
  });

  it("normalizes repeated character cue variants", () => {
    const result = parsePages([
      "TEST\n\nINT. ROOM - DAY\n\nALEX\nHello.\n\nALEX (CONT'D)\nAgain.\n\nALEX (V.O.)\nFrom afar.",
    ]);
    expect(result.objective.namedCharacterList).toEqual(["ALEX"]);
    expect(result.objective.characterAppearanceCounts["ALEX"]).toBe(3);
  });

  it("recognizes explicit act breaks and television markers", () => {
    const result = parsePages([
      "PILOT\n\nCOLD OPEN\n\nINT. ROOM - DAY\nAction.\n\nACT ONE\n\nEXT. ROAD - NIGHT\nAction.",
      "ACT TWO\n\nINT. HOME - DAY\nAction.\n\nTAG\n\nEND OF SHOW",
    ]);
    expect(result.objective.explicitActBreaks).toEqual(["ACT ONE", "ACT TWO"]);
    expect(result.objective.actCount).toBe(2);
    expect(result.objective.coldOpen).toBe(true);
    expect(result.objective.tag).toBe(true);
  });
});
