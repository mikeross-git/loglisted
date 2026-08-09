import { z } from "zod";
import { ObjectiveMetadataSchema, type ObjectiveMetadata } from "../types/screenplay.js";
import type { ScriptBudget } from "./budget.js";
import { estimateTokens } from "./chunker.js";
import { calculateCost, calculateProjectedCost } from "./cost.js";
import type { CostBreakdown, TokenUsage } from "./cost.js";
import { RepresentativeExcerptSchema, type RepresentativeExcerpt } from "./excerpt-sampler.js";
import type { LlmProvider, OpenAiReasoningEffort } from "./llm/provider.js";
import { LlmFailureError } from "./errors.js";
import type { ModelPricingConfig } from "./model-pricing.js";
import { FINAL_SCORING_SYSTEM_PROMPT } from "./prompts/final-scoring.js";
import { ReducedScreenplaySchema, type ReducedScreenplay } from "./reducer.js";
import { scoringAnchors, screenplayRubric } from "./rubric.js";
import { versions } from "./version.js";
import { assertMinimizedLlmPayload } from "./ai-data-policy.js";

const CategoryScoreSchema = z.number().min(1).max(10);

const CriterionScoreSchema = z.number().min(1).max(10);

export const CriterionScoresSchema = z
  .object({
    premise: z
      .object({
        originality: CriterionScoreSchema,
        clarity: CriterionScoreSchema,
        hook: CriterionScoreSchema,
        stakes: CriterionScoreSchema,
        commercialAppeal: CriterionScoreSchema,
      })
      .strict(),
    story: z
      .object({
        conflict: CriterionScoreSchema,
        escalation: CriterionScoreSchema,
        causality: CriterionScoreSchema,
        emotionalImpact: CriterionScoreSchema,
        resolution: CriterionScoreSchema,
      })
      .strict(),
    structure: z
      .object({
        opening: CriterionScoreSchema,
        plotProgression: CriterionScoreSchema,
        turningPoints: CriterionScoreSchema,
        climax: CriterionScoreSchema,
        sceneFlow: CriterionScoreSchema,
      })
      .strict(),
    characters: z
      .object({
        protagonist: CriterionScoreSchema,
        supportingCharacters: CriterionScoreSchema,
        characterArcs: CriterionScoreSchema,
        motivation: CriterionScoreSchema,
        relationships: CriterionScoreSchema,
      })
      .strict(),
    dialogue: z
      .object({
        naturalness: CriterionScoreSchema,
        subtext: CriterionScoreSchema,
        voice: CriterionScoreSchema,
        memorability: CriterionScoreSchema,
        efficiency: CriterionScoreSchema,
      })
      .strict(),
    pacing: z
      .object({
        momentum: CriterionScoreSchema,
        sceneRhythm: CriterionScoreSchema,
        narrativeBalance: CriterionScoreSchema,
        tensionManagement: CriterionScoreSchema,
        engagement: CriterionScoreSchema,
      })
      .strict(),
    theme: z
      .object({
        novelty: CriterionScoreSchema,
        clarity: CriterionScoreSchema,
        integration: CriterionScoreSchema,
        depth: CriterionScoreSchema,
        consistency: CriterionScoreSchema,
      })
      .strict(),
    tone: z
      .object({
        consistency: CriterionScoreSchema,
        genreAlignment: CriterionScoreSchema,
        emotionalAuthenticity: CriterionScoreSchema,
        atmosphere: CriterionScoreSchema,
        relatability: CriterionScoreSchema,
      })
      .strict(),
    marketability: z
      .object({
        audienceAppeal: CriterionScoreSchema,
        generalPositioning: CriterionScoreSchema,
        productionFeasibility: CriterionScoreSchema,
        distinctiveness: CriterionScoreSchema,
        franchisePotential: CriterionScoreSchema,
      })
      .strict(),
    craft: z
      .object({
        formatting: CriterionScoreSchema,
        grammar: CriterionScoreSchema,
        visualStorytelling: CriterionScoreSchema,
        clarityOfWriting: CriterionScoreSchema,
        economy: CriterionScoreSchema,
      })
      .strict(),
  })
  .strict();

export const CriterionModelScoreSchema = z
  .object({
    criterionScores: CriterionScoresSchema,
    confidence: z.number().min(0).max(1),
  })
  .strict();

export type CriterionScores = z.infer<typeof CriterionScoresSchema>;

export const FinalModelScoreSchema = z
  .object({
    categoryScores: z
      .object({
        premise: CategoryScoreSchema,
        story: CategoryScoreSchema,
        structure: CategoryScoreSchema,
        characters: CategoryScoreSchema,
        dialogue: CategoryScoreSchema,
        pacing: CategoryScoreSchema,
        theme: CategoryScoreSchema,
        tone: CategoryScoreSchema,
        marketability: CategoryScoreSchema,
        craft: CategoryScoreSchema,
      })
      .strict(),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export type FinalModelScore = z.infer<typeof FinalModelScoreSchema>;

export interface FinalScoreResult {
  evaluationMode?: "mock";
  internal: FinalModelScore & { overallScore: number; criterionScores: CriterionScores };
  public: {
    categoryScores: FinalModelScore["categoryScores"];
    overallScore: number;
    confidence: number;
  };
  usage: TokenUsage;
  cost: CostBreakdown;
  latencyMs: number;
  providerRequestId?: string;
  versions: {
    rubricVersion: string;
    scoringPromptVersion: string;
    parserVersion: string;
    metadataVersion: string;
    chunkerVersion: string;
    summaryPromptVersion: string;
    reducerVersion: string;
    excerptSamplerVersion: string;
    scoringModel: string;
    summaryModel?: string;
  };
}

export interface ScoreScreenplayOptions {
  provider: LlmProvider;
  pricing: ModelPricingConfig;
  budget: ScriptBudget;
  model: string;
  maximumInputTokens: number;
  maximumOutputTokens: number;
  timeoutMs: number;
  minimumConfidence?: number;
  summaryModel?: string;
  fileHash?: string;
  reasoningEffort?: OpenAiReasoningEffort;
  declaredFormat: string;
  declaredGenre: string;
}

const DeclaredScoringContextSchema = z
  .object({
    declaredFormat: z.string().trim().min(1).max(50),
    declaredGenre: z.string().trim().min(1).max(100),
  })
  .strict();

export type DeclaredScoringContext = z.infer<typeof DeclaredScoringContextSchema>;

export function calculateOverallScore(scores: FinalModelScore["categoryScores"]): number {
  const values = Object.values(scores);
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function calculateWeightedCategoryScores(
  criterionScores: CriterionScores,
): FinalModelScore["categoryScores"] {
  const criteria = criterionScores as Record<string, Record<string, number>>;
  const rubric = screenplayRubric as Record<string, Record<string, number>>;
  const weighted = Object.fromEntries(
    Object.entries(rubric).map(([category, weights]) => [
      category,
      Object.entries(weights).reduce(
        (total, [criterion, weight]) => total + criteria[category]![criterion]! * weight,
        0,
      ),
    ]),
  );
  return FinalModelScoreSchema.shape.categoryScores.parse(weighted);
}

function roundOne(value: number): number {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

export function buildScoringPayload(
  representationInput: ReducedScreenplay,
  metadataInput: ObjectiveMetadata,
  excerptsInput: readonly RepresentativeExcerpt[],
  declaredContextInput: DeclaredScoringContext,
): unknown {
  return {
    declaredProject: DeclaredScoringContextSchema.parse(declaredContextInput),
    compressedScreenplay: ReducedScreenplaySchema.parse(representationInput),
    deterministicMetadata: ObjectiveMetadataSchema.parse(metadataInput),
    representativeExcerpts: z.array(RepresentativeExcerptSchema).parse(excerptsInput),
    rubric: screenplayRubric,
    scoringAnchors,
  };
}

export async function scoreScreenplay(
  representation: ReducedScreenplay,
  metadata: ObjectiveMetadata,
  excerpts: readonly RepresentativeExcerpt[],
  options: ScoreScreenplayOptions,
): Promise<FinalScoreResult> {
  const payload = buildScoringPayload(representation, metadata, excerpts, {
    declaredFormat: options.declaredFormat,
    declaredGenre: options.declaredGenre,
  });
  assertMinimizedLlmPayload(payload);
  const estimatedInputTokens = estimateTokens(
    `${FINAL_SCORING_SYSTEM_PROMPT}\n${JSON.stringify(payload)}`,
  );
  if (estimatedInputTokens > options.maximumInputTokens) {
    throw new Error("Scoring evidence exceeds configured input token limit.");
  }
  const projected = calculateProjectedCost(
    options.pricing,
    options.model,
    estimatedInputTokens,
    options.maximumOutputTokens,
  );
  const reservation = await options.budget.reserve(projected);
  try {
    const response = await options.provider.generateStructured({
      model: options.model,
      systemPrompt: FINAL_SCORING_SYSTEM_PROMPT,
      userPayload: payload,
      schemaName: "screenplay_score",
      schema: CriterionModelScoreSchema,
      maximumOutputTokens: options.maximumOutputTokens,
      timeoutMs: options.timeoutMs,
      temperature: 0,
      seed: 1,
      ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
      ...(options.fileHash ? { context: { fileHash: options.fileHash } } : {}),
    });
    const cost = calculateCost(options.pricing, options.model, response.usage);
    await options.budget.reconcile(reservation, response.usage, cost);
    if (response.output.confidence < (options.minimumConfidence ?? 0.5)) {
      throw new LlmFailureError("Scoring confidence was below the required threshold.", {
        details: { confidence: response.output.confidence },
      });
    }
    const categoryScores = calculateWeightedCategoryScores(response.output.criterionScores);
    const overallScore = calculateOverallScore(categoryScores);
    const publicCategoryScores = Object.fromEntries(
      Object.entries(categoryScores).map(([key, value]) => [key, roundOne(value)]),
    ) as FinalModelScore["categoryScores"];
    return {
      ...(options.provider.name === "mock" ? { evaluationMode: "mock" as const } : {}),
      internal: {
        categoryScores,
        criterionScores: response.output.criterionScores,
        confidence: response.output.confidence,
        overallScore,
      },
      public: {
        categoryScores: publicCategoryScores,
        overallScore: roundOne(overallScore),
        confidence: roundOne(response.output.confidence),
      },
      usage: response.usage,
      cost,
      latencyMs: response.latencyMs,
      ...(response.providerRequestId ? { providerRequestId: response.providerRequestId } : {}),
      versions: {
        rubricVersion: versions.rubricVersion,
        scoringPromptVersion: versions.scoringPromptVersion,
        parserVersion: versions.parserVersion,
        metadataVersion: versions.metadataVersion,
        chunkerVersion: versions.chunkerVersion,
        summaryPromptVersion: versions.summaryPromptVersion,
        reducerVersion: versions.reducerVersion,
        excerptSamplerVersion: versions.excerptSamplerVersion,
        scoringModel: options.model,
        ...(options.summaryModel ? { summaryModel: options.summaryModel } : {}),
      },
    };
  } catch (error) {
    await options.budget.cancel(reservation);
    throw error;
  }
}
