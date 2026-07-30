import type { AnalysisResult, CategoryScores, FileInspection, ProjectForm } from "../types.js";
import { methodologyCategoryMeans, methodologyDistribution } from "./report-fixtures.js";

export type ScreenplayFormat = string;

export type ScoreCategoryKey = keyof CategoryScores;

export interface ScoreCategory {
  key: ScoreCategoryKey;
  label: string;
  score: number;
  mean?: number;
  median?: number;
  percentile?: number;
  sampleSize?: number;
}

export interface ScreenplayCohort {
  format: string;
  genre: string;
  label: string;
  sampleSize?: number;
  sampleSizeKind?: "observed" | "illustrative";
  mean?: number;
  median?: number;
  standardDeviation?: number;
  topDecileThreshold?: number;
  distribution?: { score: number; count: number }[];
  isExactFormatGenreMatch: boolean;
  fallbackReason?: string;
  source: "observed" | "methodology_assumption" | "development_fixture";
}

export interface ScreenplayReport {
  id: string;
  title: string;
  format: ScreenplayFormat;
  genre: string;
  pageCount?: number;
  analyzedAt?: string;
  overallScore: number;
  overallPercentile?: number;
  cohort?: ScreenplayCohort;
  categories: ScoreCategory[];
  status: "Strong" | "Promising" | "Developing";
  evaluationMode: "mock" | "production";
}

export interface ReportAdapterContext {
  project?: ProjectForm;
  inspection?: FileInspection | null;
  observedCohort?: ScreenplayCohort;
  observedOverallPercentile?: number;
}

export const categoryDefinitions: readonly {
  key: ScoreCategoryKey;
  label: string;
}[] = [
  { key: "premise", label: "Premise" },
  { key: "story", label: "Story" },
  { key: "structure", label: "Structure" },
  { key: "characters", label: "Characters" },
  { key: "dialogue", label: "Dialogue" },
  { key: "pacing", label: "Pacing" },
  { key: "theme", label: "Theme" },
  { key: "tone", label: "Tone" },
  { key: "marketability", label: "Marketability" },
  { key: "craft", label: "Craft" },
];

const formatLabels: Record<string, ScreenplayFormat> = {
  feature: "Feature",
  halfHourPilot: "Half-Hour TV Pilot",
  hourPilot: "Hour-Long TV Pilot",
  short: "Short",
  unknown: "Unknown",
};

const genreLabels: Record<string, string> = {
  action: "Action",
  animated: "Animated",
  biopic: "Biopic",
  comedy: "Comedy",
  crime: "Crime",
  darkComedy: "Dark Comedy",
  drama: "Drama",
  dramedy: "Dramedy",
  family: "Family",
  fantasy: "Fantasy",
  historical: "Historical",
  horror: "Horror",
  romCom: "Rom-Com",
  sciFi: "Sci-Fi",
  thriller: "Thriller",
};

export function clampNumber(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

export function formatScreenplayFormat(value: string): ScreenplayFormat {
  const trimmed = value.trim();
  return formatLabels[value] ?? (trimmed.length ? trimmed : "Unknown");
}

export function formatGenre(value: string): string {
  const trimmed = value.trim();
  return genreLabels[value] ?? (trimmed.length ? trimmed : "Unknown");
}

function pluralGenre(genre: string): string {
  if (genre === "Comedy") return "Comedies";
  if (genre.endsWith("y") && !/[aeiou]y$/i.test(genre)) return `${genre.slice(0, -1)}ies`;
  if (genre.endsWith("s")) return genre;
  return `${genre}s`;
}

export function cohortLabel(format: string, genre: string): string {
  return `${format} ${pluralGenre(genre)}`;
}

function normalCdf(value: number, mean: number, standardDeviation: number): number {
  const z = (value - mean) / Math.max(standardDeviation, 0.01);
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const erf =
    sign *
    (1 -
      ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
        t *
        Math.exp(-x * x));
  return 0.5 * (1 + erf);
}

function methodologyFallback(
  format: string,
  genre: string,
  score: number,
): { cohort: ScreenplayCohort; percentile: number } {
  const mean = 6.3;
  const median = 6.2;
  const standardDeviation = 1;
  return {
    percentile: Math.round(clampNumber(normalCdf(score, mean, standardDeviation) * 100, 0, 100)),
    cohort: {
      format,
      genre,
      label: "emerging-writer submissions (illustrative prior)",
      sampleSize: 1_000,
      sampleSizeKind: "illustrative",
      mean,
      median,
      standardDeviation,
      topDecileThreshold: 7.6,
      distribution: [...methodologyDistribution],
      isExactFormatGenreMatch: false,
      fallbackReason:
        "Illustrative example based on 1,000 expected Loglisted emerging writer submissions. It is not an observed benchmark against actual format and genre data.",
      source: "methodology_assumption",
    },
  };
}

export function adaptAnalysisResult(
  result: AnalysisResult,
  context: ReportAdapterContext = {},
): ScreenplayReport {
  const rawFormat = result.declaredFormat ?? context.project?.format ?? "unknown";
  const rawGenre = result.declaredGenre ?? context.project?.primaryGenre ?? "Unknown";
  const format = formatScreenplayFormat(rawFormat);
  const genre = formatGenre(rawGenre);
  const overallScore = clampNumber(result.overallScore, 0, 10);
  const pageCount =
    result.pageCount ??
    (context.inspection?.approximatePageCount === null
      ? undefined
      : context.inspection?.approximatePageCount);

  let cohort: ScreenplayCohort;
  let overallPercentile: number;
  if (
    context.observedCohort?.source === "observed" &&
    context.observedCohort.format === format &&
    context.observedCohort.genre === genre &&
    context.observedOverallPercentile !== undefined
  ) {
    cohort = context.observedCohort;
    overallPercentile = clampNumber(context.observedOverallPercentile, 0, 100);
  } else {
    const fallback = methodologyFallback(format, genre, overallScore);
    cohort = fallback.cohort;
    overallPercentile = fallback.percentile;
  }

  const categories = categoryDefinitions.map(({ key, label }) => {
    const methodologyMean =
      cohort.source === "methodology_assumption" ? methodologyCategoryMeans[key] : undefined;
    return {
      key,
      label,
      score: clampNumber(result.categoryScores[key], 0, 10),
      ...(methodologyMean !== undefined
        ? {
            mean: methodologyMean,
            percentile: Math.round(
              clampNumber(normalCdf(result.categoryScores[key], methodologyMean, 1) * 100, 0, 100),
            ),
            sampleSize: 1_000,
          }
        : {}),
    };
  });

  return {
    id: result.resultId ?? "current-result",
    title: (result.projectTitle ?? context.project?.projectTitle ?? "Untitled Screenplay").trim(),
    format,
    genre,
    ...(pageCount === undefined ? {} : { pageCount }),
    ...(result.completedAt ? { analyzedAt: result.completedAt } : {}),
    overallScore,
    overallPercentile,
    cohort,
    categories,
    status: scoreStatus(overallScore),
    evaluationMode: result.evaluationMode === "mock" ? "mock" : "production",
  };
}

export function formatOrdinal(value: number): string {
  const rounded = Math.round(clampNumber(value, 0, 100));
  const mod100 = rounded % 100;
  const suffix =
    mod100 >= 11 && mod100 <= 13
      ? "th"
      : rounded % 10 === 1
        ? "st"
        : rounded % 10 === 2
          ? "nd"
          : rounded % 10 === 3
            ? "rd"
            : "th";
  return `${rounded}${suffix}`;
}

export function scoreStatus(score: number): "Strong" | "Promising" | "Developing" {
  if (score >= 8) return "Strong";
  if (score >= 7) return "Promising";
  return "Developing";
}

export function createShareSummary(report: ScreenplayReport): string {
  const base = `${report.title.toUpperCase()} scored ${report.overallScore.toFixed(1)}/10 on Loglisted`;
  if (report.overallPercentile === undefined || !report.cohort) return `${base}.`;
  if (report.cohort.source === "methodology_assumption") {
    return `${base}, ranking in the Loglisted model ${formatOrdinal(report.overallPercentile)} percentile for expected emerging writer script scores.`;
  }
  return `${base}, ranking in the ${formatOrdinal(report.overallPercentile)} percentile among ${report.cohort.label}.`;
}
