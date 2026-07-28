import type { AbuseStore, WindowResult } from "./abuse-store.js";

interface ExpiringValue<T> {
  value: T;
  expiresAt: number;
}

export class MemoryAbuseStore implements AbuseStore {
  private readonly windows = new Map<string, ExpiringValue<number[]>>();
  private readonly once = new Map<string, number>();
  private readonly counters = new Map<string, ExpiringValue<number>>();
  private readonly sets = new Map<string, ExpiringValue<Set<string>>>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  incrementWindow(
    key: string,
    nowMs: number,
    windowMs: number,
    limit: number,
    telemetryTtlMs: number,
  ): Promise<WindowResult> {
    const existing = this.windows.get(key);
    const timestamps =
      existing && existing.expiresAt > nowMs
        ? existing.value.filter((timestamp) => timestamp > nowMs - windowMs)
        : [];
    timestamps.push(nowMs);
    this.windows.set(key, { value: timestamps, expiresAt: nowMs + telemetryTtlMs });
    const oldest = timestamps[0] ?? nowMs;
    return Promise.resolve({
      allowed: timestamps.length <= limit,
      count: timestamps.length,
      retryAfterMs: timestamps.length <= limit ? 0 : Math.max(0, oldest + windowMs - nowMs),
    });
  }

  consumeOnce(key: string, ttlMs: number): Promise<boolean> {
    const now = this.now();
    const expiry = this.once.get(key);
    if (expiry && expiry > now) return Promise.resolve(false);
    this.once.set(key, now + ttlMs);
    return Promise.resolve(true);
  }

  async acquireConcurrency(key: string, ttlMs: number, maximum: number): Promise<boolean> {
    const count = await this.getCount(key);
    if (count >= maximum) return false;
    this.counters.set(key, { value: count + 1, expiresAt: this.now() + ttlMs });
    return true;
  }

  async releaseConcurrency(key: string): Promise<void> {
    const count = await this.getCount(key);
    if (count <= 1) this.counters.delete(key);
    else {
      const existing = this.counters.get(key);
      this.counters.set(key, {
        value: count - 1,
        expiresAt: existing?.expiresAt ?? this.now() + 60_000,
      });
    }
  }

  getCount(key: string): Promise<number> {
    const existing = this.counters.get(key);
    if (!existing || existing.expiresAt <= this.now()) {
      this.counters.delete(key);
      return Promise.resolve(0);
    }
    return Promise.resolve(existing.value);
  }

  async incrementCount(key: string, ttlMs: number): Promise<number> {
    const next = (await this.getCount(key)) + 1;
    this.counters.set(key, { value: next, expiresAt: this.now() + ttlMs });
    return next;
  }

  addDistinct(key: string, member: string, ttlMs: number): Promise<number> {
    const now = this.now();
    const existing = this.sets.get(key);
    const values = existing && existing.expiresAt > now ? existing.value : new Set<string>();
    values.add(member);
    this.sets.set(key, { value: values, expiresAt: now + ttlMs });
    return Promise.resolve(values.size);
  }
}
