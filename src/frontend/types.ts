export type ProjectFormat = "feature" | "halfHourPilot" | "hourPilot" | "unknown";

export interface ProjectForm {
  firstName: string;
  lastName: string;
  email: string;
  imdbUrl: string;
  websiteUrl: string;
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

export interface CategoryScores {
  premise: number;
  story: number;
  structure: number;
  characters: number;
  dialogue: number;
  pacing: number;
  theme: number;
  tone: number;
  marketability: number;
  craft: number;
}

export interface AnalysisResult {
  resultId?: string;
  resultAccessToken?: string;
  deletionToken?: string;
  projectTitle?: string;
  declaredFormat?: string;
  declaredGenre?: string;
  categoryScores: CategoryScores;
  overallScore: number;
  pageCount?: number;
  completedAt?: string;
  evaluationMode?: "mock";
}

const categoryNames = [
  "premise",
  "story",
  "structure",
  "characters",
  "dialogue",
  "pacing",
  "theme",
  "tone",
  "marketability",
  "craft",
] as const;

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`Invalid analysis result field: ${key}`);
  return value;
}

export function parseAnalysisResult(input: unknown): AnalysisResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Invalid analysis result.");
  }
  const record = input as Record<string, unknown>;
  const rawScores = record["categoryScores"];
  if (typeof rawScores !== "object" || rawScores === null || Array.isArray(rawScores)) {
    throw new Error("Invalid analysis category scores.");
  }
  const scoreRecord = rawScores as Record<string, unknown>;
  const categoryScores = {} as CategoryScores;
  for (const category of categoryNames) {
    const score = scoreRecord[category];
    if (typeof score !== "number" || !Number.isFinite(score) || score < 1 || score > 10) {
      throw new Error(`Invalid analysis score: ${category}`);
    }
    categoryScores[category] = score;
  }
  const overallScore = record["overallScore"];
  if (
    typeof overallScore !== "number" ||
    !Number.isFinite(overallScore) ||
    overallScore < 1 ||
    overallScore > 10
  ) {
    throw new Error("Invalid overall score.");
  }
  const evaluationMode = record["evaluationMode"];
  if (evaluationMode !== undefined && evaluationMode !== "mock") {
    throw new Error("Invalid evaluation mode.");
  }
  const result: AnalysisResult = {
    categoryScores,
    overallScore,
  };
  const optionalKeys = [
    "resultId",
    "resultAccessToken",
    "deletionToken",
    "projectTitle",
    "declaredFormat",
    "declaredGenre",
    "completedAt",
  ] as const;
  for (const key of optionalKeys) {
    const value = optionalString(record, key);
    if (value !== undefined) result[key] = value;
  }
  const pageCount = record["pageCount"];
  if (
    pageCount !== undefined &&
    (typeof pageCount !== "number" || !Number.isInteger(pageCount) || pageCount < 1)
  ) {
    throw new Error("Invalid analysis result field: pageCount");
  }
  if (typeof pageCount === "number") result.pageCount = pageCount;
  if (evaluationMode === "mock") result.evaluationMode = evaluationMode;
  return result;
}

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
