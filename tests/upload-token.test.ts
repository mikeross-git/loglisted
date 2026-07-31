import { describe, expect, it } from "vitest";
import { AnonymousSessionManager } from "../src/lib/anonymous-session.js";
import { AuthorizationError } from "../src/lib/errors.js";
import { MemoryAbuseStore } from "../src/lib/storage/memory-abuse-store.js";
import { UploadTokenManager } from "../src/lib/upload-token.js";

const sessionManager = new AnonymousSessionManager({
  signingSecret: "session-signing-secret-that-is-long-enough",
  deviceHmacSecret: "device-hmac-secret-that-is-long-enough",
  csrfSigningSecret: "csrf-signing-secret-that-is-long-enough",
});

describe("single-use upload token", () => {
  it("binds claims to session, device, file, MIME, and size and rejects replay", async () => {
    const session = sessionManager.create("019f9e5d-0710-7220-a1d2-8bb230517924").session;
    const manager = new UploadTokenManager(
      "upload-signing-secret-that-is-long-enough",
      new MemoryAbuseStore(),
    );
    const issued = manager.issue({
      anonymousSessionId: session.anonymousSessionId,
      deviceIdHash: session.deviceIdHash,
      fileHash: "a".repeat(64),
      fileSize: 123,
      mimeType: "application/pdf",
      projectTitle: "Project",
      declaredFormat: "feature",
      primaryGenre: "Drama",
    });
    const claims = manager.verify(issued.token, session);
    expect(claims).toMatchObject({ fileSize: 123, confirmationsAccepted: true });
    await manager.consume(claims);
    await expect(manager.consume(claims)).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("rejects token tampering, expiration, and the wrong browser session", () => {
    let now = new Date("2026-07-26T12:00:00Z");
    const store = new MemoryAbuseStore(() => now.getTime());
    const manager = new UploadTokenManager(
      "upload-signing-secret-that-is-long-enough",
      store,
      1,
      () => now,
    );
    const first = sessionManager.create("019f9e5d-0710-7220-a1d2-8bb230517924").session;
    const second = sessionManager.create("119f9e5d-0710-7220-a1d2-8bb230517924").session;
    const issued = manager.issue({
      anonymousSessionId: first.anonymousSessionId,
      deviceIdHash: first.deviceIdHash,
      fileHash: "b".repeat(64),
      fileSize: 100,
      mimeType: "application/pdf",
      projectTitle: "Project",
      declaredFormat: "feature",
      primaryGenre: "Comedy",
    });
    expect(() => manager.verify(`${issued.token}x`, first)).toThrow(AuthorizationError);
    expect(() => manager.verify(`${issued.token}.extra`, first)).toThrow(AuthorizationError);
    expect(() => manager.verify(issued.token, second)).toThrow(AuthorizationError);
    now = new Date(now.getTime() + 2_000);
    expect(() => manager.verify(issued.token, first)).toThrow(AuthorizationError);
  });

  it("rejects the retired short format", () => {
    const session = sessionManager.create("219f9e5d-0710-7220-a1d2-8bb230517924").session;
    const manager = new UploadTokenManager(
      "upload-signing-secret-that-is-long-enough",
      new MemoryAbuseStore(),
    );
    expect(() =>
      manager.issue({
        anonymousSessionId: session.anonymousSessionId,
        deviceIdHash: session.deviceIdHash,
        fileHash: "c".repeat(64),
        fileSize: 100,
        mimeType: "application/pdf",
        projectTitle: "Retired Short",
        declaredFormat: "short" as never,
        primaryGenre: "Drama",
      }),
    ).toThrow();
  });
});
