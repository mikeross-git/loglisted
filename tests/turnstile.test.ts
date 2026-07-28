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
});
