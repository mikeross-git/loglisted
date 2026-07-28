import type { ResultStore, StoredResult } from "./result-store.js";
import { StoredResultSchema } from "./result-store.js";

export interface RedisResultClient {
  get(key: string): Promise<string | null>;
  eval<T>(script: string, keys: string[], args: (string | number)[]): Promise<T>;
}

const PUT_RESULT_LUA = `
redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[3])
redis.call("SET", KEYS[2], ARGV[2], "EX", ARGV[3])
return 1
`;
const DELETE_RESULT_LUA = `
redis.call("DEL", KEYS[1])
redis.call("DEL", KEYS[2])
return 1
`;

export class RedisResultStore implements ResultStore {
  constructor(
    private readonly redis: RedisResultClient,
    private readonly prefix = "loglisted:production:v1:result",
  ) {}

  async put(resultInput: StoredResult, ttlSeconds: number): Promise<void> {
    const result = StoredResultSchema.parse(resultInput);
    await this.redis.eval<number>(
      PUT_RESULT_LUA,
      [
        `${this.prefix}:${result.resultId}`,
        `${this.prefix}:index:${result.fileHash}:${result.anonymousSessionId}`,
      ],
      [JSON.stringify(result), result.resultId, ttlSeconds],
    );
  }

  async get(resultId: string): Promise<StoredResult | null> {
    const serialized = await this.redis.get(`${this.prefix}:${resultId}`);
    return serialized ? StoredResultSchema.parse(JSON.parse(serialized)) : null;
  }

  async findByFileAndSession(
    fileHash: string,
    anonymousSessionId: string,
  ): Promise<StoredResult | null> {
    const resultId = await this.redis.get(`${this.prefix}:index:${fileHash}:${anonymousSessionId}`);
    return resultId ? this.get(resultId) : null;
  }

  async delete(resultId: string): Promise<boolean> {
    const result = await this.get(resultId);
    if (!result) return false;
    const deleted = await this.redis.eval<number>(
      DELETE_RESULT_LUA,
      [
        `${this.prefix}:${result.resultId}`,
        `${this.prefix}:index:${result.fileHash}:${result.anonymousSessionId}`,
      ],
      [],
    );
    return deleted === 1;
  }
}
