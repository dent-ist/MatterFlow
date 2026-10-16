import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { DueInput, describeDue } from '../../../core/time/time';

/**
 * The due chip of a Dashboard list row: the same words, icons and tokens as the due chip of the Swimlane card (ASAP, "Overdue 2d",
 * "Due today", "Tomorrow", else the date in the viewer's zone). Icon and words carry the meaning, colour only adds to it. The full date
 * (with time and zone when the task has one) is the tooltip.
 */
@Component({
  selector: 'mf-due-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let d = state();
    <span [class]="'chip chip--' + d.kind" [attr.data-due-kind]="d.kind" [attr.title]="tip()">
      @switch (d.kind) {
        @case ('asap') {
          <i class="pi pi-bolt" aria-hidden="true"></i>ASAP
        }
        @case ('overdue') {
          <i class="pi pi-exclamation-circle" aria-hidden="true"></i>{{ d.badge }}
        }
        @case ('soon') {
          @if (d.daysUntil === 0) {
            <i class="pi pi-clock" aria-hidden="true"></i>Due today
          } @else if (d.daysUntil === 1) {
            Tomorrow
          } @else {
            {{ short() }}
          }
        }
        @default {
          {{ short() }}
        }
      }
    </span>
  `,
  styles: `
    :host {
      display: inline-flex;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      font-size: var(--mf-fs-sm);
      color: var(--mf-text);
      white-space: nowrap;
    }
    .chip--overdue {
      color: var(--mf-due-overdue);
      font-weight: 700;
    }
    .chip--soon {
      color: var(--mf-due-soon);
      font-weight: 700;
    }
    .chip--asap {
      color: var(--mf-asap);
      font-weight: 700;
    }
  `,
})
export class DueChip {
  private readonly clock = inject(Clock);
  private readonly zone = inject(USER_TIME_ZONE);

  readonly due = input.required<DueInput>();
  readonly status = input<string | null>(null);

  protected readonly state = computed(() =>
    describeDue(this.due(), this.clock.now(), this.zone, this.status()),
  );
  /** "Nov 4" for a date in this year, "Nov 4, 2027" otherwise. */
  protected readonly short = computed(() => {
    const text = this.state().dateText;
    const year = new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: this.zone }).format(
      this.clock.now(),
    );
    return text.replace(`, ${year}`, '');
  });
  protected readonly tip = computed(() => {
    const d = this.state();
    return d.kind === 'asap' ? d.tooltip : d.dateText || null;
  });
}
