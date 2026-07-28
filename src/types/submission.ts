import { z } from "zod";
import { PublicScoreResultSchema } from "./scoring.js";

export const SubmissionStatusSchema = z.enum([
  "awaiting_upload",
  "queued",
  "validating",
  "extracting",
  "parsing",
  "chunking",
  "summarizing",
  "scoring",
  "completed",
  "rejected",
  "failed",
]);

export const SubmissionSchema = z
  .object({
    id: z.uuid(),
    ownerSessionHash: z.string().regex(/^[a-f0-9]{64}$/),
    status: SubmissionStatusSchema,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    fileHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    result: PublicScoreResultSchema.optional(),
    failureCode: z.string().max(100).optional(),
  })
  .strict();

export type SubmissionStatus = z.infer<typeof SubmissionStatusSchema>;
export type Submission = z.infer<typeof SubmissionSchema>;
