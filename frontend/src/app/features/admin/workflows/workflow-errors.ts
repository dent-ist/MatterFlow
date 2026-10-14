import { ApiError } from '../../../core/http/api-error';
import { ServerFormErrors, serverFormErrors } from '../../../shared/forms/api-errors';

export interface WorkflowErrors extends ServerFormErrors {
  /** Messages for the alert at the top: field messages, else the server's own message, else a generic one. */
  messages: string[];
}

/**
 * Maps a failed workflow call to messages for the page. Validation failures such as "a workflow needs at least one step"
 * come back as field errors or as the problem detail; both are shown inline. Everything else gets the generic message.
 */
export function workflowErrors(err: unknown, fallback: string): WorkflowErrors {
  const base = serverFormErrors(err);
  if (base.summary.length > 0) return { ...base, messages: base.summary };
  if (base.conflict) return { ...base, messages: [] };
  if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.problem?.detail) {
    return { ...base, messages: [err.problem.detail] };
  }
  return { ...base, messages: [fallback] };
}
