import { z } from "zod";
import type { PrivacyConfig } from "./privacy-config.js";
import type { CacheTtls } from "./cache.js";

export const DataRetentionPolicySchema = z
  .object({
    rawPdfPersistenceEnabled: z.literal(false),
    rawTextPersistenceEnabled: z.literal(false),
    redactedChunkTtlSeconds: z.number().int().positive().max(86_400),
    summaryTtlSeconds: z
      .number()
      .int()
      .positive()
      .max(30 * 86_400),
    compressedRepresentationTtlSeconds: z
      .number()
      .int()
      .positive()
      .max(30 * 86_400),
    representativeExcerptPersistenceEnabled: z.literal(false),
    resultTtlSeconds: z.number().int().positive(),
    abuseTelemetryTtlSeconds: z.number().int().positive(),
  })
  .strict();

export type DataRetentionPolicy = z.infer<typeof DataRetentionPolicySchema>;

export function createDataRetentionPolicy(
  privacy: PrivacyConfig,
  resultTtlSeconds: number,
  abuseTelemetryTtlSeconds: number,
): DataRetentionPolicy {
  return DataRetentionPolicySchema.parse({
    rawPdfPersistenceEnabled: false,
    rawTextPersistenceEnabled: false,
    redactedChunkTtlSeconds: Math.floor(privacy.CHUNK_CACHE_TTL_HOURS * 3_600),
    summaryTtlSeconds: Math.floor(privacy.SUMMARY_CACHE_TTL_DAYS * 86_400),
    compressedRepresentationTtlSeconds: Math.floor(
      privacy.COMPRESSED_REPRESENTATION_TTL_DAYS * 86_400,
    ),
    representativeExcerptPersistenceEnabled: false,
    resultTtlSeconds,
    abuseTelemetryTtlSeconds,
  });
}

export function cacheTtlsForRetention(policyInput: DataRetentionPolicy): CacheTtls {
  const policy = DataRetentionPolicySchema.parse(policyInput);
  return {
    pdfExtraction: Math.min(3_600, policy.redactedChunkTtlSeconds),
    screenplayMetadata: policy.redactedChunkTtlSeconds,
    chunks: policy.redactedChunkTtlSeconds,
    chunkSummary: policy.summaryTtlSeconds,
    reducedScreenplay: policy.compressedRepresentationTtlSeconds,
    representativeExcerpts: Math.min(3_600, policy.redactedChunkTtlSeconds),
    finalScore: policy.resultTtlSeconds,
  };
}

export function discardSensitiveBuffer(buffer: Uint8Array): void {
  buffer.fill(0);
}
