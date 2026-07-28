import { describe, expect, it } from "vitest";
import { calculateCost, calculateProjectedCost } from "../src/lib/cost.js";
import { CostBudgetError } from "../src/lib/errors.js";
import { parseModelPricing } from "../src/lib/model-pricing.js";

const pricing = parseModelPricing({
  models: {
    model: {
      inputPerMillion: 2,
      outputPerMillion: 8,
      cachedInputPerMillion: 0.5,
    },
  },
});

describe("model cost accounting", () => {
  it("calculates cached, uncached, output, and total actual cost", () => {
    const result = calculateCost(pricing, "model", {
      inputTokens: 1_000_000,
      cachedInputTokens: 250_000,
      outputTokens: 100_000,
    });
    expect(result.inputCostUsd).toBe(1.5);
    expect(result.cachedInputCostUsd).toBe(0.125);
    expect(result.outputCostUsd).toBe(0.8);
    expect(result.totalCostUsd).toBeCloseTo(2.425);
  });

  it("calculates projected cost using maximum output and no cache assumption", () => {
    const result = calculateProjectedCost(pricing, "model", 10_000, 1_000);
    expect(result.totalCostUsd).toBeCloseTo(0.028);
  });

  it("fails closed when active model pricing is missing", () => {
    expect(() => calculateProjectedCost(pricing, "unknown", 100, 100)).toThrow(CostBudgetError);
  });

  it("rejects malformed pricing configuration", () => {
    expect(() =>
      parseModelPricing({
        models: {
          model: { inputPerMillion: -1, outputPerMillion: 1, cachedInputPerMillion: 0 },
        },
      }),
    ).toThrow();
  });
});
