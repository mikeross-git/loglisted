import { describe, expect, it } from "vitest";
import { SafeLogger, type LogEvent } from "../src/lib/logger.js";
import { ValidationError } from "../src/lib/errors.js";

describe("safe logger", () => {
  it("emits structured events with allowlisted operational fields", () => {
    const events: LogEvent[] = [];
    const logger = new SafeLogger((event) => events.push(event));
    logger.info("submission.validated", {
      submissionId: "submission-id",
      pageCount: 100,
      warningCodes: ["low_text_page"],
    });
    expect(events[0]).toMatchObject({
      level: "info",
      event: "submission.validated",
      fields: { pageCount: 100 },
    });
  });

  it.each([
    "screenplayText",
    "chunkText",
    "summary",
    "rawPdf",
    "turnstileToken",
    "uploadToken",
    "rawIpAddress",
    "message",
  ])("rejects unsafe or unapproved field %s", (field) => {
    const logger = new SafeLogger(() => undefined);
    expect(() => logger.info("unsafe.attempt", { [field]: "sensitive" })).toThrow(ValidationError);
  });

  it("rejects objects and invalid event names", () => {
    const logger = new SafeLogger(() => undefined);
    expect(() => logger.info("unsafe.attempt", { status: { nested: "text" } } as never)).toThrow(
      ValidationError,
    );
    expect(() => logger.info("Contains spaces")).toThrow(ValidationError);
  });
});
