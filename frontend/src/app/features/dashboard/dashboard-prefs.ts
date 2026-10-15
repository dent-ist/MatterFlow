import { Injectable, inject, signal } from '@angular/core';
import { AuthStore } from '../../core/auth/auth.store';
import { DEFAULT_PERIOD, PeriodKey, isPeriodKey } from './dashboard-period';

/** The tabs of the Dashboard, in display order. The value is the `?tab=` query parameter. */
export const DASHBOARD_TABS = ['summary', 'breakdowns', 'trends'] as const;
export type DashboardTab = (typeof DASHBOARD_TABS)[number];

export function isDashboardTab(value: unknown): value is DashboardTab {
  return typeof value === 'string' && (DASHBOARD_TABS as readonly string[]).includes(value);
}

const PREFIX = 'mf.dashboard.v2.';

interface Stored {
  period: PeriodKey;
  tab: DashboardTab;
}

/**
 * What the Dashboard remembers per user in this browser: the chosen period and the last tab. Storage may be unavailable or blocked
 * (private windows, site data cleared): every access is wrapped, and the page works without it.
 */
@Injectable({ providedIn: 'root' })
export class DashboardPrefs {
  private readonly auth = inject(AuthStore);
  private loadedFor: number | null = null;

  readonly period = signal<PeriodKey>(DEFAULT_PERIOD);
  /** The tab used last (opened when the address has no `?tab=`). */
  readonly tab = signal<DashboardTab>('summary');

  /** Reads the saved choices of the signed-in user (once per user). */
  ensureLoaded(): void {
    const userId = this.auth.profile()?.userId ?? 0;
    if (this.loadedFor === userId) return;
    this.loadedFor = userId;
    const stored = this.read(userId);
    this.period.set(stored.period);
    this.tab.set(stored.tab);
  }

  setPeriod(key: PeriodKey): void {
    this.period.set(key);
    this.save();
  }

  setTab(tab: DashboardTab): void {
    if (tab === this.tab()) return;
    this.tab.set(tab);
    this.save();
  }

  private storageKey(userId: number): string {
    return PREFIX + userId;
  }

  private read(userId: number): Stored {
    const fallback: Stored = { period: DEFAULT_PERIOD, tab: 'summary' };
    try {
      const raw = localStorage.getItem(this.storageKey(userId));
      if (!raw) return fallback;
      const parsed = JSON.parse(raw) as Partial<Stored>;
      return {
        period: isPeriodKey(parsed.period) ? parsed.period : DEFAULT_PERIOD,
        tab: isDashboardTab(parsed.tab) ? parsed.tab : 'summary',
      };
    } catch {
      return fallback;
    }
  }

  private save(): void {
    try {
      const stored: Stored = { period: this.period(), tab: this.tab() };
      localStorage.setItem(this.storageKey(this.loadedFor ?? 0), JSON.stringify(stored));
    } catch {
      /* storage unavailable: the choice lasts until the page is closed */
    }
  }
}
