import { describe, expect, it } from "vitest";
import { assertMinimizedLlmPayload, redactTitlePagePii } from "../src/lib/ai-data-policy.js";

describe("AI data minimization and title-page PII redaction", () => {
  it.each([
    ["email", "writer@example.com", "[EMAIL]"],
    ["US phone", "(212) 555-0199", "[PHONE]"],
    ["international phone", "+44 20 7946 0958", "[PHONE]"],
    ["mailing address", "123 Main Street", "[ADDRESS]"],
    ["website", "https://writer.example.com/contact", "[WEBSITE]"],
    ["social handle", "@screenwriter", "[SOCIAL]"],
  ])("redacts a title-page %s before model use", (_label, value, marker) => {
    const page = `THE FILM\nWritten by\nTaylor Smith\n${value}\nFADE IN:`;
    const redacted = redactTitlePagePii(page, [page, "INT. HOUSE - DAY\nAction."]);
    expect(redacted.titlePageContactDetected).toBe(true);
    expect(redacted.redactedModelText).toContain(marker);
    expect(redacted.redactedModelText).not.toContain(value);
    expect(redacted.redactedModelText).toContain("[WRITER]");
    expect(redacted.originalExtractedText).toBe(page);
  });

  it("removes representation contact blocks without changing a clean title page", () => {
    const represented = "A FILM\nWritten by Alex Writer\nAgent: Pat Agent, Agency, 212-555-0100";
    const redacted = redactTitlePagePii(represented, [represented]);
    expect(redacted.redactedModelText).not.toContain("Pat Agent");
    const clean = "A FILM\nDraft: January 2026\nCopyright 2026";
    const cleanResult = redactTitlePagePii(clean, [clean]);
    expect(cleanResult.titlePageContactDetected).toBe(false);
    expect(cleanResult.redactedModelText).toBe(clean);
  });

  it("redacts a second contact/title page but does not redact screenplay dialogue", () => {
    const pages = [
      "THE FILM\nWritten by\nTaylor Writer",
      "Manager: Pat Manager\npat@agency.example\nINT. HOUSE - DAY\nALEX\nEmail me at plot@example.com.",
    ];
    const result = redactTitlePagePii(pages.join("\n\n"), pages);
    expect(result.redactedTextByPage[1]).not.toContain("Pat Manager");
    expect(result.redactedTextByPage[1]).not.toContain("pat@agency.example");
    expect(result.redactedTextByPage[1]).toContain("plot@example.com");
  });

  it("rejects operational, identity, risk, and profile fields from LLM payloads", () => {
    expect(() => assertMinimizedLlmPayload({ evidence: { riskScore: 20 } })).toThrow();
    expect(() => assertMinimizedLlmPayload({ imdbProfile: "profile" })).toThrow();
    expect(() => assertMinimizedLlmPayload({ anonymousSessionId: "session" })).toThrow();
    expect(() => assertMinimizedLlmPayload({ evidence: "screenplay evidence" })).not.toThrow();
  });
});
