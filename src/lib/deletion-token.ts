import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { AuthorizationError, ValidationError } from "./errors.js";

const DeletionTokenClaimsSchema = z
  .object({
    version: z.literal(1),
    resultId: z.string().uuid(),
    anonymousSessionId: z.string().uuid(),
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
  })
  .strict();

export class DeletionTokenManager {
  constructor(
    private readonly secret: string,
    private readonly lifetimeSeconds = 30 * 86_400,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (secret.length < 32) throw new ValidationError("Deletion token secret is too short.");
  }

  issue(resultId: string, anonymousSessionId: string): string {
    const issuedAt = Math.floor(this.now().getTime() / 1_000);
    const claims = DeletionTokenClaimsSchema.parse({
      version: 1,
      resultId,
      anonymousSessionId,
      issuedAt,
      expiresAt: issuedAt + this.lifetimeSeconds,
    });
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const signature = createHmac("sha256", this.secret).update(payload).digest("base64url");
    return `${payload}.${signature}`;
  }

  verify(token: string, resultId: string, anonymousSessionId: string): void {
    const parts = token.split(".");
    if (parts.length !== 2) throw new AuthorizationError("Deletion token is invalid.");
    const [payload, suppliedSignature] = parts;
    if (!payload || !suppliedSignature) throw new AuthorizationError("Deletion token is invalid.");
    const expectedSignature = createHmac("sha256", this.secret).update(payload).digest("base64url");
    const supplied = Buffer.from(suppliedSignature);
    const expected = Buffer.from(expectedSignature);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new AuthorizationError("Deletion token is invalid.");
    }
    let claims: z.infer<typeof DeletionTokenClaimsSchema>;
    try {
      claims = DeletionTokenClaimsSchema.parse(
        JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
      );
    } catch (error) {
      throw new AuthorizationError("Deletion token is invalid.", { cause: error });
    }
    if (
      claims.expiresAt <= Math.floor(this.now().getTime() / 1_000) ||
      claims.resultId !== resultId ||
      claims.anonymousSessionId !== anonymousSessionId
    ) {
      throw new AuthorizationError("Deletion is not authorized.");
    }
  }
}
