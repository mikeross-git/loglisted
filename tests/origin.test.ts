import { describe, expect, it } from "vitest";
import { AuthorizationError, ValidationError } from "../src/lib/errors.js";
import { corsHeaders, validateSiteOrigin } from "../src/lib/origin.js";

const policy = {
  allowedOrigins: ["https://site.example", "https://preview.framer.app"],
  allowedMethods: ["POST", "OPTIONS"],
  allowedContentTypes: ["application/json"],
};

describe("site-origin security", () => {
  it("accepts exact production and preview origins with matching referer", () => {
    const request = new Request("https://api.example/api/session", {
      method: "POST",
      headers: {
        origin: "https://site.example",
        referer: "https://site.example/page",
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(validateSiteOrigin(request, policy).origin).toBe("https://site.example");
    expect(corsHeaders("https://site.example", policy)["access-control-allow-origin"]).toBe(
      "https://site.example",
    );
  });

  it("rejects bad origins, referers, methods, and content types", () => {
    const make = (headers: HeadersInit, method = "POST") =>
      new Request("https://api.example", {
        method,
        headers,
        body: method === "POST" ? "{}" : null,
      });
    expect(() =>
      validateSiteOrigin(
        make({ origin: "https://evil.example", "content-type": "application/json" }),
        policy,
      ),
    ).toThrow(AuthorizationError);
    expect(() =>
      validateSiteOrigin(
        make({
          origin: "https://site.example",
          referer: "https://evil.example",
          "content-type": "application/json",
        }),
        policy,
      ),
    ).toThrow(AuthorizationError);
    expect(() =>
      validateSiteOrigin(
        make({ origin: "https://site.example", "content-type": "text/plain" }),
        policy,
      ),
    ).toThrow(ValidationError);
  });

  it("never emits wildcard CORS", () => {
    expect(Object.values(corsHeaders("https://site.example", policy))).not.toContain("*");
  });
});
