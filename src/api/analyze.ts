import { calculateSha256 } from "../lib/file-hash.js";
import { hasPdfSignature } from "../lib/file-signature.js";
import {
  analyzeScreenplay,
  type AnalyzePipelineDependencies,
  type AnalyzePipelineStage,
} from "../lib/analyze-screenplay.js";
import type { AnonymousSessionManager } from "../lib/anonymous-session.js";
import { AppError, AuthorizationError, UnsupportedFileError } from "../lib/errors.js";
import { hashIp, resolveClientIp, type TrustedProxyOptions } from "../lib/ip.js";
import { corsHeaders, validateSiteOrigin, type OriginPolicy } from "../lib/origin.js";
import type { AnonymousQuotas } from "../lib/quotas.js";
import type { SlidingWindowRateLimiter } from "../lib/rate-limit.js";
import { withSecurityHeaders } from "../lib/security-headers.js";
import type { UploadTokenManager } from "../lib/upload-token.js";
import { discardSensitiveBuffer } from "../lib/data-retention.js";
import type { StoredResult } from "../lib/storage/result-store.js";

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
  onRejection?: (diagnostic: AnalyzeRejectionDiagnostic) => void;
  onSuccessfulResult?: (result: StoredResult) => Promise<void>;
}

export type AnalyzeStage =
  | "origin"
  | "session"
  | "upload_token"
  | "multipart"
  | "file_validation"
  | "token_consumption"
  | "quota"
  | "rate_limit"
  | "concurrency"
  | "global_capacity"
  | AnalyzePipelineStage;

export interface AnalyzeRejectionDiagnostic {
  stage: AnalyzeStage;
  errorClass: string;
  errorCode: string;
  reasonCode?: string;
  status: number;
}

export async function postAnalyze(
  request: Request,
  dependencies: AnalyzeDependencies,
): Promise<Response> {
  let origin: string | undefined;
  let releaseConcurrency: (() => Promise<void>) | undefined;
  let uploadedBuffer: Uint8Array | undefined;
  let stage: AnalyzeStage = "origin";
  try {
    ({ origin } = validateSiteOrigin(request, dependencies.originPolicy));
    stage = "session";
    const session = dependencies.sessions.parseCookieHeader(request.headers.get("cookie"));
    stage = "upload_token";
    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer "))
      throw new AuthorizationError("Upload token missing.");
    const claims = dependencies.uploadTokens.verify(authorization.slice(7), session);
    stage = "multipart";
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new UnsupportedFileError("PDF file is missing.");
    stage = "file_validation";
    if (file.size !== claims.fileSize || file.type !== claims.mimeType) {
      throw new UnsupportedFileError("Uploaded file does not match authorization.");
    }
    uploadedBuffer = new Uint8Array(await file.arrayBuffer());
    if (!hasPdfSignature(uploadedBuffer)) throw new UnsupportedFileError("Invalid PDF signature.");
    if (calculateSha256(uploadedBuffer) !== claims.fileHash) {
      throw new UnsupportedFileError("Uploaded file hash does not match authorization.");
    }
    stage = "token_consumption";
    await dependencies.uploadTokens.consume(claims);
    const clientIp = resolveClientIp(
      dependencies.directIp,
      request.headers.get("x-forwarded-for"),
      dependencies.trustedProxy,
    );
    const hashedIp = hashIp(clientIp, dependencies.ipHmacSecret);
    stage = "quota";
    await dependencies.quotas.assertCompletedQuota(session.anonymousSessionId, hashedIp);
    stage = "rate_limit";
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
    stage = "concurrency";
    releaseConcurrency = await dependencies.quotas.reserveConcurrency(
      session.anonymousSessionId,
      hashedIp,
    );
    stage = "global_capacity";
    await dependencies.admitGlobalCapacity?.();
    const analyzed = await analyzeScreenplay(uploadedBuffer, claims, {
      ...dependencies,
      onProcessingStage: (pipelineStage) => {
        stage = pipelineStage;
        dependencies.onProcessingStage?.(pipelineStage);
      },
    });
    try {
      await dependencies.onSuccessfulResult?.(analyzed.result);
    } catch {
      // A secondary integration must never invalidate a completed score.
    }
    await dependencies.quotas.recordCompleted(session.anonymousSessionId, hashedIp);
    const pageCount = analyzed.result.internal.approvedMetadata["pageCount"];
    return Response.json(
      {
        resultId: analyzed.result.resultId,
        resultAccessToken: analyzed.resultAccessToken,
        deletionToken: analyzed.deletionToken,
        projectTitle: analyzed.result.projectTitle,
        declaredFormat: analyzed.result.declaredFormat,
        declaredGenre: analyzed.result.declaredGenre,
        categoryScores: analyzed.result.categoryScores,
        overallScore: analyzed.result.overallScore,
        completedAt: analyzed.result.completedAt,
        ...(typeof pageCount === "number" && Number.isInteger(pageCount) && pageCount > 0
          ? { pageCount }
          : {}),
        ...(analyzed.result.internal.evaluationMode
          ? { evaluationMode: analyzed.result.internal.evaluationMode }
          : {}),
      },
      { headers: withSecurityHeaders(corsHeaders(origin, dependencies.originPolicy)) },
    );
  } catch (error) {
    const reasonCode =
      error instanceof AppError && typeof error.details?.["reasonCode"] === "string"
        ? error.details["reasonCode"]
        : undefined;
    const status =
      reasonCode === "pdf_file_size_limit" ||
      reasonCode === "pdf_page_minimum" ||
      reasonCode === "pdf_page_limit"
        ? 413
        : error instanceof AppError
          ? error.statusCode
          : 422;
    try {
      dependencies.onRejection?.({
        stage,
        errorClass: error instanceof Error ? error.name : "UnknownError",
        errorCode: error instanceof AppError ? error.code : "UNEXPECTED_ANALYSIS_ERROR",
        ...(reasonCode ? { reasonCode } : {}),
        status,
      });
    } catch {
      // Diagnostics must never change the public analysis response.
    }
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
