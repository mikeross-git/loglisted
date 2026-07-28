import { describe, expect, it } from "vitest";
import { ProcessingCapacityError, RateLimitError } from "../src/lib/errors.js";
import { AnonymousQuotas } from "../src/lib/quotas.js";
import { SlidingWindowRateLimiter } from "../src/lib/rate-limit.js";
import { MemoryAbuseStore } from "../src/lib/storage/memory-abuse-store.js";

describe("anonymous rate limits and quotas", () => {
  it("uses a sliding authorization window", async () => {
    let now = 1_000;
    const limiter = new SlidingWindowRateLimiter(
      new MemoryAbuseStore(() => now),
      60_000,
      () => now,
    );
    await limiter.check("ip", 2, 10_000);
    await limiter.check("ip", 2, 10_000);
    await expect(limiter.check("ip", 2, 10_000)).rejects.toBeInstanceOf(RateLimitError);
    now += 11_000;
    await expect(limiter.check("ip", 2, 10_000)).resolves.toBeDefined();
  });

  it("allows shared IP users only up to the configured completed quota", async () => {
    const store = new MemoryAbuseStore();
    const quotas = new AnonymousQuotas(store);
    await quotas.recordCompleted("session-a", "shared-ip");
    await expect(quotas.assertCompletedQuota("session-b", "shared-ip")).rejects.toBeInstanceOf(
      RateLimitError,
    );
  });

  it("atomically enforces session and IP concurrency", async () => {
    const quotas = new AnonymousQuotas(new MemoryAbuseStore());
    const release = await quotas.reserveConcurrency("session-a", "ip-a");
    await expect(quotas.reserveConcurrency("session-a", "ip-b")).rejects.toBeInstanceOf(
      ProcessingCapacityError,
    );
    await release();
    await expect(quotas.reserveConcurrency("session-a", "ip-b")).resolves.toBeTypeOf("function");
  });
});
