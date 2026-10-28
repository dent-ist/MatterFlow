import { Injectable, computed, signal } from '@angular/core';

/** The sections of the Overview that can be empty. */
export type OverviewKey = 'since' | 'attention' | 'deadlines' | 'health' | 'activity';

/**
 * `loading` (not answered, or failed: nothing is hidden on a guess), `empty` (answered, nothing to show), `content`; the Matter health section
 * also says `none` (the person manages no matter at all) and `nomatch` (the filters match no matter).
 */
export type OverviewState = 'loading' | 'empty' | 'content' | 'none' | 'nomatch';

/**
 * What each section of the Overview has to show, collected for the page (issue #920). When "Since your last visit", Needs my attention, Upcoming
 * deadlines and Recent activity are all empty at once, the page draws one line instead of four, and Matter health stays (it is the list of matters).
 */
@Injectable()
export class OverviewStates {
  private readonly states = signal<Partial<Record<OverviewKey, OverviewState>>>({});

  report(key: OverviewKey, state: OverviewState): void {
    if (this.states()[key] !== state) this.states.update((s) => ({ ...s, [key]: state }));
  }

  /** Nothing late, nothing due, nothing changed, no activity: the four sections collapse into one line. */
  readonly quiet = computed(() =>
    (['since', 'attention', 'deadlines', 'activity'] as const).every(
      (k) => this.states()[k] === 'empty',
    ),
  );

  /** No matter to list (the person manages none, or the filters match none): the Matter health message says it and nothing else is added. */
  readonly noMatters = computed(
    () => this.states().health === 'none' || this.states().health === 'nomatch',
  );
}
