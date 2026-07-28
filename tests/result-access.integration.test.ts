import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { getResult } from "../src/api/result.js";
import { AnonymousSessionManager } from "../src/lib/anonymous-session.js";
import { ResultTokenManager } from "../src/lib/result-token.js";
import { MemoryResultStore } from "../src/lib/storage/memory-result-store.js";
import type { StoredResult } from "../src/lib/storage/result-store.js";

const sessionOptions = {
  signingSecret: "session-signing-secret-that-is-long-enough",
  deviceHmacSecret: "device-hmac-secret-that-is-long-enough",
  csrfSigningSecret: "csrf-signing-secret-that-is-long-enough",
};
const scores = {
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
};

describe("anonymous result access", () => {
  it("returns only the public result to the correct session", async () => {
    const sessions = new AnonymousSessionManager(sessionOptions);
    const created = sessions.create("019f9e5d-0710-7220-a1d2-8bb230517924");
    const store = new MemoryResultStore();
    const resultId = randomUUID();
    const result: StoredResult = {
      resultId,
      anonymousSessionId: created.session.anonymousSessionId,
      fileHash: "a".repeat(64),
      projectTitle: "Project",
      declaredFormat: "feature",
      declaredGenre: "Drama",
      categoryScores: scores,
      overallScore: 7,
      completedAt: new Date().toISOString(),
      internal: {
        versions: { scoring: "v1" },
        inputTokens: 100,
        outputTokens: 20,
        estimatedCostUsd: 0.01,
        approvedMetadata: {},
      },
    };
    await store.put(result, 30 * 86_400);
    const tokens = new ResultTokenManager("result-token-secret-that-is-long-enough");
    const access = tokens.issue(resultId, created.session.anonymousSessionId);
    const response = await getResult(
      new Request(`https://api.example/api/result/${resultId}`, {
        headers: {
          origin: "https://site.example",
          referer: "https://site.example/result",
          cookie: created.cookie,
          authorization: `Bearer ${access.token}`,
        },
      }),
      resultId,
      {
        sessions,
        resultTokens: tokens,
        results: store,
        originPolicy: {
          allowedOrigins: ["https://site.example"],
          allowedMethods: ["GET"],
          allowedContentTypes: [],
        },
      },
    );
    expect(response.status).toBe(200);
    const body = z.record(z.string(), z.unknown()).parse(await response.json());
    expect(body).toMatchObject({ projectTitle: "Project", overallScore: 7 });
    expect(body).not.toHaveProperty("internal");
    expect(body).not.toHaveProperty("fileHash");
  });

  it("denies wrong sessions, expired tokens, expired results, and guessed IDs", async () => {
    let now = new Date("2026-07-26T12:00:00Z");
    const sessions = new AnonymousSessionManager(sessionOptions);
    const owner = sessions.create("019f9e5d-0710-7220-a1d2-8bb230517924");
    const other = sessions.create("119f9e5d-0710-7220-a1d2-8bb230517924");
    const tokens = new ResultTokenManager("result-token-secret-that-is-long-enough", 1, () => now);
    const resultId = randomUUID();
    const access = tokens.issue(resultId, owner.session.anonymousSessionId);
    const policy = {
      allowedOrigins: ["https://site.example"],
      allowedMethods: ["GET"],
      allowedContentTypes: [],
    };
    const make = (cookie: string, id = resultId) =>
      new Request(`https://api.example/api/result/${id}`, {
        headers: {
          origin: "https://site.example",
          cookie,
          authorization: `Bearer ${access.token}`,
        },
      });
    const emptyStore = new MemoryResultStore();
    expect(
      (
        await getResult(make(other.cookie), resultId, {
          sessions,
          resultTokens: tokens,
          results: emptyStore,
          originPolicy: policy,
        })
      ).status,
    ).toBe(403);
    const ambiguous = new Request(`https://api.example/api/result/${resultId}`, {
      headers: {
        origin: "https://site.example",
        cookie: owner.cookie,
        authorization: `Bearer ${access.token}.extra`,
      },
    });
    expect(
      (
        await getResult(ambiguous, resultId, {
          sessions,
          resultTokens: tokens,
          results: emptyStore,
          originPolicy: policy,
        })
      ).status,
    ).toBe(403);
    now = new Date(now.getTime() + 2_000);
    expect(
      (
        await getResult(make(owner.cookie), resultId, {
          sessions,
          resultTokens: tokens,
          results: emptyStore,
          originPolicy: policy,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await getResult(make(owner.cookie, randomUUID()), randomUUID(), {
          sessions,
          resultTokens: tokens,
          results: emptyStore,
          originPolicy: policy,
        })
      ).status,
    ).toBeGreaterThanOrEqual(400);
  });
});
