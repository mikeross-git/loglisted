import { describe, expect, it } from "vitest";
import { makeSummarizedChunk, objectiveMetadata, testPricing } from "../fixtures/llm-fixtures.js";
import { ScriptBudget } from "../src/lib/budget.js";
import { LlmFailureError } from "../src/lib/errors.js";
import { FakeLlmProvider } from "../src/lib/llm/provider.js";
import { parseModelPricing } from "../src/lib/model-pricing.js";
import { reduceScreenplaySummaries } from "../src/lib/reducer.js";
import {
  buildScoringPayload,
  calculateOverallScore,
  FinalModelScoreSchema,
  scoreScreenplay,
} from "../src/lib/scorer.js";

const pricing = parseModelPricing(testPricing);
const representation = reduceScreenplaySummaries(
  [makeSummarizedChunk(0), makeSummarizedChunk(1)],
  objectiveMetadata,
  { format: "feature" },
);
const categoryScores = {
  premise: 7.14,
  story: 7.25,
  structure: 7.36,
  characters: 7.47,
  dialogue: 7.58,
  pacing: 7.69,
  theme: 7.71,
  tone: 7.82,
  marketability: 7.93,
  craft: 8.04,
};

function budget(): ScriptBudget {
  return new ScriptBudget({
    maximumInputTokens: 100_000,
    maximumOutputTokens: 10_000,
    maximumCostUsd: 1,
  });
}

function options(provider: FakeLlmProvider) {
  return {
    provider,
    pricing,
    budget: budget(),
    model: "test-score",
    maximumInputTokens: 12_000,
    maximumOutputTokens: 350,
    timeoutMs: 1_000,
  };
}

describe("final screenplay scorer", () => {
  it.each([
    ["malformed JSON", "{broken"],
    ["missing categories", { categoryScores: { premise: 7 }, confidence: 0.8 }],
    ["out-of-range score", { categoryScores: { ...categoryScores, craft: 11 }, confidence: 0.8 }],
  ])("rejects %s after one structured-output retry", async (_name, response) => {
    const provider = new FakeLlmProvider(() => response);
    await expect(
      scoreScreenplay(representation, objectiveMetadata, [], options(provider)),
    ).rejects.toBeInstanceOf(LlmFailureError);
  });

  it("calculates the arithmetic mean locally and rounds only public values", async () => {
    const provider = new FakeLlmProvider(() => ({ categoryScores, confidence: 0.876 }));
    const result = await scoreScreenplay(representation, objectiveMetadata, [], options(provider));
    const expected = Object.values(categoryScores).reduce((sum, score) => sum + score, 0) / 10;
    expect(result.internal.overallScore).toBe(expected);
    expect(result.public.overallScore).toBe(Math.round(expected * 10) / 10);
    expect(result.internal.categoryScores.premise).toBe(7.14);
    expect(result.public.categoryScores.premise).toBe(7.1);
    expect(result.public.confidence).toBe(0.9);
    expect(result.versions.scoringModel).toBe("test-score");
    expect(result.versions.summaryPromptVersion).toBeTruthy();
  });

  it("fails explicitly rather than returning a low-confidence score", async () => {
    const provider = new FakeLlmProvider(() => ({ categoryScores, confidence: 0.2 }));
    await expect(
      scoreScreenplay(representation, objectiveMetadata, [], options(provider)),
    ).rejects.toBeInstanceOf(LlmFailureError);
  });

  it("does not accept an overall score from the model", () => {
    expect(
      FinalModelScoreSchema.safeParse({
        categoryScores,
        confidence: 0.8,
        overallScore: 10,
      }).success,
    ).toBe(false);
    expect(calculateOverallScore(categoryScores)).toBeGreaterThan(1);
  });

  it("builds a prompt payload that excludes risk and identity metadata", () => {
    const payload = buildScoringPayload(representation, objectiveMetadata, []);
    const keys: string[] = [];
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(visit);
      } else if (typeof value === "object" && value !== null) {
        for (const [key, nested] of Object.entries(value)) {
          keys.push(key.toLowerCase());
          visit(nested);
        }
      }
    };
    visit(payload);
    expect(keys).not.toContain("riskscore");
    expect(keys).not.toContain("writeridentity");
    expect(keys).not.toContain("ipaddress");
    expect(keys).not.toContain("anonymoussession");
    expect(keys).not.toContain("deviceid");
    expect(keys).not.toContain("uploadhistory");
    expect(keys).not.toContain("previousexternalscores");
  });
});
