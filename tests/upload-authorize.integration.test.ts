import { describe, expect, it } from "vitest";
import { postUploadAuthorize } from "../src/api/upload-authorize.js";
import { AnonymousSessionManager } from "../src/lib/anonymous-session.js";
import { AnonymousQuotas } from "../src/lib/quotas.js";
import { SlidingWindowRateLimiter } from "../src/lib/rate-limit.js";
import { MemoryAbuseStore } from "../src/lib/storage/memory-abuse-store.js";
import { TurnstileVerifier } from "../src/lib/turnstile.js";
import { UploadTokenManager } from "../src/lib/upload-token.js";

const deviceId = "019f9e5d-0710-7220-a1d2-8bb230517924";
const sessionOptions = {
  signingSecret: "session-signing-secret-that-is-long-enough",
  deviceHmacSecret: "device-hmac-secret-that-is-long-enough",
  csrfSigningSecret: "csrf-signing-secret-that-is-long-enough",
};

function setup() {
  const store = new MemoryAbuseStore();
  const sessions = new AnonymousSessionManager(sessionOptions);
  const created = sessions.create(deviceId);
  const turnstile = new TurnstileVerifier(store, {
    secretKey: "secret",
    expectedHostnames: ["site.example"],
    expectedAction: "screenplay_upload",
    fetchImplementation: () =>
      Promise.resolve(
        Response.json({
          success: true,
          hostname: "site.example",
          action: "screenplay_upload",
        }),
      ),
  });
  const dependencies = {
    sessions,
    csrfSigningSecret: sessionOptions.csrfSigningSecret,
    deviceHmacSecret: sessionOptions.deviceHmacSecret,
    ipHmacSecret: "ip-hmac-secret-that-is-long-enough",
    directIp: "203.0.113.10",
    trustedProxy: { trustedProxyIps: [] },
    originPolicy: {
      allowedOrigins: ["https://site.example"],
      allowedMethods: ["POST"],
      allowedContentTypes: ["application/json"],
    },
    turnstile,
    rateLimiter: new SlidingWindowRateLimiter(store, 90 * 86_400_000),
    quotas: new AnonymousQuotas(store),
    abuseStore: store,
    uploadTokens: new UploadTokenManager("upload-signing-secret-that-is-long-enough", store),
    now: () => new Date("2026-07-26T12:00:10Z"),
  };
  return { created, dependencies };
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    turnstileToken: crypto.randomUUID(),
    deviceId,
    fileHash: "a".repeat(64),
    fileSize: 123,
    fileName: "script.pdf",
    mimeType: "application/pdf",
    project: {
      firstName: "Taylor",
      lastName: "Writer",
      email: "taylor@example.com",
      imdbUrl: "https://www.imdb.com/name/nm1234567/",
      projectTitle: "Project",
      format: "feature",
      primaryGenre: "Drama",
      secondaryGenres: [],
      approximatePageCount: 100,
      logline: "",
      originalWorkConfirmed: true,
      uploadRightsConfirmed: true,
      privacyTermsAccepted: true,
      acceptableUseAccepted: true,
      aiProcessingAcknowledged: true,
    },
    antiBot: {
      website_confirm: "",
      formMountedAt: "2026-07-26T12:00:00Z",
      fileSelectedAt: "2026-07-26T12:00:05Z",
      formSubmittedAt: "2026-07-26T12:00:10Z",
    },
    ...overrides,
  };
}

function request(cookie: string, csrf: string, payload = body(), origin = "https://site.example") {
  return new Request("https://api.example/api/upload-authorize", {
    method: "POST",
    headers: {
      origin,
      referer: `${origin}/upload`,
      "content-type": "application/json",
      cookie,
      "x-csrf-token": csrf,
    },
    body: JSON.stringify(payload),
  });
}

describe("upload authorization endpoint", () => {
  it("issues a five-minute session-bound token", async () => {
    const { created, dependencies } = setup();
    const response = await postUploadAuthorize(
      request(created.cookie, created.csrfToken),
      dependencies,
    );
    expect(response.status).toBe(200);
    const responseBody = (await response.json()) as { uploadToken: string };
    expect(responseBody).toMatchObject({
      cachedResultAvailable: false,
      resultAccessToken: null,
    });
    expect(
      dependencies.uploadTokens.verify(responseBody.uploadToken, created.session),
    ).toMatchObject({
      firstName: "Taylor",
      lastName: "Writer",
      email: "taylor@example.com",
      imdbUrl: "https://www.imdb.com/name/nm1234567/",
    });
  });

  it.each([
    ["invalid email", { email: "not-an-email" }],
    ["non-IMDb URL", { imdbUrl: "https://example.com/name/nm1234567/" }],
    ["IMDb title URL", { imdbUrl: "https://www.imdb.com/title/tt1234567/" }],
  ])("rejects %s before issuing an upload token", async (_label, projectOverrides) => {
    const { created, dependencies } = setup();
    const response = await postUploadAuthorize(
      request(
        created.cookie,
        created.csrfToken,
        body({ project: { ...(body().project as object), ...projectOverrides } }),
      ),
      dependencies,
    );
    expect(response.status).toBe(400);
  });

  it.each([
    [
      "bad origin",
      (created: ReturnType<typeof setup>["created"]) =>
        request(created.cookie, created.csrfToken, body(), "https://evil.example"),
    ],
    ["bad CSRF", (created: ReturnType<typeof setup>["created"]) => request(created.cookie, "bad")],
    [
      "device mismatch",
      (created: ReturnType<typeof setup>["created"]) =>
        request(
          created.cookie,
          created.csrfToken,
          body({ deviceId: "119f9e5d-0710-7220-a1d2-8bb230517924" }),
        ),
    ],
    [
      "honeypot",
      (created: ReturnType<typeof setup>["created"]) =>
        request(
          created.cookie,
          created.csrfToken,
          body({
            antiBot: {
              website_confirm: "bot",
              formMountedAt: "2026-07-26T12:00:00Z",
              fileSelectedAt: "2026-07-26T12:00:05Z",
              formSubmittedAt: "2026-07-26T12:00:10Z",
            },
          }),
        ),
    ],
    [
      "missing confirmations",
      (created: ReturnType<typeof setup>["created"]) =>
        request(
          created.cookie,
          created.csrfToken,
          body({ project: { ...(body().project as object), privacyTermsAccepted: false } }),
        ),
    ],
  ])("generically rejects %s", async (_name, makeRequest) => {
    const { created, dependencies } = setup();
    const response = await postUploadAuthorize(makeRequest(created), dependencies);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await response.json()).toEqual({
      error: {
        code: "UPLOAD_AUTHORIZATION_REJECTED",
        message: "The upload could not be authorized.",
      },
    });
  });

  it("reports a content-safe internal rejection stage without changing the public error", async () => {
    const { created, dependencies } = setup();
    const diagnostics: { stage: string; errorClass: string; status: number }[] = [];
    const response = await postUploadAuthorize(request(created.cookie, "bad"), {
      ...dependencies,
      onRejection: (diagnostic) => diagnostics.push(diagnostic),
    });
    expect(response.status).toBe(403);
    expect(diagnostics).toEqual([{ stage: "csrf", errorClass: "AuthorizationError", status: 403 }]);
    expect(await response.json()).toEqual({
      error: {
        code: "UPLOAD_AUTHORIZATION_REJECTED",
        message: "The upload could not be authorized.",
      },
    });
  });
});
