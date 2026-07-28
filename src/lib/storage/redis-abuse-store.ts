import type { AbuseStore, WindowResult } from "./abuse-store.js";

export interface RedisAbuseClient {
  eval<T>(script: string, keys: string[], args: (string | number)[]): Promise<T>;
}

const WINDOW_LUA = `
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", ARGV[1] - ARGV[2])
redis.call("ZADD", KEYS[1], ARGV[1], ARGV[3])
redis.call("PEXPIRE", KEYS[1], ARGV[4])
local count = redis.call("ZCARD", KEYS[1])
local oldest = redis.call("ZRANGE", KEYS[1], 0, 0, "WITHSCORES")
local retry = 0
if count > tonumber(ARGV[5]) and oldest[2] then retry = math.max(0, oldest[2] + ARGV[2] - ARGV[1]) end
return {count, retry}
`;

export class RedisAbuseStore implements AbuseStore {
  constructor(
    private readonly redis: RedisAbuseClient,
    private readonly prefix = "loglisted:production:v1:abuse",
  ) {}

  async incrementWindow(
    key: string,
    nowMs: number,
    windowMs: number,
    limit: number,
    telemetryTtlMs: number,
  ): Promise<WindowResult> {
    const nonce = `${nowMs}:${crypto.randomUUID()}`;
    const result = await this.redis.eval<[number, number]>(
      WINDOW_LUA,
      [`${this.prefix}:${key}`],
      [nowMs, windowMs, nonce, telemetryTtlMs, limit],
    );
    const count = result[0] ?? 0;
    return { allowed: count <= limit, count, retryAfterMs: result[1] ?? 0 };
  }

  async consumeOnce(key: string, ttlMs: number): Promise<boolean> {
    const result = await this.redis.eval<number>(
      `local value = redis.call("SET", KEYS[1], "1", "PX", ARGV[1], "NX")
       if value then return 1 else return 0 end`,
      [`${this.prefix}:${key}`],
      [ttlMs],
    );
    return result === 1;
  }

  async acquireConcurrency(key: string, ttlMs: number, maximum: number): Promise<boolean> {
    const result = await this.redis.eval<number>(
      `local count = tonumber(redis.call("GET", KEYS[1]) or "0")
       if count >= tonumber(ARGV[1]) then return 0 end
       redis.call("INCR", KEYS[1]); redis.call("PEXPIRE", KEYS[1], ARGV[2]); return 1`,
      [`${this.prefix}:${key}`],
      [maximum, ttlMs],
    );
    return result === 1;
  }

  async releaseConcurrency(key: string): Promise<void> {
    await this.redis.eval<number>(
      `local count = tonumber(redis.call("GET", KEYS[1]) or "0")
       if count <= 1 then return redis.call("DEL", KEYS[1]) end
       return redis.call("DECR", KEYS[1])`,
      [`${this.prefix}:${key}`],
      [],
    );
  }

  getCount(key: string): Promise<number> {
    return this.redis.eval<number>(
      `return tonumber(redis.call("GET", KEYS[1]) or "0")`,
      [`${this.prefix}:${key}`],
      [],
    );
  }

  incrementCount(key: string, ttlMs: number): Promise<number> {
    return this.redis.eval<number>(
      `local value = redis.call("INCR", KEYS[1]); redis.call("PEXPIRE", KEYS[1], ARGV[1]); return value`,
      [`${this.prefix}:${key}`],
      [ttlMs],
    );
  }

  addDistinct(key: string, member: string, ttlMs: number): Promise<number> {
    return this.redis.eval<number>(
      `redis.call("SADD", KEYS[1], ARGV[1]); redis.call("PEXPIRE", KEYS[1], ARGV[2]); return redis.call("SCARD", KEYS[1])`,
      [`${this.prefix}:${key}`],
      [member, ttlMs],
    );
  }
}
