import type { ObjectiveMetadata } from "../src/types/screenplay.js";
import type { ScreenplayChunk } from "../src/lib/chunker.js";
import type { SummarizedChunk, ChunkSummary } from "../src/lib/summarizer.js";

export const testPricing = {
  models: {
    "test-summary": {
      inputPerMillion: 0.1,
      outputPerMillion: 0.4,
      cachedInputPerMillion: 0.025,
    },
    "test-score": {
      inputPerMillion: 1,
      outputPerMillion: 4,
      cachedInputPerMillion: 0.25,
    },
  },
};

export const validChunkSummary: ChunkSummary = {
  events: ["Alex discovers the missing evidence.", "Alex confronts Jordan at the station."],
  characterChanges: [
    { character: "ALEX", change: "Commits to exposing the conspiracy." },
    { character: "JORDAN", change: "Reveals divided loyalties." },
  ],
  conflicts: ["ALEX risks losing the case to stop JORDAN."],
  setupPayoff: ["The hidden key pays off during the final confrontation."],
  toneTags: ["tense", "noir"],
  dialogueTraits: ["clipped", "subtextual"],
  themes: ["loyalty", "truth"],
  productionElements: {
    locations: ["STATION"],
    largeScaleElements: ["train crash"],
    castNotes: ["two lead roles"],
  },
};

export function makeChunk(
  index: number,
  text = `INT. ROOM ${index} - DAY\nALEX\nDialogue ${index}.`,
): ScreenplayChunk {
  return {
    chunkIndex: index,
    pageStart: index + 1,
    pageEnd: index + 1,
    sceneIds: [`scene-${index + 1}`],
    act: index < 2 ? "ACT ONE" : "ACT TWO",
    rawText: text,
    estimatedTokens: Math.ceil(text.split(/\s+/).length * 1.3),
    characterNamesPresent: ["ALEX"],
    locationNamesPresent: [`ROOM ${index}`],
  };
}

export function makeSummarizedChunk(
  index: number,
  summary: ChunkSummary = validChunkSummary,
  act: string | null = index < 2 ? "ACT ONE" : "ACT TWO",
): SummarizedChunk {
  return {
    chunkIndex: index,
    pageStart: index + 1,
    pageEnd: index + 1,
    sceneIds: [`scene-${index + 1}`],
    act,
    summary,
    usage: { inputTokens: 100, outputTokens: 50 },
    cost: {
      model: "test-summary",
      inputTokens: 100,
      outputTokens: 50,
      cachedInputTokens: 0,
      inputCostUsd: 0.00001,
      cachedInputCostUsd: 0,
      outputCostUsd: 0.00002,
      totalCostUsd: 0.00003,
    },
    latencyMs: 10,
    cacheHit: false,
  };
}

export const objectiveMetadata: ObjectiveMetadata = {
  pageCount: 90,
  wordCount: 20_000,
  characterCount: 120_000,
  sceneCount: 60,
  actCount: 3,
  sceneHeadings: ["INT. STATION - NIGHT"],
  explicitActBreaks: ["ACT ONE", "ACT TWO", "ACT THREE"],
  coldOpen: false,
  teaser: false,
  tag: false,
  dialogueBlockCount: 300,
  actionBlockCount: 500,
  dialogueWordCount: 8_000,
  actionWordCount: 12_000,
  dialogueToActionRatio: 2 / 3,
  averageSceneLength: 1.5,
  medianSceneLength: 1,
  longestSceneLength: 5,
  shortestNonemptySceneLength: 1,
  speakingCharacterCount: 8,
  namedCharacterList: ["ALEX", "JORDAN"],
  characterAppearanceCounts: { ALEX: 100, JORDAN: 70 },
  interiorSceneCount: 35,
  exteriorSceneCount: 25,
  daySceneCount: 30,
  nightSceneCount: 30,
  uniqueLocationCount: 20,
  formattingWarnings: [],
  blankPageWarnings: [],
  lowTextPageWarnings: [],
};
