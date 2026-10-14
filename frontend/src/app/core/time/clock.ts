import { Injectable, InjectionToken } from '@angular/core';

/** Injectable wall clock so time-dependent code (overdue, throttles) is testable. */
@Injectable({ providedIn: 'root' })
export class Clock {
  now(): Date {
    return new Date();
  }
}

/** The viewer's IANA time zone (addendum M). Override in tests. */
export const USER_TIME_ZONE = new InjectionToken<string>('USER_TIME_ZONE', {
  providedIn: 'root',
  factory: () => browserTimeZone(),
});

/** IANA zone from the browser, or `undefined` when unavailable. */
export function browserTimeZoneOrNull(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

export function browserTimeZone(): string {
  return browserTimeZoneOrNull() ?? 'UTC';
}
