import { z } from "zod";
import { ParsedScreenplaySchema, type ParsedScreenplay, type Scene } from "../types/screenplay.js";
import { estimateTokens } from "./chunker.js";

export const RepresentativeExcerptSchema = z
  .object({
    sceneId: z.string(),
    pageStart: z.number().int().positive(),
    pageEnd: z.number().int().positive(),
    heading: z.string().nullable(),
    landmarks: z.array(
      z.enum([
        "opening",
        "inciting_incident",
        "midpoint",
        "climax",
        "dialogue_heavy",
        "comic_rhythm",
        "action_heavy",
        "fallback",
      ]),
    ),
    text: z.string().min(1),
    estimatedTokens: z.number().int().positive(),
  })
  .strict();

export type RepresentativeExcerpt = z.infer<typeof RepresentativeExcerptSchema>;

function countBlocks(scene: Scene, types: readonly string[]): number {
  return scene.blocks
    .filter((block) => types.includes(block.type))
    .reduce((sum, block) => sum + block.text.split(/\s+/).filter(Boolean).length, 0);
}

function sceneAtFraction(scenes: readonly Scene[], fraction: number): Scene | undefined {
  if (scenes.length === 0) return undefined;
  return scenes[Math.min(scenes.length - 1, Math.round((scenes.length - 1) * fraction))];
}

function fitSceneText(scene: Scene, remainingTokens: number): string {
  if (estimateTokens(scene.rawText) <= remainingTokens) return scene.rawText;
  const groups: string[] = [];
  for (let index = 0; index < scene.blocks.length; index += 1) {
    const block = scene.blocks[index];
    if (!block || block.type === "blank") continue;
    const exchange = [block.text];
    if (block.type === "character") {
      while (index + 1 < scene.blocks.length) {
        const next = scene.blocks[index + 1];
        if (!next || !["parenthetical", "dialogue"].includes(next.type)) break;
        exchange.push(next.text);
        index += 1;
      }
    }
    const candidate = [...groups, exchange.join("\n")].join("\n");
    if (estimateTokens(candidate) > remainingTokens) break;
    groups.push(exchange.join("\n"));
  }
  return groups.join("\n").trim();
}

export function sampleRepresentativeExcerpts(
  screenplayInput: ParsedScreenplay,
  options: { maximumTokens?: number; declaredGenre?: string } = {},
): RepresentativeExcerpt[] {
  const screenplay = ParsedScreenplaySchema.parse(screenplayInput);
  const maximumTokens = z
    .number()
    .int()
    .positive()
    .parse(options.maximumTokens ?? 4_000);
  const scenes = screenplay.scenes.filter((scene) => scene.rawText.trim());
  if (scenes.length === 0) return [];
  const candidates = new Map<
    string,
    { scene: Scene; landmarks: RepresentativeExcerpt["landmarks"] }
  >();
  const add = (scene: Scene | undefined, landmark: RepresentativeExcerpt["landmarks"][number]) => {
    if (!scene) return;
    const existing = candidates.get(scene.id);
    if (existing) existing.landmarks.push(landmark);
    else candidates.set(scene.id, { scene, landmarks: [landmark] });
  };

  add(scenes[0], "opening");
  add(sceneAtFraction(scenes, 0.12), "inciting_incident");
  add(sceneAtFraction(scenes, 0.5), "midpoint");
  const explicitClimax = [...scenes]
    .reverse()
    .find((scene) => /\b(?:climax|final confrontation|defeats?|resolution)\b/i.test(scene.rawText));
  add(explicitClimax ?? sceneAtFraction(scenes, 0.85), "climax");

  const majorCharacters = new Set(
    Object.entries(screenplay.objective.characterAppearanceCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name]) => name),
  );
  const rankedDialogue = [...scenes].sort((a, b) => {
    const dialogueA = countBlocks(a, ["dialogue"]);
    const dialogueB = countBlocks(b, ["dialogue"]);
    const majorA = a.characterNames.some((name) => majorCharacters.has(name)) ? 100 : 0;
    const majorB = b.characterNames.some((name) => majorCharacters.has(name)) ? 100 : 0;
    return dialogueB + majorB - (dialogueA + majorA) || a.index - b.index;
  });
  add(rankedDialogue[0], "dialogue_heavy");
  add(rankedDialogue[1], "dialogue_heavy");
  const comedyGenre = Boolean(
    options.declaredGenre &&
    /(?:comedy|comic|sitcom|rom[ -]?com|dramedy)/i.test(options.declaredGenre),
  );
  if (comedyGenre) {
    add(rankedDialogue[2], "dialogue_heavy");
    const comicRhythmScene = [...scenes].sort((a, b) => {
      const score = (scene: Scene): number => {
        const dialogueBlocks = scene.blocks.filter((block) => block.type === "dialogue");
        const shortDialogueBlocks = dialogueBlocks.filter(
          (block) => block.text.split(/\s+/).filter(Boolean).length <= 12,
        ).length;
        const parentheticals = scene.blocks.filter(
          (block) => block.type === "parenthetical",
        ).length;
        return shortDialogueBlocks * 3 + dialogueBlocks.length + parentheticals * 2;
      };
      return score(b) - score(a) || a.index - b.index;
    })[0];
    add(comicRhythmScene, "comic_rhythm");
  }
  const actionScene = [...scenes].sort(
    (a, b) =>
      countBlocks(b, ["action"]) -
        countBlocks(b, ["dialogue"]) -
        (countBlocks(a, ["action"]) - countBlocks(a, ["dialogue"])) || a.index - b.index,
  )[0];
  add(actionScene, "action_heavy");

  if (candidates.size === 0) add(scenes[0], "fallback");
  const maximumSceneCount = scenes.length === 1 ? 1 : scenes.length - 1;
  const selected = [...candidates.values()]
    .slice(0, maximumSceneCount)
    .sort((a, b) => a.scene.index - b.scene.index);
  const output: RepresentativeExcerpt[] = [];
  let usedTokens = 0;
  const comedyExcerptLimit = comedyGenre
    ? Math.max(1, Math.floor(maximumTokens / selected.length))
    : maximumTokens;
  for (const { scene, landmarks } of selected) {
    const remaining = maximumTokens - usedTokens;
    if (remaining <= 0) break;
    const text = fitSceneText(scene, Math.min(remaining, comedyExcerptLimit));
    if (!text) continue;
    const estimatedTokens = estimateTokens(text);
    output.push({
      sceneId: scene.id,
      pageStart: scene.pageStart,
      pageEnd: scene.pageEnd,
      heading: scene.heading ?? null,
      landmarks: [...new Set(landmarks)],
      text,
      estimatedTokens,
    });
    usedTokens += estimatedTokens;
  }
  return output.map((excerpt) => RepresentativeExcerptSchema.parse(excerpt));
}
