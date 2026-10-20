import { DestroyRef, Injectable, Signal, computed, inject, signal } from '@angular/core';
import { QuietRequests } from '../../core/http/interceptors';
import type { ShellCounts } from '../../shared/ui/admin-list-shell';
import type { MfTab } from '../../shared/ui/tabs';
import { firstAllowedTab } from './denial';

/**
 * Counted route tabs for admin pages (#545, the admin list kit). A page declares its tabs as data, shows the ones the person may use in
 * `mf-admin-list-shell` and asks `AdminTabCounts` for the numbers:
 *
 *   const TABS: AdminTab[] = [
 *     { id: 'priorities', label: 'Priorities', route: '/admin/priorities', permission: ['Priority.Manage'], countKey: 'priorities' },
 *     { id: 'status-labels', label: 'Status labels', route: '/admin/status-labels', permission: ['StatusLabel.Manage'], countKey: 'status-labels' },
 *   ];
 *   tabs = computed(() => adminTabItems(TABS, (p) => auth.has(p), counts.snapshot()));    // [tabs]="tabs()" on the shell
 *   current = computed(() => resolveAdminTab(TABS, this.tab(), (p) => auth.has(p))?.id);
 *   menu target (sidebar item, "Labels"): adminMenuTarget(TABS, (p) => auth.has(p))          // the route of the first tab the person may open
 *
 * A tab the person may not use is not built, so it is never rendered and never counted; one allowed tab gives a header without a tab strip.
 */
export interface AdminTab {
  /** The tab key: `?tab=` value or route segment, the `mf-tabs` key and the id of the tab element. */
  id: string;
  label: string;
  /** Where the tab goes (a path, may carry a query such as `?tab=link-roles`). */
  route: string;
  /** The person may open the tab with ANY of these permissions; empty means everyone who can open the page. */
  permission: readonly string[];
  /** The key in `AdminTabCounts`; a tab without one shows no number. */
  countKey?: string;
}

/** Whether a person holds a permission (`AuthStore.has` bound to the store, or a plain set lookup in a test). */
export type CanFn = (permission: string) => boolean;

/** The tabs the person may open, in the order given. */
export function allowedAdminTabs(tabs: readonly AdminTab[], can: CanFn): AdminTab[] {
  return tabs.filter((t) => t.permission.length === 0 || t.permission.some(can));
}

/**
 * The route of the first tab the person may open: the target of the sidebar item, so a menu item follows the permissions (BUG-1) and a
 * person with only `StatusLabel.Manage` is not sent to a tab that answers 403. `null` when no tab is allowed.
 */
export function adminMenuTarget(tabs: readonly AdminTab[], can: CanFn): string | null {
  return allowedAdminTabs(tabs, can)[0]?.route ?? null;
}

/**
 * The tab that is open for the `requested` id (a link, `?tab=`): that tab when the person may use it, else the first they may use
 * (`firstAllowedTab`, the denial rule of #416). `null` when no tab is allowed.
 */
export function resolveAdminTab(
  tabs: readonly AdminTab[],
  requested: string | null | undefined,
  can: CanFn,
): AdminTab | null {
  const allowed = allowedAdminTabs(tabs, can);
  if (allowed.length === 0) return null;
  const id = firstAllowedTab(
    requested,
    allowed.map((t) => t.id),
  );
  return allowed.find((t) => t.id === id) ?? null;
}

/**
 * The `mf-tabs` items for the shell: only the allowed tabs, each with its number when `counts` (by `countKey`) has an entry: the number
 * spoken as "Label, n active", `--` while it is unknown.
 */
export function adminTabItems(
  tabs: readonly AdminTab[],
  can: CanFn,
  counts: ShellCounts | null = null,
): MfTab[] {
  return allowedAdminTabs(tabs, can).map((t) => {
    const item: MfTab = { key: t.id, label: t.label };
    if (!counts || !t.countKey || !(t.countKey in counts)) return item;
    const n = counts[t.countKey];
    return typeof n === 'number'
      ? { ...item, count: n, name: `${t.label}, ${n} active` }
      : { ...item, count: '--' };
  });
}

/**
 * Reads one tab's number of ACTIVE records (decision P2 of the Task Types epic). It must start its request synchronously (return the
 * promise of `firstValueFrom(...)`): the call is marked quiet, so a failure does not toast.
 */
export type CountLoader = () => Promise<number | undefined>;

/**
 * The counts of the tabs of one page (#545; generalises the Task Types `AdminCounts`, which extends it). The page provides it:
 *
 *   providers: [AdminTabCounts]
 *   counts.start(TABS, { priorities: () => firstValueFrom(api.list()).then((l) => l.filter((p) => p.isActive).length) }, can);
 *
 * - `start` asks ONCE per page, one quiet request per allowed tab with a loader; calling it again changes nothing.
 * - `count(key)` is a signal: `--` while the number is not known (loading or the request failed, silently), the number of active records
 *   otherwise. A zero is a real answer. The tab shows `(--)` or `(n)`; nothing toasts.
 * - `refresh(key)` asks again after an edit (create, deactivate); `set(key, n)` is for a tab that already knows the new number (its own
 *   list after a load), and `AdminTabCounts.report(key)` hands that to a child component without it knowing the page.
 * - `snapshot` is the map for `adminTabItems` and the shell's `counts` input (`null` = unknown).
 */
@Injectable()
export class AdminTabCounts {
  /** The counts are background requests: a failure leaves a count unknown and must not toast on top of the list's own message. */
  protected readonly quiet = inject(QuietRequests);
  private readonly loaders = new Map<string, CountLoader>();
  private readonly started = new Set<string>();
  private readonly signals = new Map<string, Signal<number | '--'>>();

  /** The active count per key; null while it is not known. Keys appear when a tab is registered. */
  readonly counts = signal<Record<string, number | null>>({});
  /** The map the shell and `adminTabItems` read. */
  readonly snapshot = this.counts.asReadonly();

  /** The number of active records of `key`, or `--` while it is not known (a signal, so a tab label updates by itself). */
  count(key: string): Signal<number | '--'> {
    let s = this.signals.get(key);
    if (!s) {
      s = computed(() => this.counts()[key] ?? '--');
      this.signals.set(key, s);
    }
    return s;
  }

  /** Registers the loaders and reads the counts of the tabs the person may open, once per page. */
  async start(
    tabs: readonly AdminTab[],
    loaders: Readonly<Record<string, CountLoader>>,
    can: CanFn,
  ): Promise<void> {
    const wanted = allowedAdminTabs(tabs, can).filter((t) => t.countKey && loaders[t.countKey]);
    const keys = wanted.map((t) => t.countKey as string).filter((k) => !this.started.has(k));
    for (const key of new Set(keys)) {
      this.started.add(key);
      this.loaders.set(key, loaders[key]);
      this.counts.update((c) => (key in c ? c : { ...c, [key]: null }));
    }
    await Promise.all([...new Set(keys)].map((key) => this.read(key, false)));
  }

  /** Asks again (after a create, a deactivate or an activate). The new number replaces the old one; a failure keeps the old one. */
  async refresh(key: string): Promise<void> {
    if (this.loaders.has(key)) await this.read(key, true);
  }

  /** A tab reports its own active count (after each load); the request of `start` is then not needed. */
  set(key: string, count: number | null | undefined): void {
    if (typeof count === 'number') this.counts.update((c) => ({ ...c, [key]: count }));
  }

  /** Reports a tab's count to the page that holds the counts, if there is one (a tab used alone has none). Call in an injection context. */
  static report(
    this: typeof AdminTabCounts,
    key: string,
  ): (count: number | null | undefined) => void {
    // `this` is the class the page provides (a page may provide a subclass such as the Task Types `AdminCounts`).
    const counts = inject(this, { optional: true });
    const destroyed = { value: false };
    inject(DestroyRef).onDestroy(() => (destroyed.value = true));
    return (count) => {
      if (counts && !destroyed.value) counts.set(key, count);
    };
  }

  private async read(key: string, replace: boolean): Promise<void> {
    const loader = this.loaders.get(key);
    if (!loader) return;
    try {
      const count = await this.quiet.run(() => loader());
      // The open tab may have reported a newer number while the first request was on its way.
      if (typeof count === 'number' && (replace || this.counts()[key] == null))
        this.set(key, count);
    } catch {
      /* the tab simply shows no count (or keeps the last one) */
    }
  }
}
