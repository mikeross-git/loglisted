import { z } from "zod";
import { ImdbProfileUrlSchema, WriterEmailSchema, WriterNameSchema } from "../../types/project.js";
import { FinalModelScoreSchema } from "../scorer.js";

export const StoredResultSchema = z
  .object({
    resultId: z.string().uuid(),
    anonymousSessionId: z.string().uuid(),
    fileHash: z.string().regex(/^[a-f0-9]{64}$/),
    projectTitle: z.string(),
    declaredFormat: z.string(),
    declaredGenre: z.string(),
    categoryScores: FinalModelScoreSchema.shape.categoryScores,
    overallScore: z.number().min(1).max(10),
    completedAt: z.string().datetime(),
    internal: z
      .object({
        versions: z.record(z.string(), z.string()),
        inputTokens: z.number().int().nonnegative(),
        outputTokens: z.number().int().nonnegative(),
        estimatedCostUsd: z.number().nonnegative(),
        approvedMetadata: z.record(z.string(), z.unknown()),
        submissionLogline: z.string().max(1000).optional(),
        submissionContact: z
          .object({
            firstName: WriterNameSchema,
            lastName: WriterNameSchema,
            email: WriterEmailSchema,
            imdbUrl: ImdbProfileUrlSchema.optional(),
          })
          .strict()
          .optional(),
        evaluationMode: z.literal("mock").optional(),
        consent: z
          .object({
            aiProcessingPolicyVersion: z.string().min(1),
            privacyNoticeVersion: z.string().min(1),
            confirmedAt: z.string().datetime(),
          })
          .strict()
          .optional(),
      })
      .strict(),
  })
  .strict();

export type StoredResult = z.infer<typeof StoredResultSchema>;

export interface ResultStore {
  put(result: StoredResult, ttlSeconds: number): Promise<void>;
  get(resultId: string): Promise<StoredResult | null>;
  findByFileAndSession(fileHash: string, anonymousSessionId: string): Promise<StoredResult | null>;
  delete(resultId: string): Promise<boolean>;
}
