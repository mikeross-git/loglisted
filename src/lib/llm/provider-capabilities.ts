import { z } from "zod";

const BooleanOrUnknownSchema = z.union([z.boolean(), z.literal("unknown")]);
const DaysOrUnknownSchema = z.union([z.number().int().nonnegative(), z.literal("unknown")]);

export const ProviderPrivacyCapabilitiesSchema = z
  .object({
    providerName: z.string().min(1),
    modelName: z.string().min(1),
    apiDataUsedForTrainingByDefault: BooleanOrUnknownSchema,
    trainingOptOutConfigured: BooleanOrUnknownSchema,
    supportsZeroDataRetention: z.boolean(),
    zeroDataRetentionEnabled: z.boolean(),
    supportsModifiedAbuseMonitoring: z.boolean(),
    modifiedAbuseMonitoringEnabled: z.boolean(),
    statedRetentionDays: DaysOrUnknownSchema,
    supportsRegionalProcessing: z.boolean(),
    configuredRegion: z.string().min(1).nullable(),
    supportsRequestStorageControl: z.boolean(),
    requestStorageDisabled: BooleanOrUnknownSchema,
  })
  .strict();

export type ProviderPrivacyCapabilities = z.infer<typeof ProviderPrivacyCapabilitiesSchema>;

export function createProviderPrivacyCapabilities(
  input: ProviderPrivacyCapabilities,
): ProviderPrivacyCapabilities {
  return ProviderPrivacyCapabilitiesSchema.parse(input);
}
