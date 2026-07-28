import { z } from "zod";

export const AbuseAdmissionSchema = z
  .object({
    sessionHash: z.string().regex(/^[a-f0-9]{64}$/),
    networkHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    submissionCount: z.number().int().nonnegative(),
    duplicateCount: z.number().int().nonnegative(),
    challengePassed: z.boolean(),
    admitted: z.boolean(),
    reasonCode: z.string().max(80).optional(),
  })
  .strict();

export type AbuseAdmission = z.infer<typeof AbuseAdmissionSchema>;
