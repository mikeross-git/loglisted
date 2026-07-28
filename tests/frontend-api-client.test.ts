import { afterEach, describe, expect, it, vi } from "vitest";
import { ScreenplayApiClient } from "../src/frontend/api-client.js";

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
