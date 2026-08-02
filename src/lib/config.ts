import { z } from "zod";
import { ValidationError } from "./errors.js";
import { validatePrivacyConfig } from "./privacy-config.js";

const emptyToUndefined = (value: unknown): unknown => (value === "" ? undefined : value);
const optionalUrl = z.preprocess(emptyToUndefined, z.url().optional());
const optionalSecret = z.preprocess(emptyToUndefined, z.string().min(1).optional());
const booleanFromEnvironment = z.preprocess(
  (value) => (typeof value === "string" ? value.toLowerCase() === "true" : value),
  z.boolean(),
);
const booleanOrUnknownFromEnvironment = z.preprocess(
  (value) => {
    if (value === undefined || value === "" || value === "unknown") return "unknown";
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
  },
  z.union([z.boolean(), z.literal("unknown")]),
);
const retentionDaysFromEnvironment = z.preprocess(
  (value) => (value === undefined || value === "" || value === "unknown" ? "unknown" : value),
  z.union([z.literal("unknown"), z.coerce.number().int().nonnegative()]),
);

export const ConfigSchema = z
  .object({
    APP_ENV: z.enum(["development", "staging", "production"]).default("development"),
    SCREENPLAY_SCORING_MODE: z.enum(["mock", "production"]).default("production"),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
    PUBLIC_APP_ORIGIN: z.url(),
    API_ORIGIN: z.url(),
    CORS_ALLOWED_ORIGINS: z
      .string()
      .min(1)
      .transform((value) => value.split(",").map((origin) => z.url().parse(origin.trim()))),
    SESSION_SIGNING_SECRET: z.string().min(32),
    DEVICE_HMAC_SECRET: optionalSecret,
    CSRF_SIGNING_SECRET: optionalSecret,
    IP_HMAC_SECRET: optionalSecret,
    RESULT_TOKEN_SIGNING_SECRET: optionalSecret,
    DELETION_TOKEN_SIGNING_SECRET: optionalSecret,
    UPLOAD_TOKEN_SIGNING_SECRET: z.string().min(32),
    ANONYMOUS_SESSION_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(7 * 86_400),
    UPLOAD_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(300),
    RESULT_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(30 * 86_400),
    ABUSE_TELEMETRY_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(90 * 86_400),
    TRUSTED_PROXY_IPS: z
      .string()
      .default("")
      .transform((value) =>
        value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    TRUSTED_PROXY_HOPS: z.coerce.number().int().positive().default(1),
    GLOBAL_ANALYSES_PER_MINUTE: z.coerce.number().int().positive().default(10),
    TURNSTILE_SITE_KEY: z.string().min(1),
    TURNSTILE_SECRET_KEY: z.string().min(1),
    TURNSTILE_EXPECTED_HOSTNAME: z.string().min(1),
    TURNSTILE_EXPECTED_ACTION: z.string().min(1),
    STORAGE_DRIVER: z.enum(["memory", "redis"]).default("memory"),
    UPSTASH_REDIS_REST_URL: optionalUrl,
    UPSTASH_REDIS_REST_TOKEN: optionalSecret,
    CACHE_ENCRYPTION_KEY: optionalSecret,
    LLM_PROVIDER: z.enum(["mock", "openai"]).default("openai"),
    MOCK_FIXTURE_MODE: z.literal("deterministic").default("deterministic"),
    MOCK_FIXTURE: z
      .enum([
        "successful_pilot",
        "successful_feature",
        "malformed_summary_once",
        "malformed_score_once",
        "provider_timeout",
        "provider_failure",
        "low_confidence",
        "high_score",
        "cost_limit_exceeded",
      ])
      .default("successful_feature"),
    ALLOW_MOCK_IN_PRODUCTION: booleanFromEnvironment.default(false),
    AI_PROVIDER: z.string().min(1).default("openai"),
    AI_PROVIDER_DATA_TRAINING_DEFAULT: booleanOrUnknownFromEnvironment.default("unknown"),
    AI_PROVIDER_TRAINING_OPT_OUT_CONFIRMED: booleanFromEnvironment.default(false),
    AI_PROVIDER_RETENTION_DAYS: retentionDaysFromEnvironment.default("unknown"),
    AI_PROVIDER_ZERO_DATA_RETENTION_ENABLED: booleanFromEnvironment.default(false),
    AI_PROVIDER_MODIFIED_ABUSE_MONITORING_ENABLED: booleanFromEnvironment.default(false),
    AI_PROVIDER_REQUEST_STORAGE_DISABLED: booleanOrUnknownFromEnvironment.default("unknown"),
    AI_PROVIDER_PRIVACY_REVIEW_DATE: z.preprocess(emptyToUndefined, z.iso.date().optional()),
    AI_PROVIDER_TERMS_URL: optionalUrl,
    AI_PROVIDER_PRIVACY_URL: optionalUrl,
    AI_PROVIDER_DPA_URL: optionalUrl,
    AI_PROVIDER_SUPPORTS_ZERO_DATA_RETENTION: booleanFromEnvironment.default(false),
    AI_PROVIDER_SUPPORTS_MODIFIED_ABUSE_MONITORING: booleanFromEnvironment.default(false),
    AI_PROVIDER_SUPPORTS_REGIONAL_PROCESSING: booleanFromEnvironment.default(false),
    AI_PROVIDER_CONFIGURED_REGION: z.preprocess(
      (value) => (value === "" ? null : (value ?? null)),
      z.string().min(1).nullable(),
    ),
    AI_PROVIDER_SUPPORTS_REQUEST_STORAGE_CONTROL: booleanFromEnvironment.default(false),
    ALLOW_LLM_CONTENT_IN_OBSERVABILITY: booleanFromEnvironment.default(false),
    ALLOW_SCRIPT_CONTENT_IN_ERROR_REPORTS: booleanFromEnvironment.default(false),
    ALLOW_REQUEST_BODY_LOGGING: booleanFromEnvironment.default(false),
    DANGEROUS_ALLOW_CONTENT_OBSERVABILITY_IN_PRODUCTION: booleanFromEnvironment.default(false),
    RAW_PDF_PERSISTENCE_ENABLED: booleanFromEnvironment.default(false),
    RAW_TEXT_PERSISTENCE_ENABLED: booleanFromEnvironment.default(false),
    REDACT_TITLE_PAGE_PII: booleanFromEnvironment.default(true),
    CHUNK_CACHE_TTL_HOURS: z.coerce.number().positive().max(24).default(24),
    SUMMARY_CACHE_TTL_DAYS: z.coerce.number().positive().max(30).default(30),
    COMPRESSED_REPRESENTATION_TTL_DAYS: z.coerce.number().positive().max(30).default(30),
    PRIVACY_STATUS_ENABLED: booleanFromEnvironment.default(false),
    PRIVACY_STATUS_ADMIN_SECRET: z.preprocess(emptyToUndefined, z.string().min(32).optional()),
    PRIVACY_CONFIG_VERSION: z.string().min(1).default("privacy-config-1"),
    OPENAI_API_KEY: optionalSecret,
    SUMMARY_MODEL: optionalSecret,
    SCORING_MODEL: optionalSecret,
    VERIFICATION_MODEL: optionalSecret,
    ADJUDICATOR_MODEL: optionalSecret,
    MODEL_PRICING_JSON: z.string().default('{"models":{}}'),
    DRY_RUN: booleanFromEnvironment.default(false),
    LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
    LLM_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(3),
    MAX_LLM_COST_USD_PER_SUBMISSION: z.coerce.number().positive().default(0.15),
    DAILY_LLM_BUDGET_USD: z.coerce.number().positive().default(10),
    MAX_TOTAL_INPUT_TOKENS_PER_SCRIPT: z.coerce.number().int().positive().default(180_000),
    MAX_TOTAL_OUTPUT_TOKENS_PER_SCRIPT: z.coerce.number().int().positive().default(8_000),
    MAX_CHUNK_SUMMARY_OUTPUT_TOKENS: z.coerce.number().int().positive().default(350),
    MAX_SCORING_INPUT_TOKENS: z.coerce.number().int().positive().default(12_000),
    MAX_SCORING_OUTPUT_TOKENS: z.coerce.number().int().positive().default(350),
    REPRESENTATIVE_EXCERPT_TOKEN_BUDGET: z.coerce.number().int().positive().default(4_000),
    TARGET_COST_PER_SCRIPT_USD: z.coerce.number().positive().default(0.1),
    DAILY_LLM_SPEND_LIMIT_USD: z.coerce.number().positive().default(10),
    HOURLY_LLM_SPEND_LIMIT_USD: z.coerce.number().positive().default(2),
    MAX_ANALYSES_PER_HOUR_GLOBAL: z.coerce.number().int().positive().default(100),
    MAX_PDF_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(15 * 1024 * 1024),
    MAX_PDF_PAGES: z.coerce.number().int().positive().default(150),
    MIN_PDF_PAGES: z.coerce.number().int().positive().max(150).default(25),
    MIN_READABLE_TEXT_LENGTH: z.coerce.number().int().nonnegative().default(1000),
    PDF_LOW_TEXT_PAGE_THRESHOLD: z.coerce.number().int().nonnegative().default(40),
    CHUNK_TARGET_TOKENS: z.coerce.number().int().min(1500).max(2500).default(2000),
    CHUNK_HARD_MAX_TOKENS: z.coerce.number().int().min(1500).default(2500),
    FRAMER_CMS_SYNC_ENABLED: booleanFromEnvironment.default(false),
    FRAMER_CMS_PUBLISH_MODE: z.enum(["draft", "published"]).default("draft"),
    FRAMER_API_TOKEN: optionalSecret,
    FRAMER_PROJECT_ID: optionalSecret,
    FRAMER_COLLECTION_ID: optionalSecret,
    FRAMER_RANKINGS_ENABLED: booleanFromEnvironment.default(false),
    FRAMER_RANKINGS_CACHE_TTL_SECONDS: z.coerce.number().int().min(10).max(3600).default(60),
  })
  .strict()
  .superRefine((config, context) => {
    if (config.MIN_PDF_PAGES > config.MAX_PDF_PAGES) {
      context.addIssue({
        code: "custom",
        path: ["MIN_PDF_PAGES"],
        message: "MIN_PDF_PAGES cannot exceed MAX_PDF_PAGES.",
      });
    }
    if (config.APP_ENV === "staging") {
      context.addIssue({
        code: "custom",
        path: ["APP_ENV"],
        message: "Public staging must use the isolated staging executable and configuration.",
      });
    }
    if (config.APP_ENV === "production" && config.SCREENPLAY_SCORING_MODE !== "production") {
      context.addIssue({
        code: "custom",
        path: ["SCREENPLAY_SCORING_MODE"],
        message: "The production configuration requires production scoring mode.",
      });
    }
    if (config.FRAMER_CMS_SYNC_ENABLED || config.FRAMER_RANKINGS_ENABLED) {
      for (const key of [
        "FRAMER_API_TOKEN",
        "FRAMER_PROJECT_ID",
        "FRAMER_COLLECTION_ID",
      ] as const) {
        if (!config[key]) {
          context.addIssue({
            code: "custom",
            path: [key],
            message: `${key} is required when Framer CMS synchronization is enabled.`,
          });
        }
      }
    }
    try {
      const pricing = JSON.parse(config.MODEL_PRICING_JSON) as unknown;
      z.object({
        models: z.record(
          z.string(),
          z
            .object({
              inputPerMillion: z.number().nonnegative(),
              outputPerMillion: z.number().nonnegative(),
              cachedInputPerMillion: z.number().nonnegative(),
            })
            .strict(),
        ),
      })
        .strict()
        .parse(pricing);
    } catch {
      context.addIssue({
        code: "custom",
        path: ["MODEL_PRICING_JSON"],
        message: "MODEL_PRICING_JSON must contain valid model pricing.",
      });
    }
    if (
      config.STORAGE_DRIVER === "redis" &&
      (!config.UPSTASH_REDIS_REST_URL || !config.UPSTASH_REDIS_REST_TOKEN)
    ) {
      context.addIssue({
        code: "custom",
        path: ["STORAGE_DRIVER"],
        message: "Redis storage requires both Upstash Redis credentials.",
      });
    }
    if (
      config.NODE_ENV === "production" &&
      config.STORAGE_DRIVER === "redis" &&
      !config.CACHE_ENCRYPTION_KEY
    ) {
      context.addIssue({
        code: "custom",
        path: ["CACHE_ENCRYPTION_KEY"],
        message: "Production Redis caching requires application-level encryption.",
      });
    }
    if (config.CHUNK_HARD_MAX_TOKENS < config.CHUNK_TARGET_TOKENS) {
      context.addIssue({
        code: "custom",
        path: ["CHUNK_HARD_MAX_TOKENS"],
        message: "The chunk hard maximum must be at least the target.",
      });
    }
    if (config.NODE_ENV === "production" && (!config.SUMMARY_MODEL || !config.SCORING_MODEL)) {
      context.addIssue({
        code: "custom",
        path: ["SUMMARY_MODEL"],
        message: "Production requires summary and scoring model identifiers.",
      });
    }
    if (
      config.NODE_ENV === "production" &&
      config.LLM_PROVIDER === "openai" &&
      !config.OPENAI_API_KEY
    ) {
      context.addIssue({
        code: "custom",
        path: ["OPENAI_API_KEY"],
        message: "Production OpenAI mode requires an API key.",
      });
    }
    if (
      config.NODE_ENV === "production" &&
      config.LLM_PROVIDER === "mock" &&
      !config.ALLOW_MOCK_IN_PRODUCTION
    ) {
      context.addIssue({
        code: "custom",
        path: ["ALLOW_MOCK_IN_PRODUCTION"],
        message: "Mock LLM mode is disabled in production.",
      });
    }
    if (
      config.NODE_ENV === "production" &&
      (!config.DEVICE_HMAC_SECRET ||
        !config.CSRF_SIGNING_SECRET ||
        !config.IP_HMAC_SECRET ||
        !config.RESULT_TOKEN_SIGNING_SECRET ||
        !config.DELETION_TOKEN_SIGNING_SECRET)
    ) {
      context.addIssue({
        code: "custom",
        path: ["DEVICE_HMAC_SECRET"],
        message: "Production requires all anonymous security secrets.",
      });
    }
  });

export type AppConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(environment: Record<string, string | undefined>): AppConfig {
  const parsed = ConfigSchema.safeParse(environment);
  if (!parsed.success) {
    throw new ValidationError("Invalid environment configuration.", {
      details: { issueCount: parsed.error.issues.length },
    });
  }
  const pricing = JSON.parse(parsed.data.MODEL_PRICING_JSON) as {
    models?: Record<string, unknown>;
  };
  const activeModels = [
    parsed.data.SUMMARY_MODEL,
    parsed.data.SCORING_MODEL,
    parsed.data.VERIFICATION_MODEL,
    parsed.data.ADJUDICATOR_MODEL,
  ].filter((model): model is string => Boolean(model));
  for (const model of activeModels) {
    if (!pricing.models?.[model]) {
      console.warn(
        JSON.stringify({
          level: "warn",
          event: "config.model_pricing_missing",
          fields: { model },
        }),
      );
    }
  }
  const privacy = validatePrivacyConfig(
    environment,
    parsed.data.NODE_ENV,
    parsed.data.LLM_PROVIDER,
  );
  for (const warning of privacy.warnings) {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "config.ai_privacy_unknown",
        fields: { reasonCode: warning },
      }),
    );
  }
  return parsed.data;
}
