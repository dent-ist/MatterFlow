import { ApiError } from '../../core/http/api-error';

/** Server validation outcome mapped for a form: one message per field plus whether it was a concurrency conflict. */
export interface ServerFormErrors {
  /** First message per DTO property (camelCase), for example `clientNumber`. */
  fields: Record<string, string>;
  /** True for 409 CONCURRENCY_CONFLICT: offer "Reload latest". */
  conflict: boolean;
  /** Short messages for the top summary (field messages, in order). */
  summary: string[];
  /** The error code, when the error is an ApiError. */
  code?: string;
}

const NONE: ServerFormErrors = { fields: {}, conflict: false, summary: [] };

/** Maps an error thrown by an API call to form errors. Non-API errors yield no field messages. */
export function serverFormErrors(err: unknown): ServerFormErrors {
  if (!(err instanceof ApiError)) return NONE;
  const fields: Record<string, string> = {};
  for (const [key, list] of Object.entries(err.problem?.errors ?? {})) {
    const first = list?.[0]?.message;
    if (first) fields[key] = first;
  }
  return {
    fields,
    conflict: err.code === 'CONCURRENCY_CONFLICT',
    summary: Object.values(fields),
    code: err.code,
  };
}

/** Reads a numeric id from `meta` on a problem (for example the existing duplicate), if present. */
export function metaNumber(err: unknown, key: string): number | null {
  if (!(err instanceof ApiError)) return null;
  const value = err.problem?.meta?.[key];
  return typeof value === 'number' ? value : null;
}
