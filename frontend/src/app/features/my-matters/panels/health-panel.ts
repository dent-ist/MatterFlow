import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MyMattersClient, MyMattersHealthRow } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { calendarDayInZone } from '../../../core/time/time';
import { AddCommentDialog } from '../../../shared/matter-actions/add-comment-dialog';
import { matterActionMenu } from '../../../shared/matter-actions/matter-actions';
import { ActionMenu } from '../../../shared/ui/action-menu';
import { RowLink, restoreRowFocus } from '../../../shared/ui/row-nav';
import { shortDate } from '../facts';
import { MmFilters, commonArgs, mattersListParams } from '../my-matters-filters';
import { OverviewStates } from '../overview-states';
import { panelLoader } from '../panel-loader';
import { PanelBox } from './panel-box';

/** The most matters the Overview lists; "All matters (N)" opens the Matters list for the rest. */
export const MATTERS_SHOWN = 8;

/**
 * The matters of the Overview (README 6.3, epic #893 issue #908; it was "Matter health"). A person who manages ONE matter gets nothing here: the strip and the
 * lists above already say everything about it, and the strip names and links the matter. With several matters it is a compact list, one line each, the worst
 * first (most overdue, then most at risk, then most unassigned, then the soonest deadline; the server sorts): the matter's name (the client as small grey text only
 * when the matters belong to two or more clients), an "N overdue" chip that is red only above zero (the number is the signal, there is no Red / Amber / Green word),
 * an amber "N at risk" and "N unassigned" only above zero, and the next deadline. One "..." menu per row holds New task and the other quick actions. At most
 * {@link MATTERS_SHOWN} rows; "All matters (N)" opens the Matters list. The rule is stated once, behind the info button. On a phone a row is a card of two lines.
 * A matter with no manager never shows a warning anywhere.
 */
@Component({
  selector: 'mf-mm-health',
  imports: [ActionMenu, AddCommentDialog, PanelBox, RouterLink, RowLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[hidden]': 'single()' },
  styles: `
    .mh__empty {
      display: grid;
      gap: var(--mf-s2);
      justify-items: start;
      padding: var(--mf-s2) 0;
    }
    .mh__empty p {
      margin: 0;
    }
    .mh__muted {
      color: var(--mf-text-muted);
    }
    .mh__link {
      color: var(--mf-link);
    }
    .mh__info {
      min-width: 32px;
      padding-inline: var(--mf-s2);
    }
    .mh__rule {
      margin: 0 0 var(--mf-s2);
      padding: var(--mf-s2) var(--mf-s3);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius);
      background: var(--mf-surface-alt, var(--mf-surface));
    }
    .mh__rule p {
      margin: 0 0 var(--mf-s1);
    }
    .mh__rule p:last-child {
      margin-bottom: 0;
    }
    .mh__list {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .mh__row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto 8.5rem auto;
      grid-template-areas: 'name counts next menu';
      align-items: center;
      column-gap: var(--mf-s3);
      padding: var(--mf-s1) 0;
      border-top: 1px solid var(--mf-border);
    }
    .mh__name {
      grid-area: name;
      display: flex;
      align-items: baseline;
      gap: var(--mf-s2);
      min-width: 0;
    }
    .mh__name a {
      flex: 0 1 auto;
      min-width: 0;
      min-height: 24px;
      overflow: hidden;
      color: var(--mf-link);
      line-height: 24px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .mh__client {
      flex: 0 1 auto;
      min-width: 0;
      overflow: hidden;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .mh__counts {
      grid-area: counts;
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s1);
      justify-content: flex-end;
    }
    .mh__chip {
      display: inline-flex;
      align-items: center;
      padding: 0 var(--mf-s2);
      border: 1px solid var(--mf-border);
      border-radius: 999px;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
      line-height: 1.6;
      white-space: nowrap;
    }
    .mh__chip strong {
      margin-right: 0.25em;
      font-variant-numeric: tabular-nums;
    }
    .mh__chip--danger {
      border-color: var(--mf-danger);
      background: var(--mf-danger-bg);
      color: var(--mf-danger);
      font-weight: 600;
    }
    .mh__chip--warning {
      border-color: var(--mf-warning);
      background: var(--mf-warning-bg);
      color: var(--mf-warning);
      font-weight: 600;
    }
    .mh__next {
      grid-area: next;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
      text-align: right;
      white-space: nowrap;
    }
    .mh__menu {
      grid-area: menu;
    }
    @media (max-width: 639.98px) {
      /* A card of two lines: the matter and its menu, then the counts and the next deadline. */
      .mh__row {
        grid-template-columns: minmax(0, 1fr) auto;
        grid-template-areas:
          'name menu'
          'counts next';
        row-gap: var(--mf-s1);
        padding: var(--mf-s2) 0;
      }
      .mh__name {
        flex-wrap: wrap;
        row-gap: 0;
      }
      .mh__name a {
        display: inline-flex;
        align-items: center;
        flex: 1 1 100%;
        min-height: 44px;
        white-space: normal;
      }
      .mh__client {
        flex: 1 1 100%;
        margin-top: -10px;
      }
      .mh__counts {
        justify-content: flex-start;
      }
      .mh__next {
        align-self: center;
      }
      .mh__link,
      .mh__empty .mf-btn,
      .mh__info {
        min-height: 44px;
      }
      .mh__link {
        display: inline-flex;
        align-items: center;
      }
    }
  `,
  template: `
    @if (!single()) {
      <mf-mm-panel
        name="health"
        title="Matters"
        [flat]="true"
        [state]="loader.state()"
        [busy]="loader.busy()"
        [bare]="bare()"
        (retry)="loader.load()"
      >
        @if (several()) {
          <a
            mfPanelActions
            class="mh__link"
            data-all-matters
            routerLink="/matters"
            [queryParams]="allParams()"
            [attr.aria-label]="'All matters, ' + total()"
            >All matters ({{ total() }})</a
          >
        }
        @if (several()) {
          <button
            mfPanelActions
            type="button"
            class="mf-btn mh__info"
            data-how
            aria-label="How the matters are ordered"
            aria-controls="mm-health-rule"
            [attr.aria-expanded]="howOpen()"
            (click)="howOpen.set(!howOpen())"
            (keydown.escape)="howOpen.set(false)"
          >
            <i class="pi pi-info-circle" aria-hidden="true"></i>
          </button>
        }
        @if (page(); as p) {
          @if (p.total === 0) {
            <div
              class="mh__empty"
              data-empty
              [attr.data-empty-kind]="filtered() ? 'filtered' : 'none'"
            >
              @if (filtered()) {
                <!-- The one "Clear filters" is in the filter bar (issue #920). -->
                <p>No matters match these filters.</p>
              } @else if (filters().scope === 'all') {
                <p>There are no active matters.</p>
              } @else {
                <p data-no-matters>You are not the project manager of any matter yet.</p>
                @if (canShowAll()) {
                  <button type="button" class="mf-btn" data-show-all (click)="showAll.emit()">
                    Show all matters
                  </button>
                } @else {
                  <p class="mh__muted">Ask a director to assign you.</p>
                }
                @if (canMyWork()) {
                  <a class="mh__link" routerLink="/my-work" data-to-my-work>Go to My Work</a>
                }
              }
            </div>
          } @else {
            @if (howOpen()) {
              <div class="mh__rule" id="mm-health-rule" data-rule>
                <p>
                  Worst first: the matter with the most overdue tasks, then the most at risk, then
                  the most unassigned, then the one with the soonest deadline.
                </p>
                <p>
                  <strong>Overdue</strong>: an open task past its due date.
                  <strong>At risk</strong>: an open task that has used at least 80 percent of its
                  task type's target time. <strong>Unassigned</strong>: a task with nobody assigned.
                  Who manages a matter, or whether anybody does, never changes the order.
                </p>
              </div>
            }
            <ul class="mh__list" aria-label="Matters, worst first" data-health-list>
              @for (r of p.items; track r.matterId) {
                <li class="mh__row" data-health-row [attr.data-matter-id]="r.matterId">
                  <span class="mh__name">
                    <a
                      data-matter-link
                      [routerLink]="['/matters', r.matterId]"
                      mfRowLink="my-matters-health"
                      [rowKey]="r.matterId"
                      [attr.title]="r.matterRef + ' ' + r.matterName"
                      >{{ r.matterRef }} {{ r.matterName }}</a
                    >
                    @if (severalClients()) {
                      <span class="mh__client" data-client>{{ r.clientName }}</span>
                    }
                  </span>
                  <span class="mh__counts">
                    <span
                      class="mh__chip"
                      [class.mh__chip--danger]="r.overdue > 0"
                      data-overdue
                      [attr.data-count]="r.overdue"
                      ><strong>{{ r.overdue }}</strong> overdue</span
                    >
                    @if (r.atRisk > 0) {
                      <span class="mh__chip mh__chip--warning" data-at-risk
                        ><strong>{{ r.atRisk }}</strong> at risk</span
                      >
                    }
                    @if (r.unassigned > 0) {
                      <span class="mh__chip mh__chip--warning" data-unassigned
                        ><strong>{{ r.unassigned }}</strong> unassigned</span
                      >
                    }
                  </span>
                  <span class="mh__next" data-next
                    ><span class="mf-sr-only">Next deadline </span>{{ next(r) }}</span
                  >
                  <span class="mh__menu" data-row-actions>
                    <mf-action-menu
                      [floating]="true"
                      [label]="menus().get(r.matterId)!.label"
                      [items]="menus().get(r.matterId)!.items"
                    />
                  </span>
                </li>
              }
            </ul>
          }
        }
      </mf-mm-panel>
    }
    @if (commentRow(); as row) {
      <mf-add-comment-dialog
        [matterId]="row.matterId"
        [matterLabel]="row.matterRef + ' ' + row.matterName"
        [(visible)]="commentOpen"
      />
    }
  `,
})
export class HealthPanel {
  readonly filters = input.required<MmFilters>();
  /** The page's filters differ from the default (the empty state then offers Clear filters, not "ask a director"). */
  readonly filtered = input(false);
  readonly showAll = output<void>();

  private readonly api = inject(MyMattersClient);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly clock = inject(Clock);
  private readonly zone = inject(USER_TIME_ZONE);
  protected readonly howOpen = signal(false);

  protected readonly loader = panelLoader(
    () => this.filters(),
    () => {
      const a = commonArgs(this.filters());
      return this.api.getMyMattersHealth(
        'worst',
        undefined,
        1,
        MATTERS_SHOWN,
        a.scope,
        a.role,
        a.clientId,
        undefined,
        undefined,
        a.managerId,
      );
    },
  );

  private readonly states = inject(OverviewStates, { optional: true });
  protected readonly page = computed(() => this.loader.data());
  protected readonly total = computed(() => this.page()?.total ?? 0);
  protected readonly several = computed(() => this.total() > 1);
  /** One matter: nothing to compare, the panel is not drawn (the strip names and links it). */
  protected readonly single = computed(
    () => this.loader.state() === 'ready' && this.page()?.total === 1,
  );
  /** No matter to list: a line (with what to do about it), no card (issue #920). */
  protected readonly bare = computed(
    () => this.loader.state() === 'ready' && (this.page()?.total ?? 1) === 0,
  );
  /** The client is named on a row only when the matters belong to two or more clients. */
  protected readonly severalClients = computed(
    () => new Set((this.page()?.items ?? []).map((r) => r.clientId)).size > 1,
  );
  protected readonly canShowAll = computed(() => this.auth.has('Matter.AssignManagers'));
  protected readonly canMyWork = computed(() => this.auth.has('Task.View'));
  /** The row whose "Add comment" is open (the dialog posts to one of that matter's open tasks). */
  protected readonly commentRow = signal<MyMattersHealthRow | null>(null);
  protected readonly commentOpen = signal(false);
  protected readonly allParams = computed(() =>
    mattersListParams(this.filters(), this.auth.profile()?.userId ?? 0),
  );

  constructor() {
    // Back from a matter puts focus on the row that was left.
    restoreRowFocus('my-matters-health', () => this.loader.state() === 'ready');
    effect(() =>
      this.states?.report(
        'health',
        this.loader.state() !== 'ready'
          ? 'loading'
          : (this.page()?.total ?? 1) > 0
            ? 'content'
            : this.filtered()
              ? 'nomatch'
              : 'none',
      ),
    );
  }

  protected next(r: MyMattersHealthRow): string {
    const when = shortDate(r.nextDeadline, calendarDayInZone(this.clock.now(), this.zone).year, '');
    return when ? `next ${when}` : 'no deadline';
  }

  /** The row's quick actions in one menu, New task first (it used to be a button of its own). Built once per answer, not on every change detection. */
  protected readonly menus = computed(
    () => new Map((this.page()?.items ?? []).map((r) => [r.matterId, this.buildMenu(r)] as const)),
  );

  private buildMenu(r: MyMattersHealthRow) {
    return matterActionMenu(
      { matterId: r.matterId, matterRef: r.matterRef, name: r.matterName, isActive: true },
      (p) => this.auth.has(p),
      {
        newTask: () => this.newTask(r),
        bulk: () =>
          void this.router.navigate(['/matters', r.matterId], {
            queryParams: { tab: 'tasks' },
            state: { selectTasks: true },
          }),
        addComment: () => {
          this.commentRow.set(r);
          this.commentOpen.set(true);
        },
        openTasks: () =>
          void this.router.navigate(['/tasks'], { queryParams: { matter: r.matterId } }),
      },
    );
  }

  /** Create task with the matter fixed; the page returns here (with the filters) when the task is created or the form is left. */
  protected newTask(r: MyMattersHealthRow): void {
    void this.router.navigate(['/tasks/new'], {
      queryParams: { matterId: r.matterId, returnTo: this.router.url },
    });
  }
}
