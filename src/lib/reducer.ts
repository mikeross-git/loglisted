import { z } from "zod";
import type { ObjectiveMetadata } from "../types/screenplay.js";
import { ObjectiveMetadataSchema } from "../types/screenplay.js";
import { estimateTokens } from "./chunker.js";
import type { SummarizedChunk } from "./summarizer.js";

const ReducedActSchema = z
  .object({
    act: z.string(),
    events: z.array(z.string()),
    turningPoints: z.array(z.string()),
    unresolvedThreads: z.array(z.string()),
  })
  .strict();

const ReducedCharacterSchema = z
  .object({
    name: z.string(),
    role: z.string(),
    goal: z.string(),
    conflicts: z.array(z.string()),
    arcEvidence: z.array(z.string()),
  })
  .strict();

export const ReducedScreenplaySchema = z
  .object({
    format: z.string(),
    loglineInputs: z
      .object({
        protagonist: z.string(),
        goal: z.string(),
        obstacle: z.string(),
        stakes: z.string(),
      })
      .strict(),
    acts: z.array(ReducedActSchema),
    characters: z.array(ReducedCharacterSchema),
    toneTags: z.array(z.string()),
    dialogueTraits: z.array(z.string()),
    themes: z.array(z.string()),
    productionProfile: z
      .object({
        locationFrequency: z.record(z.string(), z.number().int().positive()),
        largeScaleElements: z.array(z.string()),
        castNotes: z.array(z.string()),
      })
      .strict(),
    objectiveMetadata: ObjectiveMetadataSchema,
  })
  .strict();

export type ReducedScreenplay = z.infer<typeof ReducedScreenplaySchema>;

function normalized(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function dedupe(values: readonly string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = normalized(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function frequencies(values: readonly string[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) result[value] = (result[value] ?? 0) + 1;
  return result;
}

const majorPlotPattern =
  /\b(?:inciting|discovers?|reveals?|betrays?|dies?|kills?|climax|confronts?|defeats?|escapes?|resolves?|resolution|final|payoff|turning point)\b/i;
const unresolvedPattern =
  /\b(?:setup|unresolved|unknown|question|threat remains|still|must|will)\b/i;
const minorJokePattern = /\b(?:joke|quips?|banter|gag|comic beat)\b/i;

function inferGoal(evidence: readonly string[]): string {
  return (
    evidence.find((item) => /\b(?:wants?|tries?|seeks?|needs?|must|plans?|aims?)\b/i.test(item)) ??
    ""
  );
}

function compactToBudget(value: ReducedScreenplay, maximumTokens: number): ReducedScreenplay {
  const tokenCount = (): number => estimateTokens(JSON.stringify(value));
  if (tokenCount() <= maximumTokens) return value;

  value.toneTags.splice(8);
  value.dialogueTraits.splice(8);
  value.themes.splice(6);
  value.productionProfile.castNotes.splice(8);
  value.productionProfile.largeScaleElements.splice(8);
  for (const character of value.characters.slice(8)) {
    character.arcEvidence.length = 0;
    character.conflicts.length = 0;
  }
  value.characters.splice(12);

  const removableEvents = value.acts.flatMap((act) =>
    act.events
      .map((event, index) => ({ act, event, index }))
      .filter(({ event }) => !majorPlotPattern.test(event)),
  );
  for (const candidate of removableEvents.reverse()) {
    if (tokenCount() <= maximumTokens) break;
    candidate.act.events.splice(candidate.index, 1);
  }

  for (const act of [...value.acts].reverse()) {
    while (tokenCount() > maximumTokens && act.unresolvedThreads.length > 1) {
      act.unresolvedThreads.pop();
    }
    while (tokenCount() > maximumTokens && act.turningPoints.length > 1) {
      act.turningPoints.pop();
    }
  }
  if (tokenCount() > maximumTokens) {
    throw new Error("Reduced screenplay cannot fit the configured evidence budget.");
  }
  return value;
}

export function reduceScreenplaySummaries(
  summaries: readonly SummarizedChunk[],
  metadata: ObjectiveMetadata,
  options: { maximumTokens?: number; format?: string } = {},
): ReducedScreenplay {
  const ordered = [...summaries].sort((a, b) => a.chunkIndex - b.chunkIndex);
  const actMap = new Map<string, ReducedScreenplay["acts"][number]>();
  const characterEvidence = new Map<string, string[]>();
  const conflicts: string[] = [];
  const tones: string[] = [];
  const dialogueTraits: string[] = [];
  const themes: string[] = [];
  const locations: string[] = [];
  const largeScaleElements: string[] = [];
  const castNotes: string[] = [];

  for (const chunk of ordered) {
    const actName = chunk.act ?? "UNLABELED";
    let act = actMap.get(actName);
    if (!act) {
      act = { act: actName, events: [], turningPoints: [], unresolvedThreads: [] };
      actMap.set(actName, act);
    }
    const events = chunk.summary.events.filter(
      (event) => !minorJokePattern.test(event) || majorPlotPattern.test(event),
    );
    act.events.push(...events);
    const setupPayoff = chunk.summary.setupPayoff;
    act.turningPoints.push(...setupPayoff.filter((item) => majorPlotPattern.test(item)));
    act.unresolvedThreads.push(...setupPayoff.filter((item) => unresolvedPattern.test(item)));
    conflicts.push(...chunk.summary.conflicts);
    tones.push(...chunk.summary.toneTags);
    dialogueTraits.push(...chunk.summary.dialogueTraits);
    themes.push(...chunk.summary.themes);
    locations.push(...chunk.summary.productionElements.locations);
    largeScaleElements.push(...chunk.summary.productionElements.largeScaleElements);
    castNotes.push(...chunk.summary.productionElements.castNotes);
    for (const change of chunk.summary.characterChanges) {
      const evidence = characterEvidence.get(change.character) ?? [];
      evidence.push(change.change);
      characterEvidence.set(change.character, evidence);
    }
  }

  const acts = [...actMap.values()].map((act) => ({
    ...act,
    events: dedupe(act.events),
    turningPoints: dedupe([
      ...act.turningPoints,
      ...act.events.filter((event) => majorPlotPattern.test(event)),
    ]),
    unresolvedThreads: dedupe(act.unresolvedThreads),
  }));
  const protagonistNames = metadata.namedCharacterList
    .map((name) => ({
      name,
      count: metadata.characterAppearanceCounts[name] ?? 0,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 3)
    .map(({ name }) => name);
  const characters = [...characterEvidence.entries()]
    .sort(
      ([nameA], [nameB]) =>
        (metadata.characterAppearanceCounts[nameB] ?? 0) -
          (metadata.characterAppearanceCounts[nameA] ?? 0) || nameA.localeCompare(nameB),
    )
    .map(([name, evidence]) => ({
      name,
      role: protagonistNames.includes(name) ? "protagonist candidate" : "supporting",
      goal: inferGoal(evidence),
      conflicts: dedupe(
        conflicts.filter((conflict) => normalized(conflict).includes(normalized(name))),
      ),
      arcEvidence: dedupe(evidence),
    }));
  const protagonist = protagonistNames[0] ?? characters[0]?.name ?? "";
  const protagonistEvidence =
    characters.find((character) => character.name === protagonist)?.arcEvidence ?? [];
  const result: ReducedScreenplay = {
    format: options.format ?? "unknown",
    loglineInputs: {
      protagonist,
      goal: inferGoal(protagonistEvidence),
      obstacle: conflicts[0] ?? "",
      stakes:
        conflicts.find((conflict) => /\b(?:risk|lose|death|stakes|threat)\b/i.test(conflict)) ?? "",
    },
    acts,
    characters,
    toneTags: Object.entries(frequencies(tones))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([value]) => value),
    dialogueTraits: Object.entries(frequencies(dialogueTraits))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([value]) => value),
    themes: Object.entries(frequencies(themes))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([value]) => value),
    productionProfile: {
      locationFrequency: frequencies(locations),
      largeScaleElements: dedupe(largeScaleElements),
      castNotes: dedupe(castNotes),
    },
    objectiveMetadata: metadata,
  };
  return ReducedScreenplaySchema.parse(compactToBudget(result, options.maximumTokens ?? 6_000));
}
