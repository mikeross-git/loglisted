import { describe, expect, it } from "vitest";
import { getPrivacyStatus } from "../src/api/privacy-status.js";
import { MockLlmProvider } from "../src/lib/llm/mock.js";
import { PrivacyConfigSchema } from "../src/lib/privacy-config.js";

describe("internal privacy status", () => {
  it("is unavailable publicly and requires its backend admin secret when enabled", async () => {
    const provider = new MockLlmProvider();
    const disabled = PrivacyConfigSchema.parse({});
    expect(
      (
        await getPrivacyStatus(new Request("https://api.example/api/privacy-status"), {
          config: disabled,
          provider,
          model: "mock-score",
        })
      ).status,
    ).toBe(404);

    const secret = "privacy-admin-secret-that-is-long-enough";
    const enabled = PrivacyConfigSchema.parse({
      PRIVACY_STATUS_ENABLED: "true",
      PRIVACY_STATUS_ADMIN_SECRET: secret,
      AI_PROVIDER_PRIVACY_REVIEW_DATE: "2026-07-26",
    });
    expect(
      (
        await getPrivacyStatus(new Request("https://api.example/api/privacy-status"), {
          config: enabled,
          provider,
          model: "mock-score",
        })
      ).status,
    ).toBe(404);
    const response = await getPrivacyStatus(
      new Request("https://api.example/api/privacy-status", {
        headers: { authorization: `Bearer ${secret}` },
      }),
      { config: enabled, provider, model: "mock-score" },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      provider: "mock",
      requestStorageDisabled: true,
      piiRedactionEnabled: true,
      rawPdfPersistenceEnabled: false,
      contentLoggingEnabled: false,
    });
  });
});
