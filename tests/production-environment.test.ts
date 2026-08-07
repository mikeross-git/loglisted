import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import type { LlmProvider } from "../src/lib/llm/provider.js";
import {
  createProductionProvider,
  isProductionOriginAllowed,
  loadProductionConfig,
  productionHealthStatus,
} from "../src/production-server.js";

function productionEnvironment(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  const pricing = {
    models: {
      "summary-canary": {
        inputPerMillion: 0.1,
        outputPerMillion: 0.4,
        cachedInputPerMillion: 0.05,
      },
      "scoring-canary": {
        inputPerMillion: 0.2,
        outputPerMillion: 0.8,
        cachedInputPerMillion: 0.1,
      },
    },
  };
  return {
    APP_ENV: "production",
    SCREENPLAY_SCORING_MODE: "production",
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: "10000",
    PUBLIC_APP_ORIGIN: "https://www.loglisted.com",
    API_ORIGIN: "https://api-canary.loglisted.com",
    CORS_ALLOWED_ORIGINS: "https://www.loglisted.com,https://loglisted.com",
    SESSION_SIGNING_SECRET: "s".repeat(32),
    DEVICE_HMAC_SECRET: "d".repeat(32),
    CSRF_SIGNING_SECRET: "c".repeat(32),
    IP_HMAC_SECRET: "i".repeat(32),
    RESULT_TOKEN_SIGNING_SECRET: "r".repeat(32),
    DELETION_TOKEN_SIGNING_SECRET: "x".repeat(32),
    UPLOAD_TOKEN_SIGNING_SECRET: "u".repeat(32),
    TURNSTILE_SITE_KEY: "turnstile-site-key",
    TURNSTILE_SECRET_KEY: "turnstile-secret-key",
    TURNSTILE_EXPECTED_HOSTNAME: "www.loglisted.com",
    TURNSTILE_EXPECTED_ACTION: "screenplay_upload",
    STORAGE_DRIVER: "redis",
    UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
    UPSTASH_REDIS_REST_TOKEN: "upstash-token",
    CACHE_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    LLM_PROVIDER: "openai",
    OPENAI_API_KEY: "test-openai-key-never-used",
    SUMMARY_MODEL: "summary-canary",
    SCORING_MODEL: "scoring-canary",
    VERIFICATION_MODEL: "scoring-canary",
    ADJUDICATOR_MODEL: "scoring-canary",
    MODEL_PRICING_JSON: JSON.stringify(pricing),
    DRY_RUN: "false",
    ALLOW_MOCK_IN_PRODUCTION: "false",
    AI_PROVIDER: "openai",
    AI_PROVIDER_DATA_TRAINING_DEFAULT: "unknown",
    AI_PROVIDER_TRAINING_OPT_OUT_CONFIRMED: "true",
    AI_PROVIDER_RETENTION_DAYS: "unknown",
    AI_PROVIDER_REQUEST_STORAGE_DISABLED: "true",
    AI_PROVIDER_SUPPORTS_REQUEST_STORAGE_CONTROL: "true",
    AI_PROVIDER_PRIVACY_REVIEW_DATE: "2026-08-06",
    AI_PROVIDER_TERMS_URL: "https://example.com/terms",
    AI_PROVIDER_PRIVACY_URL: "https://example.com/privacy",
    RAW_PDF_PERSISTENCE_ENABLED: "false",
    RAW_TEXT_PERSISTENCE_ENABLED: "false",
    REDACT_TITLE_PAGE_PII: "true",
    ALLOW_LLM_CONTENT_IN_OBSERVABILITY: "false",
    ALLOW_SCRIPT_CONTENT_IN_ERROR_REPORTS: "false",
    ALLOW_REQUEST_BODY_LOGGING: "false",
    FRAMER_CMS_SYNC_ENABLED: "false",
    FRAMER_RANKINGS_ENABLED: "false",
    ...overrides,
  };
}

describe("production live-canary safety", () => {
  it("loads only the exact production/openai/redis configuration", () => {
    const config = loadProductionConfig(productionEnvironment());
    expect(config.APP_ENV).toBe("production");
    expect(config.SCREENPLAY_SCORING_MODE).toBe("production");
    expect(config.LLM_PROVIDER).toBe("openai");
    expect(config.STORAGE_DRIVER).toBe("redis");
    expect(config.DRY_RUN).toBe(false);
  });

  it.each([
    { SCREENPLAY_SCORING_MODE: "mock" },
    { LLM_PROVIDER: "mock" },
    { DRY_RUN: "true" },
    { ALLOW_MOCK_IN_PRODUCTION: "true" },
    { STORAGE_DRIVER: "memory" },
    { AI_PROVIDER_TRAINING_OPT_OUT_CONFIRMED: "false" },
    { AI_PROVIDER_PRIVACY_REVIEW_DATE: "" },
    { AI_PROVIDER_REQUEST_STORAGE_DISABLED: "unknown" },
    { AI_PROVIDER_SUPPORTS_REQUEST_STORAGE_CONTROL: "false" },
    { MODEL_PRICING_JSON: '{"models":{}}' },
    {
      MODEL_PRICING_JSON:
        '{"models":{"summary-canary":{"inputPerMillion":0,"outputPerMillion":0,"cachedInputPerMillion":0},"scoring-canary":{"inputPerMillion":0.2,"outputPerMillion":0.8,"cachedInputPerMillion":0.1}}}',
    },
  ])("fails closed for unsafe override %#", (override) => {
    expect(() => loadProductionConfig(productionEnvironment(override))).toThrow();
  });

  it("constructs only the OpenAI adapter and never selects the mock factory", () => {
    const openaiProvider = { name: "openai" } as LlmProvider;
    const openai = vi.fn(() => openaiProvider);
    const mock = vi.fn(() => {
      throw new Error("The live backend must never construct the mock provider.");
    });
    const provider = createProductionProvider(loadProductionConfig(productionEnvironment()), {
      openai,
      mock,
    });
    expect(provider).toBe(openaiProvider);
    expect(openai).toHaveBeenCalledOnce();
    expect(mock).not.toHaveBeenCalled();
  });

  it("uses an exact credentialed CORS allowlist", () => {
    const config = loadProductionConfig(productionEnvironment());
    expect(isProductionOriginAllowed(config, "https://www.loglisted.com")).toBe(true);
    expect(isProductionOriginAllowed(config, "https://attacker.example")).toBe(false);
  });

  it("exposes only non-secret mode information in health status", () => {
    expect(productionHealthStatus).toEqual({
      ok: true,
      environment: "production",
      scoringMode: "production",
      llmProvider: "openai",
      dryRun: false,
    });
    expect(JSON.stringify(productionHealthStatus)).not.toContain("test-openai-key");
  });

  it("provides a production executable without changing staging startup", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(packageJson.scripts["start:production"]).toBe("node dist/production-server.js");
    expect(packageJson.scripts["start:staging"]).toBe("node dist/staging-server.js");
  });
});
