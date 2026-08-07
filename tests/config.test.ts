import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/lib/config.js";
import { ValidationError } from "../src/lib/errors.js";

const validEnvironment = {
  NODE_ENV: "test",
  LOG_LEVEL: "info",
  PUBLIC_APP_ORIGIN: "http://localhost:3000",
  API_ORIGIN: "http://localhost:8787",
  CORS_ALLOWED_ORIGINS: "http://localhost:3000,https://preview.example.com",
  SESSION_SIGNING_SECRET: "a".repeat(32),
  UPLOAD_TOKEN_SIGNING_SECRET: "b".repeat(32),
  TURNSTILE_SITE_KEY: "test-site-key",
  TURNSTILE_SECRET_KEY: "test-secret-key",
  TURNSTILE_EXPECTED_HOSTNAME: "localhost",
  TURNSTILE_EXPECTED_ACTION: "screenplay_upload",
  STORAGE_DRIVER: "memory",
};

describe("configuration", () => {
  it("loads valid configuration and defaults", () => {
    const config = loadConfig(validEnvironment);
    expect(config.MAX_PDF_BYTES).toBe(15 * 1024 * 1024);
    expect(config.MAX_PDF_PAGES).toBe(150);
    expect(config.MIN_PDF_PAGES).toBe(25);
    expect(config.CORS_ALLOWED_ORIGINS).toHaveLength(2);
    expect(config.OPENAI_REASONING_EFFORT).toBeUndefined();
  });

  it("rejects short secrets and malformed origins", () => {
    expect(() => loadConfig({ ...validEnvironment, SESSION_SIGNING_SECRET: "short" })).toThrow(
      ValidationError,
    );
    expect(() => loadConfig({ ...validEnvironment, PUBLIC_APP_ORIGIN: "not-a-url" })).toThrow(
      ValidationError,
    );
  });

  it("requires Redis credentials when Redis is selected", () => {
    expect(() => loadConfig({ ...validEnvironment, STORAGE_DRIVER: "redis" })).toThrow(
      ValidationError,
    );
  });

  it("requires production LLM configuration", () => {
    expect(() => loadConfig({ ...validEnvironment, NODE_ENV: "production" })).toThrow(
      ValidationError,
    );
  });

  it("loads all configurable model roles and warns when active pricing is missing", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const config = loadConfig({
      ...validEnvironment,
      SUMMARY_MODEL: "summary-model",
      SCORING_MODEL: "scoring-model",
      VERIFICATION_MODEL: "verification-model",
      ADJUDICATOR_MODEL: "adjudicator-model",
      MODEL_PRICING_JSON:
        '{"models":{"summary-model":{"inputPerMillion":1,"outputPerMillion":2,"cachedInputPerMillion":0.5}}}',
    });
    expect(config.VERIFICATION_MODEL).toBe("verification-model");
    expect(
      warning.mock.calls.filter(([message]) => String(message).includes("model_pricing_missing")),
    ).toHaveLength(3);
    warning.mockRestore();
  });

  it("rejects malformed model pricing JSON", () => {
    expect(() => loadConfig({ ...validEnvironment, MODEL_PRICING_JSON: "{invalid" })).toThrow(
      ValidationError,
    );
  });
});
