import { ParamMap } from '@angular/router';
import { FilterDef, FilterOption } from '../../shared/filters/filter-def';

/**
 * The Technician's Summary (UX review 2, S9): `Dashboard.ViewUnassigned` without `Dashboard.ViewSummary` sees the unassigned queue alone, titled
 * "Unassigned work", with the page Scope (P1), a Priority filter and a Task type filter built from the column-filter foundation, and a line about
 * their own work. The filters live in the address as `sprio` and `stype` (comma lists; repeated parameters are read too) and are applied by the
 * Task Queue itself (`priority`, `type`), so the count and "Showing N of M" are the Task Queue's for the same filter.
 */
export const TECH_PRIORITY_PARAM = 'sprio';
export const TECH_TYPE_PARAM = 'stype';
export const TECH_PARAMS: readonly string[] = [TECH_PRIORITY_PARAM, TECH_TYPE_PARAM];

/** The page heading of the unassigned-only Summary. */
export const TECH_HEADING = 'Unassigned work';

const asId = (v: string): string | null => (/^[1-9]\d{0,8}$/.test(v) ? v : null);

/** The positive ids an address parameter names (a comma list or repeated), in order, without duplicates; anything else is dropped. */
export function techIds(params: ParamMap, name: string): string[] {
  const out: string[] = [];
  for (const raw of params.getAll(name)) {
    for (const part of raw.split(',')) {
      const id = asId(part.trim());
      if (id && !out.includes(id)) out.push(id);
    }
  }
  return out;
}

/** The Task Queue query terms for the filters of the address (`priority=1&type=3`), or '' when there are none. */
export function techFilterQuery(params: ParamMap): string {
  return [
    ...techIds(params, TECH_PRIORITY_PARAM).map((id) => `priority=${id}`),
    ...techIds(params, TECH_TYPE_PARAM).map((id) => `type=${id}`),
  ].join('&');
}

/** A Task Queue query with the technician's filters added. */
export function withTechFilters(query: string, params: ParamMap): string {
  return [query, techFilterQuery(params)].filter(Boolean).join('&');
}

/** Whether the address carries any technician filter. */
export function hasTechFilters(params: ParamMap): boolean {
  return techFilterQuery(params) !== '';
}

/** The two filter definitions: the same kind of multi-select the Task Queue columns use, with the address names of S9. */
export function techFilterDefs(
  priorities: readonly FilterOption[],
  types: readonly FilterOption[],
): FilterDef[] {
  return [
    {
      key: TECH_PRIORITY_PARAM,
      label: 'Priority',
      type: 'multiSelect',
      options: priorities,
      normalize: asId,
      commaList: true,
      emptyLabel: 'All',
    },
    {
      key: TECH_TYPE_PARAM,
      label: 'Task type',
      type: 'multiSelect',
      options: types,
      normalize: asId,
      commaList: true,
      emptyLabel: 'All',
    },
  ];
}

/** "You have 6 open, 1 overdue." (neutral wording: no ranking, no comparison). */
export function ownWorkText(open: number, overdue: number): string {
  return `You have ${open} open, ${overdue} overdue.`;
}
