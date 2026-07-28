import { describe, expect, it } from "vitest";
import {
  makeSummarizedChunk,
  objectiveMetadata,
  validChunkSummary,
} from "../fixtures/llm-fixtures.js";
import { estimateTokens } from "../src/lib/chunker.js";
import { reduceScreenplaySummaries } from "../src/lib/reducer.js";

describe("local screenplay summary reducer", () => {
  it("deduplicates repeated events and duplicated character evidence", () => {
    const result = reduceScreenplaySummaries(
      [makeSummarizedChunk(0), makeSummarizedChunk(1)],
      objectiveMetadata,
      { format: "feature" },
    );
    expect(result.acts[0]?.events).toEqual([
      "Alex discovers the missing evidence.",
      "Alex confronts Jordan at the station.",
    ]);
    const alex = result.characters.find((character) => character.name === "ALEX");
    expect(alex?.arcEvidence).toEqual(["Commits to exposing the conspiracy."]);
    expect(result.format).toBe("feature");
  });

  it("preserves chronology and act boundaries", () => {
    const first = {
      ...validChunkSummary,
      events: ["Opening event."],
    };
    const second = {
      ...validChunkSummary,
      events: ["Later event."],
    };
    const result = reduceScreenplaySummaries(
      [makeSummarizedChunk(1, second, "ACT TWO"), makeSummarizedChunk(0, first, "ACT ONE")],
      objectiveMetadata,
    );
    expect(result.acts.map((act) => act.act)).toEqual(["ACT ONE", "ACT TWO"]);
    expect(result.acts[0]?.events[0]).toBe("Opening event.");
    expect(result.acts[1]?.events[0]).toBe("Later event.");
  });

  it("groups missing act labels under a deterministic label", () => {
    const result = reduceScreenplaySummaries(
      [makeSummarizedChunk(0, validChunkSummary, null)],
      objectiveMetadata,
    );
    expect(result.acts[0]?.act).toBe("UNLABELED");
  });

  it("keeps output under a configurable token budget using deterministic pruning", () => {
    const summaries = Array.from({ length: 40 }, (_, index) =>
      makeSummarizedChunk(index, {
        ...validChunkSummary,
        events: [
          `Minor joke ${index} is repeated banter.`,
          `Alex discovers major clue ${index}.`,
          ...(index === 39 ? ["Alex confronts the villain in the final climax."] : []),
        ],
      }),
    );
    const maximumTokens = 1_800;
    const result = reduceScreenplaySummaries(summaries, objectiveMetadata, { maximumTokens });
    expect(estimateTokens(JSON.stringify(result))).toBeLessThanOrEqual(maximumTokens);
    expect(JSON.stringify(result)).toContain("final climax");
    expect(JSON.stringify(result)).not.toContain("Minor joke");
  });

  it("preserves climax, resolution, setup, and payoff evidence", () => {
    const summary = {
      ...validChunkSummary,
      events: [
        "Alex confronts the villain in the climax.",
        "Alex resolves the case and returns home.",
      ],
      setupPayoff: [
        "The opening key setup pays off in the final confrontation.",
        "A remaining threat is unresolved.",
      ],
    };
    const result = reduceScreenplaySummaries([makeSummarizedChunk(0, summary)], objectiveMetadata);
    const serialized = JSON.stringify(result);
    expect(serialized).toContain("climax");
    expect(serialized).toContain("resolves");
    expect(serialized).toContain("pays off");
    expect(serialized).toContain("unresolved");
  });

  it("aggregates recurring tags, conflicts, and location frequency", () => {
    const result = reduceScreenplaySummaries(
      [makeSummarizedChunk(0), makeSummarizedChunk(1)],
      objectiveMetadata,
    );
    expect(result.toneTags[0]).toBe("noir");
    expect(result.productionProfile.locationFrequency["STATION"]).toBe(2);
    expect(
      result.characters.find((character) => character.name === "ALEX")?.conflicts,
    ).toHaveLength(1);
  });
});
