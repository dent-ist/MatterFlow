import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Clock, USER_TIME_ZONE } from '../../core/time/clock';
import { CLOSED_STATUSES, DueInput, describeDueCell } from '../../core/time/time';

/**
 * The Due cell of the work grids (#209), one component for My Work, Task Queue, Pod Work and the Matter and Project grids.
 * Two-line layout (Comfortable): line 1 the date (the year only outside the current year), line 2 the relative text in bold with its tone
 * (overdue red with the alert icon, due today amber with the clock, tomorrow and in 2 days bold neutral, later and closed no line 2;
 * ASAP one centred line with the bolt). Inline layout (Compact and cards): `Oct 17 · Overdue 6h` on one line. Icon and words carry the
 * meaning, colour only adds to it. The visible lines are `aria-hidden`; a visually hidden sentence is the one spoken name of the cell,
 * and the tooltip is the full date with the zone. Closed tasks are plain: muted date, no bolt, no red.
 */
@Component({
  selector: 'mf-due-cell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let c = cell();
    <span
      class="dc"
      [class]="'dc dc--' + tone() + (layout() === 'inline' ? ' dc--inline' : '')"
      [attr.data-due-tone]="tone()"
      [attr.title]="tip()"
    >
      <span class="dc-sr">{{ sentence() }}{{ riskShown() ? '. At risk' : '' }}</span>
      @if (tone() === 'asap') {
        <span class="dc-l1" aria-hidden="true"><i class="pi pi-bolt"></i>ASAP</span>
      } @else if (tone() === 'none-closed') {
        <span class="dc-l1" aria-hidden="true">-</span>
      } @else {
        <time class="dc-l1" aria-hidden="true" [attr.datetime]="iso()">{{
          lead() + (layout() === 'inline' ? c.dateText : c.line1)
        }}</time>
        @if (c.line2 && !closed()) {
          <span class="dc-l2" aria-hidden="true">
            @if (tone() === 'overdue') {
              <i class="pi pi-exclamation-circle"></i>
            } @else if (tone() === 'today') {
              <i class="pi pi-clock"></i>
            }
            {{ c.line2 }}
          </span>
        }
      }
      @if (riskShown() && (tone() === 'asap' || !c.line2)) {
        <span class="dc-l2 dc-risk" aria-hidden="true" data-at-risk>
          <i class="pi pi-clock"></i>At risk
        </span>
      }
    </span>
  `,
  styles: `
    :host {
      position: relative;
      display: block;
      min-width: 0;
    }
    .dc {
      display: flex;
      flex-direction: column;
      justify-content: center;
      line-height: 18px;
      white-space: nowrap;
    }
    .dc-l2 {
      font-weight: 700;
    }
    .dc .pi {
      margin-right: var(--mf-s1);
      font-size: 0.9em;
    }
    /* Compact: 136 px less the cell padding holds "Overdue 120d"; the date gives way (ellipsis, the full date is the tooltip). */
    .dc--inline {
      flex-direction: row;
      align-items: baseline;
      gap: var(--mf-s1);
      font-size: 13px;
    }
    .dc--inline .dc-l1 {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .dc--inline .dc-l2 {
      flex: none;
    }
    .dc--inline .pi {
      display: none;
    }
    .dc--overdue,
    .dc--overdue .dc-l2 {
      color: var(--mf-due-overdue);
    }
    .dc-risk {
      color: var(--mf-due-soon);
    }
    .dc--today .dc-l2 {
      color: var(--mf-due-soon);
    }
    .dc--asap {
      color: var(--mf-asap);
      font-weight: 700;
    }
    .dc--closed,
    .dc--none-closed {
      color: var(--mf-text-muted);
    }
    .dc-sr {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }
    @media print {
      .dc,
      .dc .pi {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
    }
  `,
})
export class DueCell {
  private readonly clock = inject(Clock);
  private readonly zone = inject(USER_TIME_ZONE);

  /** The row (or any object with `dueDate` / `dueAtUtc`). */
  readonly due = input.required<DueInput>();
  readonly status = input<string | null>(null);
  readonly layout = input<'two-line' | 'inline'>('two-line');
  /** Extra tooltip line after the full date (the Dashboard lists put "Created 3 days ago" here). */
  readonly extraTip = input('');
  /** A closed task says "Was due Oct 14" (the Task page's Due tile, B2 #302); the work lists show the plain date. */
  readonly wasDue = input(false);

  /** PM v2 (#878): the task is At risk (the server's rule: open, not overdue, 80 percent of the type's target used). Said in words, never colour alone. */
  readonly atRisk = input(false);

  protected readonly riskShown = computed(
    () => this.atRisk() && !this.closed() && this.tone() !== 'overdue',
  );
  protected readonly closed = computed(() => CLOSED_STATUSES.includes(this.status() ?? ''));
  protected readonly lead = computed(() => (this.wasDue() && this.closed() ? 'Was due ' : ''));
  protected readonly cell = computed(() =>
    describeDueCell(this.due(), this.clock.now(), this.zone, this.status()),
  );
  /** A closed task without a due date shows a muted dash and no ASAP. */
  protected readonly tone = computed(() => {
    const t = this.cell().tone;
    return t === 'asap' && this.closed() ? 'none-closed' : t;
  });
  protected readonly sentence = computed(() =>
    this.tone() === 'none-closed' ? 'No due date' : this.cell().sentence,
  );
  protected readonly tip = computed(() => {
    const extra = [
      this.riskShown() ? 'At risk: 80 percent of the target turnaround used' : '',
      this.extraTip(),
    ]
      .filter(Boolean)
      .join('\n');
    return extra ? `${this.cell().tooltip}\n${extra}` : this.cell().tooltip;
  });
  protected readonly iso = computed(() => this.due().dueAtUtc ?? this.due().dueDate ?? null);
}
