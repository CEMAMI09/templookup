export type ErrorCode =
  | "VALIDATION"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "POSSIBLE_DUPLICATE"
  | "CRM_AUTH"
  | "CRM_FORBIDDEN"
  | "CRM_RATE_LIMIT"
  | "CRM_UNAVAILABLE"
  | "CRM_WRITE_FAILED";

export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly fields?: Record<string, string>;
  readonly matches?: unknown;
  readonly logDetail?: string;

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    options?: {
      fields?: Record<string, string>;
      matches?: unknown;
      logDetail?: string;
    },
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = options?.fields;
    this.matches = options?.matches;
    this.logDetail = options?.logDetail;
  }
}

export function publicError(error: AppError) {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.fields ? { fields: error.fields } : {}),
      ...(error.matches ? { matches: error.matches } : {}),
    },
  };
}
