import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createTextPdf } from "../fixtures/pdf-fixtures.js";
import { postAnalyze } from "../src/api/analyze.js";
import { getResult } from "../src/api/result.js";
import { postSession } from "../src/api/session.js";
import { postUploadAuthorize } from "../src/api/upload-authorize.js";
import { AnonymousSessionManager } from "../src/lib/anonymous-session.js";
import { ScriptBudget } from "../src/lib/budget.js";
import { VersionedCache } from "../src/lib/cache.js";
import { calculateSha256 } from "../src/lib/file-hash.js";
import { DeletionTokenManager } from "../src/lib/deletion-token.js";
import { MockLlmProvider } from "../src/lib/llm/mock.js";
import { parseModelPricing } from "../src/lib/model-pricing.js";
import { AnonymousQuotas } from "../src/lib/quotas.js";
import { SlidingWindowRateLimiter } from "../src/lib/rate-limit.js";
import { ResultTokenManager } from "../src/lib/result-token.js";
import { MemoryAbuseStore } from "../src/lib/storage/memory-abuse-store.js";
import { MemoryCacheStore } from "../src/lib/storage/memory-cache-store.js";
import { ProcessingLock } from "../src/lib/storage/processing-lock.js";
import { MemoryResultStore } from "../src/lib/storage/memory-result-store.js";
import { TurnstileVerifier } from "../src/lib/turnstile.js";
import { UploadTokenManager } from "../src/lib/upload-token.js";

describe("full mock upload-to-result workflow", () => {
  it("runs without an API key or external request and marks the result as mock", async () => {
    const originPolicy = {
      allowedOrigins: ["https://site.example"],
      allowedMethods: ["GET", "POST"],
      allowedContentTypes: ["application/json", "multipart/form-data"],
    };
    const secrets = {
      signingSecret: "session-signing-secret-that-is-long-enough",
      deviceHmacSecret: "device-hmac-secret-that-is-long-enough",
      csrfSigningSecret: "csrf-signing-secret-that-is-long-enough",
    };
    const sessions = new AnonymousSessionManager(secrets);
    const sessionResponse = await postSession(
      new Request("https://api.example/api/session", {
        method: "POST",
        headers: {
          origin: "https://site.example",
          referer: "https://site.example/upload",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          deviceId: "019f9e5d-0710-7220-a1d2-8bb230517924",
        }),
      }),
      { sessions, originPolicy },
    );
    expect(sessionResponse.status).toBe(201);
    const cookie = sessionResponse.headers.get("set-cookie");
    expect(cookie).toBeTruthy();
    const sessionBody = z
      .object({ csrfToken: z.string(), sessionExpiresAt: z.string() })
      .parse(await sessionResponse.json());

    const pdf = await createTextPdf([
      [
        "MOCK FEATURE",
        "FADE IN:",
        "INT. OBSERVATORY - NIGHT",
        ...Array.from(
          { length: 30 },
          (_, index) => `Action ${index} develops the mystery signal conflict and discovery.`,
        ),
        "MAYA",
        "The signal is coming from inside the station.",
        "ELI",
        "Then we are already too late.",
      ].join("\n"),
    ]);
    const abuseStore = new MemoryAbuseStore();
    let turnstileCalls = 0;
    const turnstile = new TurnstileVerifier(abuseStore, {
      secretKey: "turnstile-secret",
      expectedHostnames: ["site.example"],
      expectedAction: "screenplay_upload",
      fetchImplementation: () => {
        turnstileCalls += 1;
        return Promise.resolve(
          Response.json({
            success: true,
            hostname: "site.example",
            action: "screenplay_upload",
          }),
        );
      },
    });
    const uploadTokens = new UploadTokenManager(
      "upload-signing-secret-that-is-long-enough",
      abuseStore,
    );
    const quotas = new AnonymousQuotas(abuseStore, {
      maximumCompletedPerIp: 5,
      maximumCompletedPerSession: 5,
    });
    const limiter = new SlidingWindowRateLimiter(abuseStore, 90 * 86_400_000);
    const authorizationResponse = await postUploadAuthorize(
      new Request("https://api.example/api/upload-authorize", {
        method: "POST",
        headers: {
          origin: "https://site.example",
          referer: "https://site.example/upload",
          "content-type": "application/json",
          cookie: cookie ?? "",
          "x-csrf-token": sessionBody.csrfToken,
        },
        body: JSON.stringify({
          turnstileToken: "local-test-token",
          deviceId: "019f9e5d-0710-7220-a1d2-8bb230517924",
          fileHash: calculateSha256(pdf),
          fileSize: pdf.byteLength,
          fileName: "mock-feature.pdf",
          mimeType: "application/pdf",
          project: {
            projectTitle: "Mock Feature",
            format: "feature",
            primaryGenre: "Science Fiction",
            secondaryGenres: [],
            approximatePageCount: 100,
            logline: "",
            originalWorkConfirmed: true,
            uploadRightsConfirmed: true,
            privacyTermsAccepted: true,
            acceptableUseAccepted: true,
            aiProcessingAcknowledged: true,
          },
          antiBot: {
            website_confirm: "",
            formMountedAt: new Date(Date.now() - 10_000).toISOString(),
            fileSelectedAt: new Date(Date.now() - 5_000).toISOString(),
            formSubmittedAt: new Date().toISOString(),
          },
        }),
      }),
      {
        sessions,
        csrfSigningSecret: secrets.csrfSigningSecret,
        deviceHmacSecret: secrets.deviceHmacSecret,
        ipHmacSecret: "ip-hmac-secret-that-is-long-enough",
        directIp: "203.0.113.20",
        trustedProxy: { trustedProxyIps: [] },
        originPolicy,
        turnstile,
        rateLimiter: limiter,
        quotas,
        abuseStore,
        uploadTokens,
      },
    );
    expect(authorizationResponse.status).toBe(200);
    const authorization = z
      .object({ uploadToken: z.string(), cachedResultAvailable: z.literal(false) })
      .passthrough()
      .parse(await authorizationResponse.json());
    expect(turnstileCalls).toBe(1);

    const mock = new MockLlmProvider({ fixture: "successful_feature" });
    const cacheStore = new MemoryCacheStore();
    const results = new MemoryResultStore();
    const resultTokens = new ResultTokenManager("result-token-secret-that-is-long-enough");
    const form = new FormData();
    const bytes = Uint8Array.from(pdf);
    form.set("file", new File([bytes.buffer], "mock-feature.pdf", { type: "application/pdf" }));
    const analysisResponse = await postAnalyze(
      new Request("https://api.example/api/analyze", {
        method: "POST",
        headers: {
          origin: "https://site.example",
          referer: "https://site.example/upload",
          cookie: cookie ?? "",
          authorization: `Bearer ${authorization.uploadToken}`,
        },
        body: form,
      }),
      {
        sessions,
        uploadTokens,
        quotas,
        rateLimiter: limiter,
        originPolicy,
        directIp: "203.0.113.20",
        trustedProxy: { trustedProxyIps: [] },
        ipHmacSecret: "ip-hmac-secret-that-is-long-enough",
        cache: new VersionedCache(cacheStore),
        processingLock: new ProcessingLock(cacheStore),
        results,
        resultTokens,
        deletionTokens: new DeletionTokenManager("deletion-token-secret-that-is-long-enough"),
        provider: mock,
        pricing: parseModelPricing({
          models: {
            "mock-summary": {
              inputPerMillion: 0.1,
              outputPerMillion: 0.2,
              cachedInputPerMillion: 0,
            },
            "mock-score": {
              inputPerMillion: 0.2,
              outputPerMillion: 0.4,
              cachedInputPerMillion: 0,
            },
          },
        }),
        createBudget: () =>
          new ScriptBudget({
            maximumInputTokens: 100_000,
            maximumOutputTokens: 10_000,
            maximumCostUsd: 1,
          }),
        summaryModel: "mock-summary",
        scoringModel: "mock-score",
        pdfExtractionOptions: { minPages: 1 },
      },
    );
    expect(analysisResponse.status).toBe(200);
    const analysis = z
      .object({
        resultId: z.string(),
        resultAccessToken: z.string(),
        evaluationMode: z.literal("mock"),
      })
      .passthrough()
      .parse(await analysisResponse.json());
    expect(mock.requests.length).toBeGreaterThanOrEqual(2);

    const resultResponse = await getResult(
      new Request(`https://api.example/api/result/${analysis.resultId}`, {
        headers: {
          origin: "https://site.example",
          referer: "https://site.example/result",
          cookie: cookie ?? "",
          authorization: `Bearer ${analysis.resultAccessToken}`,
        },
      }),
      analysis.resultId,
      { sessions, resultTokens, results, originPolicy },
    );
    expect(resultResponse.status).toBe(200);
    expect(await resultResponse.json()).toMatchObject({
      projectTitle: "Mock Feature",
      evaluationMode: "mock",
    });
  });
});
