import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CountChip } from './count-chip';
import { IntPipe, formatInt } from './number-format';

/** Rows a section card shows (36 px rows; "Open Full View" has the rest). */
export const SECTION_ROWS = 10;

/** What a compact section reports to its page: its load state, how many rows it shows and how many there are (for the card footer). */
export interface SectionStats {
  state: 'loading' | 'ready' | 'error';
  shown: number;
  /** How many there are; null when the list has no total (a cursor list: `more` says whether rows remain). */
  total: number | null;
  more?: boolean;
}

/**
 * The compact section card of a long page (D-03b, #1396; first use: the Matter page). One card per section, one under the other:
 *
 *   header   icon (20), heading (16/600, an `h2` the jump strip moves focus to), count chip, one muted line, the section's primary action at the right (`scAction`)
 *   body     the compact grid (`mf-record-grid compact`, 36 px rows, up to 10 rows), a state block for empty and error, or the loading placeholder
 *   footer   "Showing 10 of 38 tasks" / "Showing all 6 projects" at the left, the text button "Open Full View" (D-13a, a real link) at the right
 *
 * The card is the one border: the grid inside has none. It reports nothing itself; the page owns the section's load state and passes `state`,
 * `shown` and `total` for the footer. While the section loads, the footer says so (`role="status"`); with an error the note is left out.
 *
 *   <mf-section-card key="tasks" heading="Tasks" icon="pi-check-square" [count]="38" hint="Open tasks" noun="tasks"
 *       [shown]="10" [total]="38" state="ready" [fullView]="['/matters', 5]" [fullViewParams]="{ tab: 'tasks' }">
 *     <p-button scAction label="New Task" icon="pi pi-plus" />
 *     <mf-record-grid compact ... />
 *   </mf-section-card>
 */
@Component({
  selector: 'mf-section-card',
  imports: [CountChip, IntPipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-section]': 'key()' },
  template: `
    <section
      class="mf-card sc"
      [attr.id]="'section-' + key()"
      [attr.aria-labelledby]="'section-' + key() + '-h'"
    >
      <header class="sc__h">
        <i class="pi sc__icon" [class]="icon()" aria-hidden="true"></i>
        <h2 class="sc__title" tabindex="-1" [id]="'section-' + key() + '-h'" data-section-heading>
          {{ heading() }}
        </h2>
        @if (count() !== null && count() !== undefined) {
          <mf-count-chip data-section-count>{{ count() | mfInt }}</mf-count-chip>
        }
        <span class="sc__hint">{{ hint() }}</span>
        <span class="sc__act"><ng-content select="[scAction]" /></span>
      </header>
      <div class="sc__body"><ng-content /></div>
      <footer class="sc__f">
        <span
          class="sc__note"
          data-section-note
          [attr.role]="state() === 'loading' ? 'status' : null"
          >{{ note() }}</span
        >
        <a
          class="mf-btn mf-btn--text"
          data-full-view
          [routerLink]="fullView()"
          [queryParams]="fullViewParams()"
        >
          Open Full View <i class="pi pi-arrow-right" aria-hidden="true"></i>
        </a>
      </footer>
    </section>
  `,
  styles: `
    :host {
      display: block;
    }
    .sc {
      padding: 0;
      overflow: hidden;
      /* A jump lands with the card under the top bar and the sticky strip (53 px + 40 px + 12 px). */
      scroll-margin-top: calc(var(--mf-header-h, 53px) + var(--mf-tab-h) + var(--mf-s3));
    }
    .sc__h {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      min-height: 56px;
      padding: var(--mf-s2) var(--mf-s4);
    }
    .sc__icon {
      font-size: var(--mf-icon-lg);
      color: var(--mf-text-muted);
    }
    .sc__title {
      margin: 0;
      color: var(--mf-text);
      font-size: var(--mf-fs-lg);
      font-weight: var(--mf-fw-semibold);
      line-height: 1.3;
    }
    .sc__title:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: 2px;
      border-radius: var(--mf-radius);
    }
    .sc__hint {
      min-width: 0;
      overflow: hidden;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-md);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .sc__act {
      display: flex;
      flex: none;
      gap: var(--mf-s2);
      margin-left: auto;
    }
    .sc__act:empty {
      display: none;
    }
    .sc__body {
      min-width: 0;
      border-top: 1px solid var(--mf-border);
    }
    .sc__f {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--mf-s3);
      min-height: 40px;
      padding: 0 var(--mf-s3) 0 var(--mf-s4);
      border-top: 1px solid var(--mf-border);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-md);
    }
  `,
})
export class SectionCard {
  /** The section's key (`tasks`): the card is `#section-tasks`, its heading `#section-tasks-h`. */
  readonly key = input.required<string>();
  readonly heading = input.required<string>();
  /** A PrimeIcons class. */
  readonly icon = input.required<string>();
  /** The count chip; null or undefined leaves it out (unknown, or not for this viewer). */
  readonly count = input<number | null | undefined>(null);
  /** The one muted line after the heading. */
  readonly hint = input('');
  /** Plural, lowercase: "tasks" (the footer). */
  readonly noun = input.required<string>();
  /** Rows shown and rows there are, for "Showing 10 of 38 tasks". */
  readonly shown = input(0);
  readonly total = input<number | null>(0);
  /** With an unknown `total`: more rows remain than are shown. */
  readonly more = input(false);
  readonly state = input<'idle' | 'loading' | 'ready' | 'error'>('idle');
  /** The router commands of the full view (`['/matters', 5]`) and its query parameters (`{ tab: 'tasks' }`). */
  readonly fullView = input.required<readonly unknown[]>();
  readonly fullViewParams = input<Record<string, string>>({});

  protected readonly note = computed(() => {
    const noun = this.noun();
    switch (this.state()) {
      case 'idle':
        return `${cap(noun)} load when you scroll here`;
      case 'loading':
        return `Loading ${noun}...`;
      case 'error':
        return '';
      default: {
        const total = this.total();
        if (total === null) {
          return this.more()
            ? `Showing the latest ${formatInt(this.shown())} ${noun}`
            : `Showing all ${formatInt(this.shown())} ${noun}`;
        }
        if (total === 0) return `0 ${noun}`;
        const fmt = formatInt;
        return total > this.shown()
          ? `Showing ${fmt(this.shown())} of ${fmt(total)} ${noun}`
          : `Showing all ${fmt(total)} ${noun}`;
      }
    }
  });
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
