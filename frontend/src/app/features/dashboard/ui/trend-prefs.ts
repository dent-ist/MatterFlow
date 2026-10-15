import { Injectable, inject } from '@angular/core';
import { AuthStore } from '../../../core/auth/auth.store';
import { DEFAULT_CHOICE, TrendChoice, choiceFromStored } from './trend-model';

const PREFIX = 'mf.dashboard.trends.v1.';

/**
 * What the Trends tab remembers per user in this browser: the chosen lines (task types, whether "All task types" is on, the metric and the
 * Due dates). Storage may be unavailable or blocked (private windows, site data cleared): every access is wrapped and the tab works without it.
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
}
