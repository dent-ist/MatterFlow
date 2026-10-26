import { DestroyRef, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { ViewStateService } from '../../core/views/view-state.service';
import { ViewState, ViewSurface, mergeViewState } from '../../core/views/view-state';
import { MyMattersFocus } from './focus';

export type SectionDir = 'asc' | 'desc';

/** The task type filter and the sort of one My Matters section; the sort key is the API's (`''` = the section's own order). */
// A type alias (not an interface) so it satisfies the view state's string index signature.
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type SectionPref = {
  types: number[];
  sort: string;
  dir: SectionDir;
  /** The person chose "All types" while a Focus was set: this section ignores the Focus (PV-07). */
  allTypes: boolean;
};

export const DEFAULT_PREF: SectionPref = { types: [], sort: '', dir: 'asc', allTypes: false };

/** The sort choices of a section; the key is the API's `sort` value. */
export const SECTION_SORTS: readonly { value: string; label: string }[] = [
  { value: '', label: 'Default order' },
  { value: 'type', label: 'Task type' },
  { value: 'due', label: 'Due date' },
  { value: 'priority', label: 'Priority' },
  { value: 'matter', label: 'Matter' },
  { value: 'age', label: 'Age (oldest first)' },
];

const SORT_KEYS = new Set(SECTION_SORTS.map((s) => s.value));

/** A remembered state read defensively: anything malformed is dropped, never thrown. */
export function prefFromState(state: ViewState | null | undefined): Partial<SectionPref> {
  if (!state) return {};
  const out: Partial<SectionPref> = {};
  if (Array.isArray(state['types'])) {
    out.types = state['types'].filter((n): n is number => Number.isInteger(n) && n > 0);
  }
  if (typeof state['sort'] === 'string' && SORT_KEYS.has(state['sort'])) out.sort = state['sort'];
  if (state['dir'] === 'asc' || state['dir'] === 'desc') out.dir = state['dir'];
  if (typeof state['allTypes'] === 'boolean') out.allTypes = state['allTypes'];
  return out;
}

/** `?type=3&type=5` (or `type=3,5`) of the address; null when the address says nothing about types. */
export function typesFromAddress(values: readonly string[]): number[] | null {
  const ids = values
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter((v) => /^[1-9]\d*$/.test(v))
    .map(Number);
  return ids.length > 0 ? [...new Set(ids)] : null;
}

/**
 * The remembered filter and sort of one My Matters section (PM v2 #857). The state of the section is read from the browser cache at once (first
 * paint), then from the server (`dbo.UserView`, so it follows the person between computers), and every change is written back. The address wins:
 * an explicit `?type=` shows exactly those types until the person changes the filter themself. Call in an injection context.
 */
export function sectionPref(surface: ViewSurface, options: { sort: boolean }) {
  const views = inject(ViewStateService);
  const focus = inject(MyMattersFocus);
  focus.ensure();
  const route = inject(ActivatedRoute);
  const query = toSignal(route.queryParamMap, { initialValue: route.snapshot.queryParamMap });
  const stored = signal<SectionPref>(
    mergeViewState(DEFAULT_PREF, prefFromState(views.cached(surface)), null),
  );
  const touched = signal(false);
  let destroyed = false;
  inject(DestroyRef).onDestroy(() => {
    destroyed = true;
    void views.flush(surface);
  });

  void views.load(surface).then((state) => {
    if (destroyed || touched() || !state) return;
    stored.set(mergeViewState(DEFAULT_PREF, prefFromState(state), null));
  });

  const address = computed(() => typesFromAddress(query().getAll('type')));
  /** The section's own filter: the address, else what was remembered. Empty means "none of its own". */
  const own = computed<number[]>(() => (!touched() ? address() : null) ?? stored().types);
  /** The Focus applies where the section has no filter of its own and the person did not choose "All types" here. */
  const focused = computed(
    () => own().length === 0 && !stored().allTypes && focus.types().length > 0,
  );
  const value = computed<SectionPref>(() => {
    const base = stored();
    return {
      types: focused() ? focus.types() : own(),
      sort: options.sort ? base.sort : '',
      dir: base.dir,
      allTypes: base.allTypes,
    };
  });

  const update = (change: Partial<SectionPref>): void => {
    touched.set(true);
    const next = { ...stored(), types: own(), ...change };
    stored.set(next);
    views.save(surface, {
      types: next.types,
      sort: next.sort,
      dir: next.dir,
      allTypes: next.allTypes,
    });
  };
  // Choosing types makes the filter the section's own; choosing none while a Focus is set means "All types" here.
  const choose = (types: number[]): void =>
    update({ types, allTypes: types.length === 0 && focus.types().length > 0 });

  return {
    value,
    /** True while the types shown come from the address, not from the remembered state. */
    fromAddress: computed(() => !touched() && address() !== null),
    /** True while the types shown are the Focus (the section has no filter of its own). */
    focused,
    setTypes: choose,
    setSort: (sort: string) => update({ sort }),
    setDir: (dir: SectionDir) => update({ dir }),
    showAll: () => choose([]),
  };
}
