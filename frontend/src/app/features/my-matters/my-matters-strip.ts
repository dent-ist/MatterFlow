import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Params, Router, RouterLink } from '@angular/router';
import { DashboardCount, MyMattersClient } from '../../api/generated/api-client';
import { ErrorReference } from '../../shared/ui/error-reference';
import { MmFilters, commonArgs, filterSummary, queryToParams } from './my-matters-filters';
import { OLDEST_FIRST, holdHint } from './facts';
import { ManagedMatters } from './managed-matters';
import { LoadGroup, panelLoader } from './panel-loader';

/** One tile of the strip: the number, the word under or beside it, where it leads and how loud it may be. */
interface Tile {
  key: string;
  count: number | null;
  /** The visible word ("Overdue"). */
  label: string;
  /** The accessible name: the count first, then the word (spelled out where it is short), and the oldest hold where there is one. */
  name: string;
  params: Params;
  /** `danger` (overdue) and `warning` (at risk) are loud only while the count is above zero. */
  tone: 'danger' | 'warning' | 'plain';
}

/**
 * The count tiles of My Matters (README 6.1, issues #927, #902 and #918): the focal point of the page. SIX tiles of one size, each a button with a large number and
 * a short word: Overdue, At risk, Unassigned, On hold, Due soon (within 7 days) and Open. A tile opens the Task Queue with the filter it counts (the number comes
 * first in its accessible name: "9 overdue", "5 due soon, within 7 days"), and every number is the total of the list it opens; the tiles follow the page's
 * Client / Role / Scope filters (said in the group's name); the date range belongs to the calendar and does not narrow them. The colour budget: red only for
 * Overdue and amber only for At risk, only while the count is above zero, the word is always there (colour is never alone); every other tile is neutral and a
 * zero is muted. On a phone the tiles are two columns by three rows of 44 px targets. For one matter the Open tile is followed by its name as a link (the
 * Matters list of the Overview is not drawn for one matter, issue #908; the owner decided on 2026-10-28 that the name stays here and not in the title).
 */
@Component({
  selector: 'mf-mm-strip',
  imports: [ErrorReference, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    /* A flex item of the top row with a basis wide enough for six tiles: it stays beside the filters when the width allows and wraps under them
       otherwise, and is never shrunk to the width of one tile (which stacked the six tiles in one column on wide screens). */
    :host {
      display: block;
      flex: 1 1 44rem;
      max-width: 64rem;
    }
    .ms__error {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      min-height: 36px;
      margin: 0 0 var(--mf-s1);
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
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: var(--mf-s2);
      width: 100%;
      margin: 0 0 var(--mf-s1);
      padding: 0;
      list-style: none;
    }
    .ms > li {
      display: flex;
      min-width: 0;
    }
    /* One tile (issue #927): the same size for all six, the number large and the word beside it. A button, so it is keyboard and screen reader friendly. */
    .tile {
      display: flex;
      flex: 1 1 auto;
      align-items: center;
      justify-content: flex-start;
      gap: var(--mf-s2);
      box-sizing: border-box;
      min-width: 0;
      min-height: 36px;
      padding: 0 var(--mf-s3);
      border: 1px solid var(--mf-border-strong, var(--mf-border));
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
      color: var(--mf-text);
      font: inherit;
      text-align: left;
      white-space: nowrap;
      cursor: pointer;
    }
    .tile:hover {
      background: var(--mf-selected-bg);
    }
    .tile:focus-visible,
    .ms__matter:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: 2px;
    }
    .tile__n {
      font-size: var(--mf-fs-h2);
      font-variant-numeric: tabular-nums;
      font-weight: 700;
      line-height: 1.2;
    }
    .tile__l {
      overflow: hidden;
      text-overflow: ellipsis;
    }
    /* Red only for Overdue and amber only for At risk, and only above zero; the word is always printed. */
    .tile--danger {
      border-color: var(--mf-danger);
    }
    .tile--danger .tile__n {
      color: var(--mf-danger);
    }
    .tile--warning {
      border-color: var(--mf-warning);
    }
    .tile--warning .tile__n {
      color: var(--mf-warning);
    }
    /* Nothing counted: muted, still a button. */
    .tile--zero {
      color: var(--mf-text-muted);
      border-color: var(--mf-border);
    }
    .tile--zero .tile__n {
      font-weight: 400;
    }
    .ms__matter-note {
      align-items: center;
      min-width: 0;
      grid-column: 1 / -1;
      color: var(--mf-text-muted);
    }
    .ms__matter {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      min-width: 0;
      max-width: 100%;
      margin-left: 0.35em;
      color: var(--mf-link);
      /* A matter name is one long word for some firms: it breaks instead of widening the page (found by the long-names test of the final gate). */
      overflow-wrap: anywhere;
    }
    @media (max-width: 1099.98px) {
      /* Narrow desktop: tighter tiles so all six words fit in the one row. */
      .tile {
        gap: var(--mf-s1);
        padding: 0 var(--mf-s2);
      }
    }
    @media (max-width: 999.98px) {
      /* Tablet and phone: the number over its word, so all six words fit in the row (a shorter first screen on a phone). */
      .tile {
        flex-direction: column;
        justify-content: center;
        gap: 0;
        min-height: 44px;
        padding: 0 var(--mf-s1);
        text-align: center;
      }
      .ms__error {
        min-height: 44px;
      }
      .tile__n {
        line-height: 1.1;
      }
      .tile__l {
        max-width: 100%;
        font-size: var(--mf-fs-xs);
      }
    }
    @media (max-width: 639.98px) {
      /* A phone: three columns by two rows of 44 px targets (issue #927). */
      .ms {
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: var(--mf-s1) var(--mf-s2);
      }
      .tile,
      .ms__error,
      .ms__error .mf-btn {
        min-height: 44px;
      }
      .ms > li.ms__matter-note {
        display: none;
      }
      :host {
        margin-bottom: var(--mf-s1);
      }
    }
  `,
  template: `
    @if (loader.state() === 'error') {
      <!-- The row keeps the height of a tile (36 px, 44 on a phone): a failure never pushes the tab strip down (issue #921). -->
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
        @for (c of tiles(); track c.key) {
          <li>
            <button
              type="button"
              class="tile"
              [class.tile--danger]="c.tone === 'danger' && !!c.count"
              [class.tile--warning]="c.tone === 'warning' && !!c.count"
              [class.tile--zero]="c.count === 0"
              [attr.aria-label]="c.name"
              [attr.data-strip-item]="c.key"
              (click)="open(c.params)"
            >
              <span class="tile__n">{{ c.count ?? '--' }}</span
              >{{ ' ' }}<span class="tile__l">{{ c.label }}</span>
            </button>
          </li>
        }
        @if (only(); as m) {
          <li class="ms__matter-note" data-strip-matter-note>
            <span>Open tasks on</span>
            <a class="ms__matter" data-strip-matter [routerLink]="['/matters', m.matterId]"
              >{{ m.matterRef }} {{ m.name }}</a
            >
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
        undefined,
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

  protected readonly tiles = computed<Tile[]>(() => {
    const s = this.loader.data();
    const tile = (
      key: string,
      label: string,
      words: string,
      c: DashboardCount | undefined,
      tone: Tile['tone'],
      order: Params = {},
      hint = '',
    ): Tile => ({
      key,
      count: c?.count ?? null,
      label,
      name: `${c?.count ?? 'Unknown number of'} ${words}${hint ? `, ${hint}` : ''}`,
      params: c ? { ...queryToParams(c.query), ...order } : {},
      tone,
    });
    return [
      // Opens oldest overdue first: a person who handles overdue work starts with the longest wait (issue #817); Priority is one click on the header.
      tile('overdue', 'Overdue', 'overdue', s?.overdue, 'danger', OLDEST_FIRST),
      // PM v2 (#878): open, not overdue, 80 percent of the type's target used; the same rule as the Task Queue's At risk filter.
      tile('atRisk', 'At risk', 'at risk', s?.atRisk, 'warning'),
      tile('unassigned', 'Unassigned', 'unassigned', s?.unassigned, 'plain'),
      tile(
        'onHold',
        'On hold',
        'on hold',
        s?.onHold,
        'plain',
        {},
        holdHint(s?.oldestHoldDays, s?.onHold.count),
      ),
      // "Due soon" is the visible word; the name says what it counts (the Next 7 days grid below is the same window).
      tile('due7', 'Due soon', 'due soon', s?.dueIn7Days, 'plain', {}, 'within 7 days'),
      // All open tasks.
      tile('open', 'Open', 'open tasks', s?.openTasks, 'plain'),
    ];
  });

  protected open(params: Params): void {
    void this.router.navigate(['/tasks'], { queryParams: params });
  }
}
