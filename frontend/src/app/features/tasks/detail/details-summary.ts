import { TaskResponse } from '../../../api/generated/api-client';

/** True for a request-form value a person filled in: not null, not blank text, not an empty list or object. */
function filled(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as object).length > 0;
  return true;
}

/** How many request-form fields of the Task have a value. */
export function requestFieldCount(task: Pick<TaskResponse, 'formValues'>): number {
  const values = (task.formValues ?? {}) as Record<string, unknown>;
  return Object.values(values).filter(filled).length;
}

/**
 * The one line that tells what a closed Details holds (#307): `Requestor Dana W-M  .  14 request fields`. The requestor is the first
 * thing the Details panel shows; the count is what lies behind the disclosure. Either part is left out when there is nothing to say.
 */
export function detailsSummary(
  task: Pick<TaskResponse, 'requestorName' | 'formValues'> | null,
): string {
  if (!task) return '';
  const parts: string[] = [];
  const who = task.requestorName?.trim();
  if (who) parts.push(`Requestor ${who}`);
  const n = requestFieldCount(task);
  if (n > 0) parts.push(`${n} request ${n === 1 ? 'field' : 'fields'}`);
  return parts.join(' · ');
}
