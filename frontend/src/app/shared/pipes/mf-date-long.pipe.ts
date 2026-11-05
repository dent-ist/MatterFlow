import { Pipe, PipeTransform, inject } from '@angular/core';
import { USER_TIME_ZONE } from '../../core/time/clock';
import { MfDateKind, mfDateLong } from '../../core/time/time';

/**
 * `{{ value | mfDateLong }}`: the LONG readable form, for a tooltip (`[attr.title]`), an `aria-label` or a sentence only: `Oct 12, 2026` for a calendar
 * date (`yyyy-MM-dd`), `Oct 12, 2026, 10:23 PM EDT` for an instant in the viewer's zone. What a grid, a field, a chip or a feed shows is `mfNum`
 * (`MM/DD hh:mm AM/PM`, D-60, #1146). A spec (`mf-date-long-use.spec.ts`) fails when a template prints `mfDateLong` anywhere else.
 */
@Pipe({ name: 'mfDateLong' })
export class MfDateLongPipe implements PipeTransform {
  private readonly zone = inject(USER_TIME_ZONE);

  transform(value: string | Date | number | null | undefined, kind: MfDateKind = 'auto'): string {
    return mfDateLong(value, this.zone, kind);
  }
}
