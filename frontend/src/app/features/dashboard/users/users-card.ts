import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import {
  WorkloadPriority,
  WorkloadThresholds,
  WorkloadUser,
} from '../../../api/generated/api-client';
import { availabilityDisplay, shortDay } from '../../../core/availability/availability';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { calendarDayInZone } from '../../../core/time/time';
import { levelBars, priorityColors } from '../../../shared/ui/priority-badge';
import { Density, cardState, cardSummary, loadLevelOf, segmentsOf, toneOf } from './users-model';
import { UsersGlyph } from './users-glyph';

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
 * One person on the Team workload board, as a small tile (about 150 x 52 px). Row 1 is the name (truncated; the tooltip and the accessible
 * name carry the whole status). Row 2 is a colour pill (the highest priority colours with a level glyph and the open count; a green check
 * when nothing is open; a grey calendar when out of office), the load bar split by priority, and small icon marks for overdue work, a heavy
 * load and off hours. A left edge in the pill colour repeats the highest priority. No sentences on the tile: colour, hatching and icons carry
 * the state, and the legend explains them. The name is the button that opens the person's tasks and stretches over the whole tile; the Assign
 * icon sits above it and appears on hover or focus. Operational capacity only: no completion counts, speed or ranking.
 *
 * `density="compact"` is the dense variant: one row with the pill, the name and the marks.
 */
@Component({
  selector: 'mf-users-card',
  imports: [UsersGlyph],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.compact]': "density() === 'compact'" },
  template: `
    @let u = user();
    @let st = state();
    @let b = band();
    <article
      class="tile"
      [class.tile--ooo]="st === 'ooo'"
      [class.tile--free]="st === 'free'"
      [class.tile--heavy]="level() === 'HEAVY'"
      [attr.data-user-card]="u.userId"
      [attr.data-user]="u.displayName"
      [attr.data-state]="st"
      [attr.data-tone]="tone()"
      [attr.data-load]="level()"
      [attr.data-availability]="u.availability.state"
      [style.border-left-color]="st === 'ooo' ? null : b.fg"
    >
      <p class="name">
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
      </p>
      <div class="meta" aria-hidden="true">
        <span
          class="pill"
          data-pill
          [style.background]="b.bg"
          [style.color]="b.fg"
          [style.border-color]="b.fg"
        >
          @if (st === 'busy') {
            <mf-users-glyph data-glyph [level]="bars()" [attr.data-bars]="bars()" />
          } @else {
            <i class="pi" [class]="b.icon" data-state-icon></i>
          }
          @if (u.openTotal > 0) {
            <strong class="n" data-open-total>{{ u.openTotal }}</strong>
          }
        </span>
        <span class="marks">
          @if (u.overdue > 0) {
            <span class="mark mark--late" data-overdue [attr.data-count]="u.overdue"
              ><i class="pi pi-clock"></i>{{ u.overdue }}</span
            >
          }
          @if (level() === 'HEAVY') {
            <i class="pi pi-exclamation-triangle mark mark--heavy" data-heavy></i>
          }
          @if (u.availability.state === 'OFF_HOURS') {
            <i class="pi pi-moon mark" data-off-hours></i>
          }
        </span>
      </div>
      <span class="track" aria-hidden="true" data-load-bar [attr.data-open]="u.openTotal">
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
    .tile {
      position: relative;
      display: grid;
      gap: 3px;
      align-content: start;
      height: 100%;
      min-width: 0;
      padding: 5px 6px 5px 6px;
      overflow: hidden;
      background: var(--mf-surface);
      border: 1px solid var(--mf-border);
      border-left: 4px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
    }
    .tile:hover {
      border-color: var(--mf-border-strong);
    }
    .tile--free {
      background: var(--mf-success-bg);
      border-color: var(--mf-success);
    }
    .tile--ooo {
      border-style: dashed;
      border-color: var(--mf-border-strong);
      background: repeating-linear-gradient(
        135deg,
        var(--mf-surface-alt) 0 6px,
        var(--mf-surface) 6px 12px
      );
    }
    .tile--heavy {
      box-shadow: inset 0 0 0 1px var(--mf-danger);
    }
    .name {
      margin: 0;
      min-width: 0;
      font-size: var(--mf-fs-sm);
      line-height: 1.3;
    }
    .open {
      display: block;
      max-width: 100%;
      padding: 0;
      border: 0;
      background: none;
      color: var(--mf-text);
      font: inherit;
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
      border-radius: var(--mf-radius);
    }
    .open:focus-visible {
      outline: none;
    }
    .open:focus-visible::after {
      outline: 2px solid var(--mf-focus);
      outline-offset: 1px;
    }
    .meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 5px;
      min-width: 0;
      height: 18px;
    }
    .pill {
      flex: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      box-sizing: border-box;
      min-width: 1.5rem;
      height: 18px;
      padding: 0 5px;
      border: 1px solid;
      border-radius: 9px;
      font-size: var(--mf-fs-xs);
      line-height: 1;
    }
    .pill .pi {
      font-size: 0.7rem;
    }
    .n {
      font-variant-numeric: tabular-nums;
    }
    .tile--ooo .pill {
      border-style: dashed;
      background: var(--mf-surface);
    }
    .track {
      display: flex;
      height: 7px;
      overflow: hidden;
      background: var(--mf-surface-alt);
      border: 1px solid var(--mf-border-strong);
      border-radius: 999px;
    }
    .tile--free .track {
      background: transparent;
      border-style: dashed;
      border-color: var(--mf-success);
    }
    .seg {
      flex: none;
      height: 100%;
      min-width: 3px;
    }
    .tile--ooo .seg {
      opacity: 0.6;
    }
    .marks {
      flex: none;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
    }
    .mark {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      font-size: 0.7rem;
    }
    .mark--late {
      color: var(--mf-danger);
      font-size: var(--mf-fs-xs);
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    .mark--heavy {
      color: var(--mf-danger);
    }
    .assign {
      position: absolute;
      top: 2px;
      right: 2px;
      z-index: 1;
      display: inline-grid;
      place-items: center;
      width: 24px;
      height: 24px;
      padding: 0;
      color: var(--mf-text);
      background: var(--mf-surface);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      font-size: 0.75rem;
      cursor: pointer;
      opacity: 0;
    }
    .tile:hover .assign,
    .tile:focus-within .assign,
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
    /* No hover on a touch screen: the drawer has the Assign icon, so the tile keeps its whole name. */
    @media (hover: none) {
      .assign {
        display: none;
      }
    }
    /* Dense: one row (pill, name, marks), no bar. */
    :host(.compact) .tile {
      display: flex;
      align-items: center;
      gap: 5px;
      padding-block: 3px;
    }
    :host(.compact) .meta {
      display: contents;
    }
    :host(.compact) .pill {
      order: -1;
    }
    :host(.compact) .name {
      flex: 1;
    }
    :host(.compact) .track {
      display: none;
    }
    :host(.compact) .assign {
      top: 50%;
      transform: translateY(-50%);
    }
  `,
})
export class UsersCard {
  private readonly zone = inject(USER_TIME_ZONE);
  private readonly clock = inject(Clock);

  readonly user = input.required<WorkloadUser>();
  readonly legend = input<readonly WorkloadPriority[]>([]);
  readonly thresholds = input<WorkloadThresholds | null>(null);
  readonly density = input<Density>('comfortable');
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
  protected readonly band = computed<Band>(() => bandOf(this.user()));
  /** Level bars of the priority glyph: 4 for the most urgent rank down to 1, as on the priority badge. */
  protected readonly bars = computed(() => levelBars(this.user().topPriority?.rank));

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
        bg: 'var(--mf-success-bg)',
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
