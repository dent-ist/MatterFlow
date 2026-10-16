import { Injectable, inject, signal } from '@angular/core';
import { AuthStore } from '../../core/auth/auth.store';
import { Permission } from '../../core/auth/permissions';
import {
  DEFAULT_PERIOD,
  DEFAULT_PERIOD_KEY,
  Period,
  PeriodKey,
  migrateStoredPeriod,
  periodFromParams,
} from './dashboard-period';

/** The tabs of the Dashboard, in display order. The value is the `?tab=` query parameter. */
export const DASHBOARD_TABS = ['summary', 'breakdowns', 'trends', 'swimlane', 'users'] as const;
export type DashboardTab = (typeof DASHBOARD_TABS)[number];

/**
 * The permissions that open each tab (any one of them, in addition to Dashboard.View, which opens the Dashboard at all). The page shows only the
 * tabs the person holds; a new tab is added here and in DASHBOARD_TABS and plugs into the page's tab switch. Summary has two layers:
 * ViewSummary shows all of it, ViewUnassigned alone shows only the unassigned queue.
 */
export const DASHBOARD_TAB_PERMISSIONS: Record<DashboardTab, readonly Permission[]> = {
  summary: ['Dashboard.ViewSummary', 'Dashboard.ViewUnassigned'],
  breakdowns: ['Dashboard.ViewBreakdowns'],
  trends: ['Dashboard.ViewTrends'],
  swimlane: ['Dashboard.ViewSwimlane'],
  users: ['Dashboard.ViewUsers'],
};

export const DASHBOARD_TAB_LABELS: Record<DashboardTab, string> = {
  summary: 'Summary',
  breakdowns: 'Breakdowns',
  trends: 'Trends',
  swimlane: 'Swimlane',
  users: 'Users',
};

/** The tabs that read the shared summary request (the others read their own endpoint). */
export const SUMMARY_DATA_TABS: readonly DashboardTab[] = ['summary', 'breakdowns', 'trends'];

export function isDashboardTab(value: unknown): value is DashboardTab {
  return typeof value === 'string' && (DASHBOARD_TABS as readonly string[]).includes(value);
}

const PREFIX = 'mf.dashboard.v2.';

interface Stored {
  period: PeriodKey;
}

/**
 * What the Dashboard remembers per user in this browser: the last explicitly chosen period (never a custom range). The address wins over it: a link
 * that names a period shows that period without changing the memory. Values saved by the earlier list (This week, This month, Last 30 days, Last
 * quarter) are migrated when read and saved again in the new vocabulary. (The tab is not remembered: a plain /dashboard link always opens Summary.)
 * Storage may be unavailable or blocked (private windows, site data cleared): every access is wrapped, and the page works without it.
 */
@Injectable({ providedIn: 'root' })
export class DashboardPrefs {
  private readonly auth = inject(AuthStore);
  private loadedFor: number | null = null;
  private remembered: PeriodKey = DEFAULT_PERIOD_KEY;

  /** The period in effect on the page (the shared value of Summary, Trends and Coverage): the address, else the remembered choice. */
  readonly period = signal<Period>(DEFAULT_PERIOD);

  /** Reads the saved choice of the signed-in user (once per user). */
  ensureLoaded(): void {
    const userId = this.auth.profile()?.userId ?? 0;
    if (this.loadedFor === userId) return;
    this.loadedFor = userId;
    this.remembered = this.read(userId);
    this.period.set({ key: this.remembered, from: null, to: null });
  }

  /**
   * The address names the period (it wins, and counts as a choice: a preset it names is remembered, so the address can leave the default out) or does
   * not (the remembered choice applies). Called whenever the query parameters change.
   */
  applyAddress(get: (key: string) => string | null): void {
    this.ensureLoaded();
    const named = periodFromParams(get);
    if (named && named.key !== 'custom' && named.key !== this.remembered) {
      this.remembered = named.key;
      this.save();
    }
    const next = named ?? { key: this.remembered, from: null, to: null };
    const cur = this.period();
    if (cur.key !== next.key || cur.from !== next.from || cur.to !== next.to) this.period.set(next);
  }

  /** The person chose a period: it is in effect now and a preset (not a custom range) is remembered. */
  choose(period: Period): void {
    this.ensureLoaded();
    this.period.set(period);
    if (period.key !== 'custom') {
      this.remembered = period.key;
      this.save();
    }
  }

  private storageKey(userId: number): string {
    return PREFIX + userId;
  }

  private read(userId: number): PeriodKey {
    try {
      const raw = localStorage.getItem(this.storageKey(userId));
      if (!raw) return DEFAULT_PERIOD_KEY;
      const stored = (JSON.parse(raw) as Partial<{ period: unknown }> | null)?.period;
      const migrated = migrateStoredPeriod(stored);
      if (migrated !== stored && migrated !== null) {
        // Saved by an earlier list: write it back in the new vocabulary so the old value is gone.
        localStorage.setItem(
          this.storageKey(userId),
          JSON.stringify({ period: migrated } satisfies Stored),
        );
      }
      return migrated ?? DEFAULT_PERIOD_KEY;
    } catch {
      return DEFAULT_PERIOD_KEY;
    }
  }

  private save(): void {
    try {
      const stored: Stored = { period: this.remembered };
      localStorage.setItem(this.storageKey(this.loadedFor ?? 0), JSON.stringify(stored));
    } catch {
      /* storage unavailable: the choice lasts until the page is closed */
    }
  }
}
