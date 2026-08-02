import { describe, expect, it } from "vitest";
import { AbuseAdmissionSchema } from "../src/types/abuse.js";
import {
  ImdbProfileUrlSchema,
  ProfessionalWebsiteUrlSchema,
  WriterEmailSchema,
} from "../src/types/project.js";
import { CategoryScoresSchema } from "../src/types/scoring.js";
import { SubmissionSchema } from "../src/types/submission.js";

const scores = {
  premise: 80,
  structure: 80,
  character: 80,
  dialogue: 80,
  pacing: 80,
  conflictAndStakes: 80,
  theme: 80,
  toneAndGenreExecution: 80,
  visualStorytelling: 80,
  marketReadiness: 80,
};

describe("shared schemas", () => {
  it("accepts exactly ten bounded integer scores", () => {
    expect(CategoryScoresSchema.parse(scores)).toEqual(scores);
    expect(CategoryScoresSchema.safeParse({ ...scores, premise: 101 }).success).toBe(false);
    expect(CategoryScoresSchema.safeParse({ ...scores, extra: 10 }).success).toBe(false);
  });

  it("validates submissions and abuse admission without identity fields", () => {
    const hash = "a".repeat(64);
    expect(
      SubmissionSchema.safeParse({
        id: "16fd2706-8baf-433b-82eb-8c7fada847da",
        ownerSessionHash: hash,
        status: "queued",
        createdAt: "2026-07-26T12:00:00.000Z",
        updatedAt: "2026-07-26T12:00:00.000Z",
      }).success,
    ).toBe(true);
    expect(
      AbuseAdmissionSchema.safeParse({
        sessionHash: hash,
        submissionCount: 1,
        duplicateCount: 0,
        challengePassed: true,
        admitted: true,
        writerIdentity: "forbidden",
      }).success,
    ).toBe(false);
  });

  it("validates writer email and IMDb profile URLs", () => {
    expect(WriterEmailSchema.parse(" Writer@Example.com ")).toBe("Writer@Example.com");
    expect(WriterEmailSchema.safeParse("writer-at-example").success).toBe(false);
    expect(ImdbProfileUrlSchema.safeParse("https://www.imdb.com/name/nm1234567/").success).toBe(
      true,
    );
    expect(ImdbProfileUrlSchema.safeParse("https://example.com/name/nm1234567/").success).toBe(
      false,
    );
    expect(ImdbProfileUrlSchema.safeParse("https://www.imdb.com/title/tt1234567/").success).toBe(
      false,
    );
  });

  it("accepts public HTTPS professional and social website URLs", () => {
    expect(ProfessionalWebsiteUrlSchema.safeParse("https://writer.example.com/").success).toBe(
      true,
    );
    expect(
      ProfessionalWebsiteUrlSchema.safeParse("https://www.instagram.com/example_writer/").success,
    ).toBe(true);
    expect(ProfessionalWebsiteUrlSchema.safeParse("http://writer.example.com/").success).toBe(
      false,
    );
    expect(ProfessionalWebsiteUrlSchema.safeParse("javascript:alert(1)").success).toBe(false);
    expect(ProfessionalWebsiteUrlSchema.safeParse("https://localhost/profile").success).toBe(false);
  });
});
