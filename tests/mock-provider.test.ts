import { describe, expect, it } from "vitest";
import { ChunkSummarySchema } from "../src/lib/summarizer.js";
import { FinalModelScoreSchema } from "../src/lib/scorer.js";
import { LlmFailureError } from "../src/lib/errors.js";
import { loadConfig } from "../src/lib/config.js";
import { createLlmProvider } from "../src/lib/llm/factory.js";
import { MockLlmProvider } from "../src/lib/llm/mock.js";

const summaryRequest = {
  model: "mock-summary",
  systemPrompt: "fixture prompt",
  userPayload: {
    chunkIndex: 2,
    excerpt: "INT. LAB - NIGHT\nALEX\nWe found the signal.\nJORDAN\nThen the danger is real.",
    act: "ACT TWO",
  },
  schemaName: "screenplay_chunk_summary",
  schema: ChunkSummarySchema,
  maximumOutputTokens: 350,
  timeoutMs: 1_000,
  temperature: 0 as const,
  seed: 1,
  context: {
    fileHash: "a".repeat(64),
    chunkIndex: 2,
    characterNames: ["ALEX", "JORDAN"],
    sceneHeadings: ["INT. LAB - NIGHT"],
    act: "ACT TWO",
  },
};

const scoreRequest = {
  ...summaryRequest,
  model: "mock-score",
  userPayload: { compressedScreenplay: { format: "feature" } },
  schemaName: "screenplay_score",
  schema: FinalModelScoreSchema,
};

describe("mock LLM provider", () => {
  it("is selectable without an OpenAI key and blocked by default in production", () => {
    const base = {
      NODE_ENV: "test",
      PUBLIC_APP_ORIGIN: "https://site.example",
      API_ORIGIN: "https://api.example",
      CORS_ALLOWED_ORIGINS: "https://site.example",
      SESSION_SIGNING_SECRET: "s".repeat(32),
      UPLOAD_TOKEN_SIGNING_SECRET: "u".repeat(32),
      TURNSTILE_SITE_KEY: "site",
      TURNSTILE_SECRET_KEY: "secret",
      TURNSTILE_EXPECTED_HOSTNAME: "site.example",
      TURNSTILE_EXPECTED_ACTION: "screenplay_upload",
      LLM_PROVIDER: "mock",
      SUMMARY_MODEL: "mock-summary",
      SCORING_MODEL: "mock-score",
      MODEL_PRICING_JSON:
        '{"models":{"mock-summary":{"inputPerMillion":0.1,"outputPerMillion":0.2,"cachedInputPerMillion":0},"mock-score":{"inputPerMillion":0.2,"outputPerMillion":0.4,"cachedInputPerMillion":0}}}',
    };
    expect(createLlmProvider(loadConfig(base)).name).toBe("mock");
    expect(() =>
      loadConfig({
        ...base,
        NODE_ENV: "production",
        DEVICE_HMAC_SECRET: "d".repeat(32),
        CSRF_SIGNING_SECRET: "c".repeat(32),
        IP_HMAC_SECRET: "i".repeat(32),
        RESULT_TOKEN_SIGNING_SECRET: "r".repeat(32),
      }),
    ).toThrow();
  });
  it("returns deterministic structured summaries with simulated telemetry", async () => {
    const provider = new MockLlmProvider({ fixture: "successful_pilot", latencyMs: 12 });
    const first = await provider.generateStructured(summaryRequest);
    const second = await provider.generateStructured(summaryRequest);
    expect(first.output).toEqual(second.output);
    expect(first.output.characterChanges.map((change) => change.character)).toEqual([
      "ALEX",
      "JORDAN",
    ]);
    expect(first.output.productionElements.locations).toContain("INT. LAB - NIGHT");
    expect(first.usage.inputTokens).toBeGreaterThan(0);
    expect(first.usage.outputTokens).toBeGreaterThan(0);
    expect(first.latencyMs).toBe(12);
    expect(first.providerRequestId).toMatch(/^mock-/);
  });

  it("keeps long real-world scene headings within the summary schema limits", async () => {
    const longHeading =
      "INT. THE EXTREMELY LARGE ABANDONED INDUSTRIAL WAREHOUSE BESIDE THE RIVER - NIGHT";
    const response = await new MockLlmProvider({
      fixture: "successful_pilot",
    }).generateStructured({
      ...summaryRequest,
      userPayload: {
        ...summaryRequest.userPayload,
        excerpt: `${longHeading}\nALEX\nWe should leave.`,
      },
      context: {
        ...summaryRequest.context,
        sceneHeadings: [longHeading],
      },
    });

    expect(ChunkSummarySchema.safeParse(response.output).success).toBe(true);
    expect(response.output.productionElements.locations[0]?.split(/\s+/)).toHaveLength(8);
  });

  it("returns stable file-hash-based scores and named score fixtures", async () => {
    const feature = new MockLlmProvider({ fixture: "successful_feature" });
    const first = await feature.generateStructured(scoreRequest);
    const second = await feature.generateStructured(scoreRequest);
    expect(first.output).toEqual(second.output);
    const high = await new MockLlmProvider({ fixture: "high_score" }).generateStructured(
      scoreRequest,
    );
    expect(high.output.categoryScores.premise).toBeGreaterThan(9);
    const low = await new MockLlmProvider({ fixture: "low_confidence" }).generateStructured(
      scoreRequest,
    );
    expect(low.output.confidence).toBe(0.2);
  });

  it("repairs malformed summary output with exactly one retry", async () => {
    const response = await new MockLlmProvider({
      fixture: "malformed_summary_once",
    }).generateStructured(summaryRequest);
    expect(response.attempts).toBe(2);
  });

  it("repairs malformed scoring output with exactly one retry", async () => {
    const response = await new MockLlmProvider({
      fixture: "malformed_score_once",
    }).generateStructured(scoreRequest);
    expect(response.attempts).toBe(2);
  });

  it.each(["provider_timeout", "provider_failure"] as const)(
    "injects normalized %s failures without network calls",
    async (fixture) => {
      await expect(
        new MockLlmProvider({ fixture }).generateStructured(summaryRequest),
      ).rejects.toBeInstanceOf(LlmFailureError);
    },
  );

  it("injects excessive actual usage for budget-limit testing", async () => {
    const response = await new MockLlmProvider({
      fixture: "cost_limit_exceeded",
    }).generateStructured(summaryRequest);
    expect(response.usage.inputTokens).toBeGreaterThan(1_000_000);
  });
});
