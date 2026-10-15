import { DestroyRef, Signal, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { AuthStore } from '../../core/auth/auth.store';
import { readFlag, writeFlag } from '../ui/column-filters';
import {
  FilterChip,
  FilterDef,
  FilterValue,
  FilterValues,
  QueryParams,
  buildChips,
  defaultValue,
  hasFilterParams,
  isActive,
  isEmpty,
  paramsOf,
  parseFilters,
  printText,
  serializeFilters,
  serializeValue,
} from './filter-def';

export interface ListFiltersOptions {
  /** The screen's filters. A signal lets options and labels follow data that loads later. */
  readonly defs: readonly FilterDef[] | Signal<readonly FilterDef[]>;
  /** Screen name for the remembered open state: `mf.<screen>.filters.open.<userId>` in localStorage. */
  readonly screen: string;
  /** Start with the filter row open when nothing is remembered (Task Queue, My Work, Pod Work). */
  readonly openByDefault?: boolean;
  /** Keys of the columns on screen; a filter on any other column keeps working and shows as a chip. Omit when all columns show. */
  readonly visibleColumns?: Signal<readonly string[] | null>;
  /** Plural noun for the live region ("assets"); results are announced as "23 results" when omitted. */
  readonly noun?: string;
}

/** Below this width (and when the grid overflows sideways) the filter row becomes a sheet. */
export const SHEET_QUERY = '(max-width: 767px)';

/**
 * The URL/state helper behind every filtered grid. THE URL IS THE SOURCE OF TRUTH: values are read from the query string, every change
 * is written back (and resets `page`), defaults are visible but never written or counted, and a plain link (no filter parameter) is
 * never silently filtered by anything the helper remembers. Create it in an injection context (a routed page):
 *
 *   readonly filters = new ListFilters({ defs: DEFS, screen: 'assets' });
 *
 * It also owns the UI state around the row: open or closed (remembered per screen and user), sheet mode (narrow window or overflowing
 * grid), the "Restored your last view" notice, the result announcement for the live region and the print line.
 */
export class ListFilters {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthStore, { optional: true });
  private readonly destroyRef = inject(DestroyRef);

  readonly defs: Signal<readonly FilterDef[]>;
  readonly screen: string;
  private readonly openByDefault: boolean;
  private readonly visible: Signal<readonly string[] | null>;
  private readonly noun: string;

  /** The query string (always current, also for the first render). */
  readonly params: Signal<ParamMap>;
  /** Every filter's value. */
  readonly values: Signal<FilterValues>;
  /** Number of active filters: a default is not counted; a disabled (tab-owned) filter is not counted either. */
  readonly activeCount: Signal<number>;
  /** One chip per active value. */
  readonly chips: Signal<readonly FilterChip[]>;
  /** The chips of filters on hidden columns (or without a column): they stay visible whatever the row does. */
  readonly hiddenChips: Signal<readonly FilterChip[]>;
  /** Filters without a control in the row (hidden column, no column), for the "More filters" menu. */
  readonly moreDefs: Signal<readonly FilterDef[]>;
  /** The line printed above a filtered grid, or '' when nothing limits it. */
  readonly printLine: Signal<string>;
  /** Whether the URL carries any filter parameter (a deep link) rather than a plain link. */
  readonly isDeepLink: Signal<boolean>;

  // ---- UI state
  readonly open = signal(false);
  readonly sheetOpen = signal(false);
  private readonly narrow = signal(false);
  private readonly overflowing = signal(false);
  /** True below 768 px or when the grid overflows sideways: the controls live in the sheet and chips always show. */
  readonly sheetMode = computed(() => this.narrow() || this.overflowing());
  /** The filter row is on screen (open and not in sheet mode). */
  readonly rowVisible = computed(() => this.open() && !this.sheetMode());
  /** The Filters button's pressed state: the row, or the sheet. */
  readonly toggleOpen = computed(() => (this.sheetMode() ? this.sheetOpen() : this.open()));

  /** "Restored your last view": set by a page that applied a remembered view to a plain link. */
  readonly restored = signal(false);
  /** Text for the polite live region; empty until a filter change has loaded. */
  readonly announcement = signal('');
  readonly resultTotal = signal<number | null>(null);

  private storageKey: string;
  private announced: string | null = null;
  private flip = false;

  constructor(options: ListFiltersOptions) {
    this.screen = options.screen;
    this.openByDefault = options.openByDefault ?? false;
    this.noun = options.noun ?? 'results';
    this.visible = options.visibleColumns ?? signal(null);
    const defs = options.defs;
    this.defs = typeof defs === 'function' ? defs : signal(defs);
    this.storageKey = `mf.${this.screen}.filters.open`;

    this.params = toSignal(this.route.queryParamMap, {
      initialValue: this.route.snapshot.queryParamMap,
    });
    this.values = computed(() => parseFilters(this.defs(), this.params()));

    const enabled = (def: FilterDef) => !def.disabledReason?.();
    this.activeCount = computed(() => {
      const v = this.values();
      return this.defs().filter((d) => enabled(d) && isActive(d, v[d.key] ?? defaultValue(d)))
        .length;
    });
    this.chips = computed(() => {
      const v = this.values();
      const cols = this.visible();
      return this.defs()
        .filter(enabled)
        .flatMap((d) =>
          buildChips(
            d,
            v[d.key] ?? defaultValue(d),
            !!d.column && !!cols && !cols.includes(d.column),
          ),
        );
    });
    this.hiddenChips = computed(() =>
      this.chips().filter((c) => c.hiddenColumn || this.def(c.defKey)?.column === undefined),
    );
    this.moreDefs = computed(() => {
      const cols = this.visible();
      return this.defs().filter(
        (d) => !d.noControl && (!d.column || (!!cols && !cols.includes(d.column))),
      );
    });
    this.printLine = computed(() => {
      const v = this.values();
      const parts = this.defs()
        .filter((d) => enabled(d) && !isEmpty(v[d.key] ?? defaultValue(d)))
        .map((d) => printText(d, v[d.key]));
      return parts.length > 0 ? `Filters: ${parts.join(', ')}` : '';
    });
    this.isDeepLink = computed(() => hasFilterParams(this.defs(), this.params()));

    // The open state is remembered per user; the row also opens by itself when the address carries active filters.
    this.open.set(readFlag(this.storageKey, this.openByDefault));
    effect(() => {
      const userId = this.auth?.profile()?.userId;
      untracked(() => {
        this.storageKey = userId
          ? `mf.${this.screen}.filters.open.${userId}`
          : `mf.${this.screen}.filters.open`;
        if (readFlag(this.storageKey, this.openByDefault)) this.open.set(true);
      });
    });
    // A link that carries filters (or a change from none to some) shows them in the row. Removing chips never re-opens a closed row.
    let before = 0;
    effect(() => {
      const count = this.activeCount();
      untracked(() => {
        if (count > 0 && before === 0) this.open.set(true);
        before = count;
      });
    });

    this.watchViewport();
  }

  // ---- reading

  def(key: string): FilterDef | undefined {
    return this.defs().find((d) => d.key === key);
  }

  /** The current value of a filter (its default when the URL says nothing). */
  value(key: string): FilterValue {
    const def = this.def(key);
    return this.values()[key] ?? (def ? defaultValue(def) : '');
  }

  text(key: string): string {
    const v = this.value(key);
    return typeof v === 'string' ? v : '';
  }

  list(key: string): readonly string[] {
    const v = this.value(key);
    return Array.isArray(v) ? v : [];
  }

  /** The filters as query parameters (defaults omitted): useful for links to the same list. */
  queryParams(): QueryParams {
    return serializeFilters(this.defs(), this.values());
  }

  isDisabled(def: FilterDef): string | null {
    return def.disabledReason?.() ?? null;
  }

  // ---- writing (always to the URL)

  /** Sets one filter. Resets the page. Typing (`replace`) rewrites the current history entry so Back is not flooded. */
  set(key: string, value: FilterValue, options: { replace?: boolean } = {}): void {
    const def = this.def(key);
    if (!def) return;
    this.write({ ...serializeValue(def, value) }, options.replace);
  }

  /** Sets several filters at once; the listed keys only. */
  setMany(
    values: Readonly<Record<string, FilterValue>>,
    options: { replace?: boolean } = {},
  ): void {
    const params: QueryParams = {};
    for (const def of this.defs()) {
      if (def.key in values) Object.assign(params, serializeValue(def, values[def.key]));
    }
    this.write(params, options.replace);
  }

  /** Replaces every filter with a preset (the listed ones) and the defaults (the rest): quick views. */
  applyPreset(values: Readonly<Record<string, FilterValue>>): void {
    const full: Record<string, FilterValue> = {};
    for (const def of this.defs()) full[def.key] = values[def.key] ?? defaultValue(def);
    this.restored.set(false);
    this.write(serializeFilters(this.defs(), full));
  }

  /** Removes one chip: the filter keeps the other values (or returns to its default). */
  removeChip(chip: FilterChip): void {
    this.set(chip.defKey, chip.remaining);
  }

  /** Clear filters: back to the screen's DEFAULTS (Status Active), not to nothing. `also` names legacy parameters to drop too. */
  clear(also: readonly string[] = []): void {
    const params: QueryParams = {};
    for (const def of this.defs()) for (const p of paramsOf(def)) params[p] = null;
    for (const p of also) params[p] = null;
    this.restored.set(false);
    this.write(params);
  }

  private write(params: QueryParams, replace?: boolean): void {
    void this.router.navigate([], {
      queryParams: { ...params, page: null },
      queryParamsHandling: 'merge',
      ...(replace ? { replaceUrl: true } : {}),
    });
  }

  // ---- open state, sheet, viewport

  toggle(): void {
    if (this.sheetMode()) {
      this.sheetOpen.update((v) => !v);
      return;
    }
    const open = !this.open();
    this.open.set(open);
    writeFlag(this.storageKey, open);
  }

  /** Opens the row (or the sheet) without remembering it: used by "/" and "Show filter" actions. */
  reveal(): void {
    if (this.sheetMode()) this.sheetOpen.set(true);
    else this.open.set(true);
  }

  closeSheet(): void {
    this.sheetOpen.set(false);
  }

  /** Call with the grid's scroll area: the controls move to the sheet while the grid scrolls sideways. */
  watchOverflow(area: HTMLElement | null | undefined): void {
    if (!area || typeof ResizeObserver !== 'function') return;
    const table = area.querySelector('table');
    const check = () => this.overflowing.set(area.scrollWidth > area.clientWidth + 1);
    const observer = new ResizeObserver(check);
    observer.observe(area);
    if (table) observer.observe(table);
    this.destroyRef.onDestroy(() => observer.disconnect());
    check();
  }

  private watchViewport(): void {
    if (typeof matchMedia !== 'function') return;
    const query = matchMedia(SHEET_QUERY);
    const update = () => this.narrow.set(query.matches);
    update();
    query.addEventListener?.('change', update);
    this.destroyRef.onDestroy(() => query.removeEventListener?.('change', update));
    effect(() => {
      if (!this.sheetMode()) this.sheetOpen.set(false);
    });
  }

  // ---- last view notice

  /** A page that applied a remembered view to a plain link calls this, so the "Restored your last view" notice shows. */
  markRestored(): void {
    this.restored.set(true);
  }

  dismissRestored(): void {
    this.restored.set(false);
  }

  /** "Reset to default" in the notice. */
  resetToDefault(): void {
    this.clear();
  }

  // ---- live region

  /**
   * Call when a load has finished with the total: after a change of the filters it sets the polite announcement ("23 results",
   * "Filters cleared. 23 results"). The first load, paging, sorting and reloads of the same filters announce nothing.
   */
  reportResults(total: number): void {
    this.resultTotal.set(total);
    const signature = JSON.stringify(this.queryParams());
    if (this.announced === null) {
      this.announced = signature;
      return;
    }
    if (signature === this.announced) return;
    this.announced = signature;
    const count =
      total === 0
        ? `No ${this.noun === 'results' ? 'results' : this.noun}`
        : total === 1
          ? `1 ${this.noun === 'results' ? 'result' : singular(this.noun)}`
          : `${total} ${this.noun}`;
    const text = this.activeCount() === 0 ? `Filters cleared. ${count}` : count;
    this.flip = !this.flip;
    this.announcement.set(this.flip ? text : `${text}${NUDGE}`);
  }
}

/** Zero-width space: a live region only speaks when its text changes, so the same message alternates with this. */
const NUDGE = String.fromCharCode(0x200b);

function singular(noun: string): string {
  return noun.endsWith('ies') ? `${noun.slice(0, -3)}y` : noun.replace(/s$/, '');
}
