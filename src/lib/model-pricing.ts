import { z } from "zod";
import { ValidationError } from "./errors.js";

export const ModelPriceSchema = z
  .object({
    inputPerMillion: z.number().nonnegative(),
    outputPerMillion: z.number().nonnegative(),
    cachedInputPerMillion: z.number().nonnegative(),
  })
  .strict();

export const ModelPricingConfigSchema = z
  .object({
    models: z.record(z.string().min(1), ModelPriceSchema),
  })
  .strict();

export type ModelPrice = z.infer<typeof ModelPriceSchema>;
export type ModelPricingConfig = z.infer<typeof ModelPricingConfigSchema>;

export function parseModelPricing(value: unknown): ModelPricingConfig {
  try {
    const decoded = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
    return ModelPricingConfigSchema.parse(decoded);
  } catch (error) {
    throw new ValidationError("Invalid model pricing configuration.", { cause: error });
  }
}

export function getModelPrice(config: ModelPricingConfig, model: string): ModelPrice | undefined {
  return config.models[model];
}

export function missingModelPrices(
  config: ModelPricingConfig,
  activeModels: readonly (string | undefined)[],
): string[] {
  return [...new Set(activeModels.filter((model): model is string => Boolean(model)))].filter(
    (model) => !config.models[model],
  );
}
