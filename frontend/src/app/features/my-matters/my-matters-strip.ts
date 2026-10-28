import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Params, Router, RouterLink } from '@angular/router';
import { DashboardCount, MyMattersClient } from '../../api/generated/api-client';
import { ErrorReference } from '../../shared/ui/error-reference';
import { MmFilters, commonArgs, filterSummary, queryToParams } from './my-matters-filters';
import { OLDEST_FIRST, holdHint } from './facts';
import { ManagedMatters } from './managed-matters';
import { LoadGroup, panelLoader } from './panel-loader';

/** One chip of the strip: the number, the words after it, where it leads and how loud it may be. */
interface Chip {
  key: string;
  count: number | null;
  words: string;
  /** The accessible name: the count and the visible words (spelled out where they are short), and the oldest hold where there is one. */
  name: string;
  params: Params;
  /** `danger` (overdue) and `warning` (at risk) are loud only while the count is above zero. */
  tone: 'danger' | 'warning' | 'plain';
}

/**
 * The count strip of My Matters (README 6.1, issues #902 and #918): the focal point of the page. The first thing in the content is ONE large headline, the
 * overdue and at risk counts made big ("9 overdue  6 at risk", red and amber), or "Nothing is late" in muted text when both are zero (not a new number: the same
 * two counts, larger). After it come the quiet counts as plain text buttons without a frame (Unassigned, On hold, Due soon) and one muted "N open" that opens
 * all open tasks. Every count is a button that opens the Task Queue with the filter it counts; the number comes first, so the accessible name carries the count
 * ("9 overdue"; "5 due soon, within 7 days"). The colour budget: red only for overdue and amber only for at risk, only above zero, and the words are always there
 * (colour is never alone); everything else is neutral text and a zero is grey. "Matters I manage" and "Due in 3 days" are gone. Every number is the total of
 * the list its button opens, and the buttons follow the page's Client / Role / Scope filters (said in the group's name); the date range belongs to the Deadlines
 * tab and does not narrow the strip. For one matter the muted count names it and links to it (the Matters list of the Overview is not drawn for one matter,
 * issue #908; the owner decided on 2026-10-28 that the name stays here and not in the title).
 */
@Component({
  selector: 'mf-mm-strip',
  imports: [ErrorReference, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
    }
    .ms__error {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      min-height: 32px;
      margin: 0 0 var(--mf-s2);
      overflow: hidden;
      white-space: nowrap;
    }
    /* As wide as a row of chips (a plain width: a percentage cannot take part in sizing a flex item), so the strip wraps under the filters, or stays beside
       them, exactly as it does when it has loaded: the tabs never move. Only where the filters and the chips can share a line at all. */
    @media (min-width: 1200px) {
      .ms__error {
        min-width: 48rem;
      }
    }
    .ms__error--muted {
      color: var(--mf-text-muted);
    }
    .ms__error :is(mf-error-reference) {
      margin: 0;
    }
    .ms__error .mf-btn {
      min-height: 28px;
      padding: 0 var(--mf-s2);
    }
    .ms {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0 var(--mf-s4);
      margin: 0 0 var(--mf-s2);
      padding: 0;
      list-style: none;
    }
    /* The headline (issue #918): the late work, large. Red for overdue, amber for at risk, only above zero; the words are always there. */
    .ms__headline {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 0 var(--mf-s4);
    }
    .ms__big {
      min-height: 32px;
      padding: 0 var(--mf-s1);
      border: 0;
      background: none;
      color: var(--mf-text);
      font: inherit;
      font-size: var(--mf-fs-h2);
      font-weight: 700;
      line-height: 1.3;
      text-decoration: underline;
      text-decoration-color: transparent;
      text-underline-offset: 4px;
      white-space: nowrap;
      cursor: pointer;
    }
    .ms__big:hover {
      text-decoration-color: currentColor;
    }
    .ms__big:focus-visible,
    .ms__chip:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: 2px;
    }
    .ms__big--danger {
      color: var(--mf-danger);
    }
    .ms__big--warning {
      color: var(--mf-warning);
    }
    .ms__none {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-h2);
      font-weight: 600;
      line-height: 1.3;
    }
    /* The quiet counts: plain text buttons, no frame (a frame is for the unusual). */
    .ms__chip {
      display: inline-flex;
      align-items: center;
      gap: 0.35em;
      min-height: 28px;
      padding: 0 var(--mf-s1);
      border: 0;
      background: none;
      color: var(--mf-text);
      font: inherit;
      text-decoration: underline;
      text-decoration-color: transparent;
      text-underline-offset: 3px;
      white-space: nowrap;
      cursor: pointer;
    }
    .ms__chip:hover {
      text-decoration-color: currentColor;
    }
    .ms__chip strong {
      font-variant-numeric: tabular-nums;
    }
    /* Nothing counted: grey, still a button. */
    .ms__chip--zero {
      color: var(--mf-text-muted);
    }
    .ms__chip--zero strong {
      font-weight: 400;
    }
    .ms__open {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0 0.35em;
      color: var(--mf-text-muted);
    }
    .ms__open-link {
      min-height: 28px;
      padding: 0;
      border: 0;
      background: none;
      color: inherit;
      font: inherit;
      text-decoration: underline;
      text-decoration-color: transparent;
      text-underline-offset: 2px;
      cursor: pointer;
    }
    .ms__open-link:hover {
      color: var(--mf-text);
      text-decoration-color: currentColor;
    }
    .ms__open-link:focus-visible,
    .ms__matter:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: 2px;
    }
    .ms__matter {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      min-width: 0;
      max-width: 100%;
      color: var(--mf-link);
      /* A matter name is one long word for some firms: it breaks instead of widening the page (found by the long-names test of the final gate). */
      overflow-wrap: anywhere;
    }
    .ms__open {
      min-width: 0;
      max-width: 100%;
    }
    @media (max-width: 639.98px) {
      /* A phone (issue #922): ONE row that scrolls sideways (the last chip is cut off as the cue), four chips (Overdue, At risk, Unassigned, On hold; "Due
         in 7 days" is the Next 7 days section below) and then the muted count, so the strip is 44 px high, not four rows. */
      .ms {
        flex-wrap: nowrap;
        overflow-x: auto;
        overscroll-behavior-x: contain;
        scrollbar-width: none;
      }
      .ms > li {
        flex: none;
      }
      .ms {
        gap: 0 var(--mf-s2);
      }
      .ms__headline {
        flex-wrap: nowrap;
        gap: 0 var(--mf-s2);
      }
      .ms__big,
      .ms__none {
        font-size: var(--mf-fs-h3);
      }
      .ms__chip--seven {
        display: none;
      }
      .ms__open {
        flex-wrap: nowrap;
        white-space: nowrap;
      }
      .ms__matter {
        overflow-wrap: normal;
      }
      .ms__chip,
      .ms__big,
      .ms__open-link,
      .ms__matter,
      .ms__error,
      .ms__error .mf-btn {
        min-height: 44px;
      }
      .ms__matter {
        display: inline-flex;
        align-items: center;
      }
      .ms__open {
        margin-left: 0;
      }
      :host {
        margin-bottom: var(--mf-s1);
      }
    }
  `,
  template: `
    @if (loader.state() === 'error') {
      <!-- The row keeps the height of the headline (32 px, 44 on a phone): a failure never pushes the tab strip down (issue #921). -->
      @if (group?.many()) {
        <div class="ms__error ms__error--muted" data-strip-notloaded>Summary not loaded.</div>
      } @else {
        <div class="ms__error" role="alert" data-strip-error>
          <span>Couldn't load the summary.</span>
          <mf-error-reference />
          <button type="button" class="mf-btn" data-strip-retry (click)="loader.load()">
            Retry
          </button>
        </div>
      }
    } @else if (!allZero()) {
      <ul
        class="ms"
        [attr.aria-label]="label()"
        [attr.aria-busy]="loader.busy() ? 'true' : null"
        data-mm-strip
      >
        <li class="ms__headline" data-mm-headline>
          @for (c of headline(); track c.key) {
            <button
              type="button"
              class="ms__big"
              [class.ms__big--danger]="c.tone === 'danger' && !!c.count"
              [class.ms__big--warning]="c.tone === 'warning' && !!c.count"
              [attr.aria-label]="c.name"
              [attr.data-strip-item]="c.key"
              (click)="open(c.params)"
            >
              {{ c.count ?? '--' }} {{ c.words }}
            </button>
          } @empty {
            <span class="ms__none" data-headline-none>Nothing is late</span>
          }
        </li>
        @for (c of quiet(); track c.key) {
          <li>
            <button
              type="button"
              class="ms__chip"
              [class.ms__chip--seven]="c.key === 'due7'"
              [class.ms__chip--zero]="c.count === 0"
              [attr.aria-label]="c.name"
              [attr.data-strip-item]="c.key"
              (click)="open(c.params)"
            >
              <strong>{{ c.count ?? '--' }}</strong> {{ c.words }}
            </button>
          </li>
        }
        @if (summary(); as s) {
          <li class="ms__open" data-strip-open>
            <button
              type="button"
              class="ms__open-link"
              [attr.aria-label]="s.count + ' open tasks'"
              data-strip-item="open"
              (click)="open(s.params)"
            >
              {{ s.count }} open
            </button>
            @if (only(); as m) {
              <span>on</span>
              <a class="ms__matter" data-strip-matter [routerLink]="['/matters', m.matterId]"
                >{{ m.matterRef }} {{ m.name }}</a
              >
            }
          </li>
        }
      </ul>
    }
  `,
})
export class MyMattersStrip {
  readonly filters = input.required<MmFilters>();
  readonly clientName = input<string | null>(null);
  readonly managerName = input<string | null>(null);
  private readonly api = inject(MyMattersClient);
  private readonly router = inject(Router);
  private readonly managed = inject(ManagedMatters, { optional: true });

  protected readonly group = inject(LoadGroup, { optional: true });
  protected readonly loader = panelLoader(
    () => this.filters(),
    () => {
      const a = commonArgs(this.filters());
      return this.api.getMyMattersSummary(
        a.scope,
        a.role,
        a.clientId,
        undefined,
        undefined,
        a.managerId,
      );
    },
  );

  /** Every count is zero (no matter, or the filters match none): a row of zeros says nothing, so the strip is not drawn (issue #920). */
  protected readonly allZero = computed(() => {
    const s = this.loader.data();
    return (
      !!s &&
      [
        s.matters,
        s.openTasks,
        s.overdue,
        s.atRisk,
        s.dueIn3Days,
        s.dueIn7Days,
        s.unassigned,
        s.onHold,
      ].every((c) => c.count === 0)
    );
  });

  protected readonly label = computed(
    () =>
      `Summary of ${filterSummary(this.filters(), this.clientName(), this.managerName())}. Each count opens the list it counts.`,
  );

  /** The one matter of a person who manages exactly one (scope mine): named and linked after the open count. */
  protected readonly only = computed(() =>
    this.filters().scope === 'mine' && this.loader.data()?.matters.count === 1
      ? (this.managed?.only() ?? null)
      : null,
  );

  /**
   * The headline (issue #918): the overdue and at risk counts, made big, only the ones above zero. While the numbers are on their way both are drawn as
   * "--", so the row does not jump; when both are zero the headline is the muted "Nothing is late".
   */
  protected readonly headline = computed(() => {
    const late = this.chips().filter((c) => c.key === 'overdue' || c.key === 'atRisk');
    return this.loader.data() ? late.filter((c) => !!c.count) : late;
  });

  /** The quiet counts: Unassigned, On hold, Due soon (zero is grey). */
  protected readonly quiet = computed(() =>
    this.chips().filter((c) => c.key !== 'overdue' && c.key !== 'atRisk'),
  );

  protected readonly chips = computed<Chip[]>(() => {
    const s = this.loader.data();
    const chip = (
      key: string,
      words: string,
      c: DashboardCount | undefined,
      tone: Chip['tone'],
      order: Params = {},
      hint = '',
    ): Chip => ({
      key,
      count: c?.count ?? null,
      words,
      name: `${c?.count ?? 'Unknown number of'} ${words}${hint ? `, ${hint}` : ''}`,
      params: c ? { ...queryToParams(c.query), ...order } : {},
      tone,
    });
    return [
      // Opens oldest overdue first: a person who handles overdue work starts with the longest wait (issue #817); Priority is one click on the header.
      chip('overdue', 'overdue', s?.overdue, 'danger', OLDEST_FIRST),
      // PM v2 (#878): open, not overdue, 80 percent of the type's target used; the same rule as the Task Queue's At risk filter.
      chip('atRisk', 'at risk', s?.atRisk, 'warning'),
      chip('unassigned', 'unassigned', s?.unassigned, 'plain'),
      chip(
        'onHold',
        'on hold',
        s?.onHold,
        'plain',
        {},
        holdHint(s?.oldestHoldDays, s?.onHold.count),
      ),
      // "Due soon" is the visible word; the name says what it counts (the Next 7 days section below it is the same window).
      chip('due7', 'due soon', s?.dueIn7Days, 'plain', {}, 'within 7 days'),
    ];
  });

  /** "24 open" (all open tasks) and how many matters they are on, muted. */
  protected readonly summary = computed(() => {
    const s = this.loader.data();
    return s
      ? {
          count: s.openTasks.count,
          matters: s.matters.count,
          params: queryToParams(s.openTasks.query),
        }
      : null;
  });

  protected open(params: Params): void {
    void this.router.navigate(['/tasks'], { queryParams: params });
  }
}
