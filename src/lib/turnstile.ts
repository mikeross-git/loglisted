import { createHash } from "node:crypto";
import { z } from "zod";
import { AuthorizationError } from "./errors.js";
import type { AbuseStore } from "./storage/abuse-store.js";

const TurnstileResponseSchema = z
  .object({
    success: z.boolean(),
    hostname: z.string().optional(),
    action: z.string().optional(),
    "error-codes": z.array(z.string()).optional(),
  })
  .passthrough();

export interface TurnstileOptions {
  secretKey: string;
  expectedHostnames: readonly string[];
  expectedAction: string;
  timeoutMs?: number;
  tokenTtlMs?: number;
  fetchImplementation?: typeof fetch;
}

export class TurnstileVerifier {
  private readonly fetchImplementation: typeof fetch;
  constructor(
    private readonly store: AbuseStore,
    private readonly options: TurnstileOptions,
  ) {
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  async verify(token: string | undefined): Promise<void> {
    if (!token || token.length > 2048) throw new AuthorizationError("Turnstile validation failed.");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 10_000);
    try {
      const response = await this.fetchImplementation(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ secret: this.options.secretKey, response: token }),
          signal: controller.signal,
        },
      );
      if (!response.ok) throw new AuthorizationError("Turnstile service rejected the request.");
      const result = TurnstileResponseSchema.parse(await response.json());
      if (
        !result.success ||
        !result.hostname ||
        !this.options.expectedHostnames.includes(result.hostname) ||
        result.action !== this.options.expectedAction
      ) {
        throw new AuthorizationError("Turnstile validation failed.");
      }
      const tokenHash = createHash("sha256").update(token).digest("hex");
      if (
        !(await this.store.consumeOnce(
          `turnstile:${tokenHash}`,
          this.options.tokenTtlMs ?? 5 * 60_000,
        ))
      ) {
        throw new AuthorizationError("Turnstile token was already used.");
      }
    } catch (error) {
      if (error instanceof AuthorizationError) throw error;
      throw new AuthorizationError("Turnstile validation failed.", { cause: error });
    } finally {
      clearTimeout(timeout);
    }
  }
}
