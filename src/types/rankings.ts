export const rankingScoreKeys = [
  "overall",
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

export type RankingScoreKey = (typeof rankingScoreKeys)[number];
export type RankingScores = Record<RankingScoreKey, number | null>;

export interface PublicRankingRecord {
  id: string;
  slug: string;
  writerName: string;
  scriptTitle: string;
  logline: string;
  format: string;
  genre: string;
  imdbUrl: string | null;
  websiteUrl: string | null;
  scores: RankingScores;
  updatedAt: string | null;
}

export interface PublicRankingsResponse {
  version: 1;
  generatedAt: string;
  records: PublicRankingRecord[];
}
