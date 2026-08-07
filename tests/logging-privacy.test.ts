import { describe, expect, it } from "vitest";
import { SafeLogger, sanitizedErrorFields, type LogEvent } from "../src/lib/logger.js";

describe("logging and observability privacy", () => {
  it("allows privacy-safe provider failure diagnostics", () => {
    const events: LogEvent[] = [];
    const logger = new SafeLogger((event) => events.push(event));

    logger.warn("production.analysis_rejected", {
      processingStage: "summarization",
      errorClass: "LlmFailureError",
      errorCode: "LLM_FAILED",
      providerStatus: 400,
      providerRequestId: "req_safe123",
      providerCode: "invalid_request_error",
      providerParam: "seed",
      status: 502,
      environment: "production",
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.fields).toMatchObject({
      providerStatus: 400,
      providerRequestId: "req_safe123",
      providerCode: "invalid_request_error",
      providerParam: "seed",
    });
  });

  it.each([
    "screenplayText",
    "chunkText",
    "summary",
    "representativeExcerpt",
    "prompt",
    "responseBody",
    "writerEmail",
    "rawIp",
    "resultAccessToken",
  ])("rejects content-bearing field %s", (field) => {
    const logger = new SafeLogger(() => undefined);
    expect(() => logger.info("privacy.test", { [field]: "private screenplay value" })).toThrow();
  });

  it("sanitizes exceptions without forwarding message, cause, prompt, or response data", () => {
    const error = new Error("INT. HOUSE - DAY private screenplay text");
    const fields = sanitizedErrorFields(error);
    expect(fields).toEqual({ errorClass: "Error", retryable: false });
    expect(JSON.stringify(fields)).not.toContain("HOUSE");
  });

  it("rejects screenplay content smuggled through an otherwise allowed field", () => {
    const logger = new SafeLogger(() => undefined);
    expect(() => logger.info("privacy.test", { status: "INT. HOUSE - DAY" })).toThrow();
    expect(() =>
      logger.info("privacy.test", { reasonCode: "private screenplay summary" }),
    ).toThrow();
  });
});
