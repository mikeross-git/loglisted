import { createHash } from "node:crypto";
import { z } from "zod";
import type { ScreenplayChunk } from "./chunker.js";
import { estimateTokens } from "./chunker.js";
import type { ScriptBudget } from "./budget.js";
import { calculateCost, calculateProjectedCost } from "./cost.js";
import type { CostBreakdown, TokenUsage } from "./cost.js";
import type { LlmProvider } from "./llm/provider.js";
import type { ModelPricingConfig } from "./model-pricing.js";
import { CHUNK_SUMMARY_SYSTEM_PROMPT } from "./prompts/chunk-summary.js";
import { versions } from "./version.js";
import { assertMinimizedLlmPayload } from "./ai-data-policy.js";

const maximumWords = (maximum: number) =>
  z.string().refine((value) => value.trim().split(/\s+/).filter(Boolean).length <= maximum, {
    message: `Must contain no more than ${maximum} words.`,
  });

export const ChunkSummarySchema = z
  .object({
    events: z.array(maximumWords(24)).max(6),
    characterChanges: z
      .array(
        z
          .object({
            character: z.string().min(1).max(100),
            change: maximumWords(20),
          })
          .strict(),
      )
      .max(12),
    conflicts: z.array(maximumWords(24)).max(3),
    setupPayoff: z.array(maximumWords(24)).max(3),
    toneTags: z.array(maximumWords(4)).max(5),
    dialogueTraits: z.array(maximumWords(4)).max(5),
    themes: z.array(maximumWords(4)).max(3),
    productionElements: z
      .object({
        locations: z.array(maximumWords(8)).max(12),
        largeScaleElements: z.array(maximumWords(10)).max(8),
        castNotes: z.array(maximumWords(10)).max(8),
      })
      .strict(),
  })
  .strict()
  .refine(
    (summary) => JSON.stringify(summary).split(/\s+/).length < 250,
    "Summary must remain below 250 words.",
  );

export type ChunkSummary = z.infer<typeof ChunkSummarySchema>;

export interface SummarizedChunk {
  chunkIndex: number;
  pageStart: number;
  pageEnd: number;
  sceneIds: string[];
  act: string | null;
  summary: ChunkSummary;
  usage: TokenUsage;
  cost: CostBreakdown;
  latencyMs: number;
  providerRequestId?: string;
  cacheHit: boolean;
}

export interface SummaryCache {
  get(key: string): Promise<ChunkSummary | null>;
  set(key: string, value: ChunkSummary): Promise<void>;
}

export class InMemorySummaryCache implements SummaryCache {
  private readonly values = new Map<string, ChunkSummary>();
  get(key: string): Promise<ChunkSummary | null> {
    return Promise.resolve(this.values.get(key) ?? null);
  }
  set(key: string, value: ChunkSummary): Promise<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }
}

export interface SummarizerOptions {
  provider: LlmProvider;
  pricing: ModelPricingConfig;
  budget: ScriptBudget;
  cache: SummaryCache;
  model: string;
  concurrency: number;
  maximumOutputTokens: number;
  timeoutMs: number;
}

export function normalizedChunkHash(rawText: string): string {
  const normalized = rawText.normalize("NFKC").replace(/\s+/g, " ").trim();
  return createHash("sha256").update(normalized).digest("hex");
}

export function summaryCacheKey(chunk: ScreenplayChunk, model: string): string {
  return [
    "summary",
    normalizedChunkHash(chunk.rawText),
    model,
    versions.summaryPromptVersion,
    versions.parserVersion,
    versions.chunkerVersion,
  ].join(":");
}

function emptyCost(model: string): CostBreakdown {
  return {
    model,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    inputCostUsd: 0,
    cachedInputCostUsd: 0,
    outputCostUsd: 0,
    totalCostUsd: 0,
  };
}

async function summarizeOne(
  chunk: ScreenplayChunk,
  options: SummarizerOptions,
): Promise<SummarizedChunk> {
  const cacheKey = summaryCacheKey(chunk, options.model);
  const cached = await options.cache.get(cacheKey);
  if (cached) {
    return {
      chunkIndex: chunk.chunkIndex,
      pageStart: chunk.pageStart,
      pageEnd: chunk.pageEnd,
      sceneIds: chunk.sceneIds,
      act: chunk.act,
      summary: cached,
      usage: { inputTokens: 0, outputTokens: 0 },
      cost: emptyCost(options.model),
      latencyMs: 0,
      cacheHit: true,
    };
  }

  const payload = {
    chunkIndex: chunk.chunkIndex,
    pageStart: chunk.pageStart,
    pageEnd: chunk.pageEnd,
    sceneIds: chunk.sceneIds,
    act: chunk.act,
    excerpt: chunk.rawText,
  };
  const inputTokens = estimateTokens(`${CHUNK_SUMMARY_SYSTEM_PROMPT}\n${JSON.stringify(payload)}`);
  assertMinimizedLlmPayload(payload);
  const projected = calculateProjectedCost(
    options.pricing,
    options.model,
    inputTokens,
    options.maximumOutputTokens,
  );
  const reservation = await options.budget.reserve(projected);
  try {
    const response = await options.provider.generateStructured({
      model: options.model,
      systemPrompt: CHUNK_SUMMARY_SYSTEM_PROMPT,
      userPayload: payload,
      schemaName: "screenplay_chunk_summary",
      schema: ChunkSummarySchema,
      maximumOutputTokens: options.maximumOutputTokens,
      timeoutMs: options.timeoutMs,
      temperature: 0,
      seed: 1,
      context: {
        chunkIndex: chunk.chunkIndex,
        characterNames: chunk.characterNamesPresent,
        sceneHeadings: chunk.locationNamesPresent,
        act: chunk.act,
      },
    });
    const actual = calculateCost(options.pricing, options.model, response.usage);
    await options.budget.reconcile(reservation, response.usage, actual);
    await options.cache.set(cacheKey, response.output);
    return {
      chunkIndex: chunk.chunkIndex,
      pageStart: chunk.pageStart,
      pageEnd: chunk.pageEnd,
      sceneIds: chunk.sceneIds,
      act: chunk.act,
      summary: response.output,
      usage: response.usage,
      cost: actual,
      latencyMs: response.latencyMs,
      ...(response.providerRequestId ? { providerRequestId: response.providerRequestId } : {}),
      cacheHit: false,
    };
  } catch (error) {
    await options.budget.cancel(reservation);
    throw error;
  }
}

export async function summarizeChunks(
  chunks: readonly ScreenplayChunk[],
  options: SummarizerOptions,
): Promise<SummarizedChunk[]> {
  const concurrency = z.number().int().min(1).max(20).parse(options.concurrency);
  const output: (SummarizedChunk | undefined)[] = Array.from({ length: chunks.length });
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, chunks.length) }, async () => {
    while (nextIndex < chunks.length) {
      const index = nextIndex++;
      const chunk = chunks[index];
      if (chunk) output[index] = await summarizeOne(chunk, options);
    }
  });
  await Promise.all(workers);
  return output.map((item) => {
    if (!item) throw new Error("Summary worker did not produce an output.");
    return item;
  });
}
