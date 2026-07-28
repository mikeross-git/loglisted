import { AuthorizationError, ValidationError } from "./errors.js";

export interface OriginPolicy {
  allowedOrigins: readonly string[];
  allowedMethods: readonly string[];
  allowedContentTypes: readonly string[];
}

function normalizedOrigin(value: string): string {
  const url = new URL(value);
  return url.origin;
}

export function validateSiteOrigin(request: Request, policy: OriginPolicy): { origin: string } {
  const origin = request.headers.get("origin");
  if (!origin) throw new AuthorizationError("Origin header is required.");
  const normalized = normalizedOrigin(origin);
  if (!policy.allowedOrigins.map(normalizedOrigin).includes(normalized)) {
    throw new AuthorizationError("Origin is not allowed.");
  }
  const referer = request.headers.get("referer");
  if (referer && normalizedOrigin(referer) !== normalized) {
    throw new AuthorizationError("Referer does not match Origin.");
  }
  if (!policy.allowedMethods.includes(request.method.toUpperCase())) {
    throw new AuthorizationError("HTTP method is not allowed.");
  }
  if (["POST", "PUT", "PATCH"].includes(request.method.toUpperCase())) {
    const contentType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (!contentType || !policy.allowedContentTypes.includes(contentType)) {
      throw new ValidationError("Content-Type is not allowed.");
    }
  }
  return { origin: normalized };
}

export function corsHeaders(origin: string, policy: OriginPolicy): Record<string, string> {
  const normalized = normalizedOrigin(origin);
  if (!policy.allowedOrigins.map(normalizedOrigin).includes(normalized)) {
    throw new AuthorizationError("Origin is not allowed.");
  }
  return {
    "access-control-allow-origin": normalized,
    "access-control-allow-credentials": "true",
    "access-control-allow-methods": policy.allowedMethods.join(", "),
    "access-control-allow-headers": "Content-Type, Authorization, X-CSRF-Token",
    vary: "Origin",
  };
}
