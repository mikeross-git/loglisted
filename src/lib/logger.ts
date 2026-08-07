import { z } from "zod";
import { ValidationError } from "./errors.js";

const allowedFieldNames = new Set([
  "requestId",
  "submissionId",
  "uploadId",
  "jobId",
  "sessionHash",
  "networkHash",
  "fileHash",
  "fileSize",
  "pageCount",
  "textLength",
  "chunkCount",
  "chunkIndex",
  "sceneCount",
  "characterCount",
  "durationMs",
  "attempt",
  "count",
  "status",
  "errorCode",
  "version",
  "model",
  "environment",
  "costUsd",
  "inputTokens",
  "outputTokens",
  "warningCodes",
  "reasonCode",
  "providerStatus",
  "providerRequestId",
  "providerCode",
  "providerParam",
  "retryable",
  "processingStage",
  "errorClass",
  "promptVersion",
  "rubricVersion",
  "privacyConfigVersion",
]);

const SafeScalarSchema = z.union([
  z
    .string()
    .max(200)
    .regex(/^[A-Za-z0-9_.:@/-]+$/, "Log strings must be opaque identifiers or codes."),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
type SafeScalar = z.infer<typeof SafeScalarSchema>;
export type SafeLogFields = Readonly<Record<string, SafeScalar | readonly SafeScalar[]>>;

export interface LogEvent {
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  event: string;
  fields: SafeLogFields;
}

export type LogSink = (event: LogEvent) => void;

function validateFields(fields: SafeLogFields): void {
  for (const [key, value] of Object.entries(fields)) {
    if (!allowedFieldNames.has(key)) {
      throw new ValidationError(`Unapproved log field rejected: ${key}`);
    }
    const values = Array.isArray(value) ? value : [value];
    if (values.length > 50 || !values.every((item) => SafeScalarSchema.safeParse(item).success)) {
      throw new ValidationError(`Invalid log value rejected: ${key}`);
    }
    if (
      key === "fileHash" &&
      values.some((item) => typeof item !== "string" || !/^[a-f0-9]{64}$/.test(item))
    ) {
      throw new ValidationError("Invalid file hash rejected from log event.");
    }
  }
}

export class SafeLogger {
  constructor(private readonly sink: LogSink = (event) => console.log(JSON.stringify(event))) {}

  log(level: LogEvent["level"], event: string, fields: SafeLogFields = {}): void {
    if (!/^[a-z][a-z0-9_.-]{1,99}$/.test(event)) {
      throw new ValidationError("Invalid structured event name.");
    }
    validateFields(fields);
    this.sink({
      timestamp: new Date().toISOString(),
      level,
      event,
      fields,
    });
  }

  debug(event: string, fields?: SafeLogFields): void {
    this.log("debug", event, fields);
  }
  info(event: string, fields?: SafeLogFields): void {
    this.log("info", event, fields);
  }
  warn(event: string, fields?: SafeLogFields): void {
    this.log("warn", event, fields);
  }
  error(event: string, fields?: SafeLogFields): void {
    this.log("error", event, fields);
  }
}

export function sanitizedErrorFields(error: unknown): SafeLogFields {
  return {
    errorClass: error instanceof Error ? error.name.slice(0, 200) : "UnknownError",
    retryable: false,
  };
}
