import { createHash } from "node:crypto";
import { LlmFailureError } from "../errors.js";
import { estimateTokens } from "../chunker.js";
import type { LlmProvider, StructuredOutputRequest, StructuredOutputResponse } from "./provider.js";
import { normalizeProviderError } from "./provider.js";
import type { ProviderPrivacyCapabilities } from "./provider-capabilities.js";

export const mockFixtureNames = [
  "successful_pilot",
  "successful_feature",
  "malformed_summary_once",
  "malformed_score_once",
  "provider_timeout",
  "provider_failure",
  "low_confidence",
  "high_score",
  "cost_limit_exceeded",
] as const;

export type MockFixtureName = (typeof mockFixtureNames)[number];

export interface MockLlmProviderOptions {
  fixture?: MockFixtureName;
  dryRun?: boolean;
  latencyMs?: number;
}

const stopWords = new Set([
  "about",
  "after",
  "again",
  "before",
  "could",
  "from",
  "have",
  "into",
  "their",
  "there",
  "these",
  "they",
  "this",
  "through",
  "with",
  "would",
]);

function payloadRecord(payload: unknown): Record<string, unknown> {
  return typeof payload === "object" && payload !== null
    ? (payload as Record<string, unknown>)
    : {};
}

function excerptFrom(request: StructuredOutputRequest<unknown>): string {
  const payload = payloadRecord(request.userPayload);
  return typeof payload["excerpt"] === "string" ? payload["excerpt"] : "";
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function chunkSummary(request: StructuredOutputRequest<unknown>): unknown {
  const excerpt = excerptFrom(request);
  const lines = excerpt.split(/\r?\n/).map((line) => line.trim());
  const headings = unique([
    ...(request.context?.sceneHeadings ?? []),
    ...lines.filter((line) => /^(?:INT\.?|EXT\.?|INT\.?\/EXT\.?|I\/E\.?)\s+/i.test(line)),
  ]).slice(0, 3);
  const characters = unique([
    ...(request.context?.characterNames ?? []),
    ...lines.filter(
      (line) =>
        /^[A-Z][A-Z0-9 .'\-()]{1,29}$/.test(line) && !/^(?:INT|EXT|ACT|FADE|CUT|THE)\b/.test(line),
    ),
  ]).slice(0, 6);
  const keywords = Object.entries(
    excerpt
      .toLowerCase()
      .match(/\b[a-z][a-z'-]{4,}\b/g)
      ?.filter((word) => !stopWords.has(word))
      .reduce<Record<string, number>>((counts, word) => {
        counts[word] = (counts[word] ?? 0) + 1;
        return counts;
      }, {}) ?? {},
  )
    .sort(([wordA, countA], [wordB, countB]) => countB - countA || wordA.localeCompare(wordB))
    .slice(0, 5)
    .map(([word]) => word);
  const chunkIndex =
    request.context?.chunkIndex ??
    (typeof payloadRecord(request.userPayload)["chunkIndex"] === "number"
      ? Number(payloadRecord(request.userPayload)["chunkIndex"])
      : 0);
  const rawAct = request.context?.act ?? payloadRecord(request.userPayload)["act"];
  const act = typeof rawAct === "string" || typeof rawAct === "number" ? String(rawAct) : undefined;
  return {
    events: [
      `Chunk ${chunkIndex} advances events${headings[0] ? ` at ${headings[0]}` : ""}.`,
      ...(keywords.length ? [`Recurring elements include ${keywords.join(", ")}.`] : []),
    ],
    characterChanges: characters.slice(0, 4).map((character, index) => ({
      character,
      change:
        index === 0
          ? `Acts on the central conflict in chunk ${chunkIndex}.`
          : `Responds to events in chunk ${chunkIndex}.`,
    })),
    conflicts: characters.length >= 2 ? [`${characters[0]} conflicts with ${characters[1]}.`] : [],
    setupPayoff: act ? [`${act} contains an unresolved story thread.`] : [],
    toneTags: keywords.slice(0, 3),
    dialogueTraits: characters.length ? ["character-specific", "concise"] : [],
    themes: keywords.slice(3, 5),
    productionElements: {
      locations: headings,
      largeScaleElements: keywords.filter((word) =>
        /battle|crash|explosion|crowd|chase|storm/.test(word),
      ),
      castNotes: characters.length ? [`${characters.length} speaking characters observed`] : [],
    },
  };
}

const scoreKeys = [
  "premise",
  "story",
  "structure",
  "characters",
  "dialogue",
  "pacing",
  "theme",
  "tone",
  "marketability",
  "craft",
] as const;

function scoringOutput(
  request: StructuredOutputRequest<unknown>,
  fixture: MockFixtureName,
): unknown {
  const stableInput =
    request.context?.fileHash ?? JSON.stringify(request.userPayload) ?? "mock-screenplay";
  const digest = createHash("sha256").update(stableInput).digest();
  const base =
    fixture === "high_score"
      ? 9.7
      : fixture === "successful_pilot"
        ? 7.2
        : fixture === "successful_feature"
          ? 7.6
          : 6.8;
  const categoryScores = Object.fromEntries(
    scoreKeys.map((key, index) => {
      const variation = ((digest[index] ?? 128) / 255 - 0.5) * 0.6;
      return [key, Math.max(1, Math.min(10, Math.round((base + variation) * 100) / 100))];
    }),
  );
  return {
    categoryScores,
    confidence: fixture === "low_confidence" ? 0.2 : 0.82,
  };
}

export class MockLlmProvider implements LlmProvider {
  readonly name = "mock";
  readonly requests: StructuredOutputRequest<unknown>[] = [];
  private readonly fixture: MockFixtureName;
  private readonly malformedConsumed = new Set<string>();

  constructor(private readonly options: MockLlmProviderOptions = {}) {
    this.fixture = options.fixture ?? "successful_feature";
  }

  privacyCapabilities(modelName: string): ProviderPrivacyCapabilities {
    return {
      providerName: this.name,
      modelName,
      apiDataUsedForTrainingByDefault: false,
      trainingOptOutConfigured: true,
      supportsZeroDataRetention: true,
      zeroDataRetentionEnabled: true,
      supportsModifiedAbuseMonitoring: false,
      modifiedAbuseMonitoringEnabled: false,
      statedRetentionDays: 0,
      supportsRegionalProcessing: true,
      configuredRegion: "local",
      supportsRequestStorageControl: true,
      requestStorageDisabled: true,
    };
  }

  async generateStructured<T>(
    request: StructuredOutputRequest<T>,
  ): Promise<StructuredOutputResponse<T>> {
    await Promise.resolve();
    this.requests.push(request);
    if (this.fixture === "provider_timeout") {
      throw new LlmFailureError("Mock provider timed out.", {
        details: { provider: this.name, timeoutMs: request.timeoutMs },
      });
    }
    if (this.fixture === "provider_failure") {
      throw new LlmFailureError("Mock provider failed.", {
        details: { provider: this.name },
      });
    }
    const started = performance.now();
    const isSummary = request.schemaName === "screenplay_chunk_summary";
    const malformedFixture =
      (isSummary && this.fixture === "malformed_summary_once") ||
      (!isSummary && this.fixture === "malformed_score_once");
    let lastError: unknown;
    for (const attempt of [1, 2] as const) {
      try {
        const malformedKey = `${request.schemaName}:${this.requests.length}`;
        let candidate: unknown;
        if (malformedFixture && !this.malformedConsumed.has(malformedKey)) {
          this.malformedConsumed.add(malformedKey);
          candidate = JSON.parse("{malformed");
        } else {
          candidate = isSummary ? chunkSummary(request) : scoringOutput(request, this.fixture);
        }
        const output = request.schema.parse(candidate);
        const inputTokens = estimateTokens(
          `${request.systemPrompt}\n${JSON.stringify(request.userPayload)}`,
        );
        const outputTokens = estimateTokens(JSON.stringify(output));
        const excessive = this.fixture === "cost_limit_exceeded" ? 10_000_000 : 0;
        return {
          model: request.model,
          output,
          usage: {
            inputTokens: inputTokens + excessive,
            outputTokens: outputTokens + excessive,
            cachedInputTokens: 0,
          },
          latencyMs: this.options.latencyMs ?? Math.max(1, performance.now() - started),
          providerRequestId: `mock-${createHash("sha256")
            .update(`${request.schemaName}:${this.requests.length}`)
            .digest("hex")
            .slice(0, 16)}`,
          attempts: attempt,
          dryRun: this.options.dryRun ?? false,
        };
      } catch (error) {
        lastError = error;
      }
    }
    throw normalizeProviderError(this.name, lastError);
  }
}
