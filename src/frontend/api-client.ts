import { parseAnalysisResult } from "./types.js";
import type {
  AnalysisResult,
  BrowserSession,
  FileInspection,
  ProjectForm,
  UploadAuthorizationResponse,
} from "./types.js";

export const publicErrorMessages = Object.freeze({
  verification: "We couldn't verify your submission. Please try again.",
  limit: "You've reached the current submission limit.",
  duplicate: "This script was already submitted.",
  processing: "Your script is currently being processed…",
  authorizationExpired: "Your upload authorization expired. Please try again.",
  unreadable: "This PDF does not appear to contain readable screenplay text.",
  documentLimit: "This document exceeds the current file or page limit.",
  capacity: "We're currently at processing capacity. Please try again later.",
  analysis: "We couldn't complete the analysis. Please try again later.",
});

export class ApiClientError extends Error {
  constructor(
    readonly publicMessage: string,
    readonly status: number,
  ) {
    super(publicMessage);
    this.name = "ApiClientError";
  }
}

function errorMessage(status: number, code: string | undefined): string {
  if (status === 429) return publicErrorMessages.limit;
  if (status === 409) {
    return code?.includes("PROCESSING")
      ? publicErrorMessages.processing
      : publicErrorMessages.duplicate;
  }
  if (status === 413) return publicErrorMessages.documentLimit;
  if (status === 415 || code?.includes("UNREADABLE")) return publicErrorMessages.unreadable;
  if (status === 503) return publicErrorMessages.capacity;
  if (status === 401 || status === 403) {
    return code?.includes("EXPIRED")
      ? publicErrorMessages.authorizationExpired
      : publicErrorMessages.verification;
  }
  return publicErrorMessages.analysis;
}

async function parseResponse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as {
    error?: { code?: string };
  };
  if (!response.ok)
    throw new ApiClientError(errorMessage(response.status, body.error?.code), response.status);
  return body as T;
}

export class ScreenplayApiClient {
  constructor(private readonly apiBaseUrl: string) {}

  private url(path: string): string {
    return new URL(
      path,
      this.apiBaseUrl.endsWith("/") ? this.apiBaseUrl : `${this.apiBaseUrl}/`,
    ).toString();
  }

  async createSession(deviceId: string): Promise<Omit<BrowserSession, "deviceId">> {
    return parseResponse(
      await fetch(this.url("api/session"), {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceId }),
      }),
    );
  }

  async authorizeUpload(input: {
    csrfToken: string;
    turnstileToken: string;
    deviceId: string;
    file: File;
    inspection: FileInspection;
    project: ProjectForm;
    mountedAt: string;
    fileSelectedAt: string;
  }): Promise<UploadAuthorizationResponse> {
    return parseResponse(
      await fetch(this.url("api/upload-authorize"), {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": input.csrfToken,
        },
        body: JSON.stringify({
          turnstileToken: input.turnstileToken,
          deviceId: input.deviceId,
          fileHash: input.inspection.fileHash,
          fileSize: input.file.size,
          fileName: input.file.name,
          mimeType: input.file.type,
          project: {
            firstName: input.project.firstName.trim(),
            lastName: input.project.lastName.trim(),
            email: input.project.email.trim().toLowerCase(),
            ...(input.project.imdbUrl.trim() ? { imdbUrl: input.project.imdbUrl.trim() } : {}),
            projectTitle: input.project.projectTitle,
            format: input.project.format,
            primaryGenre: input.project.primaryGenre,
            secondaryGenres: input.project.secondaryGenres,
            approximatePageCount: input.inspection.approximatePageCount ?? 1,
            logline: input.project.logline,
            originalWorkConfirmed: input.project.originalWorkConfirmed,
            uploadRightsConfirmed: input.project.uploadRightsConfirmed,
            privacyTermsAccepted: input.project.privacyTermsAccepted,
            acceptableUseAccepted: input.project.acceptableUseAccepted,
            aiProcessingAcknowledged: input.project.aiProcessingAcknowledged,
          },
          antiBot: {
            website_confirm: input.project.websiteConfirm,
            formMountedAt: input.mountedAt,
            fileSelectedAt: input.fileSelectedAt,
            formSubmittedAt: new Date().toISOString(),
          },
        }),
      }),
    );
  }

  async analyze(file: File, uploadToken: string): Promise<AnalysisResult> {
    const form = new FormData();
    form.set("file", file);
    const response = await fetch(this.url("api/analyze"), {
      method: "POST",
      credentials: "include",
      headers: { authorization: `Bearer ${uploadToken}` },
      body: form,
    });
    return parseAnalysisResult(await parseResponse(response));
  }

  async getResult(resultId: string, resultAccessToken: string): Promise<AnalysisResult> {
    const response = await fetch(this.url(`api/result/${encodeURIComponent(resultId)}`), {
      method: "GET",
      credentials: "include",
      headers: { authorization: `Bearer ${resultAccessToken}` },
    });
    return parseAnalysisResult(await parseResponse(response));
  }

  async deleteResult(resultId: string, deletionToken: string): Promise<void> {
    const response = await fetch(this.url(`api/result/${encodeURIComponent(resultId)}`), {
      method: "DELETE",
      credentials: "include",
      headers: { authorization: `Bearer ${deletionToken}` },
    });
    if (!response.ok) await parseResponse(response);
  }
}
