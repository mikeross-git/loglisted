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
    reason: z.enum(["copyright", "impersonation", "inappropriate", "spam", "suspicious", "other"]),
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
  onRejection?: (diagnostic: RankingReportRejectionDiagnostic) => void;
}

export type RankingReportStage =
  "origin" | "session" | "csrf" | "input" | "rate_limit" | "turnstile" | "reservation" | "cms";

export interface RankingReportRejectionDiagnostic {
  stage: RankingReportStage;
  errorClass: string;
  status: number;
  reasonCode?: string;
}

function digest(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

export async function postRankingReport(
  request: Request,
  dependencies: ReportRankingDependencies,
): Promise<Response> {
  let origin: string | undefined;
  let stage: RankingReportStage = "origin";
  try {
    ({ origin } = validateSiteOrigin(request, dependencies.originPolicy));
    stage = "session";
    const session = dependencies.sessions.parseCookieHeader(request.headers.get("cookie"));
    stage = "csrf";
    validateCsrfToken(
      request.headers.get("x-csrf-token"),
      dependencies.csrfSigningSecret,
      session.anonymousSessionId,
      session.csrfSecret,
    );
    stage = "input";
    const input = ReportRequestSchema.parse(await request.json());
    const ipHash = hashIp(dependencies.directIp, dependencies.ipHmacSecret);
    stage = "rate_limit";
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
    stage = "turnstile";
    await dependencies.turnstile.verify(input.turnstileToken);
    const reportId = randomUUID();
    const createdAt = new Date().toISOString();
    stage = "reservation";
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
      stage = "cms";
      const outcome = await dependencies.cms.flagPublishedRanking({
        slug: input.rankingSlug,
        reportId,
        reason: input.reason,
        details: input.details,
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
    try {
      dependencies.onRejection?.({
        stage,
        errorClass: error instanceof Error ? error.name : "UnknownError",
        status,
        ...(error instanceof AppError && typeof error.details?.["reasonCode"] === "string"
          ? { reasonCode: error.details["reasonCode"] }
          : {}),
      });
    } catch {
      // Diagnostics must never change the public report response.
    }
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
