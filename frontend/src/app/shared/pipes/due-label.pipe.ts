import { Pipe, PipeTransform, inject } from '@angular/core';
import { Clock, USER_TIME_ZONE } from '../../core/time/clock';
import { DueInput, DueState, describeDue } from '../../core/time/time';

/**
 * `{{ task | dueLabel: task.statusCode }}`: `ASAP` when there is no due date, otherwise the
 * date (floating) or instant (viewer's local zone + abbreviation) with `Due soon` / `Overdue 4d`.
 * Use `dueState` when a template needs the kind for styling.
 */
@Pipe({ name: 'dueLabel' })
export class DueLabelPipe implements PipeTransform {
  private readonly clock = inject(Clock);
  private readonly zone = inject(USER_TIME_ZONE);

  transform(due: DueInput | null | undefined, status?: string | null): string {
    return describeDue(due, this.clock.now(), this.zone, status).label;
  }
}

/** Same inputs as `dueLabel`, returns the structured state (`kind`, `badge`, `tooltip`...). */
@Pipe({ name: 'dueState' })
export class DueStatePipe implements PipeTransform {
  private readonly clock = inject(Clock);
  private readonly zone = inject(USER_TIME_ZONE);

  transform(due: DueInput | null | undefined, status?: string | null): DueState {
    return describeDue(due, this.clock.now(), this.zone, status);
  }
}
