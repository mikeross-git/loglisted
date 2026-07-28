import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { deleteResult } from "../src/api/result.js";
import { AnonymousSessionManager } from "../src/lib/anonymous-session.js";
import { VersionedCache } from "../src/lib/cache.js";
import {
  cacheTtlsForRetention,
  DataRetentionPolicySchema,
  discardSensitiveBuffer,
} from "../src/lib/data-retention.js";
import { DeletionTokenManager } from "../src/lib/deletion-token.js";
import { MemoryCacheStore } from "../src/lib/storage/memory-cache-store.js";
import { EncryptedCacheStore } from "../src/lib/storage/encrypted-cache-store.js";
import { MemoryResultStore } from "../src/lib/storage/memory-result-store.js";
import type { StoredResult } from "../src/lib/storage/result-store.js";

const sessionOptions = {
  signingSecret: "session-signing-secret-that-is-long-enough",
  deviceHmacSecret: "device-hmac-secret-that-is-long-enough",
  csrfSigningSecret: "csrf-signing-secret-that-is-long-enough",
};

function storedResult(sessionId: string): StoredResult {
  return {
    resultId: randomUUID(),
    anonymousSessionId: sessionId,
    fileHash: "d".repeat(64),
    projectTitle: "Delete Me",
    declaredFormat: "feature",
    declaredGenre: "Drama",
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
    overallScore: 7,
    completedAt: new Date().toISOString(),
    internal: {
      versions: { scoring: "v1" },
      inputTokens: 1,
      outputTokens: 1,
      estimatedCostUsd: 0,
      approvedMetadata: {},
    },
  };
}

describe("data retention and deletion", () => {
  it("enforces short content-cache limits and disables raw persistence", () => {
    const policy = DataRetentionPolicySchema.parse({
      rawPdfPersistenceEnabled: false,
      rawTextPersistenceEnabled: false,
      redactedChunkTtlSeconds: 86_400,
      summaryTtlSeconds: 30 * 86_400,
      compressedRepresentationTtlSeconds: 30 * 86_400,
      representativeExcerptPersistenceEnabled: false,
      resultTtlSeconds: 30 * 86_400,
      abuseTelemetryTtlSeconds: 90 * 86_400,
    });
    expect(policy).toBeTruthy();
    expect(cacheTtlsForRetention(policy)).toMatchObject({
      chunks: 86_400,
      chunkSummary: 30 * 86_400,
      reducedScreenplay: 30 * 86_400,
      finalScore: 30 * 86_400,
    });
    expect(() =>
      DataRetentionPolicySchema.parse({
        rawPdfPersistenceEnabled: false,
        rawTextPersistenceEnabled: false,
        redactedChunkTtlSeconds: 86_401,
        summaryTtlSeconds: 1,
        compressedRepresentationTtlSeconds: 1,
        representativeExcerptPersistenceEnabled: false,
        resultTtlSeconds: 1,
        abuseTelemetryTtlSeconds: 1,
      }),
    ).toThrow();
  });

  it("explicitly clears the temporary PDF buffer", () => {
    const bytes = Uint8Array.from([0x25, 0x50, 0x44, 0x46]);
    discardSensitiveBuffer(bytes);
    expect(bytes).toEqual(Uint8Array.from([0, 0, 0, 0]));
  });

  it("encrypts screenplay-derived cache values before the backing store sees them", async () => {
    const backing = new MemoryCacheStore();
    const encrypted = new EncryptedCacheStore(backing, Buffer.alloc(32, 7).toString("base64"));
    await encrypted.set("private", "INT. HOUSE - DAY\nPrivate scene", 60);
    expect(await backing.get("private")).not.toContain("Private scene");
    expect(await encrypted.get("private")).toContain("Private scene");
  });

  it("uses a deletion credential to remove the stored result and file-scoped artifacts", async () => {
    const sessions = new AnonymousSessionManager(sessionOptions);
    const owner = sessions.create("019f9e5d-0710-7220-a1d2-8bb230517924");
    const results = new MemoryResultStore();
    const cacheStore = new MemoryCacheStore();
    const cache = new VersionedCache(cacheStore);
    const result = storedResult(owner.session.anonymousSessionId);
    await results.put(result, 60);
    await cache.set(
      "reduced_screenplay",
      { fileHash: result.fileHash, summaryModel: "summary" },
      // The deletion behavior is independent of artifact shape.
      DataRetentionPolicySchema,
      {
        rawPdfPersistenceEnabled: false,
        rawTextPersistenceEnabled: false,
        redactedChunkTtlSeconds: 1,
        summaryTtlSeconds: 1,
        compressedRepresentationTtlSeconds: 1,
        representativeExcerptPersistenceEnabled: false,
        resultTtlSeconds: 1,
        abuseTelemetryTtlSeconds: 1,
      },
    );
    const deletionTokens = new DeletionTokenManager("deletion-token-secret-that-is-long-enough");
    const token = deletionTokens.issue(result.resultId, owner.session.anonymousSessionId);
    const response = await deleteResult(
      new Request(`https://api.example/api/result/${result.resultId}`, {
        method: "DELETE",
        headers: {
          origin: "https://site.example",
          cookie: owner.cookie,
          authorization: `Bearer ${token}`,
        },
      }),
      result.resultId,
      {
        sessions,
        deletionTokens,
        results,
        cache,
        originPolicy: {
          allowedOrigins: ["https://site.example"],
          allowedMethods: ["DELETE"],
          allowedContentTypes: [],
        },
      },
    );
    expect(response.status).toBe(204);
    expect(await results.get(result.resultId)).toBeNull();
  });

  it("does not allow a valid deletion token to delete another session's result", async () => {
    const sessions = new AnonymousSessionManager(sessionOptions);
    const owner = sessions.create("019f9e5d-0710-7220-a1d2-8bb230517924");
    const other = sessions.create("119f9e5d-0710-7220-a1d2-8bb230517924");
    const result = storedResult(owner.session.anonymousSessionId);
    const results = new MemoryResultStore();
    await results.put(result, 60);
    const deletionTokens = new DeletionTokenManager("deletion-token-secret-that-is-long-enough");
    const token = deletionTokens.issue(result.resultId, owner.session.anonymousSessionId);
    const response = await deleteResult(
      new Request(`https://api.example/api/result/${result.resultId}`, {
        method: "DELETE",
        headers: {
          origin: "https://site.example",
          cookie: other.cookie,
          authorization: `Bearer ${token}`,
        },
      }),
      result.resultId,
      {
        sessions,
        deletionTokens,
        results,
        cache: new VersionedCache(new MemoryCacheStore()),
        originPolicy: {
          allowedOrigins: ["https://site.example"],
          allowedMethods: ["DELETE"],
          allowedContentTypes: [],
        },
      },
    );
    expect(response.status).toBe(403);
    expect(await results.get(result.resultId)).not.toBeNull();
  });
});
