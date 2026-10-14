/** Next `sort` value when a column header is activated: ascending, then descending, then ascending again. */
export function nextSort(current: string | null | undefined, field: string): string {
  return current === field ? `-${field}` : field;
}

/** `aria-sort` value for a column given the current `sort` expression (first key only). */
export function ariaSort(
  current: string | null | undefined,
  field: string,
  defaultField: string,
): 'ascending' | 'descending' | 'none' {
  const effective = current && current.length > 0 ? current.split(',')[0] : defaultField;
  if (effective === field) return 'ascending';
  if (effective === `-${field}`) return 'descending';
  return 'none';
}

export type StatusFilter = 'active' | 'inactive' | 'all';

/** Maps the Active/Inactive/All filter to the API `isActive` parameter. */
export function isActiveParam(status: StatusFilter): boolean | undefined {
  return status === 'all' ? undefined : status === 'active';
}

export function parsePage(value: string | number | null | undefined): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

export function parseStatus(value: string | null | undefined): StatusFilter {
  return value === 'inactive' || value === 'all' ? value : 'active';
}
