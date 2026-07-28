import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { FinalModelScoreSchema } from "../src/lib/scorer.js";
import {
  createStagingApp,
  createStagingProvider,
  isStagingOriginAllowed,
  stagingHealthStatus,
} from "../src/staging-server.js";
import {
  TURNSTILE_ALWAYS_PASS_TEST_SECRET,
  TURNSTILE_ALWAYS_PASS_TEST_SITE_KEY,
  loadStagingConfig,
} from "../src/staging-config.js";

function stagingEnvironment(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    APP_ENV: "staging",
    SCREENPLAY_SCORING_MODE: "mock",
    NODE_ENV: "test",
    PORT: "10000",
    HOST: "127.0.0.1",
    ALLOWED_ORIGINS: "http://localhost:5173,http://127.0.0.1:5173,https://preview.framer.website",
    MOCK_LLM_SCENARIO: "successful_pilot",
    DRY_RUN: "true",
    TURNSTILE_MODE: "test",
    TURNSTILE_SITE_KEY: TURNSTILE_ALWAYS_PASS_TEST_SITE_KEY,
    TURNSTILE_SECRET_KEY: TURNSTILE_ALWAYS_PASS_TEST_SECRET,
    TURNSTILE_EXPECTED_HOSTNAMES: "preview.framer.website",
    TURNSTILE_EXPECTED_ACTION: "screenplay_upload",
    SESSION_SIGNING_SECRET: "s".repeat(32),
    DEVICE_HMAC_SECRET: "d".repeat(32),
    CSRF_SIGNING_SECRET: "c".repeat(32),
    IP_HMAC_SECRET: "i".repeat(32),
    RESULT_TOKEN_SIGNING_SECRET: "r".repeat(32),
    DELETION_TOKEN_SIGNING_SECRET: "x".repeat(32),
    UPLOAD_TOKEN_SIGNING_SECRET: "u".repeat(32),
    ...overrides,
  };
}

describe("public mock staging safety", () => {
  it("returns deterministic mock scoring output", async () => {
    const config = loadStagingConfig(stagingEnvironment());
    const provider = createStagingProvider(config);
    const response = await provider.generateStructured({
      model: "mock-scoring",
      systemPrompt: "strict fixture scoring",
      userPayload: { compressedScreenplay: { format: "halfHourPilot" } },
      schemaName: "screenplay_score",
      schema: FinalModelScoreSchema,
      maximumOutputTokens: 350,
      timeoutMs: 1_000,
      temperature: 0,
      context: { fileHash: "a".repeat(64) },
    });
    expect(provider.name).toBe("mock");
    expect(response.output.categoryScores.premise).toBeGreaterThanOrEqual(1);
    expect(response.output.categoryScores.premise).toBeLessThanOrEqual(10);
    expect(response.dryRun).toBe(true);
  });

  it("never invokes a supplied production-provider factory", () => {
    const production = vi.fn(() => {
      throw new Error("Production provider must never be constructed.");
    });
    const provider = createStagingProvider(loadStagingConfig(stagingEnvironment()), {
      production,
    });
    expect(provider.name).toBe("mock");
    expect(production).not.toHaveBeenCalled();
  });

  it("fails closed when production scoring is requested", () => {
    expect(() =>
      loadStagingConfig(stagingEnvironment({ SCREENPLAY_SCORING_MODE: "production" })),
    ).toThrow("Invalid staging environment configuration");
  });

  it("preserves the localhost development scripts and mock configuration", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    const localEnvironment = await readFile(".env.local.example", "utf8");
    expect(packageJson.scripts["dev"]).toContain("dev:backend");
    expect(packageJson.scripts["dev:backend"]).toContain("src/dev-server.ts");
    expect(localEnvironment).toContain("APP_ENV=development");
    expect(localEnvironment).toContain("SCREENPLAY_SCORING_MODE=mock");
  });

  it("reports staging mock mode without exposing configuration secrets", () => {
    createStagingApp(loadStagingConfig(stagingEnvironment()));
    expect(stagingHealthStatus).toEqual({
      ok: true,
      environment: "staging",
      scoringMode: "mock",
    });
    expect(JSON.stringify(stagingHealthStatus)).not.toContain("ssss");
  });

  it.each(["http://localhost:5173", "https://preview.framer.website"])(
    "allows configured CORS origin %s",
    (origin) => {
      const config = loadStagingConfig(stagingEnvironment());
      expect(isStagingOriginAllowed(config, origin)).toBe(true);
    },
  );

  it("rejects an unlisted CORS origin", () => {
    const config = loadStagingConfig(stagingEnvironment());
    expect(isStagingOriginAllowed(config, "https://attacker.example")).toBe(false);
  });
});
