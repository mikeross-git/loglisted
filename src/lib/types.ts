export * from "../types/abuse.js";
export * from "../types/scoring.js";
export * from "../types/screenplay.js";
export * from "../types/submission.js";

export interface Versioned {
  version: string;
}

export interface ProcessingCost {
  inputTokens: number;
  outputTokens: number;
  estimatedUsd: number;
}
