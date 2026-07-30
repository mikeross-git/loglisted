import type { AnonymousSessionManager } from "../lib/anonymous-session.js";
import { AppError, AuthorizationError } from "../lib/errors.js";
import { corsHeaders, validateSiteOrigin, type OriginPolicy } from "../lib/origin.js";
import type { ResultTokenManager } from "../lib/result-token.js";
import { withSecurityHeaders } from "../lib/security-headers.js";
import type { ResultStore } from "../lib/storage/result-store.js";
import type { DeletionTokenManager } from "../lib/deletion-token.js";
import type { VersionedCache } from "../lib/cache.js";

export async function getResult(
  request: Request,
  resultId: string,
  dependencies: {
    sessions: AnonymousSessionManager;
    resultTokens: ResultTokenManager;
    results: ResultStore;
    originPolicy: OriginPolicy;
  },
): Promise<Response> {
  let origin: string | undefined;
  try {
    ({ origin } = validateSiteOrigin(request, dependencies.originPolicy));
    const session = dependencies.sessions.parseCookieHeader(request.headers.get("cookie"));
    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer "))
      throw new AuthorizationError("Result token missing.");
    dependencies.resultTokens.verify(authorization.slice(7), resultId, session.anonymousSessionId);
    const result = await dependencies.results.get(resultId);
    if (result?.anonymousSessionId !== session.anonymousSessionId) {
      throw new AuthorizationError("Result is unavailable.");
    }
    const pageCount = result.internal.approvedMetadata["pageCount"];
    return Response.json(
      {
        projectTitle: result.projectTitle,
        declaredFormat: result.declaredFormat,
        declaredGenre: result.declaredGenre,
        categoryScores: result.categoryScores,
        overallScore: result.overallScore,
        completedAt: result.completedAt,
        ...(typeof pageCount === "number" && Number.isInteger(pageCount) && pageCount > 0
          ? { pageCount }
          : {}),
        ...(result.internal.evaluationMode
          ? { evaluationMode: result.internal.evaluationMode }
          : {}),
      },
      { headers: withSecurityHeaders(corsHeaders(origin, dependencies.originPolicy)) },
    );
  } catch (error) {
    const status = error instanceof AppError ? error.statusCode : 404;
    return Response.json(
      { error: { code: "RESULT_UNAVAILABLE", message: "The result is unavailable." } },
      {
        status,
        headers: withSecurityHeaders(
          origin ? corsHeaders(origin, dependencies.originPolicy) : undefined,
        ),
      },
    );
  }
}

export async function deleteResult(
  request: Request,
  resultId: string,
  dependencies: {
    sessions: AnonymousSessionManager;
    deletionTokens: DeletionTokenManager;
    results: ResultStore;
    cache: VersionedCache;
    originPolicy: OriginPolicy;
  },
): Promise<Response> {
  let origin: string | undefined;
  try {
    ({ origin } = validateSiteOrigin(request, dependencies.originPolicy));
    const session = dependencies.sessions.parseCookieHeader(request.headers.get("cookie"));
    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ")) {
      throw new AuthorizationError("Deletion token missing.");
    }
    dependencies.deletionTokens.verify(
      authorization.slice(7),
      resultId,
      session.anonymousSessionId,
    );
    const result = await dependencies.results.get(resultId);
    if (result?.anonymousSessionId !== session.anonymousSessionId) {
      throw new AuthorizationError("Result is unavailable.");
    }
    await dependencies.results.delete(resultId);
    await dependencies.cache.deleteFileArtifacts(result.fileHash);
    return new Response(null, {
      status: 204,
      headers: withSecurityHeaders(corsHeaders(origin, dependencies.originPolicy)),
    });
  } catch (error) {
    const status = error instanceof AppError ? error.statusCode : 404;
    return Response.json(
      { error: { code: "RESULT_UNAVAILABLE", message: "The result is unavailable." } },
      {
        status,
        headers: withSecurityHeaders(
          origin ? corsHeaders(origin, dependencies.originPolicy) : undefined,
        ),
      },
    );
  }
}
