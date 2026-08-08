export const versions = Object.freeze({
  parserVersion: "parser-1",
  metadataVersion: "metadata-1",
  chunkerVersion: "chunker-1",
  summaryPromptVersion: "summary-prompt-3",
  reducerVersion: "reducer-2",
  excerptSamplerVersion: "excerpt-sampler-2",
  rubricVersion: "rubric-1",
  scoringPromptVersion: "scoring-prompt-5",
  riskModelVersion: "risk-model-1",
  costConfigVersion: "cost-config-1",
} as const);

export type VersionKey = keyof typeof versions;
