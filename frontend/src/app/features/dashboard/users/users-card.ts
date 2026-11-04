import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import {
  WorkloadPriority,
  WorkloadThresholds,
  WorkloadUser,
} from '../../../api/generated/api-client';
import { availabilityDisplay, shortDay } from '../../../core/availability/availability';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { calendarDayInZone } from '../../../core/time/time';
import { UserStateIcon, UserStateKey } from '../../../shared/icons/user-state-icon';
import { priorityColors } from '../../../shared/ui/priority-badge';
import {
  CARD_SLOTS,
  IDLE_TINT,
  LOAD_LABELS,
  cardState,
  legendStates,
  loadLevelOf,
  plural,
  toneOf,
} from './users-model';

/** The colours, icon and phrase of a person's state: priority colours when something is open, green when free, an amber band when out of office. */
export interface Band {
  icon: string;
  /** The words for tooltips and accessible names (the tile itself shows none of them). */
  label: string;
  bg: string;
  fg: string;
}

/** "Back on Oct 20" for a person out of office until the given instant (the end of their last day away), in the viewer's zone. */
export function backOnText(outUntil: string | undefined, zone: string, now: Date): string | null {
  if (!outUntil) return null;
  const day = calendarDayInZone(outUntil, zone);
  return `Back on ${shortDay(day, calendarDayInZone(now, zone))}`;
}

/**
 * One person on the Team workload board as a card (design B, US-09 #1100): the open-task count as a big number coloured by the load level with a small "OPEN" caption, the name,
 * three slot pips (the capacity rule of the Team capacity battery: filled up to the open tasks) and a red overdue badge only when above zero. There is NO "Available" chip (it is spoken in
 * the accessible name and tooltip); only the exceptions show: Off hours is the moon in the state icon (no extra row), Out of office tints the whole card amber and writes "Back Nov 7" in the count row. Every card has the same height. The name is the button
 * that opens the person's drawer and it stretches over the whole card; the Assign icon sits above it and appears on hover or focus. Operational capacity only: no completion counts or ranking.
 */
@Component({
  selector: 'mf-users-card',
  imports: [UserStateIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let u = user();
    @let st = state();
    <article
      class="card"
      [class.card--ooo]="st === 'ooo'"
      [class.card--heavy]="level() === 'HEAVY'"
      [attr.data-user-card]="u.userId"
      [attr.data-user]="u.displayName"
      [attr.data-state]="st"
      [attr.data-tone]="tone()"
      [attr.data-load]="level()"
      [attr.data-availability]="u.availability.state"
    >
      <div class="body">
        <mf-user-state-icon
          class="ico"
          data-state-icon-slot
          [state]="stateKey()"
          size="lg"
          [circle]="true"
        />
        <div class="main">
          <p class="head">
            <button
              type="button"
              class="open"
              data-user-open
              [id]="'wl-open-' + u.userId"
              [attr.aria-label]="summary()"
              [attr.title]="levelTip()"
              (click)="open.emit(u)"
            >
              {{ u.displayName }}
            </button>
            @if (u.overdue > 0) {
              <span
                class="late"
                data-overdue
                [attr.data-count]="u.overdue"
                [attr.title]="u.overdue + ' overdue'"
                aria-hidden="true"
                ><i class="pi pi-clock"></i>{{ u.overdue }}</span
              >
            }
          </p>
          <div class="wl" aria-hidden="true" data-workload>
            <strong class="n" data-open-total>{{ u.openTotal }}</strong
            >&ngsp;
            @if (st === 'ooo' && backText(); as back) {
              <span class="back" data-back-on><i class="pi pi-calendar"></i>{{ back }}</span>
            } @else {
              <span class="cap">open</span>
            }
            <span class="dots" [class]="'dots dots--' + level().toLowerCase()" data-slots>
              @for (p of pips(); track $index) {
                <i class="dot" [class.dot--on]="p" data-pip></i>
              }
              @if (u.openTotal > slots) {
                <span class="more" data-more>+{{ u.openTotal - slots }}</span>
              }
            </span>
          </div>
        </div>
      </div>
      @if (canAssign()) {
        <button
          type="button"
          class="assign"
          data-assign-work
          [attr.aria-label]="'Assign work to ' + u.displayName"
          [attr.title]="'Assign work to ' + u.displayName"
          (click)="assign.emit(u)"
        >
          <i class="pi pi-user-plus" aria-hidden="true"></i>
        </button>
      }
    </article>
  `,
  styles: `
    :host {
      display: block;
      height: 100%;
      min-width: 0;
    }
    /* Every card has the same height: the grid rows are fixed (see the tab), so no state can change it. */
    .card {
      position: relative;
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      height: 100%;
      min-width: 0;
      overflow: hidden;
      background: var(--mf-surface);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius-lg);
    }
    .card:hover {
      border-color: var(--mf-border-strong);
    }
    .card--heavy {
      box-shadow: inset 0 0 0 1px var(--mf-danger);
    }
    /* Out of office: the whole card is tinted amber with an amber border (the away-state tokens); the return date sits in the count row, so the height never changes. */
    .card--ooo {
      background: var(--mf-warning-bg);
      border-color: var(--mf-warning);
    }
    .back {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      color: var(--mf-warning);
      font-size: var(--mf-fs-sm);
      font-weight: 600;
      white-space: nowrap;
    }
    .back .pi {
      font-size: var(--mf-icon-sm);
    }
    .body {
      display: flex;
      flex: 1 1 auto;
      align-items: center;
      gap: var(--mf-s3);
      min-width: 0;
      padding: var(--mf-s3);
    }
    .main {
      display: grid;
      flex: 1 1 auto;
      gap: var(--mf-s1);
      min-width: 0;
    }
    .head {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      min-width: 0;
      margin: 0;
    }
    .open {
      flex: 1 1 auto;
      min-width: 0;
      padding: 0;
      border: 0;
      background: none;
      color: var(--mf-text);
      font: inherit;
      font-size: var(--mf-fs-md);
      font-weight: 600;
      text-align: left;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      cursor: pointer;
    }
    .open::after {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: var(--mf-radius-lg);
    }
    .open:focus-visible {
      outline: none;
    }
    .open:focus-visible::after {
      outline: 2px solid var(--mf-focus);
      outline-offset: 1px;
    }
    /* Overdue: just a red clock and the number (no pill, no border, no background). */
    .late {
      flex: none;
      display: inline-flex;
      align-items: center;
      gap: 3px;
      color: var(--mf-danger);
      font-size: var(--mf-fs-sm);
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    .late .pi {
      font-size: var(--mf-icon-sm);
    }
    /* The open count (about 24 px), its caption and the three capacity dots (the 3-slot rule of the Team capacity battery) on one line. */
    .wl {
      display: flex;
      align-items: baseline;
      gap: var(--mf-s1);
    }
    .n {
      font-size: 1.5rem;
      line-height: 1;
      font-variant-numeric: tabular-nums;
    }
    .cap {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .dots {
      display: inline-flex;
      align-items: center;
      align-self: center;
      gap: var(--mf-s1);
      margin-left: auto;
    }
    .dot {
      width: 0.625rem;
      height: 0.625rem;
      background: var(--mf-surface-alt);
      border: 1px solid var(--mf-border-strong);
      border-radius: 50%;
    }
    .dots--idle .dot--on {
      background: var(--mf-success);
      border-color: var(--mf-success);
    }
    .dots--light .dot--on {
      background: var(--mf-info);
      border-color: var(--mf-info);
    }
    .dots--normal .dot--on {
      background: var(--mf-text-muted);
      border-color: var(--mf-text-muted);
    }
    .dots--heavy .dot--on {
      background: var(--mf-danger);
      border-color: var(--mf-danger);
    }
    .more {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
      font-weight: 600;
    }
    .assign {
      position: absolute;
      right: var(--mf-s2);
      bottom: var(--mf-s2);
      z-index: 1;
      display: inline-grid;
      place-items: center;
      width: 28px;
      height: 28px;
      padding: 0;
      color: var(--mf-text);
      background: var(--mf-surface);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      font-size: var(--mf-icon-sm);
      cursor: pointer;
      opacity: 0;
    }
    .card:hover .assign,
    .card:focus-within .assign,
    .assign:focus-visible {
      opacity: 1;
    }
    .assign:hover {
      background: var(--mf-selected-bg);
    }
    .assign:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: 1px;
    }
    /* No hover on a touch screen: the drawer has the Assign icon. */
    @media (hover: none) {
      .assign {
        display: none;
      }
    }
  `,
})
export class UsersCard {
  private readonly zone = inject(USER_TIME_ZONE);
  private readonly clock = inject(Clock);

  readonly user = input.required<WorkloadUser>();
  readonly legend = input<readonly WorkloadPriority[]>([]);
  readonly thresholds = input<WorkloadThresholds | null>(null);
  readonly canAssign = input(false);

  readonly open = output<WorkloadUser>();
  readonly assign = output<WorkloadUser>();

  protected readonly state = computed(() => cardState(this.user()));
  protected readonly tone = computed(() => toneOf(this.user()));
  protected readonly level = computed(() => loadLevelOf(this.user()));
  protected readonly avail = computed(() =>
    availabilityDisplay(this.user().availability, this.zone, this.clock.now()),
  );
  /** "Ann Lee, 3 open tasks, Light, Available" (Available is spoken here, never drawn). */
  protected readonly summary = computed(() => {
    const u = this.user();
    return `${u.displayName}, ${plural(u.openTotal, 'open task')}, ${LOAD_LABELS[this.level()]}, ${this.avail().label}`;
  });
  /** "Back Nov 7" for the count row of an Out of office card (the full wording is in the tooltip and the accessible name). */
  protected readonly backText = computed(() => {
    const b = backOnText(this.user().availability?.outUntil, this.zone, this.clock.now());
    return b ? b.replace('Back on ', 'Back ') : null;
  });
  protected readonly slots = CARD_SLOTS;
  /** One filled dot per open task up to the slots; the rest are empty (more than the slots: all filled and a small +N). */
  protected readonly pips = computed(() =>
    Array.from({ length: CARD_SLOTS }, (_, i) => i < this.user().openTotal),
  );
  /** The state icon: Out of office wins, then Off hours, then the load level (the shape says it, the colour supports it). */
  protected readonly stateKey = computed<UserStateKey>(() => {
    const u = this.user();
    if (u.availability?.state === 'OUT_OF_OFFICE') return 'out';
    if (u.availability?.state === 'OFF_HOURS') return 'off';
    return this.level().toLowerCase() as UserStateKey;
  });
  /** The tooltip: the level with its meaning, from the board's thresholds ("Light: 1 to 3 open tasks"), and the availability. */
  protected readonly levelTip = computed(() => {
    const key = this.level().toLowerCase();
    const line = legendStates(this.thresholds()).find((l) => l.key === key)?.line ?? '';
    return `${LOAD_LABELS[this.level()]}: ${line}. ${this.avail().label}`;
  });
  protected readonly labels = LOAD_LABELS;
}

/** The colours, icon and phrase of a user: priority colours when something is open, green when free, an amber band when out of office. */
export function bandOf(u: WorkloadUser): Band {
  switch (cardState(u)) {
    case 'ooo':
      return {
        icon: 'pi-calendar-minus',
        label: 'Out of office',
        bg: 'var(--mf-surface-alt)',
        fg: 'var(--mf-text)',
      };
    case 'free':
      return {
        icon: 'pi-check-circle',
        label: 'No open tasks',
        bg: IDLE_TINT,
        fg: 'var(--mf-success)',
      };
    default: {
      const colors = priorityColors(u.topPriority?.color);
      return {
        icon: 'pi-flag-fill',
        label: `Highest priority: ${u.topPriority?.label ?? 'none'}`,
        bg: colors.bg,
        fg: colors.fg,
      };
    }
  }
}
