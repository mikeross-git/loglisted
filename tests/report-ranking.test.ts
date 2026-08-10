import { describe, expect, it, vi } from "vitest";
import { postRankingReport } from "../src/api/report-ranking.js";
import { AnonymousSessionManager } from "../src/lib/anonymous-session.js";
import { SlidingWindowRateLimiter } from "../src/lib/rate-limit.js";
import { MemoryAbuseStore } from "../src/lib/storage/memory-abuse-store.js";
import { MemoryModerationReportStore } from "../src/lib/storage/moderation-report-store.js";
import type { FramerCmsModerationService } from "../src/integrations/framer-cms.js";
import type { FramerRankingsReader } from "../src/integrations/framer-rankings.js";
import type { TurnstileVerifier } from "../src/lib/turnstile.js";

const secret = "0123456789abcdef0123456789abcdef";

function setup() {
  const sessions = new AnonymousSessionManager({
    signingSecret: secret,
    deviceHmacSecret: secret,
    csrfSigningSecret: secret,
    cookieSameSite: "None",
  });
  const created = sessions.create("00000000-0000-4000-8000-000000000001");
  const cms = { flagPublishedRanking: vi.fn().mockResolvedValue("flagged") };
  const rankings = { invalidateCache: vi.fn() };
  const turnstile = { verify: vi.fn().mockResolvedValue(undefined) };
  return {
    created,
    cms,
    rankings,
    turnstile,
    dependencies: {
      sessions,
      csrfSigningSecret: secret,
      ipHmacSecret: secret,
      directIp: "127.0.0.1",
      originPolicy: {
        allowedOrigins: ["https://www.loglisted.com"],
        allowedMethods: ["GET", "POST", "OPTIONS"],
        allowedContentTypes: ["application/json"],
      },
      turnstile: turnstile as unknown as TurnstileVerifier,
      rateLimiter: new SlidingWindowRateLimiter(new MemoryAbuseStore(), 86_400_000),
      store: new MemoryModerationReportStore(),
      cms: cms as unknown as FramerCmsModerationService,
      rankings: rankings as unknown as FramerRankingsReader,
      retentionSeconds: 86_400,
      sessionDailyLimit: 3,
      ipDailyLimit: 5,
    },
  };
}

function request(cookie: string, csrfToken: string) {
  return new Request("https://api.loglisted.com/api/rankings/report", {
    method: "POST",
    headers: {
      origin: "https://www.loglisted.com",
      referer: "https://www.loglisted.com/loglist",
      cookie,
      "content-type": "application/json",
      "x-csrf-token": csrfToken,
    },
    body: JSON.stringify({
      rankingSlug: "sample-script-12345678",
      reason: "copyright",
      details: "Possible copied screenplay.",
      turnstileToken: "verified-token",
    }),
  });
}

describe("ranking reports", () => {
  it("verifies, flags, and invalidates the public snapshot", async () => {
    const { created, dependencies, cms, rankings, turnstile } = setup();
    const response = await postRankingReport(
      request(created.cookie, created.csrfToken),
      dependencies,
    );
    expect(response.status).toBe(201);
    expect(turnstile.verify).toHaveBeenCalledWith("verified-token");
    expect(cms.flagPublishedRanking).toHaveBeenCalledOnce();
    expect(rankings.invalidateCache).toHaveBeenCalledOnce();
  });

  it("rejects a second report while a listing is pending", async () => {
    const { created, dependencies, cms } = setup();
    expect(
      (await postRankingReport(request(created.cookie, created.csrfToken), dependencies)).status,
    ).toBe(201);
    expect(
      (await postRankingReport(request(created.cookie, created.csrfToken), dependencies)).status,
    ).toBe(429);
    expect(cms.flagPublishedRanking).toHaveBeenCalledTimes(1);
  });
});
