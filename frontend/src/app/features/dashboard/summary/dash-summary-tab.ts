import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { DashboardSummary } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { CardCounts, CardKey, DashCards } from './dash-cards';
import { DashBattery } from './dash-battery';
import { DashGauge } from './dash-gauge';
import { DashGrid } from './dash-grid';
import { DashV4Api } from './dash-v4-api';

/**
 * The Summary tab of the Dashboard for anyone with Dashboard.ViewSummary (epic #1063, DB-03; the Technician's queue is the page's own view). Under the tabs: three Needs attention cards
 * that filter the grid; below, the task grid on the left (shared list standard) and a fixed-width right column with the capacity battery (Dashboard.ViewUsers) and the unassigned gauge
 * (Dashboard.ViewSummary). The page never scrolls on a desktop window; only the grid body and the right column do. Under 768 px (or on a very short window) it is one column: cards,
 * battery and gauge, then the tasks as cards. The page owns the data (it reads the summary and the Scope); this component draws it and reports what the person did.
 */
@Component({
  selector: 'mf-dash-summary',
  imports: [DashCards, DashGrid, DashBattery, DashGauge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-fill', '[attr.data-dash-summary]': '""' },
  template: `
    <mf-dash-cards [counts]="counts()" [selected]="card()" (pick)="cardPick.emit($event)" />
    <div class="body" [class.body--one]="!showRight()">
      <mf-dash-grid
        [summary]="summary()"
        [refreshKey]="refreshKey()"
        [card]="card()"
        [resetSortKey]="resetSort()"
        (assigned)="assigned.emit($event)"
      />
      @if (showRight()) {
        <div class="rcol" data-dash-rcol>
          @if (canUsers()) {
            <mf-dash-battery [scope]="scope()" [refreshKey]="refreshKey()" />
          }
          @if (gauge(); as g) {
            <mf-dash-gauge [gauge]="g" (show)="showUnassigned()" />
          }
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      display: flex;
      min-height: 0;
      min-width: 0;
      flex-direction: column;
      gap: var(--mf-s3);
    }
    .body {
      display: grid;
      min-height: 0;
      flex: 1 1 auto;
      grid-template-columns: minmax(0, 1fr) var(--dash-rc, 340px);
      gap: var(--mf-s3);
    }
    .body--one {
      grid-template-columns: minmax(0, 1fr);
    }
    .rcol {
      display: flex;
      min-height: 0;
      flex-direction: column;
      gap: var(--mf-s3);
      overflow: auto;
      overscroll-behavior: contain;
      padding: 2px;
    }
    @media (max-width: 1100px) {
      :host {
        --dash-rc: 300px;
      }
    }
    /* A phone, a narrow window or a very short one: one column and the page scrolls (reflow, 200% zoom). Battery and gauge sit between the cards and the tasks. */
    @media (max-width: 767.98px), (max-height: 560.98px) {
      .body {
        display: flex;
        flex-direction: column;
      }
      .rcol {
        order: -1;
        overflow: visible;
      }
    }
  `,
})
export class DashSummaryTab {
  private readonly auth = inject(AuthStore);
  private readonly v4 = inject(DashV4Api);

  readonly summary = input.required<DashboardSummary>();
  /** The page scope (`all`, `mine` or a pod id). */
  readonly scope = input.required<string>();
  readonly card = input<CardKey | null>(null);
  /** Changes whenever the page read the summary for the lists (a refresh, an assignment). */
  readonly refreshKey = input<unknown>(null);

  readonly cardPick = output<CardKey | null>();
  readonly assigned = output<{ taskNumber: string; name: string }>();

  protected readonly resetSort = signal(0);

  protected readonly counts = computed<CardCounts>(() => ({
    overdue: this.summary().overdue.count,
    unassigned: this.summary().unassigned.count,
    onHold: this.summary().onHold.count,
  }));
  protected readonly canUsers = computed(() => this.auth.has('Dashboard.ViewUsers'));
  protected readonly gauge = computed(() =>
    this.auth.has('Dashboard.ViewSummary') ? this.v4.gaugeOf(this.summary()) : null,
  );
  protected readonly showRight = computed(() => this.canUsers() || this.gauge() !== null);

  /** The gauge: select the Unassigned card and sort it longest waiting first. */
  protected showUnassigned(): void {
    this.resetSort.update((n) => n + 1);
    this.cardPick.emit('unassigned');
  }
}
