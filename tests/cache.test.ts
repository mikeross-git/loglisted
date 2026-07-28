import { describe, expect, it } from "vitest";
import { validChunkSummary } from "../fixtures/llm-fixtures.js";
import {
  buildCacheKey,
  VersionedCache,
  VersionedSummaryCache,
  type CacheKeyContext,
} from "../src/lib/cache.js";
import { MemoryCacheStore } from "../src/lib/storage/memory-cache-store.js";
import { versions } from "../src/lib/version.js";
import { z } from "zod";

const fileHash = "a".repeat(64);
const context: CacheKeyContext = {
  fileHash,
  summaryModel: "summary-model",
  scoringModel: "scoring-model",
};

describe("versioned cache", () => {
  it("stores and retrieves each requested cache stage with configurable TTLs", async () => {
    let now = 1_000;
    const store = new MemoryCacheStore(() => now);
    const cache = new VersionedCache(store, {
      pdfExtraction: 1,
      screenplayMetadata: 2,
      chunks: 2,
      chunkSummary: 2,
      reducedScreenplay: 2,
      representativeExcerpts: 2,
      finalScore: 2,
    });
    const schema = z.object({ marker: z.string() }).strict();
    for (const stage of [
      "pdf_extraction",
      "screenplay_metadata",
      "chunks",
      "chunk_summary",
      "reduced_screenplay",
      "representative_excerpts",
      "final_score",
    ] as const) {
      await cache.set(stage, context, schema, { marker: stage });
      await expect(cache.get(stage, context, schema)).resolves.toEqual({ marker: stage });
    }
    now += 1_001;
    await expect(cache.get("pdf_extraction", context, schema)).resolves.toBeNull();
    await expect(cache.get("final_score", context, schema)).resolves.toEqual({
      marker: "final_score",
    });
  });

  it("does not allow a raw PDF buffer to enter the cache", async () => {
    const cache = new VersionedCache(new MemoryCacheStore());
    await expect(
      cache.set("pdf_extraction", context, z.instanceof(Uint8Array), new Uint8Array([1, 2, 3])),
    ).rejects.toThrow(/Binary PDF data/);
  });

  it("invalidates the final result for every score-relevant version and model change", () => {
    const baseline = buildCacheKey("final_score", context);
    const variants: CacheKeyContext[] = [
      { ...context, fileHash: "b".repeat(64) },
      { ...context, parserVersion: `${versions.parserVersion}-changed` },
      { ...context, metadataVersion: `${versions.metadataVersion}-changed` },
      { ...context, chunkerVersion: `${versions.chunkerVersion}-changed` },
      { ...context, summaryPromptVersion: `${versions.summaryPromptVersion}-changed` },
      { ...context, reducerVersion: `${versions.reducerVersion}-changed` },
      { ...context, excerptSamplerVersion: `${versions.excerptSamplerVersion}-changed` },
      { ...context, rubricVersion: `${versions.rubricVersion}-changed` },
      { ...context, scoringPromptVersion: `${versions.scoringPromptVersion}-changed` },
      { ...context, summaryModel: "different-summary-model" },
      { ...context, scoringModel: "different-scoring-model" },
      { ...context, verificationModel: "verification-model" },
      { ...context, adjudicatorModel: "adjudicator-model" },
      { ...context, costConfigVersion: `${versions.costConfigVersion}-changed` },
    ];
    for (const variant of variants) {
      expect(buildCacheKey("final_score", variant)).not.toBe(baseline);
    }
  });

  it("only invalidates stages for versions relevant to that stage", () => {
    const baseline = buildCacheKey("screenplay_metadata", context);
    expect(
      buildCacheKey("screenplay_metadata", { ...context, scoringPromptVersion: "unrelated" }),
    ).toBe(baseline);
    expect(
      buildCacheKey("screenplay_metadata", { ...context, metadataVersion: "metadata-new" }),
    ).not.toBe(baseline);
  });

  it("reuses duplicate chunk summaries through the summarizer cache contract", async () => {
    const store = new MemoryCacheStore();
    const adapter = new VersionedSummaryCache(new VersionedCache(store), context);
    const summaryKey = "same-normalized-chunk:model:versions";
    await adapter.set(summaryKey, validChunkSummary);
    await expect(adapter.get(summaryKey)).resolves.toEqual(validChunkSummary);
    await expect(adapter.get(summaryKey)).resolves.toEqual(validChunkSummary);
  });

  it("reuses a completed scoring result", async () => {
    const cache = new VersionedCache(new MemoryCacheStore());
    const scoreSchema = z
      .object({
        overallScore: z.number(),
        categoryScores: z.record(z.string(), z.number()),
      })
      .strict();
    const result = { overallScore: 7.8, categoryScores: { premise: 8 } };
    const resultKey = await cache.set("final_score", context, scoreSchema, result);
    expect(resultKey).toBe(buildCacheKey("final_score", context));
    await expect(cache.get("final_score", context, scoreSchema)).resolves.toEqual(result);
  });

  it("discards corrupt or schema-incompatible entries safely", async () => {
    const store = new MemoryCacheStore();
    const cache = new VersionedCache(store);
    const key = buildCacheKey("final_score", context);
    await store.set(key, '{"stage":"final_score","value":{"wrong":true}}', 100);
    await expect(
      cache.get("final_score", context, z.object({ score: z.number() }).strict()),
    ).resolves.toBeNull();
    await expect(store.get(key)).resolves.toBeNull();
  });
});
