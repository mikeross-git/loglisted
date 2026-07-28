export type AppErrorCode =
  | "VALIDATION_ERROR"
  | "AUTHORIZATION_ERROR"
  | "RATE_LIMITED"
  | "DUPLICATE_SUBMISSION"
  | "UNSUPPORTED_FILE"
  | "PARSING_FAILED"
  | "LLM_FAILED"
  | "COST_BUDGET_EXCEEDED"
  | "PROCESSING_CAPACITY_EXCEEDED";

export interface AppErrorOptions {
  cause?: unknown;
  details?: Readonly<Record<string, string | number | boolean>>;
}

export abstract class AppError extends Error {
  abstract readonly code: AppErrorCode;
  abstract readonly statusCode: number;
  readonly userMessage: string;
  readonly details: Readonly<Record<string, string | number | boolean>> | undefined;

  protected constructor(message: string, userMessage: string, options: AppErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.userMessage = userMessage;
    this.details = options.details;
  }
}

export class ValidationError extends AppError {
  readonly code = "VALIDATION_ERROR";
  readonly statusCode = 400;
  constructor(message: string, options?: AppErrorOptions) {
    super(message, "The submitted information is invalid.", options);
  }
}

export class AuthorizationError extends AppError {
  readonly code = "AUTHORIZATION_ERROR";
  readonly statusCode = 403;
  constructor(message = "Authorization failed.", options?: AppErrorOptions) {
    super(message, "This request is not authorized.", options);
  }
}

export class RateLimitError extends AppError {
  readonly code = "RATE_LIMITED";
  readonly statusCode = 429;
  constructor(message = "Rate limit exceeded.", options?: AppErrorOptions) {
    super(message, "Too many submissions. Please try again later.", options);
  }
}

export class DuplicateSubmissionError extends AppError {
  readonly code = "DUPLICATE_SUBMISSION";
  readonly statusCode = 409;
  constructor(message = "Duplicate submission.", options?: AppErrorOptions) {
    super(message, "This screenplay is already being processed.", options);
  }
}

export class UnsupportedFileError extends AppError {
  readonly code = "UNSUPPORTED_FILE";
  readonly statusCode = 415;
  constructor(message: string, options?: AppErrorOptions) {
    super(message, "The uploaded file is not a supported readable PDF.", options);
  }
}

export class ParsingFailureError extends AppError {
  readonly code = "PARSING_FAILED";
  readonly statusCode = 422;
  constructor(message: string, options?: AppErrorOptions) {
    super(message, "The screenplay could not be read.", options);
  }
}

export class LlmFailureError extends AppError {
  readonly code = "LLM_FAILED";
  readonly statusCode = 502;
  constructor(message: string, options?: AppErrorOptions) {
    super(message, "Scoring could not be completed.", options);
  }
}

export class CostBudgetError extends AppError {
  readonly code = "COST_BUDGET_EXCEEDED";
  readonly statusCode = 503;
  constructor(message: string, options?: AppErrorOptions) {
    super(message, "Scoring is temporarily unavailable.", options);
  }
}

export class ProcessingCapacityError extends AppError {
  readonly code = "PROCESSING_CAPACITY_EXCEEDED";
  readonly statusCode = 503;
  constructor(message: string, options?: AppErrorOptions) {
    super(message, "We're currently at processing capacity. Please try again later.", options);
  }
}
