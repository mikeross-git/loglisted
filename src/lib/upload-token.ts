import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ImdbProfileUrlSchema, WriterEmailSchema, WriterNameSchema } from "../types/project.js";
import type { AnonymousSession } from "./anonymous-session.js";
import { AuthorizationError, ValidationError } from "./errors.js";
import type { AbuseStore } from "./storage/abuse-store.js";

export const UploadTokenClaimsSchema = z
  .object({
    version: z.literal(1),
    anonymousSessionId: z.string().uuid(),
    deviceIdHash: z.string().regex(/^[a-f0-9]{64}$/),
    fileHash: z.string().regex(/^[a-f0-9]{64}$/),
    fileSize: z.number().int().positive(),
    mimeType: z.literal("application/pdf"),
    firstName: WriterNameSchema.optional(),
    lastName: WriterNameSchema.optional(),
    email: WriterEmailSchema.optional(),
    imdbUrl: ImdbProfileUrlSchema.optional(),
    projectTitle: z.string().min(1).max(200),
    logline: z.string().max(1000).optional(),
    declaredFormat: z.enum(["feature", "halfHourPilot", "hourPilot", "short", "unknown"]),
    primaryGenre: z.string().min(1).max(100),
    confirmationsAccepted: z.literal(true),
    aiProcessingPolicyVersion: z.string().min(1),
    privacyNoticeVersion: z.string().min(1),
    aiProcessingConfirmedAt: z.number().int().nonnegative(),
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
    nonce: z.string().uuid(),
  })
  .strict();

export type UploadTokenClaims = z.infer<typeof UploadTokenClaimsSchema>;

export class UploadTokenManager {
  constructor(
    private readonly signingSecret: string,
    private readonly store: AbuseStore,
    private readonly lifetimeSeconds = 300,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (signingSecret.length < 32) throw new ValidationError("Upload token secret is too short.");
  }

  issue(
    claims: Omit<
      UploadTokenClaims,
      | "version"
      | "issuedAt"
      | "expiresAt"
      | "nonce"
      | "confirmationsAccepted"
      | "aiProcessingConfirmedAt"
      | "aiProcessingPolicyVersion"
      | "privacyNoticeVersion"
    > &
      Partial<Pick<UploadTokenClaims, "aiProcessingPolicyVersion" | "privacyNoticeVersion">>,
  ): { token: string; claims: UploadTokenClaims } {
    const issuedAt = Math.floor(this.now().getTime() / 1_000);
    const complete: UploadTokenClaims = {
      version: 1,
      aiProcessingPolicyVersion: claims.aiProcessingPolicyVersion ?? "ai-processing-policy-1",
      privacyNoticeVersion: claims.privacyNoticeVersion ?? "privacy-notice-1",
      ...claims,
      confirmationsAccepted: true,
      aiProcessingConfirmedAt: issuedAt,
      issuedAt,
      expiresAt: issuedAt + this.lifetimeSeconds,
      nonce: randomUUID(),
    };
    const payload = Buffer.from(JSON.stringify(complete)).toString("base64url");
    const signature = createHmac("sha256", this.signingSecret).update(payload).digest("base64url");
    return { token: `${payload}.${signature}`, claims: complete };
  }

  verify(token: string, session: AnonymousSession): UploadTokenClaims {
    const tokenParts = token.split(".");
    if (tokenParts.length !== 2) throw new AuthorizationError("Upload token is invalid.");
    const [payload, suppliedSignature] = tokenParts;
    if (!payload || !suppliedSignature) throw new AuthorizationError("Upload token is invalid.");
    const expectedSignature = createHmac("sha256", this.signingSecret)
      .update(payload)
      .digest("base64url");
    const supplied = Buffer.from(suppliedSignature);
    const expected = Buffer.from(expectedSignature);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new AuthorizationError("Upload token is invalid.");
    }
    let claims: UploadTokenClaims;
    try {
      claims = UploadTokenClaimsSchema.parse(
        JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
      );
    } catch (error) {
      throw new AuthorizationError("Upload token is invalid.", { cause: error });
    }
    if (claims.expiresAt <= Math.floor(this.now().getTime() / 1_000)) {
      throw new AuthorizationError("Upload token expired.");
    }
    if (
      claims.anonymousSessionId !== session.anonymousSessionId ||
      claims.deviceIdHash !== session.deviceIdHash
    ) {
      throw new AuthorizationError("Upload token session mismatch.");
    }
    return claims;
  }

  async consume(claims: UploadTokenClaims): Promise<void> {
    const remainingMs = Math.max(1, claims.expiresAt * 1_000 - this.now().getTime());
    if (!(await this.store.consumeOnce(`upload-nonce:${claims.nonce}`, remainingMs))) {
      throw new AuthorizationError("Upload token replay.");
    }
  }
}
