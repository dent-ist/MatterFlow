import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Params } from '@angular/router';
import { DashboardCount, MyMattersClient } from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { ErrorReference } from '../../shared/ui/error-reference';
import { WorkStrip, WorkStripItem } from '../../shared/work-queue/work-strip';
import {
  MmFilters,
  commonArgs,
  filterSummary,
  mattersListParams,
  queryToParams,
} from './my-matters-filters';
import { OLDEST_FIRST, holdHint } from './facts';
import { panelLoader } from './panel-loader';

/**
 * The count strip of My Matters (README 6.1): matters, open tasks, overdue, due in 3 and 7 days, unassigned, on hold. Every cell is a link to
 * the list it counts (the Matters list, or the Task Queue with the status written out, `managedByMe` shows every status otherwise), so a
 * number always equals the total of the list it opens. The cells follow the page's Client / Role / Scope filters (said in the accessible
 * name); the date range belongs to Upcoming deadlines and does not narrow the strip. "Due in 3 days" is inside "due in 7 days": never summed.
 */
@Component({
  selector: 'mf-mm-strip',
  imports: [WorkStrip, ErrorReference],
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
    @media (max-width: 639.98px) {
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
    <mf-work-strip
      [label]="label()"
      [items]="items()"
      [chipRow]="true"
      [attr.aria-busy]="loader.busy() ? 'true' : null"
      data-mm-strip
    />
  `,
})
export class MyMattersStrip {
  readonly filters = input.required<MmFilters>();
  readonly clientName = input<string | null>(null);
  readonly managerName = input<string | null>(null);
  private readonly api = inject(MyMattersClient);
  private readonly auth = inject(AuthStore);

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

  protected readonly label = computed(
    () =>
      `Summary of ${filterSummary(this.filters(), this.clientName(), this.managerName())}. Each count opens the list it counts.`,
  );

  protected readonly items = computed<WorkStripItem[]>(() => {
    const s = this.loader.data();
    const all = this.filters().scope === 'all';
    const cell = (
      key: string,
      label: string,
      c: DashboardCount | undefined,
      path: string,
      extra: Partial<WorkStripItem> = {},
      order: Params = {},
    ): WorkStripItem => ({
      key,
      label,
      count: c?.count ?? null,
      link: c
        ? {
            path,
            // The Matters list names its filters differently from the API (`mine`, `primaryManager`, ...): it gets its own address.
            queryParams:
              path === '/matters'
                ? mattersListParams(this.filters(), this.auth.profile()?.userId ?? 0)
                : { ...queryToParams(c.query), ...order },
          }
        : undefined,
      ...extra,
    });
    const hold = holdHint(s?.oldestHoldDays, s?.onHold.count);
    return [
      cell('matters', all ? 'Matters' : 'Matters I manage', s?.matters, '/matters'),
      cell('open', 'Open tasks', s?.openTasks, '/tasks'),
      // Opens oldest overdue first: a person who handles overdue work starts with the longest wait (issue #817); Priority is one click on the header.
      cell('overdue', 'Overdue', s?.overdue, '/tasks', { alert: true }, OLDEST_FIRST),
      cell('due3', 'Due in 3 days', s?.dueIn3Days, '/tasks'),
      cell('due7', 'Due in 7 days', s?.dueIn7Days, '/tasks'),
      cell('unassigned', 'Unassigned', s?.unassigned, '/tasks'),
      cell('onHold', 'On hold', s?.onHold, '/tasks', hold ? { hint: hold } : {}),
    ];
  });
}
