import { Injectable, inject, signal } from '@angular/core';
import { SessionReset } from '../../core/session/session-reset';
import { ViewStateService } from '../../core/views/view-state.service';
import { ViewState } from '../../core/views/view-state';

const SURFACE = 'my-matters.focus' as const;

/** The task type ids of a remembered Focus, read defensively (anything that is not a positive whole number is dropped). */
export function focusFromState(state: ViewState | null | undefined): number[] {
  const raw = state?.['types'];
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((n): n is number => Number.isInteger(n) && n > 0))];
}

/**
 * Focus (PM v2, PV-07 #858): the task types a person works on today, picked once. It is stored once per person (`dbo.UserView`, surface
 * `my-matters.focus`, cached in the browser for the first paint) and stays until it is changed. A My Matters section that has no filter of its own
 * uses it as its type filter. It is a plain filter: no weights, no groups, no ranking (owner decision). Lazy features only (it reads the view store).
 */
@Injectable({ providedIn: 'root' })
export class MyMattersFocus {
  private readonly views = inject(ViewStateService);
  readonly types = signal<number[]>(focusFromState(this.views.cached(SURFACE)));
  private started = false;
  private touched = false;

  constructor() {
    inject(SessionReset).register(() => {
      this.types.set([]);
      this.started = false;
      this.touched = false;
    });
  }

  /** Reads the server's copy once (the cache already showed the first paint); a change made meanwhile wins. */
  ensure(): void {
    if (this.started) return;
    this.started = true;
    void this.views.load(SURFACE).then((state) => {
      if (!this.touched && state) this.types.set(focusFromState(state));
    });
  }

  set(types: readonly number[]): void {
    this.touched = true;
    const next = [...new Set(types)];
    this.types.set(next);
    this.views.save(SURFACE, { types: next });
    // A change of Focus is rare and a reload may follow at once: send it now instead of after the usual pause.
    void this.views.flush(SURFACE);
  }

  clear(): void {
    this.set([]);
  }
}
