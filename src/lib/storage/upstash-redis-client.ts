import { ProcessingCapacityError, ValidationError } from "../errors.js";
import type { RedisEvalClient } from "../spend-circuit-breaker.js";
import type { RedisAbuseClient } from "./redis-abuse-store.js";
import type { RedisCacheClient } from "./redis-cache-store.js";
import type { RedisResultClient } from "./redis-result-store.js";

interface UpstashResponse<T> {
  result?: T;
  error?: string;
}

export type UpstashRedisCompatibleClient = RedisCacheClient &
  RedisAbuseClient &
  RedisResultClient &
  RedisEvalClient;

export interface UpstashRedisClientOptions {
  url: string;
  token: string;
  fetchImplementation?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Minimal server-only Upstash REST adapter. Command values and responses are
 * deliberately excluded from logging because cache values may contain
 * screenplay-derived data.
 */
export class UpstashRedisClient implements UpstashRedisCompatibleClient {
  private readonly url: string;
  private readonly fetchImplementation: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: UpstashRedisClientOptions) {
    this.url = new URL(options.url).toString().replace(/\/$/, "");
    if (!options.token) throw new ValidationError("Upstash Redis token is required.");
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 5_000;
  }

  private async command<T>(arguments_: readonly (string | number)[]): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImplementation(this.url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.options.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(arguments_),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new ProcessingCapacityError("Redis is temporarily unavailable.", { cause: error });
    }
    if (!response.ok) {
      throw new ProcessingCapacityError("Redis request was rejected.");
    }
    let envelope: UpstashResponse<T>;
    try {
      envelope = (await response.json()) as UpstashResponse<T>;
    } catch (error) {
      throw new ProcessingCapacityError("Redis returned an invalid response.", { cause: error });
    }
    if (envelope.error || !("result" in envelope)) {
      throw new ProcessingCapacityError("Redis command failed.");
    }
    return envelope.result;
  }

  get(key: string): Promise<string | null> {
    return this.command<string | null>(["GET", key]);
  }

  set(
    key: string,
    value: string,
    options: { ex?: number; px?: number; nx?: boolean },
  ): Promise<unknown> {
    const command: (string | number)[] = ["SET", key, value];
    if (options.ex !== undefined) command.push("EX", options.ex);
    if (options.px !== undefined) command.push("PX", options.px);
    if (options.nx) command.push("NX");
    return this.command<unknown>(command);
  }

  del(key: string): Promise<number> {
    return this.command<number>(["DEL", key]);
  }

  eval<T>(script: string, keys: string[], args: (string | number)[]): Promise<T> {
    return this.command<T>(["EVAL", script, keys.length, ...keys, ...args]);
  }

  scan(
    cursor: number,
    options: { match: string; count: number },
  ): Promise<[number | string, string[]]> {
    return this.command<[number | string, string[]]>([
      "SCAN",
      cursor,
      "MATCH",
      options.match,
      "COUNT",
      options.count,
    ]);
  }
}
