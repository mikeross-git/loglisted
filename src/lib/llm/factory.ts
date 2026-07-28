import type { AppConfig } from "../config.js";
import { ValidationError } from "../errors.js";
import { MockLlmProvider } from "./mock.js";
import type { LlmProvider } from "./provider.js";
import { OpenAiProvider } from "./openai.js";

export function createLlmProvider(
  config: AppConfig,
  options: { fetchImplementation?: typeof fetch } = {},
): LlmProvider {
  if (config.APP_ENV === "staging") {
    throw new ValidationError("Public staging cannot use the production provider factory.");
  }
  if (config.LLM_PROVIDER === "mock") {
    if (config.NODE_ENV === "production" && !config.ALLOW_MOCK_IN_PRODUCTION) {
      throw new ValidationError("Mock LLM mode is disabled in production.");
    }
    return new MockLlmProvider({
      fixture: config.MOCK_FIXTURE,
      dryRun: config.DRY_RUN,
    });
  }
  return new OpenAiProvider({
    ...(config.OPENAI_API_KEY ? { apiKey: config.OPENAI_API_KEY } : {}),
    dryRun: config.DRY_RUN,
    privacyCapabilities: {
      apiDataUsedForTrainingByDefault: config.AI_PROVIDER_DATA_TRAINING_DEFAULT,
      trainingOptOutConfigured: config.AI_PROVIDER_TRAINING_OPT_OUT_CONFIRMED,
      supportsZeroDataRetention: config.AI_PROVIDER_SUPPORTS_ZERO_DATA_RETENTION,
      zeroDataRetentionEnabled: config.AI_PROVIDER_ZERO_DATA_RETENTION_ENABLED,
      supportsModifiedAbuseMonitoring: config.AI_PROVIDER_SUPPORTS_MODIFIED_ABUSE_MONITORING,
      modifiedAbuseMonitoringEnabled: config.AI_PROVIDER_MODIFIED_ABUSE_MONITORING_ENABLED,
      statedRetentionDays: config.AI_PROVIDER_RETENTION_DAYS,
      supportsRegionalProcessing: config.AI_PROVIDER_SUPPORTS_REGIONAL_PROCESSING,
      configuredRegion: config.AI_PROVIDER_CONFIGURED_REGION,
      supportsRequestStorageControl: config.AI_PROVIDER_SUPPORTS_REQUEST_STORAGE_CONTROL,
      requestStorageDisabled: config.AI_PROVIDER_REQUEST_STORAGE_DISABLED,
    },
    ...(options.fetchImplementation ? { fetchImplementation: options.fetchImplementation } : {}),
  });
}
