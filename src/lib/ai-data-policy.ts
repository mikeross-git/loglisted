import { z } from "zod";
import { ValidationError } from "./errors.js";

export const AiDataPolicySchema = z
  .object({
    piiRedactionEnabled: z.boolean(),
    rawPdfPersistenceEnabled: z.literal(false),
    rawTextPersistenceEnabled: z.literal(false),
    contentLoggingEnabled: z.literal(false),
    privacyConfigVersion: z.string().min(1),
  })
  .strict();

export type AiDataPolicy = z.infer<typeof AiDataPolicySchema>;

const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;
const urlPattern = /\b(?:https?:\/\/|www\.)[a-z0-9][a-z0-9.-]*(?:\.[a-z]{2,})(?:\/[^\s]*)?/giu;
const socialPattern = /(^|\s)@[a-z0-9_]{2,30}\b/giu;
const usPhonePattern = /(?<!\d)(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}(?!\d)/g;
const internationalPhonePattern = /(?<!\w)\+\d{1,3}(?:[\s.-]?\d){7,14}(?!\d)/g;
const streetAddressPattern =
  /\b\d{1,6}\s+[A-Z0-9][A-Z0-9 .'-]{2,60}\s(?:ST(?:REET)?|AVE(?:NUE)?|RD|ROAD|BLVD|BOULEVARD|LN|LANE|DR|DRIVE|WAY|COURT|CT|PLACE|PL)\b[^\n]*/giu;
const contactLinePattern =
  /^(?:(?:writer|contact|agent|manager|management|representation|represented by|phone|email|website)\s*:?).*$/gimu;

export interface RedactedModelText {
  originalExtractedText: string;
  redactedModelText: string;
  redactedTextByPage: string[];
  titlePageContactDetected: boolean;
}

function redactWriterCredit(text: string): { text: string; detected: boolean } {
  let detected = false;
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const inline = /^(\s*(?:written|screenplay|teleplay)\s+by\s+)(.+)$/i.exec(line);
    if (inline?.[2]?.trim()) {
      lines[index] = `${inline[1]}[WRITER]`;
      detected = true;
      continue;
    }
    if (/^\s*(?:written|screenplay|teleplay)\s+by\s*$/i.test(line)) {
      const next = lines[index + 1];
      if (next?.trim()) {
        lines[index + 1] = "[WRITER]";
        detected = true;
      }
    }
  }
  return { text: lines.join("\n"), detected };
}

const screenplayStartPattern =
  /^(?:FADE\s+IN|(?:INT|EXT|INT\/EXT|I\/E)\.?\s+|ACT\s+(?:ONE|1)|TEASER|COLD\s+OPEN)\b/imu;

function redactTitlePage(page: string): {
  text: string;
  detected: boolean;
  screenplayStarted: boolean;
} {
  const boundary = screenplayStartPattern.exec(page);
  const prefix = boundary ? page.slice(0, boundary.index) : page;
  const screenplay = boundary ? page.slice(boundary.index) : "";
  page = prefix;
  let detected = false;
  const replace = (pattern: RegExp, replacement: string) => {
    page = page.replace(pattern, () => {
      detected = true;
      return replacement;
    });
  };
  const writer = redactWriterCredit(page);
  page = writer.text;
  detected ||= writer.detected;
  replace(emailPattern, "[EMAIL]");
  replace(usPhonePattern, "[PHONE]");
  replace(internationalPhonePattern, "[PHONE]");
  replace(streetAddressPattern, "[ADDRESS]");
  replace(urlPattern, "[WEBSITE]");
  const socialBefore = page;
  page = page.replace(socialPattern, "$1[SOCIAL]");
  detected ||= page !== socialBefore;
  replace(contactLinePattern, "[CONTACT]");
  return { text: `${page}${screenplay}`, detected, screenplayStarted: Boolean(boundary) };
}

export function redactTitlePagePii(
  originalExtractedText: string,
  textByPage: readonly string[],
): RedactedModelText {
  if (!textByPage.length) throw new ValidationError("Extracted screenplay pages are required.");
  const redactedTextByPage = [...textByPage];
  let detected = false;
  let screenplayStarted = false;
  for (let index = 0; index < Math.min(2, redactedTextByPage.length); index += 1) {
    if (screenplayStarted) break;
    const redacted = redactTitlePage(redactedTextByPage[index] ?? "");
    redactedTextByPage[index] = redacted.text;
    detected ||= redacted.detected;
    screenplayStarted ||= redacted.screenplayStarted;
  }
  return {
    originalExtractedText,
    redactedModelText: redactedTextByPage.join("\n\n"),
    redactedTextByPage,
    titlePageContactDetected: detected,
  };
}

const forbiddenPromptKeys = new Set([
  "rawip",
  "hashedip",
  "deviceid",
  "anonymoussessionid",
  "riskscore",
  "ratelimithistory",
  "uploadhistory",
  "writeremail",
  "writerphone",
  "mailingaddress",
  "imdbprofile",
  "representationinformation",
  "externalcontestscores",
  "priorblacklistscores",
]);

export function assertMinimizedLlmPayload(payload: unknown): void {
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    for (const [key, nested] of Object.entries(value)) {
      const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (forbiddenPromptKeys.has(normalized)) {
        throw new ValidationError("Forbidden operational or identity metadata in LLM payload.");
      }
      visit(nested);
    }
  };
  visit(payload);
}
