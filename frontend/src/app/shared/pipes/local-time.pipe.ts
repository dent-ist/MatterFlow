import { Pipe, PipeTransform, inject } from '@angular/core';
import { USER_TIME_ZONE } from '../../core/time/clock';
import { formatInstant } from '../../core/time/time';

/** Renders a UTC instant in the viewer's local zone with the abbreviation: `Oct 14, 2026 9:05 AM CDT`. */
@Pipe({ name: 'localTime' })
export class LocalTimePipe implements PipeTransform {
  private readonly zone = inject(USER_TIME_ZONE);

  transform(value: string | Date | null | undefined): string {
    if (!value) return '';
    const d = value instanceof Date ? value : new Date(value);
    return Number.isNaN(d.getTime()) ? '' : formatInstant(d, this.zone);
  }
}
