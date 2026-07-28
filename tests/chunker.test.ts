import { describe, expect, it } from "vitest";
import { screenplayPages } from "../fixtures/screenplay-fixtures.js";
import { chunkScreenplay } from "../src/lib/chunker.js";
import { parseScreenplay } from "../src/lib/parser.js";

function parsedPages(pages: string[]) {
  return parseScreenplay({
    extractedText: pages.join("\n\f\n"),
    textByPage: pages,
    pageCount: pages.length,
  });
}

describe("scene-aware screenplay chunker", () => {
  it.each([
    ["30-page pilot", 30, { television: true, acts: true }],
    ["60-page pilot", 60, { television: true, acts: true }],
    ["110-page feature", 110, {}],
  ] as const)("chunks a %s in order without losing scenes", (_label, count, options) => {
    const screenplay = parsedPages(screenplayPages(count, options));
    const chunks = chunkScreenplay(screenplay, { targetTokens: 1500, hardMaxTokens: 2000 });
    expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual(
      Array.from({ length: chunks.length }, (_, index) => index),
    );
    expect(chunks[0]?.pageStart).toBe(1);
    expect(chunks.at(-1)?.pageEnd).toBe(count);
    expect(new Set(chunks.flatMap((chunk) => chunk.sceneIds))).toEqual(
      new Set(screenplay.scenes.map((scene) => scene.id)),
    );
    expect(chunks.every((chunk) => chunk.estimatedTokens <= 2000)).toBe(true);
  });

  it("splits an extremely long scene only between complete blocks", () => {
    const action = Array.from(
      { length: 900 },
      (_, index) => `Unique action paragraph ${index} moves the story forward.`,
    ).join("\n");
    const screenplay = parsedPages([
      `LONG NIGHT\n\nINT. HALL - NIGHT\n${action}\n\nALEX\nStay with me.\n\nJORDAN\nAlways.`,
    ]);
    const chunks = chunkScreenplay(screenplay, { targetTokens: 1500, hardMaxTokens: 1700 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.estimatedTokens <= 1700)).toBe(true);
    const combined = chunks.map((chunk) => chunk.rawText).join("\n");
    expect(combined.match(/Unique action paragraph 417/g)).toHaveLength(1);
  });

  it("handles missing scene headings and avoids repeated text", () => {
    const pages = screenplayPages(40, { missingHeadings: true });
    const chunks = chunkScreenplay(parsedPages(pages), {
      targetTokens: 1500,
      hardMaxTokens: 1800,
    });
    const combined = chunks.map((chunk) => chunk.rawText).join("\n");
    expect(combined.match(/Action for scene 17\./g)).toHaveLength(1);
    expect(new Set(chunks.flatMap((chunk) => chunk.sceneIds)).size).toBe(1);
  });

  it("preserves act boundaries between chunks", () => {
    const screenplay = parsedPages(screenplayPages(30, { television: true, acts: true }));
    const chunks = chunkScreenplay(screenplay, { targetTokens: 1500, hardMaxTokens: 2000 });
    expect(
      chunks.every((chunk) => {
        const acts = new Set(
          chunk.sceneIds
            .map((id) => screenplay.scenes.find((scene) => scene.id === id)?.act)
            .filter(Boolean),
        );
        return acts.size <= 1;
      }),
    ).toBe(true);
  });

  it("never splits a character cue from its dialogue exchange", () => {
    const action = Array.from(
      { length: 500 },
      (_, index) => `Action paragraph ${index} creates enough material for chunking.`,
    ).join("\n");
    const screenplay = parsedPages([
      `EXCHANGE\n\nINT. ROOM - DAY\n${action}\n\nALEX\n(quietly)\nThis line must remain with its cue.`,
    ]);
    const chunks = chunkScreenplay(screenplay, { targetTokens: 1500, hardMaxTokens: 1700 });
    const dialogueChunk = chunks.find((chunk) =>
      chunk.rawText.includes("This line must remain with its cue."),
    );
    expect(dialogueChunk?.rawText).toContain(
      "ALEX\n(quietly)\nThis line must remain with its cue.",
    );
  });

  it("combines short adjacent scenes and reports names and locations", () => {
    const screenplay = parsedPages(screenplayPages(8));
    const chunks = chunkScreenplay(screenplay);
    expect(chunks.length).toBeLessThan(screenplay.scenes.length);
    expect(chunks[0]?.characterNamesPresent).toEqual(["ALEX", "JORDAN"]);
    expect(chunks[0]?.locationNamesPresent.length).toBeGreaterThan(1);
  });
});
