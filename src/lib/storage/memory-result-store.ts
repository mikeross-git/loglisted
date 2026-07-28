import type { ResultStore, StoredResult } from "./result-store.js";
import { StoredResultSchema } from "./result-store.js";

interface Entry {
  result: StoredResult;
  expiresAt: number;
}

export class MemoryResultStore implements ResultStore {
  private readonly values = new Map<string, Entry>();
  private readonly index = new Map<string, string>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  put(resultInput: StoredResult, ttlSeconds: number): Promise<void> {
    const result = StoredResultSchema.parse(resultInput);
    this.values.set(result.resultId, {
      result,
      expiresAt: this.now() + ttlSeconds * 1_000,
    });
    this.index.set(`${result.fileHash}:${result.anonymousSessionId}`, result.resultId);
    return Promise.resolve();
  }

  get(resultId: string): Promise<StoredResult | null> {
    const entry = this.values.get(resultId);
    if (!entry || entry.expiresAt <= this.now()) {
      this.values.delete(resultId);
      if (entry) {
        this.index.delete(`${entry.result.fileHash}:${entry.result.anonymousSessionId}`);
      }
      return Promise.resolve(null);
    }
    return Promise.resolve(entry.result);
  }

  async findByFileAndSession(
    fileHash: string,
    anonymousSessionId: string,
  ): Promise<StoredResult | null> {
    const resultId = this.index.get(`${fileHash}:${anonymousSessionId}`);
    return resultId ? this.get(resultId) : null;
  }

  delete(resultId: string): Promise<boolean> {
    const entry = this.values.get(resultId);
    if (!entry) return Promise.resolve(false);
    this.values.delete(resultId);
    this.index.delete(`${entry.result.fileHash}:${entry.result.anonymousSessionId}`);
    return Promise.resolve(true);
  }
}
