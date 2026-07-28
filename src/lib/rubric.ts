import { z } from "zod";

const WeightedCriteriaSchema = z
  .record(z.string(), z.number().positive())
  .refine(
    (criteria) =>
      Math.abs(Object.values(criteria).reduce((sum, value) => sum + value, 0) - 1) < 1e-9,
    "Rubric category weights must sum to 1.",
  );

export const ScreenplayRubricSchema = z
  .record(z.string(), WeightedCriteriaSchema)
  .refine((rubric) => Object.keys(rubric).length === 10, "Rubric must contain ten categories.");

export const screenplayRubric = ScreenplayRubricSchema.parse({
  premise: {
    originality: 0.25,
    clarity: 0.125,
    hook: 0.25,
    stakes: 0.125,
    commercialAppeal: 0.25,
  },
  story: {
    conflict: 0.25,
    escalation: 0.25,
    causality: 0.15,
    emotionalImpact: 0.15,
    resolution: 0.2,
  },
  structure: {
    opening: 0.25,
    plotProgression: 0.25,
    turningPoints: 0.15,
    climax: 0.25,
    sceneFlow: 0.1,
  },
  characters: {
    protagonist: 0.25,
    supportingCharacters: 0.25,
    characterArcs: 0.25,
    motivation: 0.125,
    relationships: 0.125,
  },
  dialogue: {
    naturalness: 0.15,
    subtext: 0.1,
    voice: 0.4,
    memorability: 0.25,
    efficiency: 0.1,
  },
  pacing: {
    momentum: 0.25,
    sceneRhythm: 0.15,
    narrativeBalance: 0.2,
    tensionManagement: 0.2,
    engagement: 0.2,
  },
  theme: {
    novelty: 0.25,
    clarity: 0.25,
    integration: 0.2,
    depth: 0.15,
    consistency: 0.15,
  },
  tone: {
    consistency: 0.25,
    genreAlignment: 0.1,
    emotionalAuthenticity: 0.2,
    atmosphere: 0.35,
    relatability: 0.1,
  },
  marketability: {
    audienceAppeal: 0.5,
    generalPositioning: 0.2,
    productionFeasibility: 0.1,
    distinctiveness: 0.1,
    franchisePotential: 0.1,
  },
  craft: {
    formatting: 0.25,
    grammar: 0.25,
    visualStorytelling: 0.2,
    clarityOfWriting: 0.2,
    economy: 0.1,
  },
});

export const scoringAnchors = Object.freeze({
  good: 7,
  sustainedProfessionalExecution: 8,
  outstandingProducedQuality: 9,
  extraordinarilyRareAbove: 9.5,
});
