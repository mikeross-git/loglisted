import { z } from "zod";
import { ValidationError } from "./lib/errors.js";
import { mockFixtureNames } from "./lib/llm/mock.js";

const booleanFromEnvironment = z.preprocess(
  (value) => (typeof value === "string" ? value.toLowerCase() === "true" : value),
  z.boolean(),
);

const commaSeparatedOrigins = z
  .string()
  .min(1)
  .transform((value, context) => {
    const origins = value
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean);
    try {
      return [...new Set(origins.map((origin) => new URL(origin).origin))];
    } catch {
      context.addIssue({ code: "custom", message: "ALLOWED_ORIGINS contains an invalid URL." });
      return z.NEVER;
    }
  })
  .refine((origins) => origins.length > 0, "At least one allowed origin is required.");

const commaSeparatedHostnames = z
  .string()
  .min(1)
  .transform((value) =>
    [...new Set(value.split(",").map((hostname) => hostname.trim().toLowerCase()))].filter(Boolean),
  )
  .refine((hostnames) => hostnames.length > 0, "At least one Turnstile hostname is required.");

export const TURNSTILE_ALWAYS_PASS_TEST_SITE_KEY = "1x00000000000000000000AA";
export const TURNSTILE_ALWAYS_PASS_TEST_SECRET = "1x0000000000000000000000000000000AA";

export const StagingEnvironmentSchema = z
  .object({
    APP_ENV: z.literal("staging"),
    SCREENPLAY_SCORING_MODE: z.literal("mock"),
    NODE_ENV: z.enum(["production", "test"]).default("production"),
    HOST: z.string().min(1).default("0.0.0.0"),
    PORT: z.coerce.number().int().positive().default(10_000),
    ALLOWED_ORIGINS: commaSeparatedOrigins,
    MOCK_LLM_SCENARIO: z.enum(mockFixtureNames).default("successful_pilot"),
    DRY_RUN: booleanFromEnvironment.default(true),
    TURNSTILE_MODE: z.enum(["test", "managed"]).default("test"),
    TURNSTILE_SITE_KEY: z.string().min(1),
    TURNSTILE_SECRET_KEY: z.string().min(1),
    TURNSTILE_EXPECTED_HOSTNAMES: commaSeparatedHostnames,
    TURNSTILE_EXPECTED_ACTION: z.literal("screenplay_upload").default("screenplay_upload"),
    SESSION_SIGNING_SECRET: z.string().min(32),
    DEVICE_HMAC_SECRET: z.string().min(32),
    CSRF_SIGNING_SECRET: z.string().min(32),
    IP_HMAC_SECRET: z.string().min(32),
    RESULT_TOKEN_SIGNING_SECRET: z.string().min(32),
    DELETION_TOKEN_SIGNING_SECRET: z.string().min(32),
    UPLOAD_TOKEN_SIGNING_SECRET: z.string().min(32),
    ANONYMOUS_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(604_800),
    UPLOAD_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().max(900).default(300),
    RESULT_TTL_SECONDS: z.coerce.number().int().positive().default(86_400),
    ABUSE_TELEMETRY_TTL_SECONDS: z.coerce.number().int().positive().default(604_800),
    GLOBAL_ANALYSES_PER_MINUTE: z.coerce.number().int().positive().max(100).default(10),
    MAX_PDF_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .max(15 * 1024 * 1024)
      .default(15 * 1024 * 1024),
    MAX_PDF_PAGES: z.coerce.number().int().positive().max(150).default(150),
    MIN_READABLE_TEXT_LENGTH: z.coerce.number().int().nonnegative().default(1000),
    PDF_LOW_TEXT_PAGE_THRESHOLD: z.coerce.number().int().nonnegative().default(40),
    MAX_COMPLETED_PER_SESSION: z.coerce.number().int().positive().default(10),
    MAX_COMPLETED_PER_IP: z.coerce.number().int().positive().default(20),
    AUTHORIZATION_ATTEMPTS_PER_10_MINUTES: z.coerce.number().int().positive().default(10),
    ANALYSIS_ATTEMPTS_PER_10_MINUTES: z.coerce.number().int().positive().default(10),
    RAW_PDF_PERSISTENCE_ENABLED: z.literal("false").default("false"),
    RAW_TEXT_PERSISTENCE_ENABLED: z.literal("false").default("false"),
    STORAGE_DRIVER: z.literal("memory").default("memory"),
    TRUST_PROXY_HOPS: z.coerce.number().int().positive().max(5).default(1),
  })
  .passthrough()
  .superRefine((config, context) => {
    if (config.TURNSTILE_MODE === "test") {
      if (config.TURNSTILE_SITE_KEY !== TURNSTILE_ALWAYS_PASS_TEST_SITE_KEY) {
        context.addIssue({
          code: "custom",
          path: ["TURNSTILE_SITE_KEY"],
          message: "Staging Turnstile test mode requires Cloudflare's always-pass test site key.",
        });
      }
      if (config.TURNSTILE_SECRET_KEY !== TURNSTILE_ALWAYS_PASS_TEST_SECRET) {
        context.addIssue({
          code: "custom",
          path: ["TURNSTILE_SECRET_KEY"],
          message: "Staging Turnstile test mode requires Cloudflare's always-pass test secret.",
        });
      }
    } else if (config.TURNSTILE_SECRET_KEY === TURNSTILE_ALWAYS_PASS_TEST_SECRET) {
      context.addIssue({
        code: "custom",
        path: ["TURNSTILE_SECRET_KEY"],
        message: "Managed Turnstile mode cannot use a Cloudflare test secret.",
      });
    }
  });

export type StagingConfig = z.infer<typeof StagingEnvironmentSchema>;

export function loadStagingConfig(environment: Record<string, string | undefined>): StagingConfig {
  const parsed = StagingEnvironmentSchema.safeParse(environment);
  if (!parsed.success) {
    throw new ValidationError("Invalid staging environment configuration.", {
      details: {
        issueCount: parsed.error.issues.length,
        issuePaths: parsed.error.issues.map((issue) => issue.path.join(".")).join(","),
      },
    });
  }
  return parsed.data;
}
