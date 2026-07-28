import { CostBudgetError } from "./errors.js";
import type { ModelPrice, ModelPricingConfig } from "./model-pricing.js";
import { getModelPrice } from "./model-pricing.js";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}

export interface CostBreakdown extends Required<TokenUsage> {
  model: string;
  inputCostUsd: number;
  cachedInputCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
}

function costWithPrice(model: string, usage: TokenUsage, price: ModelPrice): CostBreakdown {
  const cachedInputTokens = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens);
  const uncachedInputTokens = usage.inputTokens - cachedInputTokens;
  const inputCostUsd = (uncachedInputTokens / 1_000_000) * price.inputPerMillion;
  const cachedInputCostUsd = (cachedInputTokens / 1_000_000) * price.cachedInputPerMillion;
  const outputCostUsd = (usage.outputTokens / 1_000_000) * price.outputPerMillion;
  return {
    model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cachedInputTokens,
    inputCostUsd,
    cachedInputCostUsd,
    outputCostUsd,
    totalCostUsd: inputCostUsd + cachedInputCostUsd + outputCostUsd,
  };
}

export function calculateCost(
  pricing: ModelPricingConfig,
  model: string,
  usage: TokenUsage,
): CostBreakdown {
  const price = getModelPrice(pricing, model);
  if (!price) throw new CostBudgetError(`Pricing is missing for active model: ${model}`);
  return costWithPrice(model, usage, price);
}

export function calculateProjectedCost(
  pricing: ModelPricingConfig,
  model: string,
  estimatedInputTokens: number,
  maximumOutputTokens: number,
): CostBreakdown {
  return calculateCost(pricing, model, {
    inputTokens: estimatedInputTokens,
    outputTokens: maximumOutputTokens,
    cachedInputTokens: 0,
  });
}
