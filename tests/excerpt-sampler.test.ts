import { describe, expect, it } from "vitest";
import { screenplayPages } from "../fixtures/screenplay-fixtures.js";
import { estimateTokens } from "../src/lib/chunker.js";
import { sampleRepresentativeExcerpts } from "../src/lib/excerpt-sampler.js";
import { parseScreenplay } from "../src/lib/parser.js";

function parsePages(pages: string[]) {
  return parseScreenplay({
    extractedText: pages.join("\n\f\n"),
    textByPage: pages,
    pageCount: pages.length,
  });
}

describe("representative excerpt sampler", () => {
  it.each([
    ["short pilot", screenplayPages(30, { television: true, acts: true })],
    ["feature", screenplayPages(110)],
  ] as const)("samples a %s in screenplay order without including every scene", (_name, pages) => {
    const screenplay = parsePages([...pages]);
    const excerpts = sampleRepresentativeExcerpts(screenplay);
    expect(excerpts.map((excerpt) => excerpt.pageStart)).toEqual(
      [...excerpts].map((excerpt) => excerpt.pageStart).sort((a, b) => a - b),
    );
    expect(excerpts.length).toBeLessThan(screenplay.scenes.length);
    expect(excerpts[0]?.landmarks).toContain("opening");
  });

  it("falls back to a positional midpoint when no landmark language exists", () => {
    const screenplay = parsePages(screenplayPages(20));
    const excerpts = sampleRepresentativeExcerpts(screenplay);
    const midpoint = excerpts.find((excerpt) => excerpt.landmarks.includes("midpoint"));
    expect(midpoint).toBeDefined();
    expect(midpoint?.pageStart).toBeGreaterThan(5);
  });

  it("selects dialogue-heavy scenes containing major characters", () => {
    const screenplay = parsePages([
      "TITLE\n\nINT. ROOM - DAY\nAction.",
      "INT. CAFE - DAY\n\nALEX\nOne.\n\nJORDAN\nTwo.\n\nALEX\nThree.\n\nJORDAN\nFour.",
      "EXT. ROAD - NIGHT\nAction continues.",
      "INT. HOME - DAY\nResolution.",
    ]);
    const excerpts = sampleRepresentativeExcerpts(screenplay);
    expect(
      excerpts.some(
        (excerpt) => excerpt.pageStart === 2 && excerpt.landmarks.includes("dialogue_heavy"),
      ),
    ).toBe(true);
  });

  it("selects an action-heavy scene", () => {
    const action = Array.from({ length: 50 }, (_, index) => `Action beat ${index}.`).join("\n");
    const screenplay = parsePages([
      "TITLE\n\nINT. ROOM - DAY\nQuiet.",
      `EXT. BATTLEFIELD - DAY\n${action}`,
      "INT. HOME - NIGHT\nEnd.",
      "EXT. ROAD - DAY\nAftermath.",
    ]);
    const excerpts = sampleRepresentativeExcerpts(screenplay);
    expect(
      excerpts.some(
        (excerpt) => excerpt.pageStart === 2 && excerpt.landmarks.includes("action_heavy"),
      ),
    ).toBe(true);
  });

  it("adds comedy-rhythm evidence only for comedy-oriented submissions", () => {
    const screenplay = parsePages([
      "TITLE\n\nINT. ROOM - DAY\nAction.",
      "INT. CAFE - DAY\n\nALEX\nOne.\n\nJORDAN\nTwo.\n\nALEX\nThree.\n\nJORDAN\nFour.",
      "EXT. ROAD - NIGHT\nAction continues.",
      "INT. HOME - DAY\nResolution.",
    ]);
    const comedy = sampleRepresentativeExcerpts(screenplay, { declaredGenre: "Comedy" });
    const drama = sampleRepresentativeExcerpts(screenplay, { declaredGenre: "Drama" });

    expect(comedy.some((excerpt) => excerpt.landmarks.includes("comic_rhythm"))).toBe(true);
    expect(drama.some((excerpt) => excerpt.landmarks.includes("comic_rhythm"))).toBe(false);
  });

  it("prevents duplicate scene selection while combining landmark labels", () => {
    const screenplay = parsePages(screenplayPages(4));
    const excerpts = sampleRepresentativeExcerpts(screenplay);
    expect(new Set(excerpts.map((excerpt) => excerpt.sceneId)).size).toBe(excerpts.length);
    expect(excerpts.some((excerpt) => excerpt.landmarks.length > 1)).toBe(true);
  });

  it("strictly respects the configured token budget", () => {
    const screenplay = parsePages(screenplayPages(110));
    const maximumTokens = 100;
    const excerpts = sampleRepresentativeExcerpts(screenplay, { maximumTokens });
    expect(excerpts.reduce((sum, excerpt) => sum + excerpt.estimatedTokens, 0)).toBeLessThanOrEqual(
      maximumTokens,
    );
    expect(estimateTokens(excerpts.map((excerpt) => excerpt.text).join("\n"))).toBeLessThanOrEqual(
      maximumTokens,
    );
  });
});
