import { describe, expect, it } from "vitest";
import { validatePrivacyConfig } from "../src/lib/privacy-config.js";

const confirmed = {
  AI_PROVIDER: "openai",
  AI_PROVIDER_DATA_TRAINING_DEFAULT: "false",
  AI_PROVIDER_TRAINING_OPT_OUT_CONFIRMED: "true",
  AI_PROVIDER_RETENTION_DAYS: "30",
  AI_PROVIDER_REQUEST_STORAGE_DISABLED: "true",
  AI_PROVIDER_PRIVACY_REVIEW_DATE: "2026-07-26",
  AI_PROVIDER_TERMS_URL: "https://provider.example/terms",
};

describe("AI privacy configuration", () => {
  it("fails production when training opt-out is unconfirmed", () => {
    expect(() =>
      validatePrivacyConfig(
        { ...confirmed, AI_PROVIDER_TRAINING_OPT_OUT_CONFIRMED: "false" },
        "production",
        "openai",
      ),
    ).toThrow(/training opt-out/i);
  });

  it("fails production when the privacy review date is missing", () => {
    expect(() =>
      validatePrivacyConfig(
        { ...confirmed, AI_PROVIDER_PRIVACY_REVIEW_DATE: "" },
        "production",
        "openai",
      ),
    ).toThrow(/review date/i);
  });

  it("does not require external-provider confirmations in mock mode", () => {
    expect(
      validatePrivacyConfig(
        {
          RAW_PDF_PERSISTENCE_ENABLED: "false",
          RAW_TEXT_PERSISTENCE_ENABLED: "false",
        },
        "production",
        "mock",
      ).warnings,
    ).toEqual([]);
  });

  it("blocks production body/content capture without a dangerous backend override", () => {
    expect(() =>
      validatePrivacyConfig(
        { ...confirmed, ALLOW_REQUEST_BODY_LOGGING: "true" },
        "production",
        "openai",
      ),
    ).toThrow(/observability/i);
  });
});
