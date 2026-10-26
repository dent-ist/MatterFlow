import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';
import { DayHours, WEEK_DAYS } from '../../core/availability/availability-edit';

/**
 * The compact work hours of My profile (epic #520, P3, #534): seven day toggle buttons (Mon to Sun, `aria-pressed`, labelled with the full
 * day name) and ONE pair of times, "From 09:00 AM to 05:00 PM on the days above". It edits the same `DayHours[]` as the per-day grid (the
 * data model is unchanged): switching a day on gives it the pair's times, switching it off keeps its times for later, and changing the pair
 * writes the new times to all seven days, so a day switched on afterwards already has them. It never collapses a week whose days differ:
 * the form shows the per-day grid for such a week (#535) and this control only while the working days share one pair.
 *
 * Tab stops: seven toggles and two time fields (hour, minute and AM/PM each; the native picker button is left out of the tab order), 13 in
 * all, instead of about 50 for the seven-row grid.
 */
@Component({
  selector: 'mf-work-hours-compact',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './work-hours-compact.scss',
  template: `
    <div class="wh">
      <div class="wh__days" role="group" aria-label="Working days" data-day-toggles>
        @for (d of week(); track d.day) {
          <button
            type="button"
            class="wh__day"
            [attr.aria-pressed]="d.working"
            [attr.aria-label]="name(d.day)"
            [attr.data-day-toggle]="d.day"
            (click)="toggle(d.day)"
          >
            {{ short(d.day) }}
          </button>
        }
      </div>
      <div class="wh__pair" data-hours-pair>
        <span class="wh__word" aria-hidden="true">From</span>
        <input
          type="time"
          id="av-hours-start"
          class="mf-control wh__time"
          aria-label="Start time"
          [attr.aria-invalid]="problem() ? 'true' : null"
          [attr.aria-describedby]="problem() ? 'av-hours-error' : null"
          [value]="pair().start"
          (input)="setPair({ start: $any($event.target).value })"
        />
        <span class="wh__word" aria-hidden="true">to</span>
        <input
          type="time"
          id="av-hours-end"
          class="mf-control wh__time"
          aria-label="End time"
          [attr.aria-invalid]="problem() ? 'true' : null"
          [attr.aria-describedby]="problem() ? 'av-hours-error' : null"
          [value]="pair().end"
          (input)="setPair({ end: $any($event.target).value })"
        />
        <span class="wh__word">on the days above</span>
      </div>
      @if (problem(); as e) {
        <p class="wh__error" id="av-hours-error" role="alert" data-hours-error>
          <i class="pi pi-exclamation-circle" aria-hidden="true"></i> {{ e }}
        </p>
      }
      @if (none()) {
        <p class="wh__note" data-no-days>No working days selected: shown as off hours all week.</p>
      }
    </div>
  `,
})
export class WorkHoursCompact {
  /** The seven days, Monday first (the form's own signal: this control edits it in place). */
  readonly week = model.required<DayHours[]>();
  /** One problem with the pair (the form validates the week), shown under it. */
  readonly problem = input<string | null>(null);

  /** The shared pair: the first working day's times (every day holds them while the week is uniform), else Monday's. */
  protected readonly pair = computed(() => {
    const w = this.week();
    const d = w.find((x) => x.working) ?? w[0];
    return { start: d.start, end: d.end };
  });
  protected readonly none = computed(() => this.week().every((d) => !d.working));

  protected name(day: number): string {
    return WEEK_DAYS[day - 1].name;
  }

  protected short(day: number): string {
    return WEEK_DAYS[day - 1].short;
  }

  protected toggle(day: number): void {
    const { start, end } = this.pair();
    this.week.update((w) =>
      w.map((d) => (d.day === day ? { ...d, working: !d.working, start, end } : d)),
    );
  }

  protected setPair(patch: { start?: string; end?: string }): void {
    this.week.update((w) => w.map((d) => ({ ...d, ...patch })));
  }
}
