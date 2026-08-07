import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { mapAnalysisProgress } from "../src/frontend/report/AnalysisProgress.js";
import {
  ANALYSIS_PROGRESS_ESTIMATE_MILLISECONDS,
  MOCK_ANALYSIS_MINIMUM_MILLISECONDS,
  remainingMockAnalysisDelay,
} from "../src/frontend/report/analysis-timing.js";
import { mockReportAnalysisResult } from "../src/frontend/report/report-fixtures.js";
import {
  adaptAnalysisResult,
  clampNumber,
  createShareSummary,
  formatOrdinal,
  type ScreenplayCohort,
} from "../src/frontend/report/report-model.js";
import { requestPdfDownload, ScreenplayReport } from "../src/frontend/report/ScreenplayReport.js";
import type { AnalysisResult, ProjectForm } from "../src/frontend/types.js";

const categoryScores = {
  premise: 7.1,
  story: 7,
  structure: 7.3,
  characters: 7.4,
  dialogue: 7.2,
  pacing: 7.1,
  theme: 7.2,
  tone: 6.9,
  marketability: 7.3,
  craft: 7.5,
};

const result: AnalysisResult = mockReportAnalysisResult;
const productionResult: AnalysisResult = {
  resultId: "result",
  categoryScores,
  overallScore: 7.2,
};

const project = {
  projectTitle: "The Bluefooted Bobby",
  format: "halfHourPilot",
  primaryGenre: "comedy",
} as ProjectForm;

describe("screenplay report adapter", () => {
  it("normalizes scores and percentiles without NaN", () => {
    expect(clampNumber(Number.NaN, 0, 10)).toBe(0);
    expect(clampNumber(12, 0, 10)).toBe(10);
    expect(formatOrdinal(77)).toBe("77th");
    expect(formatOrdinal(21)).toBe("21st");
  });

  it("uses the published illustrative prior when observed cohort data is absent", () => {
    const report = adaptAnalysisResult(result, { project });
    expect(report.format).toBe("Half-Hour TV Pilot");
    expect(report.genre).toBe("Comedy");
    expect(report.cohort?.label).toBe("emerging-writer submissions (illustrative prior)");
    expect(report.cohort?.source).toBe("methodology_assumption");
    expect(report.cohort?.sampleSizeKind).toBe("illustrative");
    expect(report.cohort?.distribution?.map((bin) => bin.count)).toEqual([
      20, 90, 270, 400, 180, 38, 2,
    ]);
    expect(report.categories.find((category) => category.key === "premise")?.mean).toBe(6.7);
  });

  it("accepts only an exact observed Format/Genre cohort", () => {
    const observed: ScreenplayCohort = {
      format: "Half-Hour TV Pilot",
      genre: "Comedy",
      label: "Half-Hour TV Pilot Comedies",
      sampleSize: 25,
      isExactFormatGenreMatch: true,
      source: "observed",
    };
    const report = adaptAnalysisResult(productionResult, {
      project,
      observedCohort: observed,
      observedOverallPercentile: 88,
    });
    expect(report.cohort).toBe(observed);
    expect(report.overallPercentile).toBe(88);
  });

  it("labels methodology assumptions when exact peer data is unavailable", () => {
    const report = adaptAnalysisResult(productionResult, {
      project: { ...project, primaryGenre: "drama" },
    });
    expect(report.cohort?.source).toBe("methodology_assumption");
    expect(report.cohort?.fallbackReason).toContain("Illustrative");
    expect(report.cohort?.sampleSize).toBe(1_000);
    expect(report.cohort?.sampleSizeKind).toBe("illustrative");
  });

  it("formats a safe deterministic share summary", () => {
    const report = adaptAnalysisResult(result, { project });
    expect(createShareSummary(report)).toBe(
      "THE BLUEFOOTED BOBBY scored 7.2/10 on Loglisted, ranking in the Loglisted model 82nd percentile for expected emerging writer script scores.",
    );
  });
});

describe("analysis progress and report rendering", () => {
  it("holds mock results for a minimum ten-second analysis window", () => {
    expect(MOCK_ANALYSIS_MINIMUM_MILLISECONDS).toBe(10_000);
    expect(remainingMockAnalysisDelay(1_000, 4_000)).toBe(7_000);
    expect(remainingMockAnalysisDelay(1_000, 12_000)).toBe(0);
  });

  it("advances through all categories and finishes at 100 percent", () => {
    const midpoint = mapAnalysisProgress(
      "processing",
      ANALYSIS_PROGRESS_ESTIMATE_MILLISECONDS / 2,
    );
    expect(midpoint.items).toHaveLength(10);
    expect(midpoint.items.filter((item) => item.state === "complete")).toHaveLength(5);
    expect(midpoint.items.filter((item) => item.state === "active")).toHaveLength(1);

    const completed = mapAnalysisProgress("processing", 10_000, true);
    expect(completed.percentage).toBe(100);
    expect(completed.currentLabel).toBe("Analysis complete");
    expect(completed.items.every((item) => item.state === "complete")).toBe(true);
  });

  it("renders report navigation, scores, charts, and share action", () => {
    const report = adaptAnalysisResult(result, { project });
    const html = renderToStaticMarkup(createElement(ScreenplayReport, { report }));
    expect(html).not.toContain('aria-current="page"');
    expect(html).toContain("Download PDF Report");
    expect(html).toContain("7.2");
    expect(html).toContain("Peer distribution");
    expect(html).toContain("Score profile");
    expect(html).toContain("Share on Socials");
    expect(html).toContain("loglisted-category-icon");
    expect(html).toContain("Versus the Loglisted model");
    expect(html).toContain("Top 10% starts");
    expect(html).toContain("upper portion of the 7.0–7.9 band");
    expect(html).toContain('href="/methodology"');
    expect(html).toContain('href="/faq"');
    expect(html).toContain("https://github.com/mikeross-git/loglisted");
    expect(html).toMatch(/\d+(st|nd|rd|th) percentile/);
  });

  it("delegates PDF download to the browser print flow", () => {
    const print = vi.fn();
    requestPdfDownload(print);
    expect(print).toHaveBeenCalledOnce();
  });
});
