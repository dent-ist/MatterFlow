import { Injectable, inject } from '@angular/core';
import { AuthStore } from '../../../core/auth/auth.store';
import { DEFAULT_CHOICE, TrendChoice, choiceFromStored } from './trend-model';

const PREFIX = 'mf.dashboard.trends.v1.';
const BACKLOG_PREFIX = 'mf.dashboard.trends.backlog.v1.';

/**
 * What the Trends tab remembers per user in this browser: the chosen lines (task types, whether "All task types" is on, the measures of the two panels)
 * and whether the backlog panel is hidden. Storage may be unavailable or blocked (private windows, site data cleared): every access is wrapped and the tab works without it.
 */
@Injectable({ providedIn: 'root' })
export class TrendPrefs {
  private readonly auth = inject(AuthStore);

  private key(): string {
    return PREFIX + (this.auth.profile()?.userId ?? 0);
  }

  load(): TrendChoice {
    try {
      const raw = localStorage.getItem(this.key());
      return raw ? choiceFromStored(JSON.parse(raw)) : DEFAULT_CHOICE;
    } catch {
      return DEFAULT_CHOICE;
    }
  }

  save(choice: TrendChoice): void {
    try {
      localStorage.setItem(this.key(), JSON.stringify(choice));
    } catch {
      /* storage unavailable: the choice lasts until the page is closed */
    }
  }

  /** True when the user hid the backlog panel (not part of the address). */
  backlogHidden(): boolean {
    try {
      return localStorage.getItem(BACKLOG_PREFIX + (this.auth.profile()?.userId ?? 0)) === 'hidden';
    } catch {
      return false;
    }
  }

  saveBacklogHidden(hidden: boolean): void {
    try {
      const key = BACKLOG_PREFIX + (this.auth.profile()?.userId ?? 0);
      if (hidden) localStorage.setItem(key, 'hidden');
      else localStorage.removeItem(key);
    } catch {
      /* storage unavailable: the choice lasts until the page is closed */
    }
  }
}
