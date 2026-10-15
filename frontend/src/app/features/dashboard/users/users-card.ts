import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  WorkloadPriority,
  WorkloadThresholds,
  WorkloadUser,
} from '../../../api/generated/api-client';
import { availabilityDisplay, shortDay } from '../../../core/availability/availability';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { calendarDayInZone, describeDue } from '../../../core/time/time';
import { priorityColors } from '../../../shared/ui/priority-badge';
import {
  Density,
  LOAD_ICONS,
  LOAD_LABELS,
  cardState,
  cardSummary,
  countsOf,
  loadLevelOf,
  plural,
  segmentsOf,
  thresholdText,
  toneOf,
} from './users-model';

/** The coloured band of a card: icon, text and colours (the badge pair of the priority, or the green and grey states). */
export interface Band {
  icon: string;
  text: string;
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
 * One person on the Team workload board. The band at the top carries the card colour and always says it in words: the highest priority of the
 * open tasks (the badge colours of that priority), "Available - no open tasks" (green) or "Not available" (hatched grey, with the return date and
 * note). Below: avatar, name, availability chip, pods, a count badge per priority in rank order (zeros muted), open total, overdue, due soon,
 * on hold, next due and a segmented load bar with its Free, Light, Normal or Heavy label. The name is the button that opens the person's tasks;
 * it stretches over the whole card and "Assign work" sits above it. Operational capacity only: no completion counts, speed or ranking.
 */
@Component({
  selector: 'mf-users-card',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.compact]': "density() === 'compact'" },
  template: `
    @let u = user();
    @let st = state();
    <article
      class="card"
      [class.card--ooo]="st === 'ooo'"
      [class.card--free]="st === 'free'"
      [attr.data-user-card]="u.userId"
      [attr.data-user]="u.displayName"
      [attr.data-state]="st"
      [attr.data-tone]="tone()"
      [attr.data-load]="level()"
      [attr.data-availability]="u.availability.state"
    >
      <div
        class="band"
        data-band
        [class.band--ooo]="st === 'ooo'"
        [style.background]="band().bg"
        [style.color]="band().fg"
      >
        <i class="pi" [class]="band().icon" aria-hidden="true"></i>
        <span class="band-text" data-band-text
          ><span class="pill">{{ band().text }}</span></span
        >
      </div>

      <div class="body">
        <div class="head">
          <span class="avatar" aria-hidden="true">{{ u.initials }}</span>
          <div class="who">
            <h3 class="name">
              <button
                type="button"
                class="open"
                data-user-open
                [id]="'wl-open-' + u.userId"
                [attr.aria-label]="u.displayName + '. ' + summary() + '. Open tasks'"
                (click)="open.emit(u)"
              >
                {{ u.displayName }}
              </button>
            </h3>
            <span class="chip" [class]="'chip chip--' + avail().tone" data-avail-chip>
              <i class="pi" [class]="avail().icon" aria-hidden="true"></i>
              {{ avail().label }}
            </span>
          </div>
        </div>

        @if (u.pods.length > 0 && !isCompact()) {
          <ul class="pods" aria-label="Pods" data-pods>
            @for (p of u.pods; track p.podId) {
              <li class="pod">{{ p.name }}</li>
            }
          </ul>
        }

        @if (st === 'ooo') {
          <p class="back" data-back>
            <i class="pi pi-calendar-minus" aria-hidden="true"></i>
            <strong>{{ back() ?? 'No return date set' }}</strong>
          </p>
          @if (u.availability.note) {
            <p class="note" data-note>{{ u.availability.note }}</p>
          }
        } @else if (st === 'free') {
          <p class="free" data-free>
            <i class="pi pi-check-circle" aria-hidden="true"></i> No open tasks
          </p>
        }

        @if (u.openTotal > 0) {
          <ul class="prio" aria-label="Open tasks by priority" data-priority-counts>
            @for (c of counts(); track c.priority.priorityId) {
              @if (c.count > 0 || !isCompact()) {
                <li
                  class="pc"
                  [class.pc--zero]="c.count === 0"
                  [attr.data-priority-count]="c.priority.label"
                  [attr.data-count]="c.count"
                  [style.background]="c.count > 0 ? colorsOf(c.priority.color).bg : null"
                  [style.color]="c.count > 0 ? colorsOf(c.priority.color).fg : null"
                  [style.border-color]="c.count > 0 ? colorsOf(c.priority.color).fg : null"
                >
                  {{ c.priority.label }} <strong>{{ c.count }}</strong>
                </li>
              }
            }
          </ul>
        }

        <dl class="stats">
          <div class="stat" data-open-total>
            <dt>Open</dt>
            <dd>{{ u.openTotal }}</dd>
          </div>
          <div class="stat" [class.stat--warn]="u.overdue > 0" data-overdue>
            <dt><i class="pi pi-exclamation-circle" aria-hidden="true"></i>Overdue</dt>
            <dd>{{ u.overdue }}</dd>
          </div>
          <div class="stat" [class.stat--soon]="u.dueSoon > 0" data-due-soon>
            <dt><i class="pi pi-clock" aria-hidden="true"></i>Due soon</dt>
            <dd>{{ u.dueSoon }}</dd>
          </div>
          <div class="stat" data-hold>
            <dt><i class="pi pi-pause" aria-hidden="true"></i>On hold</dt>
            <dd>{{ u.onHold }}</dd>
          </div>
        </dl>

        @if (u.nextDue && !isCompact()) {
          <p class="next" data-next-due [class.next--overdue]="u.nextDue.isOverdue">
            <i
              class="pi"
              [class]="u.nextDue.isOverdue ? 'pi-exclamation-circle' : 'pi-calendar'"
              aria-hidden="true"
            ></i>
            Next due
            <a class="ref mf-ref" [routerLink]="['/tasks', u.nextDue.taskId]">{{
              u.nextDue.ref
            }}</a>
            <span>{{ nextDueText() }}</span>
          </p>
        }

        <div class="load" data-load-row>
          <div class="track" role="img" data-load-bar [attr.aria-label]="barLabel()">
            @for (s of segments(); track s.priorityId) {
              <span
                class="seg"
                [attr.data-segment]="s.label"
                [style.width.%]="s.percent"
                [style.background]="colorsOf(s.color).bg"
                [style.box-shadow]="'inset 0 0 0 1px ' + colorsOf(s.color).fg"
              ></span>
            }
          </div>
          <span class="level" [attr.data-load-label]="level()" [attr.title]="help()">
            <i class="pi" [class]="loadIcon()" aria-hidden="true"></i>
            {{ loadLabel() }}
          </span>
        </div>

        @if (canAssign()) {
          <div class="actions">
            <button
              type="button"
              class="mf-btn assign"
              data-assign-work
              [attr.aria-label]="'Assign work to ' + u.displayName"
              (click)="assign.emit(u)"
            >
              <i class="pi pi-user-plus" aria-hidden="true"></i>Assign work
            </button>
          </div>
        }
      </div>
    </article>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .card {
      position: relative;
      display: flex;
      flex-direction: column;
      height: 100%;
      min-width: 0;
      overflow: hidden;
      background: var(--mf-surface);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius-lg);
      box-shadow: var(--mf-shadow-1);
    }
    .card:hover {
      border-color: var(--mf-border-strong);
    }
    .card--ooo {
      border-style: dashed;
      border-color: var(--mf-border-strong);
      background: repeating-linear-gradient(
        135deg,
        var(--mf-surface-alt) 0 8px,
        var(--mf-surface) 8px 16px
      );
    }
    .band {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      padding: var(--mf-s1) var(--mf-s3);
      font-size: var(--mf-fs-sm);
      font-weight: 600;
      border-bottom: 1px solid rgb(0 0 0 / 12%);
    }
    .band--ooo {
      color: var(--mf-text);
      background: repeating-linear-gradient(
        135deg,
        var(--mf-border) 0 6px,
        var(--mf-surface-alt) 6px 12px
      ) !important;
    }
    .band--ooo .pill {
      padding: 0 var(--mf-s2);
      color: var(--mf-text);
      background: var(--mf-surface);
      border-radius: var(--mf-radius);
    }
    .body {
      display: grid;
      gap: var(--mf-s2);
      align-content: start;
      flex: 1;
      min-width: 0;
      padding: var(--mf-s3);
    }
    .head {
      display: flex;
      align-items: center;
      gap: var(--mf-s3);
      min-width: 0;
    }
    .avatar {
      flex: none;
      display: inline-grid;
      place-items: center;
      width: 2.5rem;
      height: 2.5rem;
      color: var(--mf-primary);
      background: var(--mf-selected-bg);
      border: 1px solid var(--mf-primary);
      border-radius: 50%;
      font-size: var(--mf-fs-sm);
      font-weight: 700;
    }
    .who {
      display: grid;
      gap: 2px;
      justify-items: start;
      min-width: 0;
    }
    .name {
      margin: 0;
      font-size: var(--mf-fs-md);
      line-height: 1.3;
    }
    .open {
      max-width: 100%;
      padding: 0;
      border: 0;
      background: none;
      color: var(--mf-text);
      font: inherit;
      font-weight: 600;
      text-align: left;
      cursor: pointer;
      overflow-wrap: anywhere;
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
      outline-offset: 2px;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      padding: 0 var(--mf-s2);
      border: 1px solid currentColor;
      border-radius: 999px;
      font-size: var(--mf-fs-xs);
      font-weight: 600;
      white-space: nowrap;
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
    .pods {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s1);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .pod {
      padding: 0 var(--mf-s2);
      color: var(--mf-text-muted);
      background: var(--mf-surface-alt);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius);
      font-size: var(--mf-fs-xs);
    }
    .back,
    .free,
    .note {
      margin: 0;
    }
    .back {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      color: var(--mf-text);
      font-size: var(--mf-fs-md);
    }
    .note {
      color: var(--mf-text);
      font-size: var(--mf-fs-sm);
      font-style: italic;
      overflow-wrap: anywhere;
    }
    .free {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      color: var(--mf-success);
      font-weight: 600;
    }
    .prio {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s1);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .pc {
      padding: 0 var(--mf-s2);
      border: 1px solid;
      border-radius: var(--mf-radius);
      font-size: var(--mf-fs-xs);
      white-space: nowrap;
    }
    .pc--zero {
      color: var(--mf-text-muted);
      border-style: dashed;
      border-color: var(--mf-border-strong);
      font-weight: 400;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: var(--mf-s1) var(--mf-s2);
      margin: 0;
    }
    .stat dt {
      display: flex;
      align-items: center;
      gap: 3px;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
      white-space: nowrap;
    }
    .stat dd {
      margin: 0;
      font-size: var(--mf-fs-lg, 1.125rem);
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    .stat--warn dt,
    .stat--warn dd {
      color: var(--mf-danger);
    }
    .stat--soon dt,
    .stat--soon dd {
      color: var(--mf-warning);
    }
    .next {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s1);
      margin: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .next--overdue {
      color: var(--mf-danger);
    }
    .ref {
      position: relative;
      color: var(--mf-link);
      text-underline-offset: 2px;
    }
    .load {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
    }
    .track {
      display: flex;
      flex: 1;
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
    .level {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      font-size: var(--mf-fs-sm);
      font-weight: 600;
      white-space: nowrap;
    }
    [data-load='HEAVY'] .level {
      color: var(--mf-danger);
    }
    .actions {
      position: relative;
      display: flex;
      margin-top: var(--mf-s1);
    }
    .assign {
      position: relative;
    }
    :host(.compact) .body {
      gap: var(--mf-s1);
      padding: var(--mf-s2);
    }
    :host(.compact) .avatar {
      width: 2rem;
      height: 2rem;
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
  protected readonly loadLabel = computed(() => LOAD_LABELS[this.level()]);
  protected readonly loadIcon = computed(() => LOAD_ICONS[this.level()]);
  protected readonly help = computed(() => thresholdText(this.thresholds()).join(' '));
  protected readonly isCompact = computed(() => this.density() === 'compact');
  protected readonly counts = computed(() => countsOf(this.user(), this.legend()));
  protected readonly segments = computed(() =>
    segmentsOf(this.user(), this.legend(), this.thresholds()),
  );
  protected readonly avail = computed(() =>
    availabilityDisplay(this.user().availability, this.zone),
  );
  protected readonly back = computed(() =>
    backOnText(this.user().availability.outUntil, this.zone, this.clock.now()),
  );
  protected readonly summary = computed(() =>
    cardSummary(this.user(), this.back() ?? this.avail().label),
  );
  protected readonly band = computed<Band>(() => bandOf(this.user()));

  protected readonly barLabel = computed(() => {
    const u = this.user();
    const parts = this.segments().map((s) => `${s.count} ${s.label}`);
    return `Load: ${plural(u.openTotal, 'open task')}${parts.length ? ' (' + parts.join(', ') + ')' : ''}. ${this.loadLabel()}.`;
  });

  protected readonly nextDueText = computed(() => {
    const n = this.user().nextDue;
    if (!n) return '';
    const due = describeDue(n, this.clock.now(), this.zone);
    return due.kind === 'asap' ? 'ASAP' : due.label;
  });

  protected colorsOf(tone: string) {
    return priorityColors(tone);
  }
}

/** The band of a user: priority colours when something is open, green when free, hatched grey when out of office. */
export function bandOf(u: WorkloadUser): Band {
  switch (cardState(u)) {
    case 'ooo':
      return {
        icon: 'pi-calendar-minus',
        text: 'Not available',
        bg: 'var(--mf-surface-alt)',
        fg: 'var(--mf-text)',
      };
    case 'free':
      return {
        icon: 'pi-check-circle',
        text: 'Available - no open tasks',
        bg: 'var(--mf-success-bg)',
        fg: 'var(--mf-success)',
      };
    default: {
      const colors = priorityColors(u.topPriority?.color);
      return {
        icon: 'pi-flag-fill',
        text: `Highest priority: ${u.topPriority?.label ?? 'none'}`,
        bg: colors.bg,
        fg: colors.fg,
      };
    }
  }
}
