import { z } from "zod";
import { ValidationError } from "./errors.js";

const unknownBoolean = z.preprocess(
  (value) => {
    if (value === "unknown" || value === undefined || value === "") return "unknown";
    if (value === true || value === "true") return true;
    if (value === false || value === "false") return false;
    return value;
  },
  z.union([z.boolean(), z.literal("unknown")]),
);

const environmentBoolean = z.preprocess(
  (value) => (typeof value === "string" ? value.toLowerCase() === "true" : value),
  z.boolean(),
);

const retentionDays = z.preprocess(
  (value) => (value === undefined || value === "" || value === "unknown" ? "unknown" : value),
  z.union([z.literal("unknown"), z.coerce.number().int().nonnegative()]),
);

const optionalUrl = z.preprocess((value) => (value === "" ? undefined : value), z.url().optional());

export const PrivacyConfigSchema = z
  .object({
    AI_PROVIDER: z.string().min(1).default("openai"),
    AI_PROVIDER_DATA_TRAINING_DEFAULT: unknownBoolean.default("unknown"),
    AI_PROVIDER_TRAINING_OPT_OUT_CONFIRMED: environmentBoolean.default(false),
    AI_PROVIDER_RETENTION_DAYS: retentionDays.default("unknown"),
    AI_PROVIDER_ZERO_DATA_RETENTION_ENABLED: environmentBoolean.default(false),
    AI_PROVIDER_MODIFIED_ABUSE_MONITORING_ENABLED: environmentBoolean.default(false),
    AI_PROVIDER_REQUEST_STORAGE_DISABLED: unknownBoolean.default("unknown"),
    AI_PROVIDER_PRIVACY_REVIEW_DATE: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.iso.date().optional(),
    ),
    AI_PROVIDER_TERMS_URL: optionalUrl,
    AI_PROVIDER_PRIVACY_URL: optionalUrl,
    AI_PROVIDER_DPA_URL: optionalUrl,
    AI_PROVIDER_SUPPORTS_ZERO_DATA_RETENTION: environmentBoolean.default(false),
    AI_PROVIDER_SUPPORTS_MODIFIED_ABUSE_MONITORING: environmentBoolean.default(false),
    AI_PROVIDER_SUPPORTS_REGIONAL_PROCESSING: environmentBoolean.default(false),
    AI_PROVIDER_CONFIGURED_REGION: z.preprocess(
      (value) => (value === "" ? null : (value ?? null)),
      z.string().min(1).nullable(),
    ),
    AI_PROVIDER_SUPPORTS_REQUEST_STORAGE_CONTROL: environmentBoolean.default(false),
    ALLOW_LLM_CONTENT_IN_OBSERVABILITY: environmentBoolean.default(false),
    ALLOW_SCRIPT_CONTENT_IN_ERROR_REPORTS: environmentBoolean.default(false),
    ALLOW_REQUEST_BODY_LOGGING: environmentBoolean.default(false),
    DANGEROUS_ALLOW_CONTENT_OBSERVABILITY_IN_PRODUCTION: environmentBoolean.default(false),
    RAW_PDF_PERSISTENCE_ENABLED: environmentBoolean.default(false),
    RAW_TEXT_PERSISTENCE_ENABLED: environmentBoolean.default(false),
    REDACT_TITLE_PAGE_PII: environmentBoolean.default(true),
    CHUNK_CACHE_TTL_HOURS: z.coerce.number().positive().max(24).default(24),
    SUMMARY_CACHE_TTL_DAYS: z.coerce.number().positive().max(30).default(30),
    COMPRESSED_REPRESENTATION_TTL_DAYS: z.coerce.number().positive().max(30).default(30),
    PRIVACY_STATUS_ENABLED: environmentBoolean.default(false),
    PRIVACY_STATUS_ADMIN_SECRET: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().min(32).optional(),
    ),
    PRIVACY_CONFIG_VERSION: z.string().min(1).default("privacy-config-1"),
  })
  .passthrough();

export type PrivacyConfig = z.infer<typeof PrivacyConfigSchema>;

export function validatePrivacyConfig(
  environment: Record<string, string | undefined>,
  nodeEnvironment: "development" | "test" | "production",
  llmProvider: "mock" | "openai",
): { config: PrivacyConfig; warnings: string[] } {
  const parsed = PrivacyConfigSchema.safeParse(environment);
  if (!parsed.success) {
    throw new ValidationError("Invalid AI privacy configuration.", {
      details: { issueCount: parsed.error.issues.length },
    });
  }
  const config = parsed.data;
  const warnings: string[] = [];
  const externalProvider = llmProvider !== "mock";
  if (externalProvider && config.AI_PROVIDER_DATA_TRAINING_DEFAULT === "unknown") {
    warnings.push("AI provider training default is unknown.");
  }
  if (externalProvider && config.AI_PROVIDER_RETENTION_DAYS === "unknown") {
    warnings.push("AI provider retention is unknown.");
  }
  if (externalProvider && config.AI_PROVIDER_REQUEST_STORAGE_DISABLED === "unknown") {
    warnings.push("AI provider request-storage behavior is unknown.");
  }

  if (nodeEnvironment === "production") {
    if (externalProvider && !config.AI_PROVIDER_TRAINING_OPT_OUT_CONFIRMED) {
      throw new ValidationError("Production requires confirmed provider training opt-out.");
    }
    if (externalProvider && !config.AI_PROVIDER_PRIVACY_REVIEW_DATE) {
      throw new ValidationError("Production requires an AI provider privacy review date.");
    }
    if (externalProvider && !config.AI_PROVIDER_TERMS_URL) {
      throw new ValidationError("Production requires the AI provider terms URL.");
    }
    if (externalProvider && config.AI_PROVIDER_REQUEST_STORAGE_DISABLED === "unknown") {
      throw new ValidationError("Production requires explicit request-storage behavior.");
    }
    if (
      externalProvider &&
      config.AI_PROVIDER_SUPPORTS_REQUEST_STORAGE_CONTROL &&
      config.AI_PROVIDER_REQUEST_STORAGE_DISABLED !== true
    ) {
      throw new ValidationError("Production requires provider request storage to be disabled.");
    }
    if (
      config.AI_PROVIDER_DATA_TRAINING_DEFAULT === true &&
      !config.AI_PROVIDER_TRAINING_OPT_OUT_CONFIRMED
    ) {
      throw new ValidationError("Provider training use is incompatible with production policy.");
    }
    const contentCaptureEnabled =
      config.ALLOW_LLM_CONTENT_IN_OBSERVABILITY ||
      config.ALLOW_SCRIPT_CONTENT_IN_ERROR_REPORTS ||
      config.ALLOW_REQUEST_BODY_LOGGING;
    if (contentCaptureEnabled && !config.DANGEROUS_ALLOW_CONTENT_OBSERVABILITY_IN_PRODUCTION) {
      throw new ValidationError("Production content observability is disabled by policy.");
    }
    if (config.RAW_PDF_PERSISTENCE_ENABLED || config.RAW_TEXT_PERSISTENCE_ENABLED) {
      throw new ValidationError("Production raw screenplay persistence is disabled by policy.");
    }
    if (!config.REDACT_TITLE_PAGE_PII) {
      throw new ValidationError("Production requires title-page PII redaction.");
    }
    if (config.PRIVACY_STATUS_ENABLED && !config.PRIVACY_STATUS_ADMIN_SECRET) {
      throw new ValidationError("Enabled privacy status requires an admin secret.");
    }
  }
  return { config, warnings };
}
