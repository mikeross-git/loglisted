import { z } from "zod";

export const ConfidenceSchema = z.number().min(0).max(1);

export const DetectedFormatSchema = z.enum([
  "half_hour_pilot",
  "hour_pilot",
  "feature",
  "short",
  "unknown",
]);

export const ScreenplayBlockTypeSchema = z.enum([
  "scene_heading",
  "act_break",
  "marker",
  "character",
  "parenthetical",
  "dialogue",
  "action",
  "transition",
  "blank",
]);

export const ScreenplayBlockSchema = z
  .object({
    id: z.string(),
    type: ScreenplayBlockTypeSchema,
    text: z.string(),
    page: z.number().int().positive(),
    lineStart: z.number().int().nonnegative(),
    lineEnd: z.number().int().nonnegative(),
    characterName: z.string().optional(),
  })
  .strict();

export const SceneSchema = z
  .object({
    id: z.string(),
    index: z.number().int().nonnegative(),
    heading: z.string().optional(),
    location: z.string().optional(),
    interior: z.boolean(),
    exterior: z.boolean(),
    timeOfDay: z.enum(["day", "night", "other", "unknown"]),
    act: z.string().optional(),
    pageStart: z.number().int().positive(),
    pageEnd: z.number().int().positive(),
    rawText: z.string(),
    wordCount: z.number().int().nonnegative(),
    blocks: z.array(ScreenplayBlockSchema),
    characterNames: z.array(z.string()),
  })
  .strict();

const InferredValueSchema = <T extends z.ZodType>(value: T) =>
  z.object({ value, confidence: ConfidenceSchema }).strict();

export const ObjectiveMetadataSchema = z
  .object({
    pageCount: z.number().int().positive(),
    wordCount: z.number().int().nonnegative(),
    characterCount: z.number().int().nonnegative(),
    sceneCount: z.number().int().nonnegative(),
    actCount: z.number().int().nonnegative(),
    sceneHeadings: z.array(z.string()),
    explicitActBreaks: z.array(z.string()),
    coldOpen: z.boolean(),
    teaser: z.boolean(),
    tag: z.boolean(),
    dialogueBlockCount: z.number().int().nonnegative(),
    actionBlockCount: z.number().int().nonnegative(),
    dialogueWordCount: z.number().int().nonnegative(),
    actionWordCount: z.number().int().nonnegative(),
    dialogueToActionRatio: z.number().nonnegative(),
    averageSceneLength: z.number().nonnegative(),
    medianSceneLength: z.number().nonnegative(),
    longestSceneLength: z.number().nonnegative(),
    shortestNonemptySceneLength: z.number().nonnegative(),
    speakingCharacterCount: z.number().int().nonnegative(),
    namedCharacterList: z.array(z.string()),
    characterAppearanceCounts: z.record(z.string(), z.number().int().nonnegative()),
    interiorSceneCount: z.number().int().nonnegative(),
    exteriorSceneCount: z.number().int().nonnegative(),
    daySceneCount: z.number().int().nonnegative(),
    nightSceneCount: z.number().int().nonnegative(),
    uniqueLocationCount: z.number().int().nonnegative(),
    formattingWarnings: z.array(z.string()),
    blankPageWarnings: z.array(z.number().int().positive()),
    lowTextPageWarnings: z.array(z.number().int().positive()),
    titlePageContactDetected: z.boolean().optional(),
  })
  .strict();

export const InferredMetadataSchema = z
  .object({
    title: InferredValueSchema(z.string().nullable()),
    detectedFormat: InferredValueSchema(DetectedFormatSchema),
    protagonistCandidates: InferredValueSchema(z.array(z.string())),
    approximateCastSize: InferredValueSchema(z.number().int().nonnegative()),
    estimatedRuntimeMinutes: InferredValueSchema(z.number().nonnegative()),
  })
  .strict();

export const ParsedScreenplaySchema = z
  .object({
    rawText: z.string(),
    textByPage: z.array(z.string()),
    objective: ObjectiveMetadataSchema,
    inferred: InferredMetadataSchema,
    blocks: z.array(ScreenplayBlockSchema),
    scenes: z.array(SceneSchema),
  })
  .strict();

export type ScreenplayBlock = z.infer<typeof ScreenplayBlockSchema>;
export type Scene = z.infer<typeof SceneSchema>;
export type ObjectiveMetadata = z.infer<typeof ObjectiveMetadataSchema>;
export type InferredMetadata = z.infer<typeof InferredMetadataSchema>;
export type ParsedScreenplay = z.infer<typeof ParsedScreenplaySchema>;
