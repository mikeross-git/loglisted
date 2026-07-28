import { timingSafeEqual } from "node:crypto";
import { AuthorizationError } from "../lib/errors.js";
import type { LlmProvider } from "../lib/llm/provider.js";
import type { PrivacyConfig } from "../lib/privacy-config.js";
import { withSecurityHeaders } from "../lib/security-headers.js";

function matchesSecret(supplied: string, expected: string): boolean {
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function getPrivacyStatus(
  request: Request,
  dependencies: {
    config: PrivacyConfig;
    provider: LlmProvider;
    model: string;
  },
): Promise<Response> {
  await Promise.resolve();
  try {
    if (!dependencies.config.PRIVACY_STATUS_ENABLED) {
      throw new AuthorizationError("Privacy status is disabled.");
    }
    const expected = dependencies.config.PRIVACY_STATUS_ADMIN_SECRET;
    const authorization = request.headers.get("authorization");
    if (
      !expected ||
      !authorization?.startsWith("Bearer ") ||
      !matchesSecret(authorization.slice(7), expected)
    ) {
      throw new AuthorizationError("Privacy status access denied.");
    }
    const capability = dependencies.provider.privacyCapabilities(dependencies.model);
    return Response.json(
      {
        provider: capability.providerName,
        model: capability.modelName,
        trainingOptOutConfirmed: capability.trainingOptOutConfigured === true,
        requestStorageDisabled: capability.requestStorageDisabled === true,
        zeroDataRetentionEnabled: capability.zeroDataRetentionEnabled,
        statedRetentionDays: capability.statedRetentionDays,
        privacyReviewDate: dependencies.config.AI_PROVIDER_PRIVACY_REVIEW_DATE ?? null,
        piiRedactionEnabled: dependencies.config.REDACT_TITLE_PAGE_PII,
        rawPdfPersistenceEnabled: dependencies.config.RAW_PDF_PERSISTENCE_ENABLED,
        rawTextPersistenceEnabled: dependencies.config.RAW_TEXT_PERSISTENCE_ENABLED,
        contentLoggingEnabled:
          dependencies.config.ALLOW_LLM_CONTENT_IN_OBSERVABILITY ||
          dependencies.config.ALLOW_SCRIPT_CONTENT_IN_ERROR_REPORTS ||
          dependencies.config.ALLOW_REQUEST_BODY_LOGGING,
        privacyConfigVersion: dependencies.config.PRIVACY_CONFIG_VERSION,
      },
      { headers: withSecurityHeaders() },
    );
  } catch {
    return Response.json(
      { error: { code: "NOT_FOUND", message: "The resource is unavailable." } },
      { status: 404, headers: withSecurityHeaders() },
    );
  }
}
