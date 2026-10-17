import { Injectable, Injector, inject } from '@angular/core';
import { AuthStore } from '../../../core/auth/auth.store';

/** The three views of a breakdown card. */
export type BreakdownMode = 'table' | 'bars' | 'pie';

/** Every card starts as bars. */
export const DEFAULT_MODE: BreakdownMode = 'bars';

/** The order the toggle walks through (the owner's order): table, then bars, then pie, then table again. */
export const NEXT_MODE: Record<BreakdownMode, BreakdownMode> = {
  table: 'bars',
  bars: 'pie',
  pie: 'table',
};

/** The toggle names the view it will show next: "View as pie" on the bars, "View as table" on the pie, "View as bars" on the table. */
export function nextModeLabel(mode: BreakdownMode): string {
  return `View as ${NEXT_MODE[mode]}`;
}

export function isMode(value: unknown): value is BreakdownMode {
  return value === 'table' || value === 'bars' || value === 'pie';
}

const PREFIX = 'mf.dashboard.breakdowns.view.v1.';

/**
 * Which view each Breakdowns card shows, remembered per card and per user in this browser (not in the address). Storage may be
 * unavailable (private windows, site data cleared): every access is wrapped and the card works without it.
 */
@Injectable({ providedIn: 'root' })
export class BreakdownPrefs {
  private readonly injector = inject(Injector);

  /** The signed-in user, read when needed (a page without the auth store, such as a lone chart in a test, uses user 0). */
  private userId(): number {
    try {
      return this.injector.get(AuthStore).profile()?.userId ?? 0;
    } catch {
      return 0;
    }
  }

  private key(card: string): string {
    return `${PREFIX}${this.userId()}.${card}`;
  }

  load(card: string): BreakdownMode {
    try {
      const raw = localStorage.getItem(this.key(card));
      return isMode(raw) ? raw : DEFAULT_MODE;
    } catch {
      return DEFAULT_MODE;
    }
  }

  save(card: string, mode: BreakdownMode): void {
    try {
      if (mode === DEFAULT_MODE) localStorage.removeItem(this.key(card));
      else localStorage.setItem(this.key(card), mode);
    } catch {
      /* storage unavailable: the choice lasts until the page is closed */
    }
  }
}
