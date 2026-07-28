import { describe, expect, it } from "vitest";
import { SafeLogger, sanitizedErrorFields } from "../src/lib/logger.js";

describe("logging and observability privacy", () => {
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
