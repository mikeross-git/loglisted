import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { AuthorizationError, ValidationError } from "./errors.js";

const ResultTokenClaimsSchema = z
  .object({
    version: z.literal(1),
    resultId: z.string().uuid(),
    anonymousSessionId: z.string().uuid(),
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
  })
  .strict();

export class ResultTokenManager {
  constructor(
    private readonly secret: string,
    private readonly lifetimeSeconds = 30 * 24 * 60 * 60,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (secret.length < 32) throw new ValidationError("Result token secret is too short.");
  }

  issue(resultId: string, anonymousSessionId: string): { token: string; expiresAt: string } {
    const issuedAt = Math.floor(this.now().getTime() / 1_000);
    const claims = ResultTokenClaimsSchema.parse({
      version: 1,
      resultId,
      anonymousSessionId,
      issuedAt,
      expiresAt: issuedAt + this.lifetimeSeconds,
    });
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const signature = createHmac("sha256", this.secret).update(payload).digest("base64url");
    return {
      token: `${payload}.${signature}`,
      expiresAt: new Date(claims.expiresAt * 1_000).toISOString(),
    };
  }

  verify(token: string, resultId: string, anonymousSessionId: string): void {
    const tokenParts = token.split(".");
    if (tokenParts.length !== 2) throw new AuthorizationError("Result token is invalid.");
    const [payload, suppliedSignature] = tokenParts;
    if (!payload || !suppliedSignature) throw new AuthorizationError("Result token is invalid.");
    const expectedSignature = createHmac("sha256", this.secret).update(payload).digest("base64url");
    const supplied = Buffer.from(suppliedSignature);
    const expected = Buffer.from(expectedSignature);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new AuthorizationError("Result token is invalid.");
    }
    let claims: z.infer<typeof ResultTokenClaimsSchema>;
    try {
      claims = ResultTokenClaimsSchema.parse(
        JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
      );
    } catch (error) {
      throw new AuthorizationError("Result token is invalid.", { cause: error });
    }
    if (
      claims.expiresAt <= Math.floor(this.now().getTime() / 1_000) ||
      claims.resultId !== resultId ||
      claims.anonymousSessionId !== anonymousSessionId
    ) {
      throw new AuthorizationError("Result access is denied.");
    }
  }
}
