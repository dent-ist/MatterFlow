import { DEFAULT_STATUS_LABELS, StatusCode } from '../../core/lookups/lookup-store';
import type { SearchType } from '../../shared/search/search-meta';

/**
 * The filters of the results page (Search review S6; #474, #475, #476), written as data: which filters each record type offers, how they read
 * from and write to the address (URL keys are named like the parameters of `GET /search/advanced`), how they map to the API call and how a chip
 * reads. The page and `mf-search-filters` hold no per-type knowledge. Parity with the retired Advanced search page: Clients (Status), Matters
 * (Client, Status, Sensitive), Projects (Matter, Status), Tasks (Task status, Client, Matter, Requestor), Assets (Matter, Asset type, Status).
 * Search deliberately does not default to Active: Status offers Any (the default), Active and Inactive, so a closed matter is found.
 */
export type FilterKind =
  'client' | 'matter' | 'assetType' | 'active' | 'sensitive' | 'status' | 'requestor';

/** The filters of each type, in the order the panel shows them. */
export const TYPE_FILTERS: Readonly<Record<SearchType, readonly FilterKind[]>> = {
  client: ['active'],
  matter: ['client', 'active', 'sensitive'],
  project: ['matter', 'active'],
  task: ['client', 'matter', 'status', 'requestor'],
  asset: ['matter', 'assetType', 'active'],
};

/** Every URL key a filter may use; a tab change drops all of them. */
export const FILTER_KEYS: readonly FilterKind[] = [
  'client',
  'matter',
  'assetType',
  'active',
  'sensitive',
  'status',
  'requestor',
];

export const FILTER_LABELS: Readonly<Record<FilterKind, string>> = {
  client: 'Client',
  matter: 'Matter',
  assetType: 'Asset type',
  active: 'Status',
  sensitive: 'Sensitive matter',
  status: 'Task status',
  requestor: 'Requestor',
};

export type Tri = 'any' | 'true' | 'false';

export const ACTIVE_OPTIONS: readonly { value: Tri; label: string }[] = [
  { value: 'any', label: 'Any' },
  { value: 'true', label: 'Active' },
  { value: 'false', label: 'Inactive' },
];

export const SENSITIVE_OPTIONS: readonly { value: Tri; label: string }[] = [
  { value: 'any', label: 'Any' },
  { value: 'true', label: 'Sensitive only' },
  { value: 'false', label: 'Not sensitive' },
];

export const STATUS_CODES = Object.keys(DEFAULT_STATUS_LABELS) as StatusCode[];

/** The longest requestor text the API takes, and the shortest that is worth a request. */
export const REQUESTOR_MAX = 200;
export const REQUESTOR_MIN = 2;

export interface SearchFilterValues {
  client: number | null;
  matter: number | null;
  assetType: number | null;
  active: Tri;
  sensitive: Tri;
  status: string[];
  requestor: string;
}

export const NO_FILTERS: SearchFilterValues = {
  client: null,
  matter: null,
  assetType: null,
  active: 'any',
  sensitive: 'any',
  status: [],
  requestor: '',
};

/** What the page reads from the address: one raw value per key. */
export type RawFilters = Partial<Record<FilterKind, string | string[] | undefined | null>>;

const tri = (value: unknown): Tri => (value === 'true' || value === 'false' ? value : 'any');

const toId = (value: unknown): number | null => {
  const n = Number(value);
  return typeof value === 'string' && value !== '' && Number.isInteger(n) && n > 0 ? n : null;
};

const asList = (value: string | string[] | undefined | null): string[] =>
  (Array.isArray(value) ? value : value ? [value] : [])
    .flatMap((v) => v.split(','))
    .filter((v) => v);

/** The filters of `type` from the address; a filter the type does not offer is dropped, an invalid value reads as "no filter". */
export function readFilters(type: SearchType, raw: RawFilters): SearchFilterValues {
  const offers = (kind: FilterKind) => TYPE_FILTERS[type].includes(kind);
  const requestor = typeof raw.requestor === 'string' ? raw.requestor.trim() : '';
  return {
    client: offers('client') ? toId(raw.client) : null,
    matter: offers('matter') ? toId(raw.matter) : null,
    assetType: offers('assetType') ? toId(raw.assetType) : null,
    active: offers('active') ? tri(raw.active) : 'any',
    sensitive: offers('sensitive') ? tri(raw.sensitive) : 'any',
    status: offers('status')
      ? asList(raw.status).filter((c) => (STATUS_CODES as string[]).includes(c))
      : [],
    requestor: offers('requestor') ? requestor.slice(0, REQUESTOR_MAX) : '',
  };
}

/** The URL parameters that write `values` (every filter key, `null` removing the ones that are not set). */
export function filterParams(
  values: SearchFilterValues,
): Record<FilterKind, string | string[] | null> {
  return {
    client: values.client === null ? null : String(values.client),
    matter: values.matter === null ? null : String(values.matter),
    assetType: values.assetType === null ? null : String(values.assetType),
    active: values.active === 'any' ? null : values.active,
    sensitive: values.sensitive === 'any' ? null : values.sensitive,
    status: values.status.length > 0 ? values.status : null,
    requestor: values.requestor === '' ? null : values.requestor,
  };
}

/** All filter keys cleared: the parameters of a tab change or "Clear filters". */
export const CLEARED_PARAMS: Record<FilterKind, null> = {
  client: null,
  matter: null,
  assetType: null,
  active: null,
  sensitive: null,
  status: null,
  requestor: null,
};

/** The Advanced API call's filter arguments. A requestor shorter than the minimum is not sent (typing it is not a filter yet). */
export function apiArgs(values: SearchFilterValues) {
  return {
    client: values.client ?? undefined,
    matter: values.matter ?? undefined,
    assetType: values.assetType ?? undefined,
    active: values.active === 'any' ? undefined : values.active === 'true',
    sensitive: values.sensitive === 'any' ? undefined : values.sensitive === 'true',
    status: values.status.length > 0 ? values.status : undefined,
    requestor: values.requestor.length >= REQUESTOR_MIN ? values.requestor : undefined,
  };
}

/** The filters that limit the result (a requestor under the minimum does not count: it is not sent). */
export function activeKinds(type: SearchType, values: SearchFilterValues): FilterKind[] {
  const args = apiArgs(values);
  return TYPE_FILTERS[type].filter((kind) => args[kind] !== undefined);
}

/** A chip: its label, and the values that remain once it is removed. */
export interface FilterChip {
  kind: FilterKind;
  label: string;
}

/** Names for the chips of record filters (the id is all the address holds). */
export interface ChipNames {
  client?: (id: number) => string;
  matter?: (id: number) => string;
  assetType?: (id: number) => string;
  statusLabel?: (code: string) => string;
}

export function filterChips(
  type: SearchType,
  values: SearchFilterValues,
  names: ChipNames = {},
): FilterChip[] {
  const text = (kind: FilterKind): string => {
    switch (kind) {
      case 'client':
        return names.client?.(values.client!) ?? `Client ${values.client}`;
      case 'matter':
        return names.matter?.(values.matter!) ?? `Matter ${values.matter}`;
      case 'assetType':
        return names.assetType?.(values.assetType!) ?? `Type ${values.assetType}`;
      case 'active':
        return ACTIVE_OPTIONS.find((o) => o.value === values.active)!.label;
      case 'sensitive':
        return SENSITIVE_OPTIONS.find((o) => o.value === values.sensitive)!.label;
      case 'status':
        return values.status
          .map((c) => names.statusLabel?.(c) ?? DEFAULT_STATUS_LABELS[c as StatusCode] ?? c)
          .join(', ');
      case 'requestor':
        return values.requestor;
    }
  };
  return activeKinds(type, values).map((kind) => ({
    kind,
    label: `${FILTER_LABELS[kind]}: ${text(kind)}`,
  }));
}

/** `values` with one filter put back to "no filter" (a chip removed). */
export function withoutFilter(values: SearchFilterValues, kind: FilterKind): SearchFilterValues {
  return { ...values, [kind]: NO_FILTERS[kind] };
}
