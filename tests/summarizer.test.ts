import { describe, expect, it } from "vitest";
import { makeChunk, testPricing, validChunkSummary } from "../fixtures/llm-fixtures.js";
import { ScriptBudget } from "../src/lib/budget.js";
import { CostBudgetError } from "../src/lib/errors.js";
import { FakeLlmProvider } from "../src/lib/llm/provider.js";
import { parseModelPricing } from "../src/lib/model-pricing.js";
import {
  ChunkSummarySchema,
  InMemorySummaryCache,
  normalizedChunkHash,
  summarizeChunks,
} from "../src/lib/summarizer.js";

const pricing = parseModelPricing(testPricing);

function budget(maximumCostUsd = 1): ScriptBudget {
  return new ScriptBudget({
    maximumInputTokens: 100_000,
    maximumOutputTokens: 10_000,
    maximumCostUsd,
  });
}

function options(provider: FakeLlmProvider, cache = new InMemorySummaryCache()) {
  return {
    provider,
    pricing,
    budget: budget(),
    cache,
    model: "test-summary",
    concurrency: 2,
    maximumOutputTokens: 350,
    timeoutMs: 1_000,
  };
}

describe("chunk summarizer", () => {
  it("validates the required strict summary structure", () => {
    expect(ChunkSummarySchema.parse(validChunkSummary)).toEqual(validChunkSummary);
    expect(ChunkSummarySchema.safeParse({ ...validChunkSummary, score: 8 }).success).toBe(false);
    expect(
      ChunkSummarySchema.safeParse({
        ...validChunkSummary,
        events: Array.from({ length: 7 }, () => "event"),
      }).success,
    ).toBe(false);
  });

  it("summarizes chunks concurrently and preserves input order", async () => {
    let active = 0;
    let maximumActive = 0;
    const provider = new FakeLlmProvider(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return validChunkSummary;
    });
    const result = await summarizeChunks(
      [makeChunk(0), makeChunk(1), makeChunk(2)],
      options(provider),
    );
    expect(maximumActive).toBe(2);
    expect(result.map((item) => item.chunkIndex)).toEqual([0, 1, 2]);
    expect(result.every((item) => item.cost.totalCostUsd > 0)).toBe(true);
    expect(result.every((item) => item.usage.inputTokens > 0)).toBe(true);
  });

  it("caches by normalized text and model/version dimensions", async () => {
    const provider = new FakeLlmProvider(() => validChunkSummary);
    const cache = new InMemorySummaryCache();
    const first = await summarizeChunks([makeChunk(0, "INT. ROOM - DAY\nALEX speaks.")], {
      ...options(provider, cache),
      budget: budget(),
    });
    const second = await summarizeChunks([makeChunk(0, " INT. ROOM - DAY   ALEX speaks. ")], {
      ...options(provider, cache),
      budget: budget(),
    });
    expect(first[0]?.cacheHit).toBe(false);
    expect(second[0]?.cacheHit).toBe(true);
    expect(provider.requests).toHaveLength(1);
    expect(normalizedChunkHash("a  b")).toBe(normalizedChunkHash(" a b "));
  });

  it("retries malformed structured output once through the provider", async () => {
    const provider = new FakeLlmProvider((_request, attempt) =>
      attempt === 1 ? "{bad json" : validChunkSummary,
    );
    const result = await summarizeChunks([makeChunk(0)], options(provider));
    expect(result[0]?.summary).toEqual(validChunkSummary);
  });

  it("stops before a call when the projected per-script cost exceeds budget", async () => {
    const provider = new FakeLlmProvider(() => validChunkSummary);
    const constrained = {
      ...options(provider),
      budget: budget(0.000001),
    };
    await expect(summarizeChunks([makeChunk(0)], constrained)).rejects.toBeInstanceOf(
      CostBudgetError,
    );
    expect(provider.requests).toHaveLength(0);
  });

  it("never places operational metadata into the system prompt", async () => {
    const provider = new FakeLlmProvider(() => validChunkSummary);
    await summarizeChunks([makeChunk(0)], options(provider));
    const prompt = provider.requests[0]?.systemPrompt ?? "";
    expect(prompt).not.toMatch(/ip address|risk score|writer identity/i);
    expect(prompt).toContain("Do not assign scores");
  });
});
