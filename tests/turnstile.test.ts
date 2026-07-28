import { describe, expect, it } from "vitest";
import { AuthorizationError } from "../src/lib/errors.js";
import { MemoryAbuseStore } from "../src/lib/storage/memory-abuse-store.js";
import { TurnstileVerifier } from "../src/lib/turnstile.js";

function verifier(response: unknown) {
  return new TurnstileVerifier(new MemoryAbuseStore(), {
    secretKey: "secret",
    expectedHostnames: ["site.example"],
    expectedAction: "screenplay_upload",
    fetchImplementation: () =>
      Promise.resolve(
        new Response(JSON.stringify(response), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
  });
}

function verifierWithStatus(response: unknown, status: number) {
  return new TurnstileVerifier(new MemoryAbuseStore(), {
    secretKey: "secret",
    expectedHostnames: ["site.example"],
    expectedAction: "screenplay_upload",
    fetchImplementation: () =>
      Promise.resolve(
        new Response(JSON.stringify(response), {
          status,
          headers: { "content-type": "application/json" },
        }),
      ),
  });
}

describe("Turnstile verification", () => {
  it("accepts a valid fresh token once", async () => {
    const turnstile = verifier({
      success: true,
      hostname: "site.example",
      action: "screenplay_upload",
    });
    await expect(turnstile.verify("fresh-token")).resolves.toBeUndefined();
    await expect(turnstile.verify("fresh-token")).rejects.toBeInstanceOf(AuthorizationError);
  });

  it.each([
    [undefined, null],
    ["invalid", { success: false }],
    ["wrong-host", { success: true, hostname: "evil.example", action: "screenplay_upload" }],
    ["wrong-action", { success: true, hostname: "site.example", action: "other" }],
  ])("rejects missing or invalid response %s", async (token, response) => {
    await expect(verifier(response).verify(token)).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("reports provider error codes without exposing the token", async () => {
    const turnstile = verifier({
      success: false,
      "error-codes": ["invalid-input-secret"],
    });

    await expect(turnstile.verify("sensitive-token")).rejects.toMatchObject({
      details: { reasonCode: "siteverify_rejected:invalid-input-secret" },
    });
  });

  it("reports provider error codes returned with an HTTP error status", async () => {
    const turnstile = verifierWithStatus(
      {
        success: false,
        "error-codes": ["invalid-input-secret"],
      },
      400,
    );

    await expect(turnstile.verify("sensitive-token")).rejects.toMatchObject({
      details: { reasonCode: "siteverify_http_400:invalid-input-secret" },
    });
  });

  it("distinguishes hostname and action mismatches", async () => {
    await expect(
      verifier({
        success: true,
        hostname: "other.example",
        action: "screenplay_upload",
      }).verify("hostname-token"),
    ).rejects.toMatchObject({
      details: { reasonCode: "siteverify_hostname_mismatch" },
    });
    await expect(
      verifier({
        success: true,
        hostname: "site.example",
        action: "other",
      }).verify("action-token"),
    ).rejects.toMatchObject({
      details: { reasonCode: "siteverify_action_mismatch" },
    });
  });
});
