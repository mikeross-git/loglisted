import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { AuthorizationError, ValidationError } from "./errors.js";
import { createCsrfToken } from "./csrf.js";

export const DeviceIdSchema = z.string().uuid();
export const AnonymousSessionSchema = z
  .object({
    version: z.literal(1),
    anonymousSessionId: z.string().uuid(),
    deviceIdHash: z.string().regex(/^[a-f0-9]{64}$/),
    csrfSecret: z.string().min(32),
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
  })
  .strict();

export type AnonymousSession = z.infer<typeof AnonymousSessionSchema>;

export interface AnonymousSessionOptions {
  signingSecret: string;
  deviceHmacSecret: string;
  csrfSigningSecret: string;
  cookieName?: string;
  cookieSameSite?: "Lax" | "None";
  lifetimeSeconds?: number;
  now?: () => Date;
}

function hmac(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

export function hashDeviceId(deviceId: string, secret: string): string {
  return hmac(secret, `device:v1:${DeviceIdSchema.parse(deviceId).toLowerCase()}`);
}

function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export class AnonymousSessionManager {
  readonly cookieName: string;
  private readonly lifetimeSeconds: number;
  private readonly now: () => Date;

  constructor(private readonly options: AnonymousSessionOptions) {
    if (options.signingSecret.length < 32 || options.deviceHmacSecret.length < 32) {
      throw new ValidationError("Session secrets must contain at least 32 characters.");
    }
    this.cookieName = options.cookieName ?? "loglisted_session";
    this.lifetimeSeconds = options.lifetimeSeconds ?? 7 * 24 * 60 * 60;
    this.now = options.now ?? (() => new Date());
  }

  create(deviceId: string): {
    session: AnonymousSession;
    cookie: string;
    csrfToken: string;
  } {
    const issuedAt = Math.floor(this.now().getTime() / 1_000);
    const session: AnonymousSession = {
      version: 1,
      anonymousSessionId: randomUUID(),
      deviceIdHash: hashDeviceId(deviceId, this.options.deviceHmacSecret),
      csrfSecret: randomBytes(32).toString("base64url"),
      issuedAt,
      expiresAt: issuedAt + this.lifetimeSeconds,
    };
    const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
    const value = `${payload}.${signPayload(payload, this.options.signingSecret)}`;
    const sameSite = this.options.cookieSameSite ?? "Lax";
    const cookie = `${this.cookieName}=${value}; Max-Age=${this.lifetimeSeconds}; Path=/; HttpOnly; Secure; SameSite=${sameSite}`;
    return {
      session,
      cookie,
      csrfToken: createCsrfToken(
        this.options.csrfSigningSecret,
        session.anonymousSessionId,
        session.csrfSecret,
      ),
    };
  }

  parseCookieHeader(cookieHeader: string | null): AnonymousSession {
    const cookieValue = cookieHeader
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${this.cookieName}=`))
      ?.slice(this.cookieName.length + 1);
    if (!cookieValue) throw new AuthorizationError("Anonymous session cookie is missing.");
    const [payload, suppliedSignature] = cookieValue.split(".");
    if (!payload || !suppliedSignature)
      throw new AuthorizationError("Session cookie is malformed.");
    const expectedSignature = signPayload(payload, this.options.signingSecret);
    const supplied = Buffer.from(suppliedSignature);
    const expected = Buffer.from(expectedSignature);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new AuthorizationError("Session cookie signature is invalid.");
    }
    let session: AnonymousSession;
    try {
      session = AnonymousSessionSchema.parse(
        JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
      );
    } catch (error) {
      throw new AuthorizationError("Session cookie payload is invalid.", { cause: error });
    }
    if (session.expiresAt <= Math.floor(this.now().getTime() / 1_000)) {
      throw new AuthorizationError("Anonymous session has expired.");
    }
    return session;
  }
}
