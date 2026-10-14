import { DestroyRef, inject } from '@angular/core';

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

/**
 * A function that runs `fn` once `ms` after its last call, so a list can search while the user types. Call in an injection context;
 * a pending call is dropped when the component is destroyed.
 */
export function debounced<A extends unknown[]>(fn: (...args: A) => void, ms = 350): (...args: A) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  inject(DestroyRef).onDestroy(() => clearTimeout(timer));
  return (...args: A) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
