import { describe, expect, it } from "vitest";
import { AnonymousSessionManager } from "../src/lib/anonymous-session.js";
import { AuthorizationError } from "../src/lib/errors.js";

const secrets = {
  signingSecret: "session-signing-secret-that-is-long-enough",
  deviceHmacSecret: "device-hmac-secret-that-is-long-enough",
  csrfSigningSecret: "csrf-signing-secret-that-is-long-enough",
};

describe("anonymous browser sessions", () => {
  it("creates an opaque signed seven-day cookie without exposing private identifiers", () => {
    const manager = new AnonymousSessionManager(secrets);
    const created = manager.create("019f9e5d-0710-7220-a1d2-8bb230517924");
    expect(created.cookie).toContain("HttpOnly");
    expect(created.cookie).toContain("Secure");
    expect(created.cookie).toContain("SameSite=Lax");
    expect(created.cookie).not.toContain(created.session.deviceIdHash);
    expect(created.session.expiresAt - created.session.issuedAt).toBe(7 * 24 * 60 * 60);
    expect(manager.parseCookieHeader(created.cookie)).toEqual(created.session);
  });

  it("rejects invalid device UUIDs", () => {
    expect(() => new AnonymousSessionManager(secrets).create("device-123")).toThrow();
  });

  it("rejects cookie tampering", () => {
    const manager = new AnonymousSessionManager(secrets);
    const created = manager.create("019f9e5d-0710-7220-a1d2-8bb230517924");
    const tampered = created.cookie.replace(
      /=([^;.])/,
      (_match, character: string) => `=${character === "a" ? "b" : "a"}`,
    );
    expect(() => manager.parseCookieHeader(tampered)).toThrow(AuthorizationError);
  });

  it("rejects expired sessions", () => {
    let now = new Date("2026-07-26T12:00:00Z");
    const manager = new AnonymousSessionManager({ ...secrets, lifetimeSeconds: 1, now: () => now });
    const created = manager.create("019f9e5d-0710-7220-a1d2-8bb230517924");
    now = new Date(now.getTime() + 2_000);
    expect(() => manager.parseCookieHeader(created.cookie)).toThrow(AuthorizationError);
  });
});
