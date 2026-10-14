import { HttpErrorResponse } from '@angular/common/http';

/** RFC 9457 problem details as produced by the API (architecture section 11). */
export interface ProblemDetails {
  type?: string;
  title?: string;
  status?: number;
  code?: string;
  detail?: string;
  traceId?: string;
  errors?: Record<string, { code: string; message: string }[]>;
  meta?: Record<string, unknown>;
}

/** Typed error the HTTP layer throws for every failed request. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
    readonly problem: ProblemDetails | undefined,
    readonly response: HttpErrorResponse,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get traceId(): string | undefined {
    return this.problem?.traceId;
  }

  /** Field-level validation errors present (the form maps these; no global toast). */
  get hasFieldErrors(): boolean {
    return !!this.problem?.errors && Object.keys(this.problem.errors).length > 0;
  }

  /** Network failure / proxy down (status 0). */
  get isNetworkError(): boolean {
    return this.status === 0;
  }

  static from(error: HttpErrorResponse): ApiError {
    const body: unknown = error.error;
    const problem =
      body && typeof body === 'object' && !(body instanceof Blob) && !(body instanceof ArrayBuffer)
        ? (body as ProblemDetails)
        : undefined;
    const message = problem?.detail ?? problem?.title ?? error.message;
    return new ApiError(error.status, problem?.code, message, problem, error);
  }
}
