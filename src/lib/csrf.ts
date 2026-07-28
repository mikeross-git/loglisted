import { createHmac, timingSafeEqual } from "node:crypto";
import { AuthorizationError } from "./errors.js";

function signature(secret: string, sessionId: string, csrfSecret: string): string {
  return createHmac("sha256", secret)
    .update(`csrf:v1:${sessionId}:${csrfSecret}`)
    .digest("base64url");
}

export function createCsrfToken(
  signingSecret: string,
  sessionId: string,
  csrfSecret: string,
): string {
  return signature(signingSecret, sessionId, csrfSecret);
}

export function validateCsrfToken(
  supplied: string | null,
  signingSecret: string,
  sessionId: string,
  csrfSecret: string,
): void {
  if (!supplied) throw new AuthorizationError("CSRF token is missing.");
  const expected = signature(signingSecret, sessionId, csrfSecret);
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  if (
    suppliedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(suppliedBuffer, expectedBuffer)
  ) {
    throw new AuthorizationError("CSRF token is invalid.");
  }
}
