import { Injectable, computed, signal } from '@angular/core';

/** The sections of the Overview that can be empty. */
export type OverviewKey = 'attention' | 'deadlines' | 'health';

/**
 * `loading` (not answered), `error` (failed: nothing is hidden on a guess), `empty` (answered, nothing to show), `content`; the Matter health section
 * also says `none` (the person manages no matter at all) and `nomatch` (the filters match no matter).
 */
export type OverviewState = 'loading' | 'error' | 'empty' | 'content' | 'none' | 'nomatch';

/**
 * What each section of the Overview has to show, collected for the page (issue #920). When Needs my attention and Next 7 days are both empty at once, the page
 * draws one line instead of two, and the Matters list stays (it is the list of matters). "Since your last visit" and the events are not on the Overview any more
 * (issues #909, and the owner's decision of 2026-10-28): the Activity tab holds them and shows their number as a badge.
 */
@Injectable()
export class OverviewStates {
  private readonly states = signal<Partial<Record<OverviewKey, OverviewState>>>({});

  report(key: OverviewKey, state: OverviewState): void {
    if (this.states()[key] !== state) this.states.update((s) => ({ ...s, [key]: state }));
  }

  /** Nothing late and nothing due: the two sections collapse into one line. */
  readonly quiet = computed(() =>
    (['attention', 'deadlines'] as const).every((k) => this.states()[k] === 'empty'),
  );

  /**
   * Where the Calendar button is drawn (issue #929): in the heading of the first grid that has something to show, else in the line that says all is quiet. A
   * grid with nothing to show is one muted line with no toolbar, so the button must not live in it.
   */
  readonly calendarHost = computed<'attention' | 'deadlines' | 'quiet'>(() => {
    const s = this.states();
    if (s.attention !== 'empty') return 'attention';
    if (s.deadlines !== 'empty') return 'deadlines';
    return 'quiet';
  });

  /** No matter to list (the person manages none, or the filters match none): the Matter health message says it and nothing else is added. */
  readonly noMatters = computed(
    () => this.states().health === 'none' || this.states().health === 'nomatch',
  );
}
