import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { RedisResultStore, type RedisResultClient } from "../src/lib/storage/redis-result-store.js";
import type { StoredResult } from "../src/lib/storage/result-store.js";

function result(): StoredResult {
  return {
    resultId: randomUUID(),
    anonymousSessionId: randomUUID(),
    fileHash: "a".repeat(64),
    projectTitle: "Private Project",
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
      inputTokens: 100,
      outputTokens: 20,
      estimatedCostUsd: 0.01,
      approvedMetadata: {},
    },
  };
}

class FakeRedis implements RedisResultClient {
  readonly values = new Map<string, string>();
  evalCalls = 0;

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.values.get(key) ?? null);
  }

  eval<T>(_script: string, keys: string[], args: (string | number)[]): Promise<T> {
    this.evalCalls += 1;
    const [resultKey, indexKey] = keys;
    const [serialized, resultId] = args;
    if (!resultKey || !indexKey || typeof serialized !== "string" || typeof resultId !== "string") {
      throw new Error("Unexpected Redis invocation.");
    }
    this.values.set(resultKey, serialized);
    this.values.set(indexKey, resultId);
    return Promise.resolve(1 as T);
  }
}

describe("Redis result storage", () => {
  it("writes the result and ownership index in one atomic operation", async () => {
    const redis = new FakeRedis();
    const store = new RedisResultStore(redis);
    const stored = result();
    await store.put(stored, 60);
    expect(redis.evalCalls).toBe(1);
    expect(await store.get(stored.resultId)).toEqual(stored);
    expect(await store.findByFileAndSession(stored.fileHash, stored.anonymousSessionId)).toEqual(
      stored,
    );
  });
});
