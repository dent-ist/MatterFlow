import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { DashboardCapacity, DashboardSummary } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { Tip } from '../../../shared/ui/tip';
import { DashboardPrefs } from '../dashboard-prefs';
import { CardCounts, CardKey, DashCards } from './dash-cards';
import { DashBattery } from './dash-battery';
import { DashCompact } from './dash-compact';
import { DashGauge } from './dash-gauge';
import { DashGrid } from './dash-grid';
import { DashV4Api } from './dash-v4-api';

/**
 * The Summary tab of the Dashboard for anyone with Dashboard.ViewSummary (epic #1063, DB-03; the Technician's queue is the page's own view). Under the tabs: three Needs attention cards
 * that filter the grid; below, the task grid on the left (shared list standard) and a fixed-width right column with the capacity battery (Dashboard.ViewUsers) and the unassigned gauge
 * (Dashboard.ViewSummary). ONE Hide Panel / Show Panel icon button at the far right of the cards row (it never moves) hides the column (#1233): the grid takes the full width and the compact battery and gauge sit on that row to the left of the button; the choice is remembered per user (`DashboardPrefs`). The page never scrolls on a desktop window; only the grid body and the right column do. Under 768 px (or on a very short window) it is one column: cards,
 * battery and gauge, then the tasks as cards. The page owns the data (it reads the summary and the Scope); this component draws it and reports what the person did.
 */
@Component({
  selector: 'mf-dash-summary',
  imports: [DashCards, DashGrid, DashBattery, DashGauge, DashCompact, Tip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-fill', '[attr.data-dash-summary]': '""' },
  template: `
    <div class="top" data-dash-top>
      <mf-dash-cards [counts]="counts()" [selected]="card()" (pick)="cardPick.emit($event)" />
      @if (showRight()) {
        <div class="tright" data-dash-compact-row>
          @if (collapsed()) {
            <mf-dash-compact
              data-dash-compact
              [capacity]="canUsers() ? capacity() : null"
              [gauge]="gauge()"
              (show)="showUnassigned()"
            />
          }
          <button
            type="button"
            class="mf-btn mf-btn--icon"
            data-panel-toggle
            [attr.aria-label]="collapsed() ? 'Show Panel' : 'Hide Panel'"
            [mfTip]="collapsed() ? 'Show Panel' : 'Hide Panel'"
            aria-controls="dash-rcol"
            [attr.aria-expanded]="!collapsed()"
            (click)="setCollapsed(!collapsed())"
          >
            <i
              class="pi"
              [class]="collapsed() ? 'pi-chevron-left' : 'pi-chevron-right'"
              aria-hidden="true"
            ></i>
          </button>
        </div>
      }
    </div>
    @if (noPodNote(); as note) {
      <!-- Tasks with no pod are in no scope but All pods: a quiet line so they cannot be lost. -->
      <p class="no-pod" data-no-pod-hint>
        {{ note }}
        <button
          type="button"
          class="mf-btn mf-btn--text"
          data-show-all-pods
          (click)="showAll($event)"
        >
          Show All Pods
        </button>
      </p>
    }
    <div class="body" [class.body--one]="!showRight() || collapsed()">
      <mf-dash-grid
        [summary]="summary()"
        [refreshKey]="refreshKey()"
        [card]="card()"
        [resetSortKey]="resetSort()"
        (assigned)="assigned.emit($event)"
      />
      @if (showRight()) {
        <div class="rcol" id="dash-rcol" [class.rcol--off]="collapsed()" data-dash-rcol>
          @if (canUsers()) {
            <mf-dash-battery
              [scope]="scope()"
              [refreshKey]="refreshKey()"
              (loaded)="capacity.set($event)"
              (showUnassigned)="showUnassigned()"
            />
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
    /* The cards row: the cards on the left, the compact battery and gauge and the Show Panel button right aligned on the same row, centred with the cards (#1233). The row is the container
       the compact widgets measure to drop their texts; it never wraps and never overflows. */
    .top {
      display: flex;
      flex: none;
      align-items: center;
      gap: var(--mf-s4);
      min-width: 0;
      container: top / inline-size;
    }
    .tright {
      display: flex;
      flex: 0 0 auto;
      margin-left: auto;
      align-items: center;
      justify-content: flex-end;
      gap: var(--mf-s3);
    }
    .tright mf-dash-compact {
      min-width: 0;
    }
    .tright .mf-btn {
      flex: none;
    }
    .rcol.rcol--off {
      display: none;
    }
    .no-pod {
      margin: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
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
    @media (max-width: 900px) {
      :host {
        --dash-rc: 272px;
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
      /* One column: the panel is always shown, so there is nothing to hide or show. */
      .rcol.rcol--off {
        display: flex;
      }
      .tright {
        display: none;
      }
    }
  `,
})
export class DashSummaryTab {
  private readonly auth = inject(AuthStore);
  private readonly v4 = inject(DashV4Api);
  private readonly prefs = inject(DashboardPrefs);

  readonly summary = input.required<DashboardSummary>();
  /** The page scope (`all`, `mine` or a pod id). */
  readonly scope = input.required<string>();
  readonly card = input<CardKey | null>(null);
  /** Changes whenever the page read the summary for the lists (a refresh, an assignment). */
  readonly refreshKey = input<unknown>(null);

  /** "4 unassigned tasks have no pod." under a Pod scope (null: nothing to say). */
  readonly noPodNote = input<string | null>(null);

  readonly cardPick = output<CardKey | null>();
  readonly showAllPods = output<void>();
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
  /** The right panel is hidden (remembered per user); only possible while there is something to hide. */
  protected readonly collapsed = computed(() => this.showRight() && this.prefs.panelCollapsed());
  /** The last good capacity read of the full battery, for the compact battery (no second request). */
  protected readonly capacity = signal<DashboardCapacity | null>(null);

  constructor() {
    this.prefs.ensureLoaded();
  }

  /** Hide or show the right panel. The one toggle button stays where it is (same element), so focus stays on it. */
  protected setCollapsed(collapsed: boolean): void {
    this.prefs.setPanelCollapsed(collapsed);
  }

  protected showAll(event: Event): void {
    event.preventDefault();
    this.showAllPods.emit();
  }

  /** The gauge: select the Unassigned card and sort it longest waiting first. */
  protected showUnassigned(): void {
    this.resetSort.update((n) => n + 1);
    this.cardPick.emit('unassigned');
  }
}
