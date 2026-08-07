import { createHash } from "node:crypto";
import { z } from "zod";
import type { CacheStore } from "./storage/cache-store.js";
import { ChunkSummarySchema, type ChunkSummary, type SummaryCache } from "./summarizer.js";
import { versions } from "./version.js";

export const CacheStageSchema = z.enum([
  "pdf_extraction",
  "screenplay_metadata",
  "chunks",
  "chunk_summary",
  "reduced_screenplay",
  "representative_excerpts",
  "final_score",
]);

export type CacheStage = z.infer<typeof CacheStageSchema>;

export const CacheKeyContextSchema = z
  .object({
    fileHash: z.string().regex(/^[a-f0-9]{64}$/),
    artifactHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    summaryModel: z.string().min(1).optional(),
    scoringModel: z.string().min(1).optional(),
    scoringReasoningEffort: z.enum(["none", "low", "medium", "high", "xhigh"]).optional(),
    verificationModel: z.string().min(1).optional(),
    adjudicatorModel: z.string().min(1).optional(),
    parserVersion: z.string().min(1).default(versions.parserVersion),
    metadataVersion: z.string().min(1).default(versions.metadataVersion),
    chunkerVersion: z.string().min(1).default(versions.chunkerVersion),
    summaryPromptVersion: z.string().min(1).default(versions.summaryPromptVersion),
    reducerVersion: z.string().min(1).default(versions.reducerVersion),
    excerptSamplerVersion: z.string().min(1).default(versions.excerptSamplerVersion),
    rubricVersion: z.string().min(1).default(versions.rubricVersion),
    scoringPromptVersion: z.string().min(1).default(versions.scoringPromptVersion),
    costConfigVersion: z.string().min(1).default(versions.costConfigVersion),
  })
  .strict();

export type CacheKeyContext = z.input<typeof CacheKeyContextSchema>;

export const CacheTtlSchema = z
  .object({
    pdfExtraction: z.number().int().positive().default(3_600),
    screenplayMetadata: z.number().int().positive().default(86_400),
    chunks: z.number().int().positive().default(86_400),
    chunkSummary: z
      .number()
      .int()
      .positive()
      .default(30 * 86_400),
    reducedScreenplay: z
      .number()
      .int()
      .positive()
      .default(30 * 86_400),
    representativeExcerpts: z
      .number()
      .int()
      .positive()
      .default(30 * 86_400),
    finalScore: z
      .number()
      .int()
      .positive()
      .default(30 * 86_400),
  })
  .strict();

export type CacheTtls = z.input<typeof CacheTtlSchema>;

const ttlFieldByStage: Record<CacheStage, keyof z.output<typeof CacheTtlSchema>> = {
  pdf_extraction: "pdfExtraction",
  screenplay_metadata: "screenplayMetadata",
  chunks: "chunks",
  chunk_summary: "chunkSummary",
  reduced_screenplay: "reducedScreenplay",
  representative_excerpts: "representativeExcerpts",
  final_score: "finalScore",
};

function relevantContext(
  stage: CacheStage,
  context: z.output<typeof CacheKeyContextSchema>,
): Record<string, string> {
  const base = { fileHash: context.fileHash };
  switch (stage) {
    case "pdf_extraction":
      return { ...base, parserVersion: context.parserVersion };
    case "screenplay_metadata":
      return {
        ...base,
        parserVersion: context.parserVersion,
        metadataVersion: context.metadataVersion,
      };
    case "chunks":
      return {
        ...base,
        parserVersion: context.parserVersion,
        metadataVersion: context.metadataVersion,
        chunkerVersion: context.chunkerVersion,
      };
    case "chunk_summary":
      return {
        ...base,
        ...(context.artifactHash ? { artifactHash: context.artifactHash } : {}),
        parserVersion: context.parserVersion,
        chunkerVersion: context.chunkerVersion,
        summaryPromptVersion: context.summaryPromptVersion,
        summaryModel: context.summaryModel ?? "missing",
      };
    case "reduced_screenplay":
      return {
        ...base,
        parserVersion: context.parserVersion,
        metadataVersion: context.metadataVersion,
        chunkerVersion: context.chunkerVersion,
        summaryPromptVersion: context.summaryPromptVersion,
        summaryModel: context.summaryModel ?? "missing",
        reducerVersion: context.reducerVersion,
      };
    case "representative_excerpts":
      return {
        ...base,
        parserVersion: context.parserVersion,
        metadataVersion: context.metadataVersion,
        excerptSamplerVersion: context.excerptSamplerVersion,
      };
    case "final_score":
      return {
        ...base,
        parserVersion: context.parserVersion,
        metadataVersion: context.metadataVersion,
        chunkerVersion: context.chunkerVersion,
        summaryPromptVersion: context.summaryPromptVersion,
        summaryModel: context.summaryModel ?? "missing",
        reducerVersion: context.reducerVersion,
        excerptSamplerVersion: context.excerptSamplerVersion,
        rubricVersion: context.rubricVersion,
        scoringPromptVersion: context.scoringPromptVersion,
        scoringModel: context.scoringModel ?? "missing",
        scoringReasoningEffort: context.scoringReasoningEffort ?? "none",
        verificationModel: context.verificationModel ?? "none",
        adjudicatorModel: context.adjudicatorModel ?? "none",
        costConfigVersion: context.costConfigVersion,
      };
  }
}

export function buildCacheKey(stageInput: CacheStage, contextInput: CacheKeyContext): string {
  const stage = CacheStageSchema.parse(stageInput);
  const context = CacheKeyContextSchema.parse(contextInput);
  const relevant = relevantContext(stage, context);
  const canonical = JSON.stringify(
    Object.fromEntries(
      Object.entries(relevant).sort(([left], [right]) => left.localeCompare(right)),
    ),
  );
  const fingerprint = createHash("sha256").update(canonical).digest("hex");
  return `loglisted:cache:v1:${stage}:${context.fileHash}:${fingerprint}`;
}

function containsBinary(value: unknown, seen = new Set<object>()): boolean {
  if (value instanceof Uint8Array || value instanceof ArrayBuffer || value instanceof Blob)
    return true;
  if (typeof value !== "object" || value === null) return false;
  if (seen.has(value)) return false;
  seen.add(value);
  return Object.values(value).some((nested) => containsBinary(nested, seen));
}

export class VersionedCache {
  private readonly ttls: z.output<typeof CacheTtlSchema>;

  constructor(
    private readonly store: CacheStore,
    ttls: CacheTtls = {},
  ) {
    this.ttls = CacheTtlSchema.parse(ttls);
  }

  async get<T>(
    stage: CacheStage,
    context: CacheKeyContext,
    schema: z.ZodType<T>,
  ): Promise<T | null> {
    const serialized = await this.store.get(buildCacheKey(stage, context));
    if (serialized === null) return null;
    try {
      const envelope = z
        .object({ stage: CacheStageSchema, value: z.unknown() })
        .strict()
        .parse(JSON.parse(serialized));
      if (envelope.stage !== stage) return null;
      return schema.parse(envelope.value);
    } catch {
      await this.store.delete(buildCacheKey(stage, context));
      return null;
    }
  }

  async set<T>(
    stage: CacheStage,
    context: CacheKeyContext,
    schema: z.ZodType<T>,
    value: T,
  ): Promise<string> {
    if (containsBinary(value)) {
      throw new Error("Binary PDF data is not permitted in the application cache.");
    }
    const validated = schema.parse(value);
    const key = buildCacheKey(stage, context);
    const ttl = this.ttls[ttlFieldByStage[stage]];
    await this.store.set(key, JSON.stringify({ stage, value: validated }), ttl);
    return key;
  }

  delete(stage: CacheStage, context: CacheKeyContext): Promise<void> {
    return this.store.delete(buildCacheKey(stage, context));
  }

  async deleteFileArtifacts(fileHashInput: string): Promise<number> {
    const fileHash = z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(fileHashInput);
    if (!this.store.deleteMatching) return 0;
    return this.store.deleteMatching(`loglisted:cache:v1:*:${fileHash}:*`);
  }
}

export class VersionedSummaryCache implements SummaryCache {
  constructor(
    private readonly cache: VersionedCache,
    private readonly context: CacheKeyContext,
  ) {}

  private contextForSummary(summaryKey: string): CacheKeyContext {
    return {
      ...this.context,
      artifactHash: createHash("sha256").update(summaryKey).digest("hex"),
    };
  }

  get(summaryKey: string): Promise<ChunkSummary | null> {
    return this.cache.get("chunk_summary", this.contextForSummary(summaryKey), ChunkSummarySchema);
  }

  async set(summaryKey: string, value: ChunkSummary): Promise<void> {
    await this.cache.set(
      "chunk_summary",
      this.contextForSummary(summaryKey),
      ChunkSummarySchema,
      value,
    );
  }
}
