import { z } from "zod";
import {
  ParsedScreenplaySchema,
  type ParsedScreenplay,
  type Scene,
  type ScreenplayBlock,
} from "../types/screenplay.js";

export const ChunkerOptionsSchema = z
  .object({
    targetTokens: z.number().int().min(1500).max(2500).default(2000),
    hardMaxTokens: z.number().int().min(1500).default(2500),
  })
  .strict()
  .refine((value) => value.hardMaxTokens >= value.targetTokens, {
    message: "hardMaxTokens must be at least targetTokens",
  });

export const ScreenplayChunkSchema = z
  .object({
    chunkIndex: z.number().int().nonnegative(),
    pageStart: z.number().int().positive(),
    pageEnd: z.number().int().positive(),
    sceneIds: z.array(z.string()).min(1),
    act: z.string().nullable(),
    rawText: z.string().min(1),
    estimatedTokens: z.number().int().positive(),
    characterNamesPresent: z.array(z.string()),
    locationNamesPresent: z.array(z.string()),
  })
  .strict();

export type ScreenplayChunk = z.infer<typeof ScreenplayChunkSchema>;
export type ChunkerOptions = z.input<typeof ChunkerOptionsSchema>;

interface ChunkUnit {
  sceneId: string;
  act?: string;
  pageStart: number;
  pageEnd: number;
  text: string;
  characters: string[];
  locations: string[];
  estimatedTokens: number;
}

export function estimateTokens(text: string): number {
  const words = text.match(/\S+/g)?.length ?? 0;
  return Math.max(1, Math.ceil(words * 1.3));
}

function blockGroups(blocks: ScreenplayBlock[]): ScreenplayBlock[][] {
  const groups: ScreenplayBlock[][] = [];
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (!block) continue;
    if (block.type === "character") {
      const exchange = [block];
      while (index + 1 < blocks.length) {
        const next = blocks[index + 1];
        if (!next || !["parenthetical", "dialogue"].includes(next.type)) break;
        exchange.push(next);
        index += 1;
      }
      groups.push(exchange);
    } else {
      groups.push([block]);
    }
  }
  return groups;
}

function unitFromBlocks(scene: Scene, blocks: ScreenplayBlock[]): ChunkUnit {
  const text = blocks
    .filter((block) => block.type !== "blank")
    .map((block) => block.text)
    .join("\n")
    .trim();
  return {
    sceneId: scene.id,
    ...(scene.act ? { act: scene.act } : {}),
    pageStart: blocks[0]?.page ?? scene.pageStart,
    pageEnd: blocks.at(-1)?.page ?? scene.pageEnd,
    text,
    characters: [
      ...new Set(blocks.flatMap((block) => (block.characterName ? [block.characterName] : []))),
    ],
    locations: scene.location ? [scene.location] : [],
    estimatedTokens: estimateTokens(text),
  };
}

function sceneUnits(scene: Scene, hardMaxTokens: number): ChunkUnit[] {
  if (estimateTokens(scene.rawText) <= hardMaxTokens) {
    return [
      {
        sceneId: scene.id,
        ...(scene.act ? { act: scene.act } : {}),
        pageStart: scene.pageStart,
        pageEnd: scene.pageEnd,
        text: scene.rawText,
        characters: scene.characterNames,
        locations: scene.location ? [scene.location] : [],
        estimatedTokens: estimateTokens(scene.rawText),
      },
    ];
  }

  const units: ChunkUnit[] = [];
  let pending: ScreenplayBlock[] = [];
  let pendingTokens = 0;
  for (const group of blockGroups(scene.blocks)) {
    const groupText = group.map((block) => block.text).join("\n");
    const groupTokens = estimateTokens(groupText);
    if (pending.length > 0 && pendingTokens + groupTokens > hardMaxTokens) {
      units.push(unitFromBlocks(scene, pending));
      pending = [];
      pendingTokens = 0;
    }
    pending.push(...group);
    pendingTokens += groupTokens;
  }
  if (pending.length > 0) units.push(unitFromBlocks(scene, pending));
  return units.filter((unit) => unit.text.length > 0);
}

export function chunkScreenplay(
  screenplayInput: ParsedScreenplay,
  optionsInput: ChunkerOptions = {},
): ScreenplayChunk[] {
  const screenplay = ParsedScreenplaySchema.parse(screenplayInput);
  const options = ChunkerOptionsSchema.parse(optionsInput);
  const units = screenplay.scenes.flatMap((scene) => sceneUnits(scene, options.hardMaxTokens));
  const output: ScreenplayChunk[] = [];
  let pending: ChunkUnit[] = [];
  let pendingTokens = 0;

  const flush = (): void => {
    if (pending.length === 0) return;
    const rawText = pending
      .map((unit) => unit.text)
      .join("\n\n")
      .trim();
    output.push({
      chunkIndex: output.length,
      pageStart: pending[0]?.pageStart ?? 1,
      pageEnd: pending.at(-1)?.pageEnd ?? 1,
      sceneIds: [...new Set(pending.map((unit) => unit.sceneId))],
      act: pending[0]?.act ?? null,
      rawText,
      estimatedTokens: estimateTokens(rawText),
      characterNamesPresent: [...new Set(pending.flatMap((unit) => unit.characters))].sort(),
      locationNamesPresent: [...new Set(pending.flatMap((unit) => unit.locations))].sort(),
    });
    pending = [];
    pendingTokens = 0;
  };

  for (const unit of units) {
    const actChanged = pending.length > 0 && pending[0]?.act !== unit.act && Boolean(unit.act);
    const wouldExceedHardMax =
      pending.length > 0 && pendingTokens + unit.estimatedTokens > options.hardMaxTokens;
    if (actChanged || wouldExceedHardMax) flush();
    pending.push(unit);
    pendingTokens += unit.estimatedTokens;
    if (pendingTokens >= options.targetTokens) flush();
  }
  flush();
  return output.map((chunk) => ScreenplayChunkSchema.parse(chunk));
}
