import { z } from "zod";

export const ScoreValueSchema = z.number().int().min(0).max(100);

export const CategoryScoresSchema = z
  .object({
    premise: ScoreValueSchema,
    structure: ScoreValueSchema,
    character: ScoreValueSchema,
    dialogue: ScoreValueSchema,
    pacing: ScoreValueSchema,
    conflictAndStakes: ScoreValueSchema,
    theme: ScoreValueSchema,
    toneAndGenreExecution: ScoreValueSchema,
    visualStorytelling: ScoreValueSchema,
    marketReadiness: ScoreValueSchema,
  })
  .strict();

export const PublicScoreResultSchema = z
  .object({
    submissionId: z.uuid(),
    scores: CategoryScoresSchema,
    overallScore: ScoreValueSchema,
    scoringVersion: z.string().min(1).max(100),
  })
  .strict();

export type CategoryScores = z.infer<typeof CategoryScoresSchema>;
export type PublicScoreResult = z.infer<typeof PublicScoreResultSchema>;
