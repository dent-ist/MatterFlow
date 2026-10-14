import { HttpInterceptorFn } from '@angular/common/http';

/** Header carrying the browser's IANA time zone; the server falls back to the firm zone when absent or invalid. */
export const TIME_ZONE_HEADER = 'X-Time-Zone';

export function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/** Adds `X-Time-Zone: <IANA id>` to every API request (addendum M). */
export const timeZoneInterceptor: HttpInterceptorFn = (req, next) => {
  const zone = browserTimeZone();
  if (!zone || req.headers.has(TIME_ZONE_HEADER)) {
    return next(req);
  }
  return next(req.clone({ setHeaders: { [TIME_ZONE_HEADER]: zone } }));
};
