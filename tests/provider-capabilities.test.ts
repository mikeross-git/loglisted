import { describe, expect, it } from "vitest";
import { z } from "zod";
import { OpenAiProvider } from "../src/lib/llm/openai.js";
import { ProviderPrivacyCapabilitiesSchema } from "../src/lib/llm/provider-capabilities.js";

describe("provider privacy capabilities", () => {
  it("validates explicit operator-supplied capabilities without inferring provider guarantees", () => {
    const provider = new OpenAiProvider({
      apiKey: "test",
      privacyCapabilities: {
        apiDataUsedForTrainingByDefault: "unknown",
        trainingOptOutConfigured: true,
        supportsZeroDataRetention: true,
        zeroDataRetentionEnabled: false,
        supportsModifiedAbuseMonitoring: true,
        modifiedAbuseMonitoringEnabled: false,
        statedRetentionDays: "unknown",
        supportsRegionalProcessing: false,
        configuredRegion: null,
        supportsRequestStorageControl: true,
        requestStorageDisabled: true,
      },
    });
    expect(
      ProviderPrivacyCapabilitiesSchema.parse(provider.privacyCapabilities("score-model")),
    ).toMatchObject({
      providerName: "openai",
      modelName: "score-model",
      trainingOptOutConfigured: true,
      statedRetentionDays: "unknown",
    });
  });

  it.each([
    "screenplay_chunk_summary",
    "screenplay_score",
    "screenplay_verification",
    "screenplay_adjudication",
  ])("sends store=false for %s requests", async (schemaName) => {
    let body: Record<string, unknown> = {};
    const provider = new OpenAiProvider({
      apiKey: "test",
      fetchImplementation: (_input, init) => {
        if (typeof init?.body !== "string") throw new Error("Expected a JSON request body.");
        body = JSON.parse(init.body) as Record<string, unknown>;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: "response-id",
              output_text: '{"ok":true}',
              usage: { input_tokens: 1, output_tokens: 1 },
            }),
          ),
        );
      },
    });
    await provider.generateStructured({
      model: "model",
      systemPrompt: "system",
      userPayload: { minimized: true },
      schemaName,
      schema: z.object({ ok: z.literal(true) }).strict(),
      maximumOutputTokens: 20,
      timeoutMs: 1_000,
      temperature: 0,
    });
    expect(body["store"]).toBe(false);
    expect(body).not.toHaveProperty("retention");
  });
});
