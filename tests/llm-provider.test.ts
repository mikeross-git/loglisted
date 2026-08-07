import { describe, expect, it } from "vitest";
import { z } from "zod";
import { LlmFailureError } from "../src/lib/errors.js";
import { OpenAiProvider } from "../src/lib/llm/openai.js";
import { FakeLlmProvider } from "../src/lib/llm/provider.js";

const schema = z.object({ result: z.string() }).strict();
const request = {
  model: "configurable-model",
  systemPrompt: "Return structured data.",
  userPayload: { evidenceId: "safe-id" },
  schemaName: "test_output",
  schema,
  maximumOutputTokens: 100,
  timeoutMs: 1_000,
  temperature: 0 as const,
  seed: 1,
};

describe("LLM provider abstraction", () => {
  it("returns structured output, usage, latency, request ID, and model", async () => {
    const provider = new FakeLlmProvider(() => ({ result: "ok" }));
    const response = await provider.generateStructured(request);
    expect(response.output).toEqual({ result: "ok" });
    expect(response.model).toBe("configurable-model");
    expect(response.usage.inputTokens).toBeGreaterThan(0);
    expect(response.usage.outputTokens).toBeGreaterThan(0);
    expect(response.latencyMs).toBeGreaterThanOrEqual(0);
    expect(response.providerRequestId).toMatch(/^fake-/);
    expect(provider.requests[0]?.temperature).toBe(0);
    expect(provider.requests[0]?.timeoutMs).toBe(1_000);
  });

  it("retries malformed structured output exactly once", async () => {
    const provider = new FakeLlmProvider((_request, attempt) =>
      attempt === 1 ? "not-json" : { result: "repaired" },
    );
    const response = await provider.generateStructured(request);
    expect(response.attempts).toBe(2);
    expect(response.output.result).toBe("repaired");
  });

  it("normalizes failure after the single retry", async () => {
    const provider = new FakeLlmProvider(() => ({ wrong: true }));
    await expect(provider.generateStructured(request)).rejects.toBeInstanceOf(LlmFailureError);
  });

  it("supports dry run without making a provider request", async () => {
    let called = false;
    const provider = new OpenAiProvider({
      dryRun: true,
      dryRunOutput: { result: "dry-run" },
      fetchImplementation: () => {
        called = true;
        throw new Error("Network must not be called in dry run.");
      },
    });
    const response = await provider.generateStructured(request);
    expect(response.output.result).toBe("dry-run");
    expect(response.dryRun).toBe(true);
    expect(response.usage.outputTokens).toBe(0);
    expect(called).toBe(false);
  });

  it("omits unsupported seed while retaining request-storage controls", async () => {
    let requestBody: unknown;
    const provider = new OpenAiProvider({
      apiKey: "test-key",
      fetchImplementation: (_url, init) => {
        if (typeof init?.body !== "string") throw new Error("Expected a JSON request body.");
        requestBody = JSON.parse(init.body);
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: "resp_safe",
              output: [
                {
                  type: "message",
                  content: [{ type: "output_text", text: JSON.stringify({ result: "ok" }) }],
                },
              ],
              usage: { input_tokens: 10, output_tokens: 2 },
            }),
            { status: 200 },
          ),
        );
      },
    });

    await provider.generateStructured(request);

    expect(requestBody).toMatchObject({
      model: "configurable-model",
      temperature: 0,
      store: false,
    });
    expect(requestBody).not.toHaveProperty("seed");
  });

  it("uses reasoning effort and omits temperature for reasoning-model requests", async () => {
    let requestBody: Record<string, unknown> = {};
    const provider = new OpenAiProvider({
      apiKey: "test-key",
      fetchImplementation: (_url, init) => {
        if (typeof init?.body !== "string") throw new Error("Expected a JSON request body.");
        requestBody = JSON.parse(init.body) as Record<string, unknown>;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: "resp_terra",
              output: [
                {
                  type: "message",
                  content: [{ type: "output_text", text: JSON.stringify({ result: "ok" }) }],
                },
              ],
              usage: { input_tokens: 10, output_tokens: 2 },
            }),
            { status: 200 },
          ),
        );
      },
    });

    await provider.generateStructured({
      ...request,
      model: "gpt-5.6-terra",
      reasoningEffort: "none",
    });

    expect(requestBody).toMatchObject({
      model: "gpt-5.6-terra",
      reasoning: { effort: "none" },
      store: false,
    });
    expect(requestBody).not.toHaveProperty("temperature");
    expect(requestBody).not.toHaveProperty("seed");
  });

  it("normalizes only safe provider error metadata", async () => {
    const provider = new OpenAiProvider({
      apiKey: "test-key",
      fetchImplementation: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              error: {
                code: "unknown_parameter",
                param: "seed",
                message: "sensitive provider message must not propagate",
              },
            }),
            { status: 400, headers: { "x-request-id": "req_safe" } },
          ),
        ),
    });

    const failure = await provider.generateStructured(request).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(LlmFailureError);
    expect((failure as LlmFailureError).details).toEqual({
      provider: "openai",
      status: 400,
      requestId: "req_safe",
      providerCode: "unknown_parameter",
      providerParam: "seed",
    });
    expect(JSON.stringify(failure)).not.toContain("sensitive provider message");
  });

  it("classifies successful responses that omit structured output without retaining content", async () => {
    const provider = new OpenAiProvider({
      apiKey: "test-key",
      fetchImplementation: () =>
        Promise.resolve(
          new Response(JSON.stringify({ id: "resp_missing", output: [] }), {
            status: 200,
            headers: { "x-request-id": "req_missing" },
          }),
        ),
    });

    const failure = await provider.generateStructured(request).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(LlmFailureError);
    expect((failure as LlmFailureError).details).toMatchObject({
      provider: "openai",
      requestId: "req_missing",
      failureKind: "missing_output_text",
    });
  });
});
