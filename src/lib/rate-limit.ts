import { RateLimitError } from "./errors.js";
import type { AbuseStore, WindowResult } from "./storage/abuse-store.js";

export class SlidingWindowRateLimiter {
  constructor(
    private readonly store: AbuseStore,
    private readonly telemetryTtlMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async check(key: string, limit: number, windowMs: number): Promise<WindowResult> {
    const result = await this.store.incrementWindow(
      `rate:${key}`,
      this.now(),
      windowMs,
      limit,
      this.telemetryTtlMs,
    );
    if (!result.allowed) {
      throw new RateLimitError("Sliding-window rate limit exceeded.", {
        details: { retryAfterMs: result.retryAfterMs },
      });
    }
    return result;
  }
}
