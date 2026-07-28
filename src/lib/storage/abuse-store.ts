export interface WindowResult {
  allowed: boolean;
  count: number;
  retryAfterMs: number;
}

export interface AbuseStore {
  incrementWindow(
    key: string,
    nowMs: number,
    windowMs: number,
    limit: number,
    telemetryTtlMs: number,
  ): Promise<WindowResult>;
  consumeOnce(key: string, ttlMs: number): Promise<boolean>;
  acquireConcurrency(key: string, ttlMs: number, maximum: number): Promise<boolean>;
  releaseConcurrency(key: string): Promise<void>;
  getCount(key: string): Promise<number>;
  incrementCount(key: string, ttlMs: number): Promise<number>;
  addDistinct(key: string, member: string, ttlMs: number): Promise<number>;
}
