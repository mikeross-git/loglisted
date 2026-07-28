import { z } from "zod";

export const ProjectFormatSchema = z.enum([
  "feature",
  "halfHourPilot",
  "hourPilot",
  "short",
  "unknown",
]);
export type ProjectFormat = z.infer<typeof ProjectFormatSchema>;

export interface ProjectForm {
  firstName: string;
  lastName: string;
  email: string;
  imdbUrl: string;
  projectTitle: string;
  format: ProjectFormat;
  primaryGenre: string;
  secondaryGenres: string[];
  logline: string;
  originalWorkConfirmed: boolean;
  uploadRightsConfirmed: boolean;
  privacyTermsAccepted: boolean;
  acceptableUseAccepted: boolean;
  aiProcessingAcknowledged: boolean;
  websiteConfirm: string;
}

export interface BrowserSession {
  deviceId: string;
  csrfToken: string;
  sessionExpiresAt: string;
}

export interface FileInspection {
  fileHash: string;
  fileSize: number;
  approximatePageCount: number | null;
  readableTextWarning: boolean;
}

export interface UploadAuthorizationResponse {
  uploadToken: string | null;
  expiresAt: string | null;
  cachedResultAvailable: boolean;
  resultAccessToken: string | null;
  deletionToken?: string;
  resultId?: string;
}

export const CategoryScoresSchema = z
  .object({
    premise: z.number(),
    story: z.number(),
    structure: z.number(),
    characters: z.number(),
    dialogue: z.number(),
    pacing: z.number(),
    theme: z.number(),
    tone: z.number(),
    marketability: z.number(),
    craft: z.number(),
  })
  .strict();

export const AnalysisResultSchema = z
  .object({
    resultId: z.string().optional(),
    resultAccessToken: z.string().optional(),
    deletionToken: z.string().optional(),
    projectTitle: z.string().optional(),
    declaredFormat: z.string().optional(),
    declaredGenre: z.string().optional(),
    categoryScores: CategoryScoresSchema,
    overallScore: z.number(),
    completedAt: z.string().optional(),
    evaluationMode: z.literal("mock").optional(),
  })
  .strict();

export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;

export type UploaderPhase =
  | "establishing_session"
  | "ready"
  | "hashing"
  | "authorizing"
  | "uploading"
  | "processing"
  | "retrieving_cached"
  | "completed"
  | "error";
