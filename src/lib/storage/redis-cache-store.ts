import type { CacheStore } from "./cache-store.js";
import {
  ProcessingLockStateSchema,
  type ProcessingLockState,
  type ProcessingLockStore,
} from "./processing-lock.js";

export interface RedisCacheClient {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    options: { ex?: number; px?: number; nx?: boolean },
  ): Promise<unknown>;
  del(key: string): Promise<number>;
  eval<T>(script: string, keys: string[], args: (string | number)[]): Promise<T>;
  scan(
    cursor: number,
    options: { match: string; count: number },
  ): Promise<[number | string, string[]]>;
}

const ACQUIRE_SCRIPT = `
local existing = redis.call("GET", KEYS[1])
if existing then return existing end
local written = redis.call("SET", KEYS[1], ARGV[1], "PX", ARGV[2], "NX")
if written then return ARGV[1] end
return redis.call("GET", KEYS[1])
`;

const COMPLETE_SCRIPT = `
local existing = redis.call("GET", KEYS[1])
if not existing then return 0 end
local decoded = cjson.decode(existing)
if decoded.status ~= "processing" or decoded.ownerToken ~= ARGV[1] then return 0 end
redis.call("SET", KEYS[1], ARGV[2], "PX", ARGV[3])
return 1
`;

const RELEASE_SCRIPT = `
local existing = redis.call("GET", KEYS[1])
if not existing then return 0 end
local decoded = cjson.decode(existing)
if decoded.status ~= "processing" or decoded.ownerToken ~= ARGV[1] then return 0 end
return redis.call("DEL", KEYS[1])
`;

export class RedisCacheStore implements CacheStore, ProcessingLockStore {
  constructor(private readonly redis: RedisCacheClient) {}

  get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(key, value, { ex: ttlSeconds });
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async deleteMatching(pattern: string): Promise<number> {
    let cursor: number | string = 0;
    let deleted = 0;
    do {
      const result = await this.redis.scan(Number(cursor), { match: pattern, count: 100 });
      cursor = result[0];
      const keys = result[1];
      for (const key of keys) deleted += await this.redis.del(key);
    } while (String(cursor) !== "0");
    return deleted;
  }

  async acquire(
    key: string,
    ownerToken: string,
    lockTtlMs: number,
    now: Date,
  ): Promise<ProcessingLockState> {
    const state: ProcessingLockState = {
      status: "processing",
      ownerToken,
      startedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + lockTtlMs).toISOString(),
    };
    const serialized = await this.redis.eval<string>(
      ACQUIRE_SCRIPT,
      [key],
      [JSON.stringify(state), lockTtlMs],
    );
    return ProcessingLockStateSchema.parse(JSON.parse(serialized));
  }

  async complete(
    key: string,
    ownerToken: string,
    resultKey: string,
    terminalTtlMs: number,
    now: Date,
  ): Promise<boolean> {
    const state: ProcessingLockState = {
      status: "completed",
      resultKey,
      completedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + terminalTtlMs).toISOString(),
    };
    const result = await this.redis.eval<number>(
      COMPLETE_SCRIPT,
      [key],
      [ownerToken, JSON.stringify(state), terminalTtlMs],
    );
    return result === 1;
  }

  async fail(
    key: string,
    ownerToken: string,
    failureCode: string,
    terminalTtlMs: number,
    now: Date,
  ): Promise<boolean> {
    const state: ProcessingLockState = {
      status: "failed",
      failureCode,
      failedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + terminalTtlMs).toISOString(),
    };
    const result = await this.redis.eval<number>(
      COMPLETE_SCRIPT,
      [key],
      [ownerToken, JSON.stringify(state), terminalTtlMs],
    );
    return result === 1;
  }

  async release(key: string, ownerToken: string): Promise<boolean> {
    const result = await this.redis.eval<number>(RELEASE_SCRIPT, [key], [ownerToken]);
    return result === 1;
  }

  async getState(key: string, now: Date): Promise<ProcessingLockState | null> {
    void now;
    const serialized = await this.redis.get(key);
    return serialized ? ProcessingLockStateSchema.parse(JSON.parse(serialized)) : null;
  }
}
