import { Injectable, inject, signal } from '@angular/core';
import { AuthStore } from '../../core/auth/auth.store';
import { Permission } from '../../core/auth/permissions';
import { DEFAULT_PERIOD, PeriodKey, isPeriodKey } from './dashboard-period';

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
 * What the Dashboard remembers per user in this browser: the chosen period. (The tab is not remembered: a plain /dashboard link, from the
 * navigation or shared, always opens Summary.) Storage may be unavailable or blocked
 * (private windows, site data cleared): every access is wrapped, and the page works without it.
 */
@Injectable({ providedIn: 'root' })
export class DashboardPrefs {
  private readonly auth = inject(AuthStore);
  private loadedFor: number | null = null;

  readonly period = signal<PeriodKey>(DEFAULT_PERIOD);

  /** Reads the saved choices of the signed-in user (once per user). */
  ensureLoaded(): void {
    const userId = this.auth.profile()?.userId ?? 0;
    if (this.loadedFor === userId) return;
    this.loadedFor = userId;
    const stored = this.read(userId);
    this.period.set(stored.period);
  }

  setPeriod(key: PeriodKey): void {
    this.period.set(key);
    this.save();
  }

  private storageKey(userId: number): string {
    return PREFIX + userId;
  }

  private read(userId: number): Stored {
    const fallback: Stored = { period: DEFAULT_PERIOD };
    try {
      const raw = localStorage.getItem(this.storageKey(userId));
      if (!raw) return fallback;
      const parsed = JSON.parse(raw) as Partial<Stored>;
      return {
        period: isPeriodKey(parsed.period) ? parsed.period : DEFAULT_PERIOD,
      };
    } catch {
      return fallback;
    }
  }

  private save(): void {
    try {
      const stored: Stored = { period: this.period() };
      localStorage.setItem(this.storageKey(this.loadedFor ?? 0), JSON.stringify(stored));
    } catch {
      /* storage unavailable: the choice lasts until the page is closed */
    }
  }
}
