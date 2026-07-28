import { afterEach, describe, expect, it, vi } from "vitest";
import { ScreenplayApiClient } from "../src/frontend/api-client.js";
import { parseAnalysisResult } from "../src/frontend/types.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("frontend upload authorization payload", () => {
  it("captures contact fields and omits a blank optional IMDb URL", async () => {
    const requests: Request[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        requests.push(new Request(input, init));
        return Promise.resolve(
          Response.json({
            uploadToken: "token",
            expiresAt: "2026-07-26T12:05:00.000Z",
            cachedResultAvailable: false,
            resultAccessToken: null,
          }),
        );
      }),
    );
    const client = new ScreenplayApiClient("https://api.example/");
    await client.authorizeUpload({
      csrfToken: "csrf",
      turnstileToken: "turnstile",
      deviceId: "019f9e5d-0710-7220-a1d2-8bb230517924",
      file: new File(["pdf"], "screenplay.pdf", { type: "application/pdf" }),
      inspection: {
        fileHash: "a".repeat(64),
        fileSize: 3,
        approximatePageCount: 10,
        readableTextWarning: false,
      },
      project: {
        firstName: " Taylor ",
        lastName: " Writer ",
        email: " TAYLOR@EXAMPLE.COM ",
        imdbUrl: "",
        projectTitle: "Project",
        format: "feature",
        primaryGenre: "drama",
        secondaryGenres: [],
        logline: "",
        originalWorkConfirmed: true,
        uploadRightsConfirmed: true,
        privacyTermsAccepted: true,
        acceptableUseAccepted: true,
        aiProcessingAcknowledged: true,
        websiteConfirm: "",
      },
      mountedAt: "2026-07-26T12:00:00.000Z",
      fileSelectedAt: "2026-07-26T12:00:05.000Z",
    });

    expect(requests).toHaveLength(1);
    const payload = (await requests[0]?.json()) as {
      project: Record<string, unknown>;
    };
    expect(payload.project).toMatchObject({
      firstName: "Taylor",
      lastName: "Writer",
      email: "taylor@example.com",
    });
    expect(payload.project).not.toHaveProperty("imdbUrl");
  });
});

describe("frontend analysis response validation", () => {
  it("accepts the complete staging response without a browser Zod dependency", () => {
    const result = parseAnalysisResult({
      resultId: "result-id",
      resultAccessToken: "access-token",
      deletionToken: "deletion-token",
      categoryScores: {
        premise: 7.1,
        story: 7.2,
        structure: 7.3,
        characters: 7.4,
        dialogue: 7.5,
        pacing: 7.6,
        theme: 7.7,
        tone: 7.8,
        marketability: 7.9,
        craft: 8,
      },
      overallScore: 7.6,
      evaluationMode: "mock",
    });

    expect(result.resultId).toBe("result-id");
    expect(result.deletionToken).toBe("deletion-token");
    expect(result.evaluationMode).toBe("mock");
  });
});
