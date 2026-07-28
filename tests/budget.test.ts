import { describe, expect, it } from "vitest";
import {
  applyNextBudgetDegradation,
  ScriptBudget,
  budgetDegradationOrder,
  type BudgetDegradationState,
} from "../src/lib/budget.js";
import { calculateCost, calculateProjectedCost } from "../src/lib/cost.js";
import { CostBudgetError } from "../src/lib/errors.js";
import { parseModelPricing } from "../src/lib/model-pricing.js";
import { InMemoryAtomicSpendStore } from "../src/lib/spend-circuit-breaker.js";

const pricing = parseModelPricing({
  models: {
    model: {
      inputPerMillion: 1,
      outputPerMillion: 2,
      cachedInputPerMillion: 0.25,
    },
  },
});

describe("per-script token and cost budget", () => {
  it("reserves projected use and reconciles actual token use and cost", async () => {
    const budget = new ScriptBudget({
      maximumInputTokens: 10_000,
      maximumOutputTokens: 1_000,
      maximumCostUsd: 1,
    });
    const projected = calculateProjectedCost(pricing, "model", 1_000, 200);
    const reservation = await budget.reserve(projected);
    const usage = { inputTokens: 900, outputTokens: 100 };
    await budget.reconcile(reservation, usage, calculateCost(pricing, "model", usage));
    expect(budget.usage()).toEqual({
      inputTokens: 900,
      outputTokens: 100,
      actualCostUsd: 0.0011,
      reservedCostUsd: 0,
    });
  });

  it("checks concurrent projected token reservations", async () => {
    const budget = new ScriptBudget({
      maximumInputTokens: 1_500,
      maximumOutputTokens: 300,
      maximumCostUsd: 1,
    });
    const projected = calculateProjectedCost(pricing, "model", 1_000, 200);
    const results = await Promise.allSettled([
      budget.reserve(projected),
      budget.reserve(projected),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  it("rejects projected cost before a call", async () => {
    const budget = new ScriptBudget({
      maximumInputTokens: 1_000_000,
      maximumOutputTokens: 1_000_000,
      maximumCostUsd: 0.0001,
    });
    await expect(
      budget.reserve(calculateProjectedCost(pricing, "model", 1_000, 1_000)),
    ).rejects.toBeInstanceOf(CostBudgetError);
  });

  it("supports dry run without reserving or recording spend", async () => {
    const budget = new ScriptBudget(
      {
        maximumInputTokens: 10_000,
        maximumOutputTokens: 1_000,
        maximumCostUsd: 0.000001,
      },
      undefined,
      undefined,
      true,
    );
    const projected = calculateProjectedCost(pricing, "model", 1_000, 200);
    const reservation = await budget.reserve(projected);
    const usage = { inputTokens: 1_000, outputTokens: 100 };
    await budget.reconcile(reservation, usage, calculateCost(pricing, "model", usage));
    expect(budget.usage().actualCostUsd).toBe(0);
  });

  it("admits one analysis before calls and applies global spend reservations", async () => {
    const globalStore = new InMemoryAtomicSpendStore();
    const globalLimits = {
      hourlySpendLimitUsd: 1,
      dailySpendLimitUsd: 2,
      maxAnalysesPerHour: 1,
    };
    const budget = new ScriptBudget(
      {
        maximumInputTokens: 10_000,
        maximumOutputTokens: 1_000,
        maximumCostUsd: 1,
      },
      globalStore,
      globalLimits,
    );
    const now = new Date("2026-07-26T12:00:00.000Z");
    const projected = calculateProjectedCost(pricing, "model", 1_000, 100);
    await budget.reserve(projected, now);
    await budget.reserve(projected, now);
    expect((await globalStore.snapshot(now)).analysesThisHour).toBe(1);
  });

  it("exposes the approved deterministic degradation order", () => {
    expect(budgetDegradationOrder).toEqual([
      "reduce_chunk_summary_output",
      "combine_short_chunks",
      "remove_low_priority_production_metadata",
      "compress_supporting_characters",
      "reduce_representative_excerpt_budget",
      "use_cheaper_model",
      "stop_if_evidence_insufficient",
    ]);
  });

  it("applies degradation in the approved order and stops before insufficient evidence", () => {
    let state: BudgetDegradationState = {
      summaryOutputTokens: 200,
      combineShortChunks: false,
      includeLowPriorityProductionMetadata: true,
      supportingCharacterLimit: 20,
      representativeExcerptTokens: 2_000,
      modelCandidates: ["primary", "cheaper"],
      modelIndex: 0,
      stopped: false,
    };
    const actions: string[] = [];
    for (let index = 0; index < 7; index += 1) {
      const result = applyNextBudgetDegradation(state);
      state = result.state;
      actions.push(result.action);
    }
    expect(actions).toEqual(budgetDegradationOrder);
    expect(state.stopped).toBe(true);
  });
});
