import type { z } from "zod";
import { LlmFailureError } from "../errors.js";
import type { TokenUsage } from "../cost.js";
import type { ProviderPrivacyCapabilities } from "./provider-capabilities.js";

export interface StructuredOutputRequest<T> {
  model: string;
  systemPrompt: string;
  userPayload: unknown;
  schemaName: string;
  schema: z.ZodType<T>;
  maximumOutputTokens: number;
  timeoutMs: number;
  temperature: 0;
  seed?: number;
  context?: {
    fileHash?: string;
    chunkIndex?: number;
    characterNames?: readonly string[];
    sceneHeadings?: readonly string[];
    act?: string | null;
  };
}

export interface StructuredOutputResponse<T> {
  model: string;
  output: T;
  usage: TokenUsage;
  latencyMs: number;
  providerRequestId?: string;
  attempts: 1 | 2;
  dryRun: boolean;
}

export interface LlmProvider {
  readonly name: string;
  privacyCapabilities(modelName: string): ProviderPrivacyCapabilities;
  generateStructured<T>(request: StructuredOutputRequest<T>): Promise<StructuredOutputResponse<T>>;
}

export interface NormalizedProviderError {
  provider: string;
  code: string;
  status?: number;
  retryable: boolean;
  requestId?: string;
}

export function normalizeProviderError(provider: string, error: unknown): LlmFailureError {
  if (error instanceof LlmFailureError) return error;
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number(error.status)
      : undefined;
  const requestId =
    typeof error === "object" && error !== null && "request_id" in error
      ? String(error.request_id)
      : undefined;
  const providerCode =
    typeof error === "object" && error !== null && "provider_code" in error
      ? String(error.provider_code)
      : undefined;
  const providerParam =
    typeof error === "object" && error !== null && "provider_param" in error
      ? String(error.provider_param)
      : undefined;
  const finiteStatus = typeof status === "number" && Number.isFinite(status) ? status : undefined;
  return new LlmFailureError(`${provider} structured-output request failed.`, {
    cause: error,
    details: {
      provider,
      ...(finiteStatus !== undefined ? { status: finiteStatus } : {}),
      ...(requestId ? { requestId } : {}),
      ...(providerCode ? { providerCode } : {}),
      ...(providerParam ? { providerParam } : {}),
    },
  });
}

export class FakeLlmProvider implements LlmProvider {
  readonly name = "fake";
  readonly requests: StructuredOutputRequest<unknown>[] = [];

  constructor(
    private readonly responder: (
      request: StructuredOutputRequest<unknown>,
      attempt: number,
    ) => unknown,
  ) {}

  privacyCapabilities(modelName: string): ProviderPrivacyCapabilities {
    return {
      providerName: this.name,
      modelName,
      apiDataUsedForTrainingByDefault: "unknown",
      trainingOptOutConfigured: "unknown",
      supportsZeroDataRetention: false,
      zeroDataRetentionEnabled: false,
      supportsModifiedAbuseMonitoring: false,
      modifiedAbuseMonitoringEnabled: false,
      statedRetentionDays: "unknown",
      supportsRegionalProcessing: false,
      configuredRegion: null,
      supportsRequestStorageControl: false,
      requestStorageDisabled: "unknown",
    };
  }

  async generateStructured<T>(
    request: StructuredOutputRequest<T>,
  ): Promise<StructuredOutputResponse<T>> {
    this.requests.push(request);
    const started = performance.now();
    let lastError: unknown;
    for (const attempt of [1, 2] as const) {
      try {
        const raw = await this.responder(request, attempt);
        const decoded = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
        return {
          model: request.model,
          output: request.schema.parse(decoded),
          usage: {
            inputTokens: Math.ceil(JSON.stringify(request.userPayload).length / 4),
            outputTokens: Math.ceil(JSON.stringify(decoded).length / 4),
          },
          latencyMs: performance.now() - started,
          providerRequestId: `fake-${this.requests.length}`,
          attempts: attempt,
          dryRun: false,
        };
      } catch (error) {
        lastError = error;
      }
    }
    throw normalizeProviderError(this.name, lastError);
  }
}
