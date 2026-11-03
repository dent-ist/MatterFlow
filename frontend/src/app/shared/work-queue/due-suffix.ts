import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Clock, USER_TIME_ZONE } from '../../core/time/clock';
import { DueCell, DueInput, describeDueCell } from '../../core/time/time';
import { numericDate, numericInstant } from '../ui/numeric-date';

/** What the Due cell of the Dashboard grid shows (decision AS item 3): the date, and when overdue a compact suffix, on ONE line. */
export interface DashDue {
  /** `ASAP`, `12/05 09:00 AM`, `12/05`, `12/05/2027`, or `-` for a closed task without a due date. */
  dateText: string;
  /** `+9d`, `+7h` or `+<1h` while the task is overdue; null otherwise (today, tomorrow and later have no suffix). */
  suffix: string | null;
  /** The suffix in words: `9 days overdue`, `7 hours overdue`, `less than 1 hour overdue`; null without a suffix. */
  words: string | null;
  /** The one spoken name of the cell: `Due 12/05 at 09:00 AM, 9 days overdue`. */
  name: string;
  /** The full date with the zone for the tooltip, then the words. */
  tooltip: string;
  overdue: boolean;
}

/** `Overdue 9d` (line 2 of the shared Due logic) to `+9d`; `Overdue <1h` to `+<1h`. Day and hour boundaries are the shared logic's (floor, viewer's clock). */
export function suffixOf(cell: DueCell): string | null {
  if (cell.tone !== 'overdue' || !cell.line2.startsWith('Overdue ')) return null;
  return `+${cell.line2.slice('Overdue '.length)}`;
}

/** `+9d` to `9 days overdue`, `+1d` to `1 day overdue`, `+7h` to `7 hours overdue`, `+<1h` to `less than 1 hour overdue`. */
export function suffixWords(suffix: string): string {
  if (suffix === '+<1h') return 'less than 1 hour overdue';
  const n = Number.parseInt(suffix.slice(1), 10);
  const unit = suffix.endsWith('h') ? 'hour' : 'day';
  return `${n} ${unit}${n === 1 ? '' : 's'} overdue`;
}

/**
 * The Due cell of the Dashboard grid. The overdue maths is the shared Due logic (`describeDueCell`: the instant for a timed due, the viewer's
 * calendar day for a date-only due, days floored, then hours), so this cell and the Task Queue never disagree about whether a task is overdue.
 * A closed task shows its plain date (never red).
 */
export function dashDue(
  due: DueInput | null | undefined,
  now: Date,
  zone: string,
  status?: string | null,
): DashDue {
  const cell = describeDueCell(due, now, zone, status);
  if (cell.tone === 'asap') {
    return {
      dateText: 'ASAP',
      suffix: null,
      words: null,
      name: 'No due date, ASAP',
      tooltip: cell.tooltip,
      overdue: false,
    };
  }
  const timed = !!due?.dueAtUtc && !Number.isNaN(new Date(due.dueAtUtc).getTime());
  const dateText = timed
    ? numericInstant(due?.dueAtUtc as string, now, zone)
    : numericDate(due?.dueDate ?? null, now, zone);
  const suffix = suffixOf(cell);
  const words = suffix ? suffixWords(suffix) : null;
  const name = words ? `Due ${dateText}, ${words}` : `${cell.sentence}`;
  return {
    dateText,
    suffix,
    words,
    name,
    tooltip: words ? `${cell.tooltip}\n${words}` : cell.tooltip,
    overdue: suffix !== null,
  };
}

/** `12 m`, `2 h 48 m`, `3 d 4 h`: how long a task has waited (the Unassigned for column and the gauge). */
export function ageText(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ${String(m % 60).padStart(2, '0')} m`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

/**
 * The Due cell of the Dashboard grid (`mf-due-suffix-cell`, decision AS item 3): the numeric date and, while overdue, a compact red `+9d` / `+7h` on the SAME line.
 * The suffix is text (with the words in the tooltip and in the accessible name), so red is never the only signal. The visible parts are `aria-hidden`; one visually
 * hidden sentence is the spoken name of the cell.
 */
@Component({
  selector: 'mf-due-suffix-cell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let d = cell();
    <span class="ds" [class.ds--over]="d.overdue" [attr.title]="d.tooltip" data-due-suffix-cell>
      <span class="ds-sr">{{ d.name }}</span>
      <span class="ds-date" aria-hidden="true" data-due-date>{{ d.dateText }}</span>
      @if (d.suffix; as suffix) {
        <span class="ds-suffix" aria-hidden="true" data-due-suffix>{{ suffix }}</span>
      }
    </span>
  `,
  styles: `
    :host {
      position: relative;
      display: block;
      min-width: 0;
    }
    .ds {
      display: inline-flex;
      align-items: baseline;
      gap: var(--mf-s1);
      white-space: nowrap;
      font-size: 13px;
    }
    .ds--over {
      color: var(--mf-due-overdue);
    }
    .ds-suffix {
      font-weight: 700;
    }
    .ds-sr {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }
  `,
})
export class DueSuffixCell {
  private readonly clock = inject(Clock);
  private readonly zone = inject(USER_TIME_ZONE);
  readonly due = input.required<DueInput>();
  readonly status = input<string | null>(null);
  protected readonly cell = computed(() =>
    dashDue(this.due(), this.clock.now(), this.zone, this.status()),
  );
}
