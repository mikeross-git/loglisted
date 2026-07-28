import { describe, expect, it } from "vitest";
import { createCsrfToken, validateCsrfToken } from "../src/lib/csrf.js";
import { AuthorizationError } from "../src/lib/errors.js";

describe("CSRF tokens", () => {
  it("validates only the matching session and secret", () => {
    const secret = "csrf-secret-that-is-long-enough-for-tests";
    const token = createCsrfToken(secret, "session-a", "nonce-a");
    expect(() => validateCsrfToken(token, secret, "session-a", "nonce-a")).not.toThrow();
    expect(() => validateCsrfToken(token, secret, "session-b", "nonce-a")).toThrow(
      AuthorizationError,
    );
  });

  it("rejects missing and malformed tokens", () => {
    expect(() => validateCsrfToken(null, "secret", "session", "nonce")).toThrow(AuthorizationError);
    expect(() => validateCsrfToken("bad", "secret", "session", "nonce")).toThrow(
      AuthorizationError,
    );
  });
});
