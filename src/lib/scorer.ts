import { z } from "zod";
import { ObjectiveMetadataSchema, type ObjectiveMetadata } from "../types/screenplay.js";
import type { ScriptBudget } from "./budget.js";
import { estimateTokens } from "./chunker.js";
import { calculateCost, calculateProjectedCost } from "./cost.js";
import type { CostBreakdown, TokenUsage } from "./cost.js";
import { RepresentativeExcerptSchema, type RepresentativeExcerpt } from "./excerpt-sampler.js";
import type { LlmProvider } from "./llm/provider.js";
import { LlmFailureError } from "./errors.js";
import type { ModelPricingConfig } from "./model-pricing.js";
import { FINAL_SCORING_SYSTEM_PROMPT } from "./prompts/final-scoring.js";
import { ReducedScreenplaySchema, type ReducedScreenplay } from "./reducer.js";
import { scoringAnchors, screenplayRubric } from "./rubric.js";
import { versions } from "./version.js";
import { assertMinimizedLlmPayload } from "./ai-data-policy.js";

const CategoryScoreSchema = z.number().min(1).max(10);

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
  internal: FinalModelScore & { overallScore: number };
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
}

export function calculateOverallScore(scores: FinalModelScore["categoryScores"]): number {
  const values = Object.values(scores);
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundOne(value: number): number {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

export function buildScoringPayload(
  representationInput: ReducedScreenplay,
  metadataInput: ObjectiveMetadata,
  excerptsInput: readonly RepresentativeExcerpt[],
): unknown {
  return {
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
  const payload = buildScoringPayload(representation, metadata, excerpts);
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
      schema: FinalModelScoreSchema,
      maximumOutputTokens: options.maximumOutputTokens,
      timeoutMs: options.timeoutMs,
      temperature: 0,
      seed: 1,
      ...(options.fileHash ? { context: { fileHash: options.fileHash } } : {}),
    });
    const cost = calculateCost(options.pricing, options.model, response.usage);
    await options.budget.reconcile(reservation, response.usage, cost);
    if (response.output.confidence < (options.minimumConfidence ?? 0.5)) {
      throw new LlmFailureError("Scoring confidence was below the required threshold.", {
        details: { confidence: response.output.confidence },
      });
    }
    const overallScore = calculateOverallScore(response.output.categoryScores);
    const publicCategoryScores = Object.fromEntries(
      Object.entries(response.output.categoryScores).map(([key, value]) => [key, roundOne(value)]),
    ) as FinalModelScore["categoryScores"];
    return {
      ...(options.provider.name === "mock" ? { evaluationMode: "mock" as const } : {}),
      internal: { ...response.output, overallScore },
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
