import { Type, WritableSignal, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AuthStore } from '../../core/auth/auth.store';
import { Clock, USER_TIME_ZONE } from '../../core/time/clock';
import { FilterDef } from './filter-def';
import { ListFilters, ListFiltersOptions } from './list-filters';

/** Test helpers for the shared filter parts: a routed host page that owns a real `ListFilters` reading a real query string. */

export const DEMO_DEFS: FilterDef[] = [
  { key: 'name', label: 'Name', column: 'name', type: 'text' },
  {
    key: 'type',
    label: 'Type',
    column: 'type',
    type: 'select',
    allLabel: 'All types',
    options: [
      { value: '4', label: 'Document Set' },
      { value: '5', label: 'Source System' },
    ],
  },
  {
    key: 'priority',
    label: 'Priority',
    column: 'priority',
    type: 'multiSelect',
    options: [
      { value: '1', label: 'Critical' },
      { value: '2', label: 'High' },
    ],
  },
  {
    key: 'due',
    label: 'Due',
    column: 'due',
    type: 'dateRange',
    fromParam: 'dueFrom',
    toParam: 'dueTo',
  },
  {
    key: 'status',
    label: 'Status',
    column: 'status',
    type: 'select',
    default: 'active',
    options: [
      { value: 'active', label: 'Active' },
      { value: 'inactive', label: 'Inactive' },
      { value: 'all', label: 'All' },
    ],
  },
  {
    key: 'sensitive',
    label: 'Sensitive',
    type: 'triState',
    options: [
      { value: '', label: 'Any' },
      { value: 'true', label: 'Sensitive only' },
      { value: 'false', label: 'Not sensitive' },
    ],
  },
];

export const DEMO_COLUMNS = ['name', 'type', 'priority', 'due', 'status'];

export interface Mounted<H> {
  harness: RouterTestingHarness;
  host: H;
  filters: ListFilters;
  el: HTMLElement;
  router: Router;
  settle: () => Promise<void>;
  go: (url: string) => Promise<void>;
}

export interface MountOptions {
  url?: string;
  defs?: ListFiltersOptions['defs'];
  columns?: readonly string[] | null;
  narrow?: boolean;
  now?: string;
  zone?: string;
  options?: Partial<ListFiltersOptions>;
}

/** What the next `FiltersTestHost` is built with (set by `mountFilters`; a component template cannot be built at run time). */
const config: {
  defs: ListFiltersOptions['defs'];
  visible: WritableSignal<readonly string[] | null>;
  options: Partial<ListFiltersOptions>;
} = {
  defs: DEMO_DEFS,
  visible: signal(DEMO_COLUMNS),
  options: {},
};

/** Base class of a spec's host page: `@Component({ imports, template }) class Host extends FiltersTestHost {}`. */
export class FiltersTestHost {
  readonly filters = new ListFilters({
    screen: 'demo',
    noun: 'things',
    defs: config.defs,
    visibleColumns: config.visible,
    ...config.options,
  });
  readonly columns = DEMO_COLUMNS;
  /** Free slot for templates that record an event. */
  shown = '';
}

/** Mounts a spec's host page (routed at /list, so it reads a real query string) with a real `ListFilters`. */
export async function mountFilters<H extends FiltersTestHost>(
  Host: Type<H>,
  o: MountOptions = {},
): Promise<Mounted<H>> {
  config.defs = o.defs ?? DEMO_DEFS;
  config.visible = signal<readonly string[] | null>(
    o.columns === undefined ? DEMO_COLUMNS : o.columns,
  );
  config.options = o.options ?? {};
  localStorage.clear();
  originalMatchMedia ??= window.matchMedia;
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: () => ({
      matches: !!o.narrow,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: 'list', component: Host }]),
      { provide: AuthStore, useValue: { profile: signal({ userId: 5 }) } },
      { provide: Clock, useValue: { now: () => new Date(o.now ?? '2026-10-15T12:00:00Z') } },
      { provide: USER_TIME_ZONE, useValue: o.zone ?? 'UTC' },
    ],
  });
  const harness = await RouterTestingHarness.create();
  const host = await harness.navigateByUrl(o.url ?? '/list', Host);
  document.body.appendChild(harness.fixture.nativeElement);
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      harness.detectChanges();
      await harness.fixture.whenStable();
    }
    harness.detectChanges();
  };
  await settle();
  return {
    harness,
    host,
    filters: host.filters,
    el: harness.fixture.nativeElement as HTMLElement,
    router: TestBed.inject(Router),
    settle,
    go: async (url: string) => {
      await harness.navigateByUrl(url);
      await settle();
    },
  };
}

let originalMatchMedia: typeof window.matchMedia | undefined;

/** Call after each test (together with `vi.restoreAllMocks()` in the spec). */
export function cleanup(): void {
  if (originalMatchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: originalMatchMedia,
    });
  }
  document.body.querySelectorAll('mf-filter-popover').forEach((n) => n.remove());
  TestBed.resetTestingModule();
}
