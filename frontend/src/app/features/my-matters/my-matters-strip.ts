import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Params, Router, RouterLink } from '@angular/router';
import { DashboardCount, MyMattersClient } from '../../api/generated/api-client';
import { ErrorReference } from '../../shared/ui/error-reference';
import { MmFilters, commonArgs, filterSummary, queryToParams } from './my-matters-filters';
import { OLDEST_FIRST, holdHint } from './facts';
import { ManagedMatters } from './managed-matters';
import { panelLoader } from './panel-loader';

/** One chip of the strip: the number, the words after it, where it leads and how loud it may be. */
interface Chip {
  key: string;
  count: number | null;
  words: string;
  /** The accessible name: the count and the words, and the oldest hold where there is one. */
  name: string;
  params: Params;
  /** `danger` (overdue) and `warning` (at risk) are loud only while the count is above zero. */
  tone: 'danger' | 'warning' | 'plain';
}

/**
 * The count strip of My Matters (README 6.1, issue #902): five chips that each open the Task Queue with the filter they count - Overdue, At risk, Unassigned,
 * On hold and Due in 7 days - then one muted "N open" that opens all open tasks. A chip is a button with a hover and focus state; the number comes first
 * ("9 overdue"), so the accessible name carries the count. A zero stays reachable but muted; only Overdue is red and only At risk amber, and only above zero (the
 * words are always there, colour is never alone). "Matters I manage" and "Due in 3 days" are gone: the first is the page's scope, the second is always inside
 * "7 days". Every number is the total of the list its chip opens, and the chips follow the page's Client / Role / Scope filters (said in the group's name); the
 * date range belongs to the Deadlines tab and does not narrow the strip. For one matter the muted count names it and links to it (the Matters list of the
 * Overview is not drawn for one matter, issue #908).
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
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2);
      margin: 0 0 var(--mf-s2);
    }
    .ms {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2);
      margin: 0 0 var(--mf-s2);
      padding: 0;
      list-style: none;
    }
    .ms__chip {
      display: inline-flex;
      align-items: center;
      gap: 0.35em;
      min-height: 28px;
      padding: 0 var(--mf-s3);
      border: 1px solid var(--mf-border-strong, var(--mf-border));
      border-radius: 999px;
      background: var(--mf-surface);
      color: var(--mf-text);
      font: inherit;
      white-space: nowrap;
      cursor: pointer;
    }
    .ms__chip:hover {
      border-color: var(--mf-primary);
      background: var(--mf-surface-alt);
    }
    .ms__chip:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: 2px;
    }
    .ms__chip strong {
      font-variant-numeric: tabular-nums;
    }
    /* Nothing counted: muted, still a button. */
    .ms__chip--zero {
      border-color: var(--mf-border);
      background: transparent;
      color: var(--mf-text-muted);
    }
    .ms__chip--zero strong {
      font-weight: 400;
    }
    .ms__chip--danger {
      border-color: var(--mf-danger);
      background: var(--mf-danger-bg);
      color: var(--mf-danger);
      font-weight: 600;
    }
    .ms__chip--warning {
      border-color: var(--mf-warning);
      background: var(--mf-warning-bg);
      color: var(--mf-warning);
      font-weight: 600;
    }
    .ms__chip--danger:hover,
    .ms__chip--warning:hover {
      filter: brightness(0.96);
    }
    .ms__open {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0 0.35em;
      margin-left: var(--mf-s2);
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
      color: var(--mf-link);
    }
    @media (max-width: 639.98px) {
      .ms__chip,
      .ms__open-link,
      .ms__matter {
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
      <div class="ms__error" role="alert" data-strip-error>
        <span>Couldn't load the summary.</span>
        <mf-error-reference />
        <button type="button" class="mf-btn" data-strip-retry (click)="loader.load()">Retry</button>
      </div>
    }
    @if (!allZero()) {
      <ul
        class="ms"
        [attr.aria-label]="label()"
        [attr.aria-busy]="loader.busy() ? 'true' : null"
        data-mm-strip
      >
        @for (c of chips(); track c.key) {
          <li>
            <button
              type="button"
              class="ms__chip"
              [class.ms__chip--zero]="c.count === 0"
              [class.ms__chip--danger]="c.tone === 'danger' && !!c.count"
              [class.ms__chip--warning]="c.tone === 'warning' && !!c.count"
              [attr.aria-label]="c.name"
              [attr.data-strip-item]="c.key"
              (click)="open(c.params)"
            >
              @if (c.tone === 'danger' && c.count) {
                <i class="pi pi-exclamation-circle" aria-hidden="true"></i>
              }
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
            } @else if (s.matters > 1) {
              <span>on {{ s.matters }} matters</span>
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
      chip('due7', 'due in 7 days', s?.dueIn7Days, 'plain'),
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
