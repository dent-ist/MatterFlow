import { Pipe, PipeTransform, inject } from '@angular/core';
import { USER_TIME_ZONE } from '../../core/time/clock';
import { MfDateKind, mfDate } from '../../core/time/time';

/**
 * `{{ value | mfDate }}`: `Oct 12, 2026` for a calendar date (`yyyy-MM-dd`), `Oct 12, 2026, 10:23 PM EDT` for an instant in the
 * viewer's zone. `{{ instant | mfDate: 'date' }}` shows only the day. See `mfDate` in core/time/time.ts (UXR-08).
 */
@Pipe({ name: 'mfDate' })
export class MfDatePipe implements PipeTransform {
  private readonly zone = inject(USER_TIME_ZONE);

  transform(value: string | Date | number | null | undefined, kind: MfDateKind = 'auto'): string {
    return mfDate(value, this.zone, kind);
  }
}
