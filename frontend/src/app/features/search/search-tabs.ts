import { SearchGroup } from '../../api/generated/api-client';
import { SearchType, SearchTypeInfo, formatTotal } from '../../shared/search/search-meta';
import { MfTab } from '../../shared/ui/tabs';
import { PAGE_SIZES } from '../../shared/ui/list-query';

/** The key of the tab that holds every type (the default; an old `/search?q=` link opens it). */
export const ALL_TAB = 'all';

export type SearchTabKey = typeof ALL_TAB | SearchType;

export { formatTotal };

/** The count a tab announces ("24 results", "1,000 or more results"). */
function spoken(total: number, capped: boolean): string {
  const n = total.toLocaleString('en-US');
  if (capped) return `${n} or more results`;
  return total === 1 ? '1 result' : `${n} results`;
}

/**
 * The tabs of the results page, in the order of the review: All, then Matters, Clients, Tasks, Projects, Assets, only the types the person
 * may view. A type with no hits keeps its tab (a zero is an answer, not a missing tab). While the totals are not known the count reads `--`.
 * The All count is the sum of the types; it carries the `+` when any type was capped.
 */
export function resultTabs(
  types: readonly SearchTypeInfo[],
  groups: readonly SearchGroup[] | null,
): MfTab[] {
  const unknown = (label: string): MfTab => ({ key: '', label, count: '--' });
  if (!groups) {
    return [
      { ...unknown('All'), key: ALL_TAB },
      ...types.map((t) => ({ ...unknown(t.label), key: t.type })),
    ];
  }
  const byType = new Map(groups.map((g) => [g.type, g]));
  const counted = types.map((t) => {
    const g = byType.get(t.type);
    return { info: t, total: g?.total ?? 0, capped: g?.totalCapped ?? false };
  });
  const sum = counted.reduce((n, c) => n + c.total, 0);
  const anyCapped = counted.some((c) => c.capped);
  const tab = (key: string, label: string, total: number, capped: boolean): MfTab => ({
    key,
    label,
    count: formatTotal(total, capped),
    name: `${label}, ${spoken(total, capped)}`,
  });
  return [
    tab(ALL_TAB, 'All', sum, anyCapped),
    ...counted.map((c) => tab(c.info.type, c.info.label, c.total, c.capped)),
  ];
}

/**
 * The tab a `type` value opens: a type the person may view opens its tab, anything else (missing, unknown, a type they may not view, a
 * repeated parameter) falls back to All, like a denied tab of the Task Types pages.
 */
export function resolveTab(
  raw: string | undefined,
  types: readonly SearchTypeInfo[],
): SearchTabKey {
  const type = types.find((t) => t.type === raw);
  return type ? type.type : ALL_TAB;
}

/** A positive whole page number from the address; anything else is page 1. */
export function parsePage(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/** A page size from the address: one of the list sizes, else the first. */
export function parsePageSize(raw: string | undefined): number {
  const n = Number(raw);
  return (PAGE_SIZES as readonly number[]).includes(n) ? n : PAGE_SIZES[0];
}
