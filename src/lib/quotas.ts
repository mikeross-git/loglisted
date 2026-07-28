import { ProcessingCapacityError, RateLimitError } from "./errors.js";
import type { AbuseStore } from "./storage/abuse-store.js";

export interface QuotaConfig {
  completedWindowMs?: number;
  maximumCompletedPerSession?: number;
  maximumCompletedPerIp?: number;
  concurrencyTtlMs?: number;
}

export class AnonymousQuotas {
  private readonly config: Required<QuotaConfig>;
  constructor(
    private readonly store: AbuseStore,
    config: QuotaConfig = {},
  ) {
    this.config = {
      completedWindowMs: config.completedWindowMs ?? 90 * 24 * 60 * 60_000,
      maximumCompletedPerSession: config.maximumCompletedPerSession ?? 1,
      maximumCompletedPerIp: config.maximumCompletedPerIp ?? 1,
      concurrencyTtlMs: config.concurrencyTtlMs ?? 15 * 60_000,
    };
  }

  async assertCompletedQuota(sessionId: string, hashedIp: string): Promise<void> {
    const [sessionCount, ipCount] = await Promise.all([
      this.store.getCount(`completed:session:${sessionId}`),
      this.store.getCount(`completed:ip:${hashedIp}`),
    ]);
    if (
      sessionCount >= this.config.maximumCompletedPerSession ||
      ipCount >= this.config.maximumCompletedPerIp
    ) {
      throw new RateLimitError("Completed-analysis quota exceeded.");
    }
  }

  async reserveConcurrency(sessionId: string, hashedIp: string): Promise<() => Promise<void>> {
    const sessionKey = `concurrent:session:${sessionId}`;
    const ipKey = `concurrent:ip:${hashedIp}`;
    if (!(await this.store.acquireConcurrency(sessionKey, this.config.concurrencyTtlMs, 1))) {
      throw new ProcessingCapacityError("Session already has an active analysis.");
    }
    if (!(await this.store.acquireConcurrency(ipKey, this.config.concurrencyTtlMs, 1))) {
      await this.store.releaseConcurrency(sessionKey);
      throw new ProcessingCapacityError("IP already has an active analysis.");
    }
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      await Promise.all([
        this.store.releaseConcurrency(sessionKey),
        this.store.releaseConcurrency(ipKey),
      ]);
    };
  }

  async recordCompleted(sessionId: string, hashedIp: string): Promise<void> {
    await Promise.all([
      this.store.incrementCount(`completed:session:${sessionId}`, this.config.completedWindowMs),
      this.store.incrementCount(`completed:ip:${hashedIp}`, this.config.completedWindowMs),
    ]);
  }
}
