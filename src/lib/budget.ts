import type { CostBreakdown, TokenUsage } from "./cost.js";
import { CostBudgetError } from "./errors.js";
import type { AtomicSpendStore, SpendLimits, SpendReservation } from "./spend-circuit-breaker.js";

export interface ScriptBudgetLimits {
  maximumInputTokens: number;
  maximumOutputTokens: number;
  maximumCostUsd: number;
}

export interface CallReservation {
  id: string;
  projectedInputTokens: number;
  projectedOutputTokens: number;
  projectedCostUsd: number;
  globalReservation?: SpendReservation;
  dryRun: boolean;
}

export interface BudgetUsage {
  inputTokens: number;
  outputTokens: number;
  actualCostUsd: number;
  reservedCostUsd: number;
}

export class ScriptBudget {
  private inputTokens = 0;
  private outputTokens = 0;
  private actualCostUsd = 0;
  private reservedCostUsd = 0;
  private reservedInputTokens = 0;
  private reservedOutputTokens = 0;
  private readonly reservations = new Map<string, CallReservation>();
  private sequence = 0;
  private analysisAdmission: Promise<void> | undefined;

  constructor(
    private readonly limits: ScriptBudgetLimits,
    private readonly globalStore?: AtomicSpendStore,
    private readonly globalLimits?: SpendLimits,
    private readonly dryRun = false,
  ) {}

  private ensureAnalysisAdmission(now: Date): Promise<void> {
    if (this.dryRun || !this.globalStore || !this.globalLimits) return Promise.resolve();
    this.analysisAdmission ??= this.globalStore
      .beginAnalysis(now, this.globalLimits)
      .then(() => undefined);
    return this.analysisAdmission;
  }

  async reserve(projected: CostBreakdown, now = new Date()): Promise<CallReservation> {
    await this.ensureAnalysisAdmission(now);
    if (
      this.inputTokens + this.reservedInputTokens + projected.inputTokens >
      this.limits.maximumInputTokens
    ) {
      throw new CostBudgetError("Per-script input token budget exceeded.");
    }
    if (
      this.outputTokens + this.reservedOutputTokens + projected.outputTokens >
      this.limits.maximumOutputTokens
    ) {
      throw new CostBudgetError("Per-script output token budget exceeded.");
    }
    if (
      !this.dryRun &&
      this.actualCostUsd + this.reservedCostUsd + projected.totalCostUsd >
        this.limits.maximumCostUsd
    ) {
      throw new CostBudgetError("Per-script cost budget exceeded.");
    }
    const globalReservation =
      !this.dryRun && this.globalStore && this.globalLimits
        ? await this.globalStore.reserve(now, projected.totalCostUsd, this.globalLimits)
        : undefined;
    const reservation: CallReservation = {
      id: `script-call-${++this.sequence}`,
      projectedInputTokens: projected.inputTokens,
      projectedOutputTokens: projected.outputTokens,
      projectedCostUsd: projected.totalCostUsd,
      ...(globalReservation ? { globalReservation } : {}),
      dryRun: this.dryRun,
    };
    this.reservedCostUsd += this.dryRun ? 0 : projected.totalCostUsd;
    this.reservedInputTokens += projected.inputTokens;
    this.reservedOutputTokens += projected.outputTokens;
    this.reservations.set(reservation.id, reservation);
    return reservation;
  }

  async reconcile(
    reservation: CallReservation,
    usage: TokenUsage,
    actual: CostBreakdown,
  ): Promise<void> {
    const stored = this.reservations.get(reservation.id);
    if (!stored) throw new CostBudgetError("Unknown or already reconciled script reservation.");
    const exceedsInput = this.inputTokens + usage.inputTokens > this.limits.maximumInputTokens;
    const exceedsOutput = this.outputTokens + usage.outputTokens > this.limits.maximumOutputTokens;
    const exceedsCost =
      !this.dryRun && this.actualCostUsd + actual.totalCostUsd > this.limits.maximumCostUsd;
    this.inputTokens += usage.inputTokens;
    this.outputTokens += usage.outputTokens;
    this.actualCostUsd += this.dryRun ? 0 : actual.totalCostUsd;
    this.reservedCostUsd = Math.max(
      0,
      this.reservedCostUsd - (this.dryRun ? 0 : stored.projectedCostUsd),
    );
    this.reservedInputTokens = Math.max(0, this.reservedInputTokens - stored.projectedInputTokens);
    this.reservedOutputTokens = Math.max(
      0,
      this.reservedOutputTokens - stored.projectedOutputTokens,
    );
    if (stored.globalReservation && this.globalStore) {
      await this.globalStore.reconcile(stored.globalReservation, actual.totalCostUsd);
    }
    this.reservations.delete(reservation.id);
    if (exceedsInput || exceedsOutput || exceedsCost) {
      throw new CostBudgetError("Actual LLM usage exceeded the per-script hard budget.");
    }
  }

  async cancel(reservation: CallReservation): Promise<void> {
    const stored = this.reservations.get(reservation.id);
    if (!stored) return;
    this.reservedCostUsd = Math.max(
      0,
      this.reservedCostUsd - (this.dryRun ? 0 : stored.projectedCostUsd),
    );
    this.reservedInputTokens = Math.max(0, this.reservedInputTokens - stored.projectedInputTokens);
    this.reservedOutputTokens = Math.max(
      0,
      this.reservedOutputTokens - stored.projectedOutputTokens,
    );
    if (stored.globalReservation && this.globalStore) {
      await this.globalStore.reconcile(stored.globalReservation, 0);
    }
    this.reservations.delete(reservation.id);
  }

  usage(): BudgetUsage {
    return {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      actualCostUsd: this.actualCostUsd,
      reservedCostUsd: this.reservedCostUsd,
    };
  }
}

export const budgetDegradationOrder = Object.freeze([
  "reduce_chunk_summary_output",
  "combine_short_chunks",
  "remove_low_priority_production_metadata",
  "compress_supporting_characters",
  "reduce_representative_excerpt_budget",
  "use_cheaper_model",
  "stop_if_evidence_insufficient",
] as const);

export interface BudgetDegradationState {
  summaryOutputTokens: number;
  combineShortChunks: boolean;
  includeLowPriorityProductionMetadata: boolean;
  supportingCharacterLimit: number;
  representativeExcerptTokens: number;
  modelCandidates: readonly string[];
  modelIndex: number;
  stopped: boolean;
}

export function applyNextBudgetDegradation(state: BudgetDegradationState): {
  state: BudgetDegradationState;
  action: (typeof budgetDegradationOrder)[number];
} {
  if (state.summaryOutputTokens > 150) {
    return {
      action: "reduce_chunk_summary_output",
      state: { ...state, summaryOutputTokens: Math.max(150, state.summaryOutputTokens - 50) },
    };
  }
  if (!state.combineShortChunks) {
    return {
      action: "combine_short_chunks",
      state: { ...state, combineShortChunks: true },
    };
  }
  if (state.includeLowPriorityProductionMetadata) {
    return {
      action: "remove_low_priority_production_metadata",
      state: { ...state, includeLowPriorityProductionMetadata: false },
    };
  }
  if (state.supportingCharacterLimit > 8) {
    return {
      action: "compress_supporting_characters",
      state: { ...state, supportingCharacterLimit: 8 },
    };
  }
  if (state.representativeExcerptTokens > 1_500) {
    return {
      action: "reduce_representative_excerpt_budget",
      state: {
        ...state,
        representativeExcerptTokens: Math.max(1_500, state.representativeExcerptTokens - 500),
      },
    };
  }
  if (state.modelIndex + 1 < state.modelCandidates.length) {
    return {
      action: "use_cheaper_model",
      state: { ...state, modelIndex: state.modelIndex + 1 },
    };
  }
  return {
    action: "stop_if_evidence_insufficient",
    state: { ...state, stopped: true },
  };
}
