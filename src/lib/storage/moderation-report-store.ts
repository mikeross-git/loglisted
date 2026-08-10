import { z } from "zod";
import type { UpstashRedisCompatibleClient } from "./upstash-redis-client.js";

export const ModerationReportSchema = z.object({
  version: z.literal(1),
  reportId: z.string().uuid(),
  rankingSlug: z.string().min(1).max(200),
  reason: z.enum(["copyright", "inappropriate", "spam", "other"]),
  details: z.string().max(500),
  status: z.literal("pending_review"),
  anonymousSessionHash: z.string().regex(/^[a-f0-9]{64}$/),
  deviceHash: z.string().regex(/^[a-f0-9]{64}$/),
  ipHash: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.string().datetime(),
});

export type ModerationReport = z.infer<typeof ModerationReportSchema>;

export interface ModerationReportStore {
  reserve(report: ModerationReport, ttlSeconds: number): Promise<boolean>;
  release(rankingSlug: string, reportId: string): Promise<void>;
}

export class MemoryModerationReportStore implements ModerationReportStore {
  private readonly pending = new Map<string, string>();

  reserve(report: ModerationReport): Promise<boolean> {
    if (this.pending.has(report.rankingSlug)) return Promise.resolve(false);
    this.pending.set(report.rankingSlug, report.reportId);
    return Promise.resolve(true);
  }

  release(rankingSlug: string, reportId: string): Promise<void> {
    if (this.pending.get(rankingSlug) === reportId) this.pending.delete(rankingSlug);
    return Promise.resolve();
  }
}

export class RedisModerationReportStore implements ModerationReportStore {
  constructor(
    private readonly redis: UpstashRedisCompatibleClient,
    private readonly prefix = "loglisted:moderation:v1",
  ) {}

  async reserve(report: ModerationReport, ttlSeconds: number): Promise<boolean> {
    const parsed = ModerationReportSchema.parse(report);
    const result = await this.redis.eval<number>(
      `if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
       redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3])
       redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[3])
       return 1`,
      [`${this.prefix}:pending:${parsed.rankingSlug}`, `${this.prefix}:report:${parsed.reportId}`],
      [parsed.reportId, JSON.stringify(parsed), ttlSeconds],
    );
    return result === 1;
  }

  async release(rankingSlug: string, reportId: string): Promise<void> {
    await this.redis.eval<number>(
      `if redis.call('GET', KEYS[1]) == ARGV[1] then
         redis.call('DEL', KEYS[1])
         redis.call('DEL', KEYS[2])
         return 1
       end
       return 0`,
      [`${this.prefix}:pending:${rankingSlug}`, `${this.prefix}:report:${reportId}`],
      [reportId],
    );
  }
}
