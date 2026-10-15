import { Injectable, inject, signal } from '@angular/core';
import { AuthStore } from '../../../core/auth/auth.store';
import {
  DEFAULT_COMPLETED_DAYS,
  DEFAULT_VIEW,
  Density,
  GroupBy,
  SortKey,
  isCompletedDays,
  isDensity,
  isGroupBy,
  isSortKey,
} from './swimlane-model';

const PREFIX = 'mf.dashboard.swimlane.v1.';

interface Stored {
  groupBy: GroupBy;
  sort: SortKey;
  days: number;
  density: Density;
}

const FALLBACK: Stored = {
  groupBy: DEFAULT_VIEW.groupBy,
  sort: DEFAULT_VIEW.sort,
  days: DEFAULT_COMPLETED_DAYS,
  density: 'comfortable',
};

/**
 * What the Swimlane tab remembers per user in this browser: how to group, how to sort, the completed window and the card density. The data
 * filters (search, pod, assignee, type, priority, overdue, only mine) are not remembered: they live in the address, so a plain Swimlane
 * link never opens a board that is silently filtered. Storage may be unavailable (private window, site data cleared): every access is
 * wrapped and the tab works without it.
 */
@Injectable({ providedIn: 'root' })
export class SwimlanePrefs {
  private readonly auth = inject(AuthStore);
  private loadedFor: number | null = null;
  private stored: Stored = FALLBACK;

  readonly density = signal<Density>(FALLBACK.density);

  /** Reads the saved choices of the signed-in user (once per user). */
  ensureLoaded(): Stored {
    const userId = this.auth.profile()?.userId ?? 0;
    if (this.loadedFor !== userId) {
      this.loadedFor = userId;
      this.stored = this.read(userId);
      this.density.set(this.stored.density);
    }
    return this.stored;
  }

  /** The remembered display choices (grouping, sort, window). */
  remembered(): Pick<Stored, 'groupBy' | 'sort' | 'days'> {
    return this.ensureLoaded();
  }

  remember(choice: Partial<Stored>): void {
    this.ensureLoaded();
    this.stored = { ...this.stored, ...choice };
    if (choice.density) this.density.set(choice.density);
    this.save();
  }

  private read(userId: number): Stored {
    try {
      const raw = localStorage.getItem(PREFIX + userId);
      if (!raw) return FALLBACK;
      const parsed = JSON.parse(raw) as Partial<Stored>;
      return {
        groupBy: isGroupBy(parsed.groupBy) ? parsed.groupBy : FALLBACK.groupBy,
        sort: isSortKey(parsed.sort) ? parsed.sort : FALLBACK.sort,
        days: isCompletedDays(parsed.days) ? parsed.days : FALLBACK.days,
        density: isDensity(parsed.density) ? parsed.density : FALLBACK.density,
      };
    } catch {
      return FALLBACK;
    }
  }

  private save(): void {
    try {
      localStorage.setItem(PREFIX + (this.loadedFor ?? 0), JSON.stringify(this.stored));
    } catch {
      /* storage unavailable: the choice lasts until the page is closed */
    }
  }
}
