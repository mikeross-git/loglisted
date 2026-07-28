import { z } from "zod";
import type { ParsedScreenplay, Scene, ScreenplayBlock } from "../types/screenplay.js";
import { buildMetadata } from "./metadata.js";

export const ParseScreenplayInputSchema = z
  .object({
    extractedText: z.string().min(1),
    textByPage: z.array(z.string()).min(1),
    pageCount: z.number().int().positive(),
  })
  .strict()
  .refine((value) => value.textByPage.length === value.pageCount, {
    message: "textByPage length must equal pageCount",
    path: ["textByPage"],
  });

const SCENE_HEADING = /^(?:(?:INT\.?|EXT\.?|INT\.?\/EXT\.?|EXT\.?\/INT\.?|I\/E\.?|E\/I\.?)\s+).+/i;
const ACT_BREAK = /^(?:ACT\s+(?:ONE|TWO|THREE|FOUR|FIVE|SIX|\d+)|END OF ACT\s+\w+)$/i;
const MARKER = /^(?:COLD OPEN|TEASER|TAG|FADE IN:?|FADE OUT\.?|END OF SHOW)$/i;
const TRANSITION =
  /^(?:CUT TO:|SMASH CUT TO:|DISSOLVE TO:|MATCH CUT TO:|WIPE TO:|FADE TO:|BACK TO:|INTERCUT:?|END CREDITS)$/i;
const PARENTHETICAL = /^\([^)]{1,100}\)$/;
const CHARACTER_CUE = /^[A-Z][A-Z0-9 .'\-()]{0,29}$/;
const CUE_EXCLUSIONS = /^(?:THE|A|AN|HE|SHE|IT|THEY|WE|YOU|CAMERA|ANGLE|CLOSE|WIDE|CONTINUED)\b/;

interface LineRecord {
  text: string;
  page: number;
  line: number;
}

function normalizedCue(line: string): string {
  return line.replace(/\s*\((?:CONT'D|CONTINUED|V\.?O\.?|O\.?S\.?|O\.?C\.?)\)\s*$/i, "").trim();
}

function isCharacterCue(lines: LineRecord[], index: number): boolean {
  const line = lines[index]?.text.trim() ?? "";
  if (
    !CHARACTER_CUE.test(line) ||
    CUE_EXCLUSIONS.test(line) ||
    SCENE_HEADING.test(line) ||
    ACT_BREAK.test(line) ||
    MARKER.test(line) ||
    TRANSITION.test(line) ||
    line.endsWith(":")
  ) {
    return false;
  }
  const cue = normalizedCue(line);
  const words = cue.split(/\s+/);
  if (words.length > 4 || cue.length < 2) return false;
  const next = lines[index + 1]?.text.trim() ?? "";
  if (!next || SCENE_HEADING.test(next) || ACT_BREAK.test(next) || MARKER.test(next)) return false;
  return PARENTHETICAL.test(next) || (!CHARACTER_CUE.test(next) && next.length <= 180);
}

function classifyBlocks(textByPage: string[]): ScreenplayBlock[] {
  const lines: LineRecord[] = [];
  textByPage.forEach((pageText, pageIndex) => {
    pageText
      .split(/\r?\n/)
      .forEach((text, line) => lines.push({ text, page: pageIndex + 1, line }));
    lines.push({ text: "", page: pageIndex + 1, line: Number.MAX_SAFE_INTEGER });
  });

  const blocks: ScreenplayBlock[] = [];
  let dialogueCharacter: string | undefined;
  let blockIndex = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const record = lines[index];
    if (!record) continue;
    const text = record.text.trim();
    let type: ScreenplayBlock["type"];
    let characterName: string | undefined;

    if (!text) {
      type = "blank";
      dialogueCharacter = undefined;
    } else if (SCENE_HEADING.test(text)) {
      type = "scene_heading";
      dialogueCharacter = undefined;
    } else if (ACT_BREAK.test(text)) {
      type = "act_break";
      dialogueCharacter = undefined;
    } else if (MARKER.test(text)) {
      type = "marker";
      dialogueCharacter = undefined;
    } else if (TRANSITION.test(text) || /^[A-Z ]+ TO:$/.test(text)) {
      type = "transition";
      dialogueCharacter = undefined;
    } else if (isCharacterCue(lines, index)) {
      type = "character";
      characterName = normalizedCue(text);
      dialogueCharacter = characterName;
    } else if (dialogueCharacter && PARENTHETICAL.test(text)) {
      type = "parenthetical";
      characterName = dialogueCharacter;
    } else if (dialogueCharacter) {
      type = "dialogue";
      characterName = dialogueCharacter;
    } else {
      type = "action";
    }

    blocks.push({
      id: `block-${blockIndex++}`,
      type,
      text,
      page: record.page,
      lineStart: record.line,
      lineEnd: record.line,
      ...(characterName ? { characterName } : {}),
    });
  }
  return blocks;
}

function parseHeading(
  heading: string,
): Pick<Scene, "interior" | "exterior" | "timeOfDay" | "location"> {
  const upper = heading.toUpperCase();
  const interior = /^(?:INT\.?|INT\.?\/EXT\.?|EXT\.?\/INT\.?|I\/E\.?)/.test(upper);
  const exterior = /^(?:EXT\.?|INT\.?\/EXT\.?|EXT\.?\/INT\.?|I\/E\.?|E\/I\.?)/.test(upper);
  const timeOfDay = /(?:^|\s|-)NIGHT(?:\s|$)/.test(upper)
    ? "night"
    : /(?:^|\s|-)DAY(?:\s|$)/.test(upper)
      ? "day"
      : /(?:DAWN|DUSK|MORNING|EVENING|LATER|CONTINUOUS)/.test(upper)
        ? "other"
        : "unknown";
  const location = heading
    .replace(/^(?:INT\.?|EXT\.?|INT\.?\/EXT\.?|EXT\.?\/INT\.?|I\/E\.?|E\/I\.?)\s*/i, "")
    .split(/\s+-\s+/)[0]
    ?.trim();
  return { interior, exterior, timeOfDay, ...(location ? { location } : {}) };
}

function buildScenes(blocks: ScreenplayBlock[], pageCount: number): Scene[] {
  const scenes: Scene[] = [];
  let currentAct: string | undefined;
  let sceneBlocks: ScreenplayBlock[] = [];
  let heading: string | undefined;

  const finish = (): void => {
    const meaningful = sceneBlocks.filter((block) => block.type !== "blank");
    if (meaningful.length === 0) return;
    const index = scenes.length;
    const rawText = meaningful
      .map((block) => block.text)
      .join("\n")
      .trim();
    const firstPage = meaningful[0]?.page ?? 1;
    const lastPage = meaningful.at(-1)?.page ?? firstPage;
    const headingDetails = heading
      ? parseHeading(heading)
      : { interior: false, exterior: false, timeOfDay: "unknown" as const };
    scenes.push({
      id: `scene-${index + 1}`,
      index,
      ...(heading ? { heading } : {}),
      ...headingDetails,
      ...(currentAct ? { act: currentAct } : {}),
      pageStart: firstPage,
      pageEnd: Math.min(lastPage, pageCount),
      rawText,
      wordCount: rawText.split(/\s+/).filter(Boolean).length,
      blocks: meaningful,
      characterNames: [
        ...new Set(
          meaningful.flatMap((block) => (block.characterName ? [block.characterName] : [])),
        ),
      ],
    });
    sceneBlocks = [];
    heading = undefined;
  };

  for (const block of blocks) {
    if (block.type === "act_break") {
      finish();
      currentAct = block.text.toUpperCase();
      sceneBlocks.push(block);
      continue;
    }
    if (block.type === "scene_heading") {
      if (
        sceneBlocks.some(
          (candidate) => candidate.type !== "act_break" && candidate.type !== "marker",
        )
      ) {
        finish();
      }
      heading = block.text;
    }
    sceneBlocks.push(block);
  }
  finish();
  return scenes;
}

export function parseScreenplay(
  input: z.input<typeof ParseScreenplayInputSchema>,
): ParsedScreenplay {
  const validated = ParseScreenplayInputSchema.parse(input);
  const blocks = classifyBlocks(validated.textByPage);
  const scenes = buildScenes(blocks, validated.pageCount);
  const { objective, inferred } = buildMetadata({
    extractedText: validated.extractedText,
    textByPage: validated.textByPage,
    pageCount: validated.pageCount,
    blocks,
    scenes,
  });
  return {
    rawText: validated.extractedText,
    textByPage: validated.textByPage,
    objective,
    inferred,
    blocks,
    scenes,
  };
}
