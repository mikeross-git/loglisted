import { createHmac, randomUUID } from "node:crypto";
import { z } from "zod";
import type { FramerCmsModerationService } from "../integrations/framer-cms.js";
import type { FramerRankingsReader } from "../integrations/framer-rankings.js";
import type { AnonymousSessionManager } from "../lib/anonymous-session.js";
import { validateCsrfToken } from "../lib/csrf.js";
import { AppError, AuthorizationError, RateLimitError } from "../lib/errors.js";
import { hashIp } from "../lib/ip.js";
import { corsHeaders, validateSiteOrigin, type OriginPolicy } from "../lib/origin.js";
import type { SlidingWindowRateLimiter } from "../lib/rate-limit.js";
import { withSecurityHeaders } from "../lib/security-headers.js";
import type { ModerationReportStore } from "../lib/storage/moderation-report-store.js";
import type { TurnstileVerifier } from "../lib/turnstile.js";

const ReportRequestSchema = z
  .object({
    rankingSlug: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[a-z0-9-]+$/),
    reason: z.enum(["copyright", "inappropriate", "spam", "other"]),
    details: z.string().trim().max(500).default(""),
    turnstileToken: z.string().min(1).max(4096),
  })
  .strict();

export interface ReportRankingDependencies {
  sessions: AnonymousSessionManager;
  csrfSigningSecret: string;
  ipHmacSecret: string;
  directIp: string;
  originPolicy: OriginPolicy;
  turnstile: TurnstileVerifier;
  rateLimiter: SlidingWindowRateLimiter;
  store: ModerationReportStore;
  cms: FramerCmsModerationService;
  rankings: FramerRankingsReader;
  retentionSeconds: number;
  sessionDailyLimit: number;
  ipDailyLimit: number;
}

function digest(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

export async function postRankingReport(
  request: Request,
  dependencies: ReportRankingDependencies,
): Promise<Response> {
  let origin: string | undefined;
  try {
    ({ origin } = validateSiteOrigin(request, dependencies.originPolicy));
    const session = dependencies.sessions.parseCookieHeader(request.headers.get("cookie"));
    validateCsrfToken(
      request.headers.get("x-csrf-token"),
      dependencies.csrfSigningSecret,
      session.anonymousSessionId,
      session.csrfSecret,
    );
    const input = ReportRequestSchema.parse(await request.json());
    const ipHash = hashIp(dependencies.directIp, dependencies.ipHmacSecret);
    await dependencies.rateLimiter.check(
      `moderation:session:${session.anonymousSessionId}`,
      dependencies.sessionDailyLimit,
      86_400_000,
    );
    await dependencies.rateLimiter.check(
      `moderation:ip:${ipHash}`,
      dependencies.ipDailyLimit,
      86_400_000,
    );
    await dependencies.turnstile.verify(input.turnstileToken);
    const reportId = randomUUID();
    const createdAt = new Date().toISOString();
    const reserved = await dependencies.store.reserve(
      {
        version: 1,
        reportId,
        rankingSlug: input.rankingSlug,
        reason: input.reason,
        details: input.details,
        status: "pending_review",
        anonymousSessionHash: digest(
          dependencies.ipHmacSecret,
          `session:${session.anonymousSessionId}`,
        ),
        deviceHash: session.deviceIdHash,
        ipHash,
        createdAt,
      },
      dependencies.retentionSeconds,
    );
    if (!reserved) throw new RateLimitError("This screenplay is already pending review.");
    try {
      const outcome = await dependencies.cms.flagPublishedRanking({
        slug: input.rankingSlug,
        reportId,
        reason: input.reason,
        createdAt,
      });
      if (outcome === "not_found") throw new AuthorizationError("The screenplay is unavailable.");
      if (outcome === "already_pending") {
        return Response.json(
          { reportId, status: "pending_review", alreadyReported: true },
          {
            status: 200,
            headers: withSecurityHeaders(corsHeaders(origin, dependencies.originPolicy)),
          },
        );
      }
      dependencies.rankings.invalidateCache();
      return Response.json(
        { reportId, status: "pending_review" },
        {
          status: 201,
          headers: withSecurityHeaders(corsHeaders(origin, dependencies.originPolicy)),
        },
      );
    } catch (error) {
      await dependencies.store.release(input.rankingSlug, reportId).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    const status =
      error instanceof z.ZodError ? 400 : error instanceof AppError ? error.statusCode : 502;
    const message =
      status === 429
        ? "This report cannot be submitted again right now."
        : status === 400
          ? "Select a valid report reason."
          : "The report could not be submitted. Please try again later.";
    return Response.json(
      { error: { code: "REPORT_REJECTED", message } },
      {
        status,
        headers: withSecurityHeaders(origin ? corsHeaders(origin, dependencies.originPolicy) : {}),
      },
    );
  }
}
