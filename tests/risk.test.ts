import { describe, expect, it } from "vitest";
import { assessRisk } from "../src/lib/risk.js";

const clean = {
  validTurnstile: true,
  sessionOlderThan24Hours: true,
  validOriginAndCsrf: true,
  sameCompletedFileBySession: false,
  suspiciouslyFastForm: false,
  repeatedAuthorizationAttempts: false,
  invalidTurnstileAttempts: false,
  sameFileAcrossManySessions: false,
  rapidDeviceRotationOnIp: false,
  rapidIpRotationForSession: false,
  frontendBackendHashMismatch: false,
  honeypotCompleted: false,
  uploadTokenReplay: false,
};

describe("anonymous risk model", () => {
  it("allows low-risk traffic and applies documented weights", () => {
    expect(assessRisk(clean)).toEqual({ score: -25, decision: "allow" });
  });

  it("blocks device resets and session IP rotation at configurable thresholds", () => {
    expect(assessRisk({ ...clean, rapidDeviceRotationOnIp: true }).decision).toBe(
      "fresh_turnstile",
    );
    expect(
      assessRisk({ ...clean, rapidDeviceRotationOnIp: true, rapidIpRotationForSession: true })
        .decision,
    ).toBe("temporary_block");
  });

  it("blocks honeypot and hash mismatch without exposing score publicly", () => {
    expect(assessRisk({ ...clean, honeypotCompleted: true }).decision).toBe("temporary_block");
    expect(assessRisk({ ...clean, frontendBackendHashMismatch: true }).decision).toBe(
      "temporary_block",
    );
  });
});
