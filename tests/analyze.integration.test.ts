import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createTextPdf } from "../fixtures/pdf-fixtures.js";
import { testPricing, validChunkSummary } from "../fixtures/llm-fixtures.js";
import { postAnalyze, type AnalyzeDependencies } from "../src/api/analyze.js";
import { analyzeScreenplay } from "../src/lib/analyze-screenplay.js";
import { AnonymousSessionManager } from "../src/lib/anonymous-session.js";
import { ScriptBudget } from "../src/lib/budget.js";
import { VersionedCache } from "../src/lib/cache.js";
import { calculateSha256 } from "../src/lib/file-hash.js";
import { DeletionTokenManager } from "../src/lib/deletion-token.js";
import { hashIp } from "../src/lib/ip.js";
import { FakeLlmProvider } from "../src/lib/llm/provider.js";
import { parseModelPricing } from "../src/lib/model-pricing.js";
import { AnonymousQuotas } from "../src/lib/quotas.js";
import { SlidingWindowRateLimiter } from "../src/lib/rate-limit.js";
import { ResultTokenManager } from "../src/lib/result-token.js";
import { MemoryAbuseStore } from "../src/lib/storage/memory-abuse-store.js";
import { MemoryCacheStore } from "../src/lib/storage/memory-cache-store.js";
import { ProcessingLock } from "../src/lib/storage/processing-lock.js";
import { MemoryResultStore } from "../src/lib/storage/memory-result-store.js";
import { UploadTokenManager } from "../src/lib/upload-token.js";

const deviceId = "019f9e5d-0710-7220-a1d2-8bb230517924";
const scoreOutput = {
  categoryScores: {
    premise: 7,
    story: 7,
    structure: 7,
    characters: 7,
    dialogue: 7,
    pacing: 7,
    theme: 7,
    tone: 7,
    marketability: 7,
    craft: 7,
  },
  confidence: 0.8,
};

async function setup(options: { providerMalformed?: boolean; budget?: number } = {}) {
  const pdf = await createTextPdf([
    [
      "THE TEST",
      "Written by Taylor Writer",
      "taylor@example.com",
      "+1 (212) 555-0199",
      "FADE IN:",
      "INT. HOUSE - DAY",
      ...Array.from(
        { length: 30 },
        (_, index) =>
          `Action line ${index} establishes plot character conflict and production detail.`,
      ),
      "ALEX",
      "We have to finish this before nightfall.",
      "JORDAN",
      "Then we should start now.",
    ].join("\n"),
  ]);
  const abuseStore = new MemoryAbuseStore();
  const sessions = new AnonymousSessionManager({
    signingSecret: "session-signing-secret-that-is-long-enough",
    deviceHmacSecret: "device-hmac-secret-that-is-long-enough",
    csrfSigningSecret: "csrf-signing-secret-that-is-long-enough",
  });
  const created = sessions.create(deviceId);
  const uploadTokens = new UploadTokenManager(
    "upload-signing-secret-that-is-long-enough",
    abuseStore,
  );
  const issued = uploadTokens.issue({
    anonymousSessionId: created.session.anonymousSessionId,
    deviceIdHash: created.session.deviceIdHash,
    fileHash: calculateSha256(pdf),
    fileSize: pdf.byteLength,
    mimeType: "application/pdf",
    projectTitle: "Project",
    declaredFormat: "feature",
    primaryGenre: "Drama",
  });
  const provider = new FakeLlmProvider((request) => {
    if (options.providerMalformed) return "{malformed";
    return request.schemaName === "screenplay_chunk_summary" ? validChunkSummary : scoreOutput;
  });
  const cacheStore = new MemoryCacheStore();
  const results = new MemoryResultStore();
  const dependencies: AnalyzeDependencies = {
    sessions,
    uploadTokens,
    quotas: new AnonymousQuotas(abuseStore, {
      maximumCompletedPerSession: 10,
      maximumCompletedPerIp: 10,
    }),
    rateLimiter: new SlidingWindowRateLimiter(abuseStore, 90 * 86_400_000),
    originPolicy: {
      allowedOrigins: ["https://site.example"],
      allowedMethods: ["POST"],
      allowedContentTypes: ["multipart/form-data"],
    },
    directIp: "203.0.113.10",
    trustedProxy: { trustedProxyIps: [] },
    ipHmacSecret: "ip-hmac-secret-that-is-long-enough",
    cache: new VersionedCache(cacheStore),
    processingLock: new ProcessingLock(cacheStore),
    results,
    resultTokens: new ResultTokenManager("result-token-secret-that-is-long-enough"),
    deletionTokens: new DeletionTokenManager("deletion-token-secret-that-is-long-enough"),
    provider,
    pricing: parseModelPricing(testPricing),
    createBudget: () =>
      new ScriptBudget({
        maximumInputTokens: 100_000,
        maximumOutputTokens: 10_000,
        maximumCostUsd: options.budget ?? 1,
      }),
    summaryModel: "test-summary",
    scoringModel: "test-score",
    pdfExtractionOptions: { minPages: 1 },
  };
  return { pdf, created, issued, dependencies, provider, results };
}

function analyzeRequest(pdf: Uint8Array, cookie: string, token: string): Request {
  const form = new FormData();
  const bytes = new Uint8Array(pdf.byteLength);
  bytes.set(pdf);
  form.set("file", new File([bytes.buffer], "script.pdf", { type: "application/pdf" }));
  return new Request("https://api.example/api/analyze", {
    method: "POST",
    headers: {
      origin: "https://site.example",
      referer: "https://site.example/upload",
      cookie,
      authorization: `Bearer ${token}`,
    },
    body: form,
  });
}

describe("complete screenplay analysis endpoint", () => {
  it("returns a completed score when a secondary CMS synchronization fails", async () => {
    const setupValue = await setup();
    setupValue.dependencies.onSuccessfulResult = vi.fn(() =>
      Promise.reject(new Error("CMS unavailable")),
    );
    const response = await postAnalyze(
      analyzeRequest(setupValue.pdf, setupValue.created.cookie, setupValue.issued.token),
      setupValue.dependencies,
    );
    expect(response.status).toBe(200);
    expect(setupValue.dependencies.onSuccessfulResult).toHaveBeenCalledOnce();
  });

  it("runs the normal pipeline and returns scores without prose", async () => {
    const setupValue = await setup();
    const cacheWrites = vi.spyOn(setupValue.dependencies.cache, "set");
    const response = await postAnalyze(
      analyzeRequest(setupValue.pdf, setupValue.created.cookie, setupValue.issued.token),
      setupValue.dependencies,
    );
    expect(response.status).toBe(200);
    const body = z
      .object({
        resultId: z.string(),
        resultAccessToken: z.string(),
        categoryScores: z.record(z.string(), z.number()),
        overallScore: z.number(),
      })
      .parse(await response.json());
    expect(body).toMatchObject({ overallScore: 7, categoryScores: scoreOutput.categoryScores });
    expect(body).not.toHaveProperty("analysis");
    expect(await setupValue.results.get(body.resultId)).not.toBeNull();
    const providerPayloads = JSON.stringify(
      setupValue.provider.requests.map((request) => request.userPayload),
    );
    expect(providerPayloads).not.toContain("taylor@example.com");
    expect(providerPayloads).not.toContain("Taylor Writer");
    expect(providerPayloads).not.toContain("555-0199");
    expect(providerPayloads).toContain("[WRITER]");
    expect(cacheWrites.mock.calls.map(([stage]) => stage)).not.toContain("pdf_extraction");
    expect(cacheWrites.mock.calls.map(([stage]) => stage)).not.toContain("representative_excerpts");
    expect(JSON.stringify(cacheWrites.mock.calls)).not.toContain("taylor@example.com");
  });

  it("rejects hash mismatch before parsing or LLM work", async () => {
    const setupValue = await setup();
    const changed = Uint8Array.from(setupValue.pdf);
    changed[changed.length - 1] = (changed.at(-1) ?? 0) ^ 1;
    const response = await postAnalyze(
      analyzeRequest(changed, setupValue.created.cookie, setupValue.issued.token),
      setupValue.dependencies,
    );
    expect(response.status).toBe(415);
    expect(setupValue.provider.requests).toHaveLength(0);
  });

  it("rejects replayed and wrong-session tokens", async () => {
    const setupValue = await setup();
    const request = () =>
      analyzeRequest(setupValue.pdf, setupValue.created.cookie, setupValue.issued.token);
    expect((await postAnalyze(request(), setupValue.dependencies)).status).toBe(200);
    expect((await postAnalyze(request(), setupValue.dependencies)).status).toBe(403);
    const other = setupValue.dependencies.sessions.create("119f9e5d-0710-7220-a1d2-8bb230517924");
    expect(
      (
        await postAnalyze(
          analyzeRequest(setupValue.pdf, other.cookie, setupValue.issued.token),
          setupValue.dependencies,
        )
      ).status,
    ).toBe(403);
  });

  it("returns safe failures for malformed LLM output and cost budget rejection", async () => {
    const malformed = await setup({ providerMalformed: true });
    expect(
      (
        await postAnalyze(
          analyzeRequest(malformed.pdf, malformed.created.cookie, malformed.issued.token),
          malformed.dependencies,
        )
      ).status,
    ).toBe(502);
    const costly = await setup({ budget: 0.000001 });
    expect(
      (
        await postAnalyze(
          analyzeRequest(costly.pdf, costly.created.cookie, costly.issued.token),
          costly.dependencies,
        )
      ).status,
    ).toBe(503);
  });

  it("rejects global capacity before parsing", async () => {
    const setupValue = await setup();
    setupValue.dependencies.admitGlobalCapacity = () =>
      Promise.reject(new Error("capacity exceeded"));
    const response = await postAnalyze(
      analyzeRequest(setupValue.pdf, setupValue.created.cookie, setupValue.issued.token),
      setupValue.dependencies,
    );
    expect(response.status).toBe(422);
    expect(setupValue.provider.requests).toHaveLength(0);
  });

  it("rejects completed quota and active concurrency before processing", async () => {
    const quota = await setup();
    const hashedIp = hashIp(quota.dependencies.directIp, quota.dependencies.ipHmacSecret);
    for (let index = 0; index < 10; index += 1) {
      await quota.dependencies.quotas.recordCompleted(
        quota.created.session.anonymousSessionId,
        hashedIp,
      );
    }
    expect(
      (
        await postAnalyze(
          analyzeRequest(quota.pdf, quota.created.cookie, quota.issued.token),
          quota.dependencies,
        )
      ).status,
    ).toBe(429);
    expect(quota.provider.requests).toHaveLength(0);

    const concurrent = await setup();
    const concurrentIp = hashIp(
      concurrent.dependencies.directIp,
      concurrent.dependencies.ipHmacSecret,
    );
    const release = await concurrent.dependencies.quotas.reserveConcurrency(
      concurrent.created.session.anonymousSessionId,
      concurrentIp,
    );
    expect(
      (
        await postAnalyze(
          analyzeRequest(concurrent.pdf, concurrent.created.cookie, concurrent.issued.token),
          concurrent.dependencies,
        )
      ).status,
    ).toBe(503);
    await release();
  });

  it("rejects duplicate processing and malformed PDFs safely", async () => {
    const duplicate = await setup();
    await duplicate.dependencies.processingLock.acquire(duplicate.issued.claims.fileHash, {
      summaryModel: "test-summary",
      scoringModel: "test-score",
    });
    expect(
      (
        await postAnalyze(
          analyzeRequest(duplicate.pdf, duplicate.created.cookie, duplicate.issued.token),
          duplicate.dependencies,
        )
      ).status,
    ).toBe(422);

    const malformed = await setup();
    const malformedPdf = new TextEncoder().encode("%PDF-1.7\nnot a valid document");
    const issued = malformed.dependencies.uploadTokens.issue({
      anonymousSessionId: malformed.created.session.anonymousSessionId,
      deviceIdHash: malformed.created.session.deviceIdHash,
      fileHash: calculateSha256(malformedPdf),
      fileSize: malformedPdf.byteLength,
      mimeType: "application/pdf",
      projectTitle: "Broken",
      declaredFormat: "feature",
      primaryGenre: "Drama",
    });
    expect(
      (
        await postAnalyze(
          analyzeRequest(malformedPdf, malformed.created.cookie, issued.token),
          malformed.dependencies,
        )
      ).status,
    ).toBe(422);
  });

  it("reuses a completed cached artifact without another LLM call or leaking ownership", async () => {
    const setupValue = await setup();
    expect(
      (
        await postAnalyze(
          analyzeRequest(setupValue.pdf, setupValue.created.cookie, setupValue.issued.token),
          setupValue.dependencies,
        )
      ).status,
    ).toBe(200);
    const requestCount = setupValue.provider.requests.length;
    const secondSession = setupValue.dependencies.sessions.create(
      "119f9e5d-0710-7220-a1d2-8bb230517924",
    );
    const secondClaims = setupValue.dependencies.uploadTokens.issue({
      anonymousSessionId: secondSession.session.anonymousSessionId,
      deviceIdHash: secondSession.session.deviceIdHash,
      fileHash: setupValue.issued.claims.fileHash,
      fileSize: setupValue.pdf.byteLength,
      mimeType: "application/pdf",
      projectTitle: "Second Project",
      declaredFormat: "feature",
      primaryGenre: "Drama",
    }).claims;
    const reused = await analyzeScreenplay(setupValue.pdf, secondClaims, setupValue.dependencies);
    expect(reused.reused).toBe(true);
    expect(reused.result.anonymousSessionId).toBe(secondSession.session.anonymousSessionId);
    expect(reused.result.resultId).not.toBe(setupValue.issued.claims.anonymousSessionId);
    expect(setupValue.provider.requests).toHaveLength(requestCount);
  });
});
