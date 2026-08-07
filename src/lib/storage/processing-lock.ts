import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { versions } from "../version.js";

const FileHashSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const ScoringConfigurationSchema = z
  .object({
    summaryModel: z.string().min(1),
    scoringModel: z.string().min(1),
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

export type ScoringConfiguration = z.input<typeof ScoringConfigurationSchema>;

export const ProcessingLockStateSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("processing"),
      ownerToken: z.string().uuid(),
      startedAt: z.string().datetime(),
      expiresAt: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      status: z.literal("completed"),
      resultKey: z.string().min(1),
      completedAt: z.string().datetime(),
      expiresAt: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      status: z.literal("failed"),
      failureCode: z.string().min(1).max(100),
      failedAt: z.string().datetime(),
      expiresAt: z.string().datetime(),
    })
    .strict(),
]);

export type ProcessingLockState = z.infer<typeof ProcessingLockStateSchema>;

export interface ProcessingLockStore {
  acquire(
    key: string,
    ownerToken: string,
    lockTtlMs: number,
    now: Date,
  ): Promise<ProcessingLockState>;
  complete(
    key: string,
    ownerToken: string,
    resultKey: string,
    terminalTtlMs: number,
    now: Date,
  ): Promise<boolean>;
  fail(
    key: string,
    ownerToken: string,
    failureCode: string,
    terminalTtlMs: number,
    now: Date,
  ): Promise<boolean>;
  release(key: string, ownerToken: string): Promise<boolean>;
  getState(key: string, now: Date): Promise<ProcessingLockState | null>;
}

export interface ProcessingLockOptions {
  lockTtlMs?: number;
  terminalTtlMs?: number;
  now?: () => Date;
}

export type LockAcquisition =
  | { outcome: "acquired"; lease: ProcessingLease }
  | { outcome: "processing"; state: Extract<ProcessingLockState, { status: "processing" }> }
  | { outcome: "completed"; resultKey: string }
  | { outcome: "failed"; failureCode: string };

function stableConfiguration(configuration: ScoringConfiguration): string {
  const parsed = ScoringConfigurationSchema.parse(configuration);
  return JSON.stringify(
    Object.fromEntries(Object.entries(parsed).sort(([left], [right]) => left.localeCompare(right))),
  );
}

export function buildProcessingLockKey(
  fileHashInput: string,
  configuration: ScoringConfiguration,
): string {
  const fileHash = FileHashSchema.parse(fileHashInput);
  const fingerprint = createHash("sha256").update(stableConfiguration(configuration)).digest("hex");
  return `loglisted:lock:v1:${fileHash}:${fingerprint}`;
}

export class ProcessingLease {
  constructor(
    readonly key: string,
    readonly ownerToken: string,
    private readonly store: ProcessingLockStore,
    private readonly terminalTtlMs: number,
    private readonly now: () => Date,
  ) {}

  complete(resultKey: string): Promise<boolean> {
    return this.store.complete(
      this.key,
      this.ownerToken,
      resultKey,
      this.terminalTtlMs,
      this.now(),
    );
  }

  fail(failureCode: string): Promise<boolean> {
    return this.store.fail(this.key, this.ownerToken, failureCode, this.terminalTtlMs, this.now());
  }

  release(): Promise<boolean> {
    return this.store.release(this.key, this.ownerToken);
  }
}

export class ProcessingLock {
  private readonly lockTtlMs: number;
  private readonly terminalTtlMs: number;
  private readonly now: () => Date;

  constructor(
    private readonly store: ProcessingLockStore,
    options: ProcessingLockOptions = {},
  ) {
    this.lockTtlMs = options.lockTtlMs ?? 15 * 60_000;
    this.terminalTtlMs = options.terminalTtlMs ?? 30 * 24 * 60 * 60_000;
    this.now = options.now ?? (() => new Date());
  }

  async acquire(fileHash: string, configuration: ScoringConfiguration): Promise<LockAcquisition> {
    const key = buildProcessingLockKey(fileHash, configuration);
    const ownerToken = randomUUID();
    const state = await this.store.acquire(key, ownerToken, this.lockTtlMs, this.now());
    if (state.status === "processing" && state.ownerToken === ownerToken) {
      return {
        outcome: "acquired",
        lease: new ProcessingLease(key, ownerToken, this.store, this.terminalTtlMs, this.now),
      };
    }
    if (state.status === "processing") return { outcome: "processing", state };
    if (state.status === "completed") {
      return { outcome: "completed", resultKey: state.resultKey };
    }
    return { outcome: "failed", failureCode: state.failureCode };
  }

  async run<T>(
    fileHash: string,
    configuration: ScoringConfiguration,
    work: (lease: ProcessingLease) => Promise<{ value: T; resultKey: string }>,
    failureCode: (error: unknown) => string = () => "PROCESSING_FAILED",
  ): Promise<
    | { outcome: "completed"; value: T; resultKey: string }
    | Exclude<LockAcquisition, { outcome: "acquired" }>
  > {
    const acquisition = await this.acquire(fileHash, configuration);
    if (acquisition.outcome !== "acquired") return acquisition;
    let terminal = false;
    try {
      const result = await work(acquisition.lease);
      terminal = await acquisition.lease.complete(result.resultKey);
      if (!terminal) throw new Error("Processing lock ownership was lost before completion.");
      return { outcome: "completed", ...result };
    } catch (error) {
      terminal = await acquisition.lease.fail(failureCode(error));
      throw error;
    } finally {
      if (!terminal) await acquisition.lease.release();
    }
  }
}
