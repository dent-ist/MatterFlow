import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { Badge, BadgeTone } from '../../../shared/ui/badge';
import { Dismissable } from '../../../shared/ui/dismissable';
import {
  WorkloadSummary,
  WorkloadThresholds,
  WorkloadUser,
} from '../../../api/generated/api-client';
import { UserStateIcon, UserStateKey } from '../../../shared/icons/user-state-icon';
import { UsersFilters, legendStates } from './users-model';
import { UsersState } from './users-state';

export const WHO_IS_COUNTED =
  'This tab lists every active user with a role who is in a pod or holds open tasks. The Team capacity battery and the Calendar count only people who can execute workflow and are in a pod of the scope, so their number is lower.';

/**
 * The ONE filter bar above the cards (US-01, #1091, US-05, #1096): the four load levels (Idle, Light, Normal, Heavy) as buttons of one fixed size (not proportional to the people), then Out of office and Off hours, each a toggle (`aria-pressed`) with its icon, word and count. The unassigned link and the Assign work menu (projected as `mfBarEnd`)
 * sit at the end of the same row and the population line wraps under it. Load segments combine (any of them); Out of office and Off hours are the availability filter. Counts of
 * the load segments and Off hours follow the people on the board (the page scope and the name filter apply); Out of office while "Available" hides them comes from the team summary, which
 * follows the page scope and ignores the availability and name filters. An info button says who is counted (the capacity battery counts fewer people).
 */
@Component({
  selector: 'mf-users-summary',
  imports: [Badge, Dismissable, UserStateIcon, UsersState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="row">
      <div class="chips" data-summary data-capacity-bar>
        <mf-users-state
          [users]="users()"
          [filters]="filters()"
          (statesChange)="statesChange.emit($event)"
        />
        <span class="who-wrap">
          <button
            #whoBtn
            type="button"
            class="mf-btn mf-btn--icon info"
            data-who-counted
            aria-label="What the states mean and who is counted"
            title="What the states mean and who is counted"
            aria-haspopup="dialog"
            [attr.aria-expanded]="whoOpen()"
            (click)="whoOpen.set(!whoOpen())"
          >
            <i class="pi pi-info-circle" aria-hidden="true"></i>
          </button>
          @if (whoOpen()) {
            <div
              class="who mf-menu mf-menu--filter"
              role="dialog"
              aria-label="What the states mean and who is counted"
              data-who-popover
              [mfDismissable]="whoBtn"
              (dismissed)="whoOpen.set(false)"
            >
              <section class="sec" aria-labelledby="wl-states-h" data-legend>
                <h3 id="wl-states-h">What the States Mean</h3>
                <ul class="states" data-legend-states>
                  @for (st of states(); track st.key) {
                    <li [attr.data-state]="st.key">
                      <mf-badge [tone]="stateTone(st.key)" [ownIcon]="true"
                        ><mf-user-state-icon mfBadgeIcon [state]="st.key" />{{ st.word }}</mf-badge
                      >&ngsp;<span class="line">{{ st.line }}</span>
                    </li>
                  }
                </ul>
              </section>
              <section class="sec" aria-labelledby="wl-who-h">
                <h3 id="wl-who-h">Who Is Counted</h3>
                <p class="wt" data-who-text>{{ who }}</p>
                @if (population(); as line) {
                  <p class="pop" data-users-population>
                    <span data-users-population-text>{{ line.text }}</span>
                    <button
                      type="button"
                      class="mf-btn mf-btn--text"
                      data-users-population-toggle
                      [attr.aria-pressed]="populationOn()"
                      (click)="populationToggle.emit()"
                    >
                      {{ line.action }}
                    </button>
                  </p>
                }
              </section>
            </div>
          }
        </span>
      </div>
      <ng-content />
    </div>
  `,
  styles: `
    :host {
      display: block;
      margin-bottom: var(--mf-s2);
    }
    /* The unassigned link and Assign work (projected) sit at the right end of the state row; they wrap after the state buttons. */
    :host ::ng-deep [mfBarEnd] {
      margin-left: auto;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s1) var(--mf-s3);
    }
    /* The state buttons are all the same size (the widest label with its count), left aligned and not stretched: the width does not follow the number of people. */
    .chips {
      display: flex;
      flex: 0 1 auto;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s1) var(--mf-s2);
      min-width: 0;
    }
    .who-wrap {
      position: relative;
      display: inline-flex;
      align-self: center;
    }
    .who {
      position: absolute;
      top: calc(100% + var(--mf-s1));
      left: 0;
      z-index: 40;
      max-height: calc(100vh - 14rem);
    }
    .who > .sec {
      padding: var(--mf-s2);
    }
    .who h3 {
      margin: 0 0 var(--mf-s2);
      font-size: var(--mf-fs-md);
    }
    .sec + .sec {
      margin-top: var(--mf-s3);
      padding-top: var(--mf-s3);
      border-top: 1px solid var(--mf-border-soft);
    }
    .who p {
      margin: 0 0 var(--mf-s2);
      font-size: var(--mf-fs-sm);
    }
    .who p:last-child {
      margin-bottom: 0;
    }
    .pop {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s1) var(--mf-s2);
      color: var(--mf-text-muted);
    }
    .info {
      align-self: center;
    }
    .states {
      display: grid;
      gap: var(--mf-s2);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .states li {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
    }
    .line {
      color: var(--mf-text);
      font-size: var(--mf-fs-sm);
    }

    @media (max-width: 560px) {
      .row {
        display: block;
      }
    }
  `,
})
export class UsersSummary {
  /** The badge tone of a workload state in the legend: Idle healthy, Light info, Normal neutral, Heavy danger, Out of Office and Off Hours as the availability badge says. */
  protected stateTone(key: UserStateKey): BadgeTone {
    switch (key) {
      case 'idle':
        return 'success';
      case 'light':
        return 'info';
      case 'heavy':
        return 'danger';
      case 'out':
        return 'warning';
      default:
        return 'neutral';
    }
  }

  readonly summary = input<WorkloadSummary | null>(null);
  readonly users = input<readonly WorkloadUser[]>([]);
  readonly filters = input.required<UsersFilters>();
  readonly thresholds = input<WorkloadThresholds | null>(null);

  readonly statesChange = output<UserStateKey[]>();

  protected readonly who = WHO_IS_COUNTED;
  /** The six states with their icon and ONE line each; the load lines use the real thresholds. */
  protected readonly states = computed(() => legendStates(this.thresholds()));
  protected readonly whoOpen = signal(false);

  /** The "Showing 60 people ... Show them" line (the page's population rule) and its action: both live in the Who is counted popover. */
  readonly population = input<{ text: string; action: string } | null>(null);
  readonly populationOn = input(false);
  readonly populationToggle = output<void>();
}
