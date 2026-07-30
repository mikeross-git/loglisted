import type { AnalysisResult } from "../types.js";
import type { ScoreCategoryKey } from "./report-model.js";

export const mockReportAnalysisResult: AnalysisResult = {
  resultId: "development-report-fixture",
  projectTitle: "The Bluefooted Bobby",
  declaredFormat: "halfHourPilot",
  declaredGenre: "comedy",
  overallScore: 7.2,
  categoryScores: {
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
  },
  evaluationMode: "mock",
};

export const methodologyCategoryMeans: Readonly<Record<ScoreCategoryKey, number>> = {
  premise: 6.7,
  story: 6.1,
  structure: 5.9,
  characters: 6.3,
  dialogue: 6.5,
  pacing: 5.8,
  theme: 5.9,
  tone: 6.4,
  marketability: 6,
  craft: 6.2,
};

export const methodologyDistribution = Object.freeze([
  { score: 3.5, count: 20 },
  { score: 4.5, count: 90 },
  { score: 5.5, count: 270 },
  { score: 6.5, count: 400 },
  { score: 7.5, count: 180 },
  { score: 8.5, count: 38 },
  { score: 9.5, count: 2 },
]);
