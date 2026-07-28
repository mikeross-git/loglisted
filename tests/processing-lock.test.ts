import { describe, expect, it } from "vitest";
import { MemoryCacheStore } from "../src/lib/storage/memory-cache-store.js";
import {
  buildProcessingLockKey,
  ProcessingLock,
  type ScoringConfiguration,
} from "../src/lib/storage/processing-lock.js";

const fileHash = "c".repeat(64);
const configuration: ScoringConfiguration = {
  summaryModel: "summary-model",
  scoringModel: "scoring-model",
};

describe("distributed processing lock", () => {
  it("allows only one same-file simultaneous submission to start", async () => {
    const lock = new ProcessingLock(new MemoryCacheStore());
    const acquisitions = await Promise.all(
      Array.from({ length: 10 }, () => lock.acquire(fileHash, configuration)),
    );
    expect(acquisitions.filter((result) => result.outcome === "acquired")).toHaveLength(1);
    expect(acquisitions.filter((result) => result.outcome === "processing")).toHaveLength(9);
  });

  it("recovers a stale processing lock", async () => {
    let currentTime = new Date("2026-07-26T12:00:00.000Z");
    const store = new MemoryCacheStore();
    const lock = new ProcessingLock(store, {
      lockTtlMs: 1_000,
      now: () => currentTime,
    });
    const first = await lock.acquire(fileHash, configuration);
    expect(first.outcome).toBe("acquired");
    currentTime = new Date(currentTime.getTime() + 1_001);
    const recovered = await lock.acquire(fileHash, configuration);
    expect(recovered.outcome).toBe("acquired");
  });

  it("records completion and reuses the completed result", async () => {
    const store = new MemoryCacheStore();
    const lock = new ProcessingLock(store);
    const result = await lock.run(fileHash, configuration, () =>
      Promise.resolve({
        value: { overallScore: 8.1 },
        resultKey: "loglisted:cache:v1:final_score:key",
      }),
    );
    expect(result.outcome).toBe("completed");
    const duplicate = await lock.acquire(fileHash, configuration);
    expect(duplicate).toEqual({
      outcome: "completed",
      resultKey: "loglisted:cache:v1:final_score:key",
    });
    const state = await store.getState(buildProcessingLockKey(fileHash, configuration), new Date());
    expect(state?.status).toBe("completed");
  });

  it("records failed processing and releases active ownership", async () => {
    const store = new MemoryCacheStore();
    const lock = new ProcessingLock(store);
    await expect(
      lock.run(
        fileHash,
        configuration,
        () => Promise.reject(new Error("provider failed")),
        () => "LLM_FAILED",
      ),
    ).rejects.toThrow("provider failed");
    const duplicate = await lock.acquire(fileHash, configuration);
    expect(duplicate).toEqual({ outcome: "failed", failureCode: "LLM_FAILED" });
    const state = await store.getState(buildProcessingLockKey(fileHash, configuration), new Date());
    expect(state?.status).toBe("failed");
  });

  it("allows only the owner to complete or release a lock", async () => {
    const store = new MemoryCacheStore();
    const lock = new ProcessingLock(store);
    const acquisition = await lock.acquire(fileHash, configuration);
    expect(acquisition.outcome).toBe("acquired");
    if (acquisition.outcome !== "acquired") throw new Error("Expected lock ownership.");
    await expect(
      store.complete(
        acquisition.lease.key,
        "00000000-0000-4000-8000-000000000000",
        "result",
        1_000,
        new Date(),
      ),
    ).resolves.toBe(false);
    await expect(
      store.release(acquisition.lease.key, "00000000-0000-4000-8000-000000000000"),
    ).resolves.toBe(false);
    await expect(acquisition.lease.release()).resolves.toBe(true);
  });

  it("uses scoring configuration to isolate otherwise identical files", async () => {
    const lock = new ProcessingLock(new MemoryCacheStore());
    const first = await lock.acquire(fileHash, configuration);
    const second = await lock.acquire(fileHash, {
      ...configuration,
      scoringModel: "different-model",
    });
    expect(first.outcome).toBe("acquired");
    expect(second.outcome).toBe("acquired");
  });
});
