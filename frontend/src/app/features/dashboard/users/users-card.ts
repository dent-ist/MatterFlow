import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import {
  WorkloadPriority,
  WorkloadThresholds,
  WorkloadUser,
} from '../../../api/generated/api-client';
import { availabilityDisplay, shortDay } from '../../../core/availability/availability';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { calendarDayInZone } from '../../../core/time/time';
import { priorityColors } from '../../../shared/ui/priority-badge';
import {
  IDLE_TINT,
  LOAD_ICONS,
  LOAD_LABELS,
  cardState,
  cardSummary,
  loadLevelOf,
  segmentsOf,
  toneOf,
} from './users-model';

/** The colours, icon and phrase of a person's state: priority colours when something is open, green when free, hatched grey when out of office. */
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
 * One person on the Team workload board as a card (US-05, #1096), simple on purpose: the name with the avatar initials, Workload (the open-task count, the load bar split by priority and
 * the level word) and the Availability (icon and word: Available, Out of office until ..., Off hours). Overdue work shows only as a red badge when there is some. The name is the button
 * that opens the person's drawer and it stretches over the whole card; the Assign icon sits above it and appears on hover or focus. Operational capacity only: no completion counts, speed
 * or ranking.
 */
@Component({
  selector: 'mf-users-card',
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
      <p class="head">
        <span class="avatar" aria-hidden="true">{{ u.initials }}</span>
        <button
          type="button"
          class="open"
          data-user-open
          [id]="'wl-open-' + u.userId"
          [attr.aria-label]="summary()"
          [attr.title]="summary()"
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
        <span class="lbl">Workload</span>
        <span class="row">
          <strong class="n" data-open-total>{{ u.openTotal }}</strong>
          <span class="track" data-load-bar [attr.data-open]="u.openTotal">
            @for (s of segments(); track s.priorityId) {
              <span
                class="seg"
                [attr.data-segment]="s.label"
                [style.width.%]="s.percent"
                [style.background]="colorsOf(s.color).bg"
                [style.box-shadow]="'inset 0 0 0 1px ' + colorsOf(s.color).fg"
              ></span>
            }
          </span>
          <span class="lvl" data-level-word
            ><i class="pi" [class]="icons[level()]"></i>{{ labels[level()] }}</span
          >
        </span>
      </div>
      <div class="av" aria-hidden="true" data-availability-line>
        <span class="chip" [class]="'chip chip--' + avail().tone">
          <i class="pi" [class]="avail().icon"></i>{{ avail().label }}
        </span>
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
      min-width: 0;
    }
    .card {
      position: relative;
      display: grid;
      gap: var(--mf-s2);
      align-content: start;
      height: 100%;
      min-width: 0;
      padding: var(--mf-s3);
      background: var(--mf-surface);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius-lg);
    }
    .card:hover {
      border-color: var(--mf-border-strong);
    }
    .card--ooo {
      border-style: dashed;
      background: repeating-linear-gradient(
        135deg,
        var(--mf-surface-alt) 0 6px,
        var(--mf-surface) 6px 12px
      );
    }
    .card--heavy {
      box-shadow: inset 0 0 0 1px var(--mf-danger);
    }
    .head {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      min-width: 0;
      margin: 0;
    }
    .avatar {
      flex: none;
      display: inline-grid;
      place-items: center;
      width: 2rem;
      height: 2rem;
      color: var(--mf-primary);
      background: var(--mf-selected-bg);
      border: 1px solid var(--mf-primary);
      border-radius: 50%;
      font-size: var(--mf-fs-xs);
      font-weight: 700;
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
    .late {
      flex: none;
      display: inline-flex;
      align-items: center;
      gap: 3px;
      padding: 0 var(--mf-s2);
      color: var(--mf-danger);
      background: var(--mf-danger-bg);
      border: 1px solid var(--mf-danger);
      border-radius: 999px;
      font-size: var(--mf-fs-xs);
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    .wl {
      display: grid;
      gap: 2px;
    }
    .lbl {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
      font-weight: 600;
    }
    .row {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
    }
    .n {
      min-width: 1.5rem;
      font-size: var(--mf-fs-lg);
      font-variant-numeric: tabular-nums;
    }
    .track {
      display: flex;
      flex: 1 1 auto;
      min-width: 3rem;
      height: 0.75rem;
      overflow: hidden;
      background: var(--mf-surface-alt);
      border: 1px solid var(--mf-border-strong);
      border-radius: 999px;
    }
    .seg {
      flex: none;
      height: 100%;
      min-width: 3px;
    }
    .card--ooo .seg {
      opacity: 0.6;
    }
    .lvl {
      flex: none;
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .card--heavy .lvl {
      color: var(--mf-danger);
      font-weight: 700;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      max-width: 100%;
      padding: 0 var(--mf-s2);
      border: 1px solid currentColor;
      border-radius: 999px;
      font-size: var(--mf-fs-xs);
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .chip--success {
      color: var(--mf-success);
      background: var(--mf-success-bg);
    }
    .chip--warning {
      color: var(--mf-warning);
      background: var(--mf-warning-bg);
    }
    .chip--neutral {
      color: var(--mf-text-muted);
      background: var(--mf-surface-alt);
      border-style: dashed;
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
      font-size: 0.8rem;
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
  protected readonly segments = computed(() =>
    segmentsOf(this.user(), this.legend(), this.thresholds()),
  );
  protected readonly avail = computed(() =>
    availabilityDisplay(this.user().availability, this.zone, this.clock.now()),
  );
  protected readonly summary = computed(() => cardSummary(this.user(), this.avail().label));
  protected readonly icons = LOAD_ICONS;
  protected readonly labels = LOAD_LABELS;

  protected colorsOf(tone: string) {
    return priorityColors(tone);
  }
}

/** The colours, icon and phrase of a user: priority colours when something is open, green when free, hatched grey when out of office. */
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
