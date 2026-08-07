import { z } from "zod";
import { estimateTokens } from "../chunker.js";
import { normalizeProviderError } from "./provider.js";
import type { LlmProvider, StructuredOutputRequest, StructuredOutputResponse } from "./provider.js";
import type { ProviderPrivacyCapabilities } from "./provider-capabilities.js";

const OpenAiResponseSchema = z
  .object({
    id: z.string().optional(),
    output_text: z.string().optional(),
    output: z.array(z.unknown()).optional(),
    usage: z
      .object({
        input_tokens: z.number().int().nonnegative(),
        output_tokens: z.number().int().nonnegative(),
        input_tokens_details: z
          .object({ cached_tokens: z.number().int().nonnegative().optional() })
          .passthrough()
          .optional(),
      })
      .optional(),
  })
  .passthrough();

const OpenAiErrorResponseSchema = z
  .object({
    error: z
      .object({
        code: z.string().nullable().optional(),
        param: z.string().nullable().optional(),
        type: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();

export interface OpenAiProviderOptions {
  apiKey?: string;
  baseUrl?: string;
  dryRun?: boolean;
  fetchImplementation?: typeof fetch;
  dryRunOutput?: unknown;
  privacyCapabilities?: Omit<ProviderPrivacyCapabilities, "providerName" | "modelName">;
}

function extractOutputText(response: z.infer<typeof OpenAiResponseSchema>): string {
  if (response.output_text) return response.output_text;
  const output = response.output as { content?: { type?: string; text?: string }[] }[] | undefined;
  for (const item of output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  throw new Error("OpenAI response did not contain output text.");
}

type SafeProviderFailure = Error & {
  request_id?: string;
  provider_failure_kind?: string;
};

function safeFailure(error: unknown, kind: string, requestId?: string): SafeProviderFailure {
  const failure: SafeProviderFailure =
    error instanceof Error ? error : new Error("Provider request failed.");
  failure.provider_failure_kind = kind;
  if (requestId) failure.request_id = requestId;
  return failure;
}

export class OpenAiProvider implements LlmProvider {
  readonly name = "openai";
  private readonly fetchImplementation: typeof fetch;
  private readonly baseUrl: string;
  private readonly dryRun: boolean;

  constructor(private readonly options: OpenAiProviderOptions) {
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.baseUrl = options.baseUrl ?? "https://api.openai.com/v1";
    this.dryRun = options.dryRun ?? false;
  }

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
      supportsRequestStorageControl: true,
      requestStorageDisabled: true,
      ...this.options.privacyCapabilities,
    };
  }

  async generateStructured<T>(
    request: StructuredOutputRequest<T>,
  ): Promise<StructuredOutputResponse<T>> {
    const started = performance.now();
    if (this.dryRun) {
      return {
        model: request.model,
        output: request.schema.parse(this.options.dryRunOutput ?? {}),
        usage: {
          inputTokens: estimateTokens(
            `${request.systemPrompt}\n${JSON.stringify(request.userPayload)}`,
          ),
          outputTokens: 0,
        },
        latencyMs: performance.now() - started,
        attempts: 1,
        dryRun: true,
      };
    }
    if (!this.options.apiKey)
      throw normalizeProviderError(this.name, new Error("Missing API key."));

    let lastError: unknown;
    for (const attempt of [1, 2] as const) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), request.timeoutMs);
      try {
        const response = await this.fetchImplementation(`${this.baseUrl}/responses`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.options.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: request.model,
            instructions: request.systemPrompt,
            input: JSON.stringify(request.userPayload),
            temperature: request.temperature,
            max_output_tokens: request.maximumOutputTokens,
            store: false,
            text: {
              format: {
                type: "json_schema",
                name: request.schemaName,
                strict: true,
                schema: z.toJSONSchema(request.schema),
              },
            },
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const error = new Error(`OpenAI HTTP ${response.status}`) as Error & {
            status: number;
            request_id?: string;
            provider_code?: string;
            provider_param?: string;
          };
          error.status = response.status;
          const requestId = response.headers.get("x-request-id");
          if (requestId) error.request_id = requestId;
          const errorBody = OpenAiErrorResponseSchema.safeParse(
            await response.json().catch(() => null),
          );
          if (errorBody.success) {
            const providerCode = errorBody.data.error.code ?? errorBody.data.error.type;
            if (providerCode) error.provider_code = providerCode;
            if (errorBody.data.error.param) error.provider_param = errorBody.data.error.param;
          }
          throw error;
        }
        const requestId = response.headers.get("x-request-id") ?? undefined;
        let body: z.infer<typeof OpenAiResponseSchema>;
        try {
          body = OpenAiResponseSchema.parse(await response.json());
        } catch (error) {
          throw safeFailure(error, "response_shape", requestId);
        }
        let outputText: string;
        try {
          outputText = extractOutputText(body);
        } catch (error) {
          throw safeFailure(error, "missing_output_text", requestId ?? body.id);
        }
        let decoded: unknown;
        try {
          decoded = JSON.parse(outputText) as unknown;
        } catch (error) {
          throw safeFailure(error, "malformed_output_json", requestId ?? body.id);
        }
        let output: T;
        try {
          output = request.schema.parse(decoded);
        } catch (error) {
          throw safeFailure(error, "structured_output_validation", requestId ?? body.id);
        }
        return {
          model: request.model,
          output,
          usage: {
            inputTokens: body.usage?.input_tokens ?? 0,
            outputTokens: body.usage?.output_tokens ?? 0,
            cachedInputTokens: body.usage?.input_tokens_details?.cached_tokens ?? 0,
          },
          latencyMs: performance.now() - started,
          ...(body.id ? { providerRequestId: body.id } : {}),
          attempts: attempt,
          dryRun: false,
        };
      } catch (error) {
        const classifiedError =
          error instanceof DOMException && error.name === "AbortError"
            ? safeFailure(error, "timeout")
            : error instanceof TypeError
              ? safeFailure(error, "network_error")
              : error;
        lastError = classifiedError;
        const malformedOutput =
          classifiedError instanceof SyntaxError ||
          classifiedError instanceof z.ZodError ||
          (classifiedError instanceof Error && classifiedError.message.includes("output text"));
        if (!malformedOutput || attempt === 2) {
          throw normalizeProviderError(this.name, classifiedError);
        }
      } finally {
        clearTimeout(timeout);
      }
    }
    throw normalizeProviderError(this.name, lastError);
  }
}
