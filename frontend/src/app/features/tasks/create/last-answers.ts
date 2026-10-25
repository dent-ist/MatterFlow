import type { FormDefinition, FormField } from 'form-engine';

/**
 * "Same as my last task of this type" (issue #819): which answers of an earlier task of the same type may be offered again.
 *
 * Only the answers a person gives by choosing from a short list (the Category, "What is driving the due date?") are offered: a list answer is
 * a decision the person made a minute ago for the same work, never text that could carry a name, a quote or privileged advice. Free text,
 * numbers, dates, check boxes (the privilege flags are check boxes or yes/no lists), people and assets are never copied, and neither is any
 * field whose key or label speaks of privilege, confidentiality, attorney work, legal hold or sensitivity, whatever its control. The
 * offer is a button the person presses and the page says what it filled; nothing is applied silently.
 */
const SENSITIVE_WORDS =
  /privileg|confidential|attorney|work[\s_-]*product|legal[\s_-]*hold|sensitiv|protected|secret|restricted/i;

/** Whether a field of the request form may be filled from an earlier task. */
export function isReusableField(field: FormField): boolean {
  if (field.control !== 'SELECT' && field.control !== 'RADIO') return false;
  return !SENSITIVE_WORDS.test(`${field.key} ${field.label ?? ''}`);
}

export interface ReusedAnswers {
  /** The values to put into the form, by field key (only keys of reusable fields whose option still exists). */
  values: Record<string, unknown>;
  /** The labels of the filled fields, in form order, for the sentence that says what was filled. */
  labels: string[];
}

/** The answers of `previous` that can be offered again for `definition`; none of it for a field that is not reusable or whose option was removed. */
export function reusableAnswers(
  definition: FormDefinition | null,
  previous: Record<string, unknown> | null | undefined,
): ReusedAnswers {
  const values: Record<string, unknown> = {};
  const labels: string[] = [];
  if (!definition || !previous || typeof previous !== 'object') return { values, labels };
  for (const field of definition.fields) {
    if (!isReusableField(field) || !(field.key in previous)) continue;
    const value = previous[field.key];
    if (typeof value !== 'string' || value === '') continue;
    if (!(field.options ?? []).some((o) => o.key === value)) continue;
    values[field.key] = value;
    labels.push(field.label ?? field.key);
  }
  return { values, labels };
}
