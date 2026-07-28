import { calculateSha256 } from "../lib/file-hash.js";
import { hasPdfSignature } from "../lib/file-signature.js";
import { analyzeScreenplay, type AnalyzePipelineDependencies } from "../lib/analyze-screenplay.js";
import type { AnonymousSessionManager } from "../lib/anonymous-session.js";
import { AppError, AuthorizationError, UnsupportedFileError } from "../lib/errors.js";
import { hashIp, resolveClientIp, type TrustedProxyOptions } from "../lib/ip.js";
import { corsHeaders, validateSiteOrigin, type OriginPolicy } from "../lib/origin.js";
import type { AnonymousQuotas } from "../lib/quotas.js";
import type { SlidingWindowRateLimiter } from "../lib/rate-limit.js";
import { withSecurityHeaders } from "../lib/security-headers.js";
import type { UploadTokenManager } from "../lib/upload-token.js";
import { discardSensitiveBuffer } from "../lib/data-retention.js";

export interface AnalyzeDependencies extends AnalyzePipelineDependencies {
  sessions: AnonymousSessionManager;
  uploadTokens: UploadTokenManager;
  quotas: AnonymousQuotas;
  rateLimiter: SlidingWindowRateLimiter;
  originPolicy: OriginPolicy;
  directIp: string;
  trustedProxy: TrustedProxyOptions;
  ipHmacSecret: string;
  analysisAttemptsPer10Minutes?: number;
  admitGlobalCapacity?: () => Promise<void>;
}

export async function postAnalyze(
  request: Request,
  dependencies: AnalyzeDependencies,
): Promise<Response> {
  let origin: string | undefined;
  let releaseConcurrency: (() => Promise<void>) | undefined;
  let uploadedBuffer: Uint8Array | undefined;
  try {
    ({ origin } = validateSiteOrigin(request, dependencies.originPolicy));
    const session = dependencies.sessions.parseCookieHeader(request.headers.get("cookie"));
    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer "))
      throw new AuthorizationError("Upload token missing.");
    const claims = dependencies.uploadTokens.verify(authorization.slice(7), session);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new UnsupportedFileError("PDF file is missing.");
    if (file.size !== claims.fileSize || file.type !== claims.mimeType) {
      throw new UnsupportedFileError("Uploaded file does not match authorization.");
    }
    uploadedBuffer = new Uint8Array(await file.arrayBuffer());
    if (!hasPdfSignature(uploadedBuffer)) throw new UnsupportedFileError("Invalid PDF signature.");
    if (calculateSha256(uploadedBuffer) !== claims.fileHash) {
      throw new UnsupportedFileError("Uploaded file hash does not match authorization.");
    }
    await dependencies.uploadTokens.consume(claims);
    const clientIp = resolveClientIp(
      dependencies.directIp,
      request.headers.get("x-forwarded-for"),
      dependencies.trustedProxy,
    );
    const hashedIp = hashIp(clientIp, dependencies.ipHmacSecret);
    await dependencies.quotas.assertCompletedQuota(session.anonymousSessionId, hashedIp);
    await Promise.all([
      dependencies.rateLimiter.check(
        `analyze:session:${session.anonymousSessionId}`,
        dependencies.analysisAttemptsPer10Minutes ?? 3,
        10 * 60_000,
      ),
      dependencies.rateLimiter.check(
        `analyze:ip:${hashedIp}`,
        dependencies.analysisAttemptsPer10Minutes ?? 3,
        10 * 60_000,
      ),
    ]);
    releaseConcurrency = await dependencies.quotas.reserveConcurrency(
      session.anonymousSessionId,
      hashedIp,
    );
    await dependencies.admitGlobalCapacity?.();
    const analyzed = await analyzeScreenplay(uploadedBuffer, claims, dependencies);
    await dependencies.quotas.recordCompleted(session.anonymousSessionId, hashedIp);
    return Response.json(
      {
        resultId: analyzed.result.resultId,
        resultAccessToken: analyzed.resultAccessToken,
        deletionToken: analyzed.deletionToken,
        categoryScores: analyzed.result.categoryScores,
        overallScore: analyzed.result.overallScore,
        ...(analyzed.result.internal.evaluationMode
          ? { evaluationMode: analyzed.result.internal.evaluationMode }
          : {}),
      },
      { headers: withSecurityHeaders(corsHeaders(origin, dependencies.originPolicy)) },
    );
  } catch (error) {
    const status = error instanceof AppError ? error.statusCode : 422;
    return Response.json(
      { error: { code: "ANALYSIS_FAILED", message: "The screenplay could not be analyzed." } },
      {
        status,
        headers: withSecurityHeaders(
          origin ? corsHeaders(origin, dependencies.originPolicy) : undefined,
        ),
      },
    );
  } finally {
    if (uploadedBuffer) discardSensitiveBuffer(uploadedBuffer);
    await releaseConcurrency?.();
  }
}
