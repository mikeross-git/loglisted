import type { CacheStore } from "./cache-store.js";
import {
  ProcessingLockStateSchema,
  type ProcessingLockState,
  type ProcessingLockStore,
} from "./processing-lock.js";

interface CacheEntry {
  value: string;
  expiresAtMs: number;
}

export class MemoryCacheStore implements CacheStore, ProcessingLockStore {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly locks = new Map<string, ProcessingLockState>();

  constructor(private readonly nowMs: () => number = () => Date.now()) {}

  get(key: string): Promise<string | null> {
    const entry = this.cache.get(key);
    if (!entry) return Promise.resolve(null);
    if (entry.expiresAtMs <= this.nowMs()) {
      this.cache.delete(key);
      return Promise.resolve(null);
    }
    return Promise.resolve(entry.value);
  }

  set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.cache.set(key, {
      value,
      expiresAtMs: this.nowMs() + ttlSeconds * 1_000,
    });
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.cache.delete(key);
    return Promise.resolve();
  }

  deleteMatching(pattern: string): Promise<number> {
    const expression = new RegExp(
      `^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*")}$`,
    );
    let deleted = 0;
    for (const key of this.cache.keys()) {
      if (expression.test(key)) {
        this.cache.delete(key);
        deleted += 1;
      }
    }
    return Promise.resolve(deleted);
  }

  private liveLock(key: string, now: Date): ProcessingLockState | null {
    const state = this.locks.get(key);
    if (!state) return null;
    if (Date.parse(state.expiresAt) <= now.getTime()) {
      this.locks.delete(key);
      return null;
    }
    return state;
  }

  acquire(
    key: string,
    ownerToken: string,
    lockTtlMs: number,
    now: Date,
  ): Promise<ProcessingLockState> {
    const existing = this.liveLock(key, now);
    if (existing) return Promise.resolve(existing);
    const state: ProcessingLockState = {
      status: "processing",
      ownerToken,
      startedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + lockTtlMs).toISOString(),
    };
    this.locks.set(key, state);
    return Promise.resolve(state);
  }

  complete(
    key: string,
    ownerToken: string,
    resultKey: string,
    terminalTtlMs: number,
    now: Date,
  ): Promise<boolean> {
    const existing = this.liveLock(key, now);
    if (existing?.status !== "processing" || existing.ownerToken !== ownerToken) {
      return Promise.resolve(false);
    }
    this.locks.set(key, {
      status: "completed",
      resultKey,
      completedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + terminalTtlMs).toISOString(),
    });
    return Promise.resolve(true);
  }

  fail(
    key: string,
    ownerToken: string,
    failureCode: string,
    terminalTtlMs: number,
    now: Date,
  ): Promise<boolean> {
    const existing = this.liveLock(key, now);
    if (existing?.status !== "processing" || existing.ownerToken !== ownerToken) {
      return Promise.resolve(false);
    }
    this.locks.set(key, {
      status: "failed",
      failureCode,
      failedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + terminalTtlMs).toISOString(),
    });
    return Promise.resolve(true);
  }

  release(key: string, ownerToken: string): Promise<boolean> {
    const existing = this.locks.get(key);
    if (existing?.status !== "processing" || existing.ownerToken !== ownerToken) {
      return Promise.resolve(false);
    }
    this.locks.delete(key);
    return Promise.resolve(true);
  }

  getState(key: string, now: Date): Promise<ProcessingLockState | null> {
    const state = this.liveLock(key, now);
    return Promise.resolve(state ? ProcessingLockStateSchema.parse(state) : null);
  }
}
