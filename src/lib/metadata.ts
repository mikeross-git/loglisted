import type {
  InferredMetadata,
  ObjectiveMetadata,
  Scene,
  ScreenplayBlock,
} from "../types/screenplay.js";

export interface MetadataInput {
  extractedText: string;
  textByPage: string[];
  pageCount: number;
  blocks: ScreenplayBlock[];
  scenes: Scene[];
}

function wordCount(text: string): number {
  return text.match(/\b[\p{L}\p{N}'’-]+\b/gu)?.length ?? 0;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  return sorted.length % 2 ? upper : ((sorted[middle - 1] ?? 0) + upper) / 2;
}

function detectTitle(textByPage: string[]): { value: string | null; confidence: number } {
  const candidates = (textByPage[0] ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 20);
  const excluded =
    /^(?:written by|screenplay by|teleplay by|story by|fade in:?|int\.|ext\.|act |cold open|teaser)/i;
  const title = candidates.find(
    (line) =>
      !excluded.test(line) &&
      line.length >= 2 &&
      line.length <= 100 &&
      (line === line.toUpperCase() || /^[A-Z][\p{L}\p{N}'’:\- ]+$/u.test(line)),
  );
  return { value: title ?? null, confidence: title ? 0.65 : 0 };
}

function detectFormat(
  pageCount: number,
  hasTelevisionMarkers: boolean,
): InferredMetadata["detectedFormat"] {
  if (hasTelevisionMarkers && pageCount <= 40)
    return { value: "half_hour_pilot", confidence: 0.85 };
  if (hasTelevisionMarkers && pageCount <= 75) return { value: "hour_pilot", confidence: 0.85 };
  if (pageCount <= 30) return { value: "short", confidence: 0.7 };
  if (pageCount >= 70) return { value: "feature", confidence: 0.8 };
  return { value: "unknown", confidence: 0.3 };
}

export function buildMetadata(input: MetadataInput): {
  objective: ObjectiveMetadata;
  inferred: InferredMetadata;
} {
  const meaningfulBlocks = input.blocks.filter((block) => block.type !== "blank");
  const dialogueBlocks = meaningfulBlocks.filter((block) => block.type === "dialogue");
  const actionBlocks = meaningfulBlocks.filter((block) => block.type === "action");
  const acts = meaningfulBlocks
    .filter((block) => block.type === "act_break")
    .map((block) => block.text.toUpperCase());
  const markers = new Set(
    meaningfulBlocks
      .filter((block) => block.type === "marker")
      .map((block) => block.text.toUpperCase()),
  );
  const appearanceCounts: Record<string, number> = {};
  for (const block of meaningfulBlocks) {
    if (block.type === "character" && block.characterName) {
      appearanceCounts[block.characterName] = (appearanceCounts[block.characterName] ?? 0) + 1;
    }
  }
  const namedCharacters = Object.keys(appearanceCounts).sort();
  const rankedCharacters = Object.entries(appearanceCounts).sort(
    ([nameA, countA], [nameB, countB]) => countB - countA || nameA.localeCompare(nameB),
  );
  const maxAppearances = rankedCharacters[0]?.[1] ?? 0;
  const protagonistCandidates = rankedCharacters
    .filter(([, count]) => count >= Math.max(2, maxAppearances * 0.5))
    .slice(0, 3)
    .map(([name]) => name);
  const sceneLengths = input.scenes.map((scene) => scene.pageEnd - scene.pageStart + 1);
  const nonemptySceneLengths = sceneLengths.filter((length) => length > 0);
  const dialogueWords = dialogueBlocks.reduce((sum, block) => sum + wordCount(block.text), 0);
  const actionWords = actionBlocks.reduce((sum, block) => sum + wordCount(block.text), 0);
  const locations = new Set(
    input.scenes.flatMap((scene) => (scene.location ? [scene.location] : [])),
  );
  const formattingWarnings: string[] = [];
  if (input.scenes.every((scene) => !scene.heading)) formattingWarnings.push("no_scene_headings");
  if (namedCharacters.length === 0) formattingWarnings.push("no_character_cues");
  if (actionWords > Math.max(dialogueWords * 4, 1000)) formattingWarnings.push("action_heavy");

  const blankPageWarnings = input.textByPage
    .map((text, index) => ({ text, page: index + 1 }))
    .filter(({ text }) => text.trim().length === 0)
    .map(({ page }) => page);
  const lowTextPageWarnings = input.textByPage
    .map((text, index) => ({ length: text.replace(/\s/g, "").length, page: index + 1 }))
    .filter(({ length }) => length > 0 && length < 40)
    .map(({ page }) => page);

  const objective: ObjectiveMetadata = {
    pageCount: input.pageCount,
    wordCount: wordCount(input.extractedText),
    characterCount: input.extractedText.length,
    sceneCount: input.scenes.length,
    actCount: new Set(acts).size,
    sceneHeadings: input.scenes.flatMap((scene) => (scene.heading ? [scene.heading] : [])),
    explicitActBreaks: acts,
    coldOpen: markers.has("COLD OPEN"),
    teaser: markers.has("TEASER"),
    tag: markers.has("TAG"),
    dialogueBlockCount: dialogueBlocks.length,
    actionBlockCount: actionBlocks.length,
    dialogueWordCount: dialogueWords,
    actionWordCount: actionWords,
    dialogueToActionRatio: actionWords === 0 ? dialogueWords : dialogueWords / actionWords,
    averageSceneLength:
      sceneLengths.length === 0
        ? 0
        : sceneLengths.reduce((sum, length) => sum + length, 0) / sceneLengths.length,
    medianSceneLength: median(sceneLengths),
    longestSceneLength: Math.max(0, ...sceneLengths),
    shortestNonemptySceneLength:
      nonemptySceneLengths.length === 0 ? 0 : Math.min(...nonemptySceneLengths),
    speakingCharacterCount: namedCharacters.length,
    namedCharacterList: namedCharacters,
    characterAppearanceCounts: appearanceCounts,
    interiorSceneCount: input.scenes.filter((scene) => scene.interior).length,
    exteriorSceneCount: input.scenes.filter((scene) => scene.exterior).length,
    daySceneCount: input.scenes.filter((scene) => scene.timeOfDay === "day").length,
    nightSceneCount: input.scenes.filter((scene) => scene.timeOfDay === "night").length,
    uniqueLocationCount: locations.size,
    formattingWarnings,
    blankPageWarnings,
    lowTextPageWarnings,
  };

  const title = detectTitle(input.textByPage);
  const televisionMarkers = markers.has("COLD OPEN") || markers.has("TEASER") || markers.has("TAG");
  const inferred: InferredMetadata = {
    title,
    detectedFormat: detectFormat(input.pageCount, televisionMarkers),
    protagonistCandidates: {
      value: protagonistCandidates,
      confidence:
        maxAppearances === 0
          ? 0
          : Math.min(0.95, 0.4 + maxAppearances / Math.max(10, dialogueBlocks.length)),
    },
    approximateCastSize: {
      value: namedCharacters.length,
      confidence: namedCharacters.length > 0 ? 0.75 : 0.2,
    },
    estimatedRuntimeMinutes: {
      value: input.pageCount,
      confidence: formattingWarnings.length === 0 ? 0.8 : 0.55,
    },
  };
  return { objective, inferred };
}
