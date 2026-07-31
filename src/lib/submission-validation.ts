import { z } from "zod";
import { ImdbProfileUrlSchema, WriterEmailSchema, WriterNameSchema } from "../types/project.js";
import { ValidationError } from "./errors.js";

export const UploadAuthorizationInputSchema = z
  .object({
    turnstileToken: z.string().min(1).max(2048),
    deviceId: z.string().uuid(),
    fileHash: z.string().regex(/^[a-f0-9]{64}$/),
    fileSize: z
      .number()
      .int()
      .positive()
      .max(15 * 1024 * 1024),
    fileName: z.string().min(1).max(255),
    mimeType: z.literal("application/pdf"),
    project: z
      .object({
        firstName: WriterNameSchema.optional(),
        lastName: WriterNameSchema.optional(),
        email: WriterEmailSchema.optional(),
        imdbUrl: ImdbProfileUrlSchema.optional(),
        projectTitle: z.string().min(1).max(200),
        format: z.enum(["feature", "halfHourPilot", "hourPilot", "unknown"]),
        primaryGenre: z.string().min(1).max(100),
        secondaryGenres: z.array(z.string().min(1).max(100)).max(5),
        approximatePageCount: z.number().int().positive().max(300),
        logline: z.string().max(1_000),
        originalWorkConfirmed: z.literal(true),
        uploadRightsConfirmed: z.literal(true),
        privacyTermsAccepted: z.literal(true),
        acceptableUseAccepted: z.literal(true),
        aiProcessingAcknowledged: z.literal(true),
      })
      .strict(),
    antiBot: z
      .object({
        website_confirm: z.string().max(500),
        formMountedAt: z.string().datetime(),
        fileSelectedAt: z.string().datetime(),
        formSubmittedAt: z.string().datetime(),
      })
      .strict(),
  })
  .strict();

export type UploadAuthorizationInput = z.infer<typeof UploadAuthorizationInputSchema>;

export interface TimingSignals {
  suspiciouslyFastForm: boolean;
  futureTimestamps: boolean;
  staleTimestamps: boolean;
  honeypotCompleted: boolean;
}

export function validateSubmissionTiming(
  input: UploadAuthorizationInput,
  serverTime: Date,
): TimingSignals {
  const mounted = Date.parse(input.antiBot.formMountedAt);
  const selected = Date.parse(input.antiBot.fileSelectedAt);
  const submitted = Date.parse(input.antiBot.formSubmittedAt);
  if (![mounted, selected, submitted].every(Number.isFinite)) {
    throw new ValidationError("Submission timing is invalid.");
  }
  const now = serverTime.getTime();
  return {
    suspiciouslyFastForm: submitted - mounted < 2_000 || submitted - selected < 500,
    futureTimestamps: mounted > now + 30_000 || selected > now + 30_000 || submitted > now + 30_000,
    staleTimestamps: now - mounted > 24 * 60 * 60_000 || now - submitted > 30 * 60_000,
    honeypotCompleted: input.antiBot.website_confirm.trim().length > 0,
  };
}
