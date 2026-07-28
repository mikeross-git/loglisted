import type { AnonymousSessionManager } from "../lib/anonymous-session.js";
import { hashDeviceId } from "../lib/anonymous-session.js";
import { validateCsrfToken } from "../lib/csrf.js";
import { AppError, AuthorizationError } from "../lib/errors.js";
import { hashIp, resolveClientIp, type TrustedProxyOptions } from "../lib/ip.js";
import { corsHeaders, validateSiteOrigin, type OriginPolicy } from "../lib/origin.js";
import type { AnonymousQuotas } from "../lib/quotas.js";
import type { SlidingWindowRateLimiter } from "../lib/rate-limit.js";
import { assessRisk } from "../lib/risk.js";
import { withSecurityHeaders } from "../lib/security-headers.js";
import {
  UploadAuthorizationInputSchema,
  validateSubmissionTiming,
} from "../lib/submission-validation.js";
import type { AbuseStore } from "../lib/storage/abuse-store.js";
import type { TurnstileVerifier } from "../lib/turnstile.js";
import type { UploadTokenManager } from "../lib/upload-token.js";

export interface UploadAuthorizeDependencies {
  sessions: AnonymousSessionManager;
  csrfSigningSecret: string;
  deviceHmacSecret: string;
  ipHmacSecret: string;
  directIp: string;
  trustedProxy: TrustedProxyOptions;
  originPolicy: OriginPolicy;
  turnstile: TurnstileVerifier;
  rateLimiter: SlidingWindowRateLimiter;
  quotas: AnonymousQuotas;
  abuseStore: AbuseStore;
  uploadTokens: UploadTokenManager;
  findCachedResult?: (
    fileHash: string,
    sessionId: string,
  ) => Promise<{
    resultId: string;
    resultAccessToken: string;
    deletionToken?: string;
  } | null>;
  now?: () => Date;
  globalAnalysesPerMinute?: number;
  telemetryTtlMs?: number;
  maxFileBytes?: number;
  authorizationAttemptsPer10Minutes?: number;
  aiProcessingPolicyVersion?: string;
  privacyNoticeVersion?: string;
}

export async function postUploadAuthorize(
  request: Request,
  dependencies: UploadAuthorizeDependencies,
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
    const input = UploadAuthorizationInputSchema.parse(await request.json());
    if (input.fileSize > (dependencies.maxFileBytes ?? 15 * 1024 * 1024)) {
      throw new AuthorizationError("Submission rejected.");
    }
    const suppliedDeviceHash = hashDeviceId(input.deviceId, dependencies.deviceHmacSecret);
    const directIp = resolveClientIp(
      dependencies.directIp,
      request.headers.get("x-forwarded-for"),
      dependencies.trustedProxy,
    );
    const hashedIp = hashIp(directIp, dependencies.ipHmacSecret);
    const now = dependencies.now?.() ?? new Date();
    const telemetryTtl = dependencies.telemetryTtlMs ?? 90 * 24 * 60 * 60_000;

    const [ipAttempts, sessionAttempts] = await Promise.all([
      dependencies.rateLimiter.check(
        `authorize:ip:${hashedIp}`,
        dependencies.authorizationAttemptsPer10Minutes ?? 3,
        10 * 60_000,
      ),
      dependencies.rateLimiter.check(
        `authorize:session:${session.anonymousSessionId}`,
        dependencies.authorizationAttemptsPer10Minutes ?? 3,
        10 * 60_000,
      ),
      dependencies.rateLimiter.check(
        "authorize:global",
        dependencies.globalAnalysesPerMinute ?? 60,
        60_000,
      ),
    ]);
    const timing = validateSubmissionTiming(input, now);
    if (timing.honeypotCompleted) throw new AuthorizationError("Submission rejected.");
    if (timing.futureTimestamps || timing.staleTimestamps) {
      throw new AuthorizationError("Submission rejected.");
    }
    if ((await dependencies.abuseStore.getCount(`turnstile-fail:${hashedIp}`)) >= 3) {
      throw new AuthorizationError("Submission rejected.");
    }
    try {
      await dependencies.turnstile.verify(input.turnstileToken);
    } catch (error) {
      const failures = await dependencies.abuseStore.incrementCount(
        `turnstile-fail:${hashedIp}`,
        15 * 60_000,
      );
      if (failures >= 3) throw new AuthorizationError("Submission rejected.", { cause: error });
      throw error;
    }
    await dependencies.quotas.assertCompletedQuota(session.anonymousSessionId, hashedIp);
    const [fileSessionCount, deviceCount, ipCount, duplicateAttempts] = await Promise.all([
      dependencies.abuseStore.addDistinct(
        `file-sessions:${input.fileHash}`,
        session.anonymousSessionId,
        telemetryTtl,
      ),
      dependencies.abuseStore.addDistinct(
        `ip-devices:${hashedIp}`,
        suppliedDeviceHash,
        60 * 60_000,
      ),
      dependencies.abuseStore.addDistinct(
        `session-ips:${session.anonymousSessionId}`,
        hashedIp,
        60 * 60_000,
      ),
      dependencies.abuseStore.incrementWindow(
        `duplicates:${input.fileHash}`,
        now.getTime(),
        60 * 60_000,
        3,
        telemetryTtl,
      ),
    ]);
    if (!duplicateAttempts.allowed) throw new AuthorizationError("Submission rejected.");
    const risk = assessRisk({
      validTurnstile: true,
      sessionOlderThan24Hours: now.getTime() / 1_000 - session.issuedAt > 86_400,
      validOriginAndCsrf: true,
      sameCompletedFileBySession: false,
      suspiciouslyFastForm: timing.suspiciouslyFastForm,
      repeatedAuthorizationAttempts: ipAttempts.count > 1 || sessionAttempts.count > 1,
      invalidTurnstileAttempts: false,
      sameFileAcrossManySessions: fileSessionCount >= 3,
      rapidDeviceRotationOnIp: deviceCount >= 3,
      rapidIpRotationForSession: ipCount >= 3,
      frontendBackendHashMismatch: suppliedDeviceHash !== session.deviceIdHash,
      honeypotCompleted: false,
      uploadTokenReplay: false,
    });
    if (risk.decision === "cooldown" || risk.decision.includes("block")) {
      throw new AuthorizationError("Submission rejected.");
    }
    if (suppliedDeviceHash !== session.deviceIdHash) {
      throw new AuthorizationError("Submission rejected.");
    }
    const cached = await dependencies.findCachedResult?.(
      input.fileHash,
      session.anonymousSessionId,
    );
    if (cached) {
      return Response.json(
        {
          uploadToken: null,
          expiresAt: null,
          cachedResultAvailable: true,
          resultAccessToken: cached.resultAccessToken,
          resultId: cached.resultId,
          ...(cached.deletionToken ? { deletionToken: cached.deletionToken } : {}),
        },
        {
          headers: withSecurityHeaders(corsHeaders(origin, dependencies.originPolicy)),
        },
      );
    }
    const issued = dependencies.uploadTokens.issue({
      anonymousSessionId: session.anonymousSessionId,
      deviceIdHash: session.deviceIdHash,
      fileHash: input.fileHash,
      fileSize: input.fileSize,
      mimeType: input.mimeType,
      ...(input.project.firstName ? { firstName: input.project.firstName } : {}),
      ...(input.project.lastName ? { lastName: input.project.lastName } : {}),
      ...(input.project.email ? { email: input.project.email } : {}),
      ...(input.project.imdbUrl ? { imdbUrl: input.project.imdbUrl } : {}),
      projectTitle: input.project.projectTitle,
      declaredFormat: input.project.format,
      primaryGenre: input.project.primaryGenre,
      aiProcessingPolicyVersion: dependencies.aiProcessingPolicyVersion ?? "ai-processing-policy-1",
      privacyNoticeVersion: dependencies.privacyNoticeVersion ?? "privacy-notice-1",
    });
    return Response.json(
      {
        uploadToken: issued.token,
        expiresAt: new Date(issued.claims.expiresAt * 1_000).toISOString(),
        cachedResultAvailable: false,
        resultAccessToken: null,
      },
      { headers: withSecurityHeaders(corsHeaders(origin, dependencies.originPolicy)) },
    );
  } catch (error) {
    const status = error instanceof AppError ? error.statusCode : 400;
    return Response.json(
      {
        error: {
          code: "UPLOAD_AUTHORIZATION_REJECTED",
          message: "The upload could not be authorized.",
        },
      },
      {
        status,
        headers: withSecurityHeaders(
          origin ? corsHeaders(origin, dependencies.originPolicy) : undefined,
        ),
      },
    );
  }
}
