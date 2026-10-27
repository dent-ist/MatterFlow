import type { SearchHit } from '../../api/generated/api-client';
import {
  calendarDayInZone,
  dayIndex,
  formatCalendarDay,
  formatMonthDay,
  parseDateOnly,
} from '../../core/time/time';
import { formatSize } from '../assets/disposition/asset-size';

const OPEN = new Set(['NEW', 'IN_PROGRESS', 'ON_HOLD']);

/**
 * The due fact of a task hit (PM v2, #885): "Due Oct 27", "Overdue Oct 20" (an open task whose day is past in the viewer's zone), "ASAP" (an open task
 * with no date) and nothing for a closed task or a hit that is not a task. The year shows only when it is not this year.
 */
export function hitDueText(hit: SearchHit, now: Date, zone: string): string {
  if (hit.type !== 'task' || !hit.status || !OPEN.has(hit.status)) return '';
  const day = hit.dueDate
    ? parseDateOnly(hit.dueDate)
    : hit.dueAtUtc
      ? calendarDayInZone(hit.dueAtUtc, zone)
      : null;
  if (!day) return 'ASAP';
  const today = calendarDayInZone(now, zone);
  const text = day.year === today.year ? formatMonthDay(day) : formatCalendarDay(day);
  return dayIndex(day) < dayIndex(today) ? `Overdue ${text}` : `Due ${text}`;
}

/** True when {@link hitDueText} says overdue (the shared overdue colour applies). */
export function hitIsOverdue(text: string): boolean {
  return text.startsWith('Overdue');
}

/** The size of an asset hit, "412 GB"; an empty string when it has none. */
export function hitSizeText(hit: SearchHit): string {
  return formatSize(hit.sizeValue, hit.sizeUnit);
}
