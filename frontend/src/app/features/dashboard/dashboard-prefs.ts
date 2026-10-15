import { Injectable, inject, signal } from '@angular/core';
import { AuthStore } from '../../core/auth/auth.store';
import { DEFAULT_PERIOD, PeriodKey, isPeriodKey } from './dashboard-period';

/** The sections the user can collapse. "Needs attention" and the department counts are never collapsible. */
export type SectionKey = 'lists' | 'mine' | 'breakdowns' | 'trend' | 'recent';

const PREFIX = 'mf.dashboard.v2.';

interface Stored {
  collapsed: SectionKey[];
  period: PeriodKey;
}

/**
 * What the Dashboard remembers per user in this browser: which sections are collapsed and the chosen period. Storage may be unavailable or
 * blocked (private windows, site data cleared): every access is wrapped, and the page works without it.
 */
@Injectable({ providedIn: 'root' })
export class DashboardPrefs {
  private readonly auth = inject(AuthStore);
  private loadedFor: number | null = null;

  readonly collapsed = signal<ReadonlySet<SectionKey>>(new Set());
  readonly period = signal<PeriodKey>(DEFAULT_PERIOD);

  /** Reads the saved choices of the signed-in user (once per user). */
  ensureLoaded(): void {
    const userId = this.auth.profile()?.userId ?? 0;
    if (this.loadedFor === userId) return;
    this.loadedFor = userId;
    const stored = this.read(userId);
    this.collapsed.set(new Set(stored.collapsed));
    this.period.set(stored.period);
  }

  isCollapsed(key: SectionKey): boolean {
    return this.collapsed().has(key);
  }

  toggle(key: SectionKey): void {
    this.collapsed.update((set) => {
      const next = new Set(set);
      if (!next.delete(key)) next.add(key);
      return next;
    });
    this.save();
  }

  setPeriod(key: PeriodKey): void {
    this.period.set(key);
    this.save();
  }

  private storageKey(userId: number): string {
    return PREFIX + userId;
  }

  private read(userId: number): Stored {
    const fallback: Stored = { collapsed: [], period: DEFAULT_PERIOD };
    try {
      const raw = localStorage.getItem(this.storageKey(userId));
      if (!raw) return fallback;
      const parsed = JSON.parse(raw) as Partial<Stored>;
      const keys: SectionKey[] = ['lists', 'mine', 'breakdowns', 'trend', 'recent'];
      return {
        collapsed: Array.isArray(parsed.collapsed)
          ? parsed.collapsed.filter((k): k is SectionKey => keys.includes(k as SectionKey))
          : [],
        period: isPeriodKey(parsed.period) ? parsed.period : DEFAULT_PERIOD,
      };
    } catch {
      return fallback;
    }
  }

  private save(): void {
    try {
      const stored: Stored = { collapsed: [...this.collapsed()], period: this.period() };
      localStorage.setItem(this.storageKey(this.loadedFor ?? 0), JSON.stringify(stored));
    } catch {
      /* storage unavailable: the choice lasts until the page is closed */
    }
  }
}
