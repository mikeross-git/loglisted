import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ParsedScreenplaySchema } from "../types/screenplay.js";
import type { ScriptBudget } from "./budget.js";
import { VersionedSummaryCache, type CacheKeyContext, type VersionedCache } from "./cache.js";
import { ScreenplayChunkSchema, chunkScreenplay } from "./chunker.js";
import { RepresentativeExcerptSchema, sampleRepresentativeExcerpts } from "./excerpt-sampler.js";
import type { LlmProvider } from "./llm/provider.js";
import type { ModelPricingConfig } from "./model-pricing.js";
import { parseScreenplay } from "./parser.js";
import { extractPdf, type PdfExtractionOptions } from "./pdf.js";
import { ReducedScreenplaySchema, reduceScreenplaySummaries } from "./reducer.js";
import type { ResultTokenManager } from "./result-token.js";
import { scoreScreenplay } from "./scorer.js";
import type { ProcessingLock, ScoringConfiguration } from "./storage/processing-lock.js";
import type { ResultStore, StoredResult } from "./storage/result-store.js";
import { StoredResultSchema } from "./storage/result-store.js";
import { summarizeChunks } from "./summarizer.js";
import type { UploadTokenClaims } from "./upload-token.js";
import { redactTitlePagePii } from "./ai-data-policy.js";
import type { DeletionTokenManager } from "./deletion-token.js";

const PdfResultSchema = z
  .object({
    fileHash: z.string(),
    fileSize: z.number(),
    pageCount: z.number(),
    extractedText: z.string(),
    textByPage: z.array(z.string()),
    textLength: z.number(),
    textDensityByPage: z.array(z.number()),
    warnings: z.array(z.string()),
  })
  .strict();

export interface AnalyzePipelineDependencies {
  cache: VersionedCache;
  processingLock: ProcessingLock;
  results: ResultStore;
  resultTokens: ResultTokenManager;
  deletionTokens: DeletionTokenManager;
  provider: LlmProvider;
  pricing: ModelPricingConfig;
  createBudget: () => ScriptBudget;
  summaryModel: string;
  scoringModel: string;
  llmConcurrency?: number;
  summaryOutputTokens?: number;
  scoringInputTokens?: number;
  scoringOutputTokens?: number;
  timeoutMs?: number;
  resultTtlSeconds?: number;
  pdfExtractionOptions?: PdfExtractionOptions;
  representativeExcerptTokenBudget?: number;
  onProcessingStage?: (stage: AnalyzePipelineStage) => void;
}

export type AnalyzePipelineStage =
  | "pdf_extraction"
  | "pii_redaction"
  | "metadata_cache"
  | "screenplay_parsing"
  | "chunk_cache"
  | "chunking"
  | "summarization"
  | "reduction"
  | "excerpt_sampling"
  | "scoring"
  | "result_persistence";

export interface AnalyzePipelineResult {
  result: StoredResult;
  resultAccessToken: string;
  deletionToken: string;
  reused: boolean;
}

export async function analyzeScreenplay(
  pdfBuffer: Uint8Array,
  claims: UploadTokenClaims,
  dependencies: AnalyzePipelineDependencies,
): Promise<AnalyzePipelineResult> {
  const scoringConfiguration: ScoringConfiguration = {
    summaryModel: dependencies.summaryModel,
    scoringModel: dependencies.scoringModel,
  };
  const lockResult = await dependencies.processingLock.run(
    claims.fileHash,
    scoringConfiguration,
    async () => {
      const context: CacheKeyContext = {
        fileHash: claims.fileHash,
        summaryModel: dependencies.summaryModel,
        scoringModel: dependencies.scoringModel,
      };
      dependencies.onProcessingStage?.("pdf_extraction");
      const pdf = PdfResultSchema.parse(
        await extractPdf(
          pdfBuffer,
          "screenplay.pdf",
          claims.mimeType,
          dependencies.pdfExtractionOptions,
        ),
      );
      dependencies.onProcessingStage?.("pii_redaction");
      const redacted = redactTitlePagePii(pdf.extractedText, pdf.textByPage);
      dependencies.onProcessingStage?.("metadata_cache");
      let screenplay = await dependencies.cache.get(
        "screenplay_metadata",
        context,
        ParsedScreenplaySchema,
      );
      if (!screenplay) {
        dependencies.onProcessingStage?.("screenplay_parsing");
        screenplay = parseScreenplay({
          extractedText: redacted.redactedModelText,
          textByPage: redacted.redactedTextByPage,
          pageCount: pdf.pageCount,
        });
        screenplay = {
          ...screenplay,
          objective: {
            ...screenplay.objective,
            titlePageContactDetected: redacted.titlePageContactDetected,
          },
        };
        await dependencies.cache.set(
          "screenplay_metadata",
          context,
          ParsedScreenplaySchema,
          screenplay,
        );
      }
      const ChunksSchema = z.array(ScreenplayChunkSchema);
      dependencies.onProcessingStage?.("chunk_cache");
      let chunks = await dependencies.cache.get("chunks", context, ChunksSchema);
      if (!chunks) {
        dependencies.onProcessingStage?.("chunking");
        chunks = chunkScreenplay(screenplay);
        await dependencies.cache.set("chunks", context, ChunksSchema, chunks);
      }
      const budget = dependencies.createBudget();
      dependencies.onProcessingStage?.("summarization");
      const summaries = await summarizeChunks(chunks, {
        provider: dependencies.provider,
        pricing: dependencies.pricing,
        budget,
        cache: new VersionedSummaryCache(dependencies.cache, context),
        model: dependencies.summaryModel,
        concurrency: dependencies.llmConcurrency ?? 3,
        maximumOutputTokens: dependencies.summaryOutputTokens ?? 350,
        timeoutMs: dependencies.timeoutMs ?? 45_000,
      });
      let reduced = await dependencies.cache.get(
        "reduced_screenplay",
        context,
        ReducedScreenplaySchema,
      );
      if (!reduced) {
        dependencies.onProcessingStage?.("reduction");
        reduced = reduceScreenplaySummaries(summaries, screenplay.objective, {
          format: screenplay.inferred.detectedFormat.value,
        });
        await dependencies.cache.set(
          "reduced_screenplay",
          context,
          ReducedScreenplaySchema,
          reduced,
        );
      }
      const ExcerptsSchema = z.array(RepresentativeExcerptSchema);
      dependencies.onProcessingStage?.("excerpt_sampling");
      const excerpts = ExcerptsSchema.parse(
        sampleRepresentativeExcerpts(screenplay, {
          maximumTokens: dependencies.representativeExcerptTokenBudget ?? 4_000,
        }),
      );
      dependencies.onProcessingStage?.("scoring");
      const score = await scoreScreenplay(reduced, screenplay.objective, excerpts, {
        provider: dependencies.provider,
        pricing: dependencies.pricing,
        budget,
        model: dependencies.scoringModel,
        summaryModel: dependencies.summaryModel,
        maximumInputTokens: dependencies.scoringInputTokens ?? 12_000,
        maximumOutputTokens: dependencies.scoringOutputTokens ?? 350,
        timeoutMs: dependencies.timeoutMs ?? 45_000,
        fileHash: claims.fileHash,
      });
      const result: StoredResult = {
        resultId: randomUUID(),
        anonymousSessionId: claims.anonymousSessionId,
        fileHash: claims.fileHash,
        projectTitle: claims.projectTitle,
        declaredFormat: claims.declaredFormat,
        declaredGenre: claims.primaryGenre,
        categoryScores: score.public.categoryScores,
        overallScore: score.public.overallScore,
        completedAt: new Date().toISOString(),
        internal: {
          versions: score.versions,
          inputTokens: budget.usage().inputTokens,
          outputTokens: budget.usage().outputTokens,
          estimatedCostUsd: budget.usage().actualCostUsd,
          approvedMetadata: screenplay.objective,
          ...(claims.logline ? { submissionLogline: claims.logline } : {}),
          ...(claims.firstName && claims.lastName && claims.email
            ? {
                submissionContact: {
                  firstName: claims.firstName,
                  lastName: claims.lastName,
                  email: claims.email,
                  ...(claims.imdbUrl ? { imdbUrl: claims.imdbUrl } : {}),
                },
              }
            : {}),
          ...(score.evaluationMode ? { evaluationMode: score.evaluationMode } : {}),
          consent: {
            aiProcessingPolicyVersion: claims.aiProcessingPolicyVersion,
            privacyNoticeVersion: claims.privacyNoticeVersion,
            confirmedAt: new Date(claims.aiProcessingConfirmedAt * 1_000).toISOString(),
          },
        },
      };
      StoredResultSchema.parse(result);
      dependencies.onProcessingStage?.("result_persistence");
      await dependencies.results.put(result, dependencies.resultTtlSeconds ?? 30 * 86_400);
      await dependencies.cache.set("final_score", context, StoredResultSchema, result);
      return { value: result, resultKey: result.resultId };
    },
  );

  let result: StoredResult;
  let reused = false;
  if ("value" in lockResult) {
    result = lockResult.value;
  } else if (lockResult.outcome === "completed") {
    const stored = await dependencies.results.get(lockResult.resultKey);
    if (!stored) throw new Error("Completed processing result is unavailable.");
    result = {
      ...stored,
      resultId: randomUUID(),
      anonymousSessionId: claims.anonymousSessionId,
      projectTitle: claims.projectTitle,
      declaredFormat: claims.declaredFormat,
      declaredGenre: claims.primaryGenre,
      completedAt: new Date().toISOString(),
      internal: {
        ...stored.internal,
        ...(claims.logline
          ? { submissionLogline: claims.logline }
          : { submissionLogline: undefined }),
        ...(claims.firstName && claims.lastName && claims.email
          ? {
              submissionContact: {
                firstName: claims.firstName,
                lastName: claims.lastName,
                email: claims.email,
                ...(claims.imdbUrl ? { imdbUrl: claims.imdbUrl } : {}),
              },
            }
          : { submissionContact: undefined }),
      },
    };
    await dependencies.results.put(result, dependencies.resultTtlSeconds ?? 30 * 86_400);
    reused = true;
  } else {
    throw new Error("Equivalent screenplay processing is already active or failed.");
  }
  const access = dependencies.resultTokens.issue(result.resultId, claims.anonymousSessionId);
  const deletionToken = dependencies.deletionTokens.issue(
    result.resultId,
    claims.anonymousSessionId,
  );
  return { result, resultAccessToken: access.token, deletionToken, reused };
}
