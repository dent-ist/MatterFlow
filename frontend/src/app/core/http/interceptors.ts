import {
  HttpContextToken,
  HttpErrorResponse,
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import { Injector, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, from, map, mergeMap, of, throwError } from 'rxjs';
import { AuthStore } from '../auth/auth.store';
import { APP_PATHS } from '../auth/guards';
import { NotificationService } from '../notify/notification.service';
import { ErrorReferenceStore } from './error-reference-store';
import { USER_TIME_ZONE } from '../time/clock';
import { ApiError } from './api-error';

export const TIME_ZONE_HEADER = 'X-Time-Zone';
export const CSRF_HEADER = 'X-MatterFlow-Client';
export const CSRF_HEADER_VALUE = 'web';

/** Set `true` on a request's HttpContext when the caller handles its errors itself. */
export const SKIP_ERROR_TOAST = new HttpContextToken<boolean>(() => false);

/** Adds the viewer's IANA zone to every request (addendum M); the server validates it. */
export const timeZoneInterceptor: HttpInterceptorFn = (req, next) => {
  const zone = inject(USER_TIME_ZONE);
  return next(zone ? req.clone({ setHeaders: { [TIME_ZONE_HEADER]: zone } }) : req);
};

/** Custom header required on every state-changing request (architecture 6.6). */
export const csrfInterceptor: HttpInterceptorFn = (req, next) => {
  const safe = req.method === 'GET' || req.method === 'HEAD';
  return next(safe ? req : req.clone({ setHeaders: { [CSRF_HEADER]: CSRF_HEADER_VALUE } }));
};

/** Converts failures to `ApiError`, toasts non-field errors, refreshes permissions on 403. */
export const problemDetailsInterceptor: HttpInterceptorFn = (req, next) => {
  const injector = inject(Injector);
  return next(req).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse)) return throwError(() => error);
      return decodeBlobBody(error).pipe(
        mergeMap((decoded) => {
          const apiError = ApiError.from(decoded);
          if (!req.context.get(SKIP_ERROR_TOAST)) {
            const toast = toastFor(apiError);
            if (toast) {
              const show = () =>
                injector.get(NotificationService).error(toast.summary, toast.detail);
              // A failed page load shows an inline alert with the reference id; hold the toast back so it is not duplicated.
              if (req.method === 'GET' && toast.detail) {
                injector.get(ErrorReferenceStore).report(apiError.traceId, show);
              } else {
                show();
              }
            }
          }
          if (shouldRefreshPermissions(req, apiError)) void refreshAfterDenied(injector);
          return throwError(() => apiError);
        }),
      );
    }),
  );
};

/**
 * The generated NSwag client requests `responseType: 'blob'`, so error bodies arrive as a Blob. Parse them as JSON so the
 * problem details (stable `code`, field errors) are available to callers; synchronous for non-blob bodies.
 */
function decodeBlobBody(error: HttpErrorResponse): Observable<HttpErrorResponse> {
  if (!(error.error instanceof Blob)) return of(error);
  return from(error.error.text()).pipe(
    map((text) => {
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        /* not JSON: keep the raw text */
      }
      return new HttpErrorResponse({
        error: body,
        headers: error.headers,
        status: error.status,
        statusText: error.statusText,
        url: error.url ?? undefined,
      });
    }),
    catchError(() => of(error)),
  );
}

export const MF_HTTP_INTERCEPTORS = [
  timeZoneInterceptor,
  csrfInterceptor,
  problemDetailsInterceptor,
];

/** Pure mapping from an error to toast copy (UX copy deck 8.5/8.6). `null` = no toast. */
export function toastFor(err: ApiError): { summary: string; detail?: string } | null {
  if (err.hasFieldErrors) return null; // forms map these back onto controls
  if (err.code === 'CONCURRENCY_CONFLICT') return null; // conflict dialog
  if (err.code === 'ACCESS_PENDING' || err.code === 'ACCOUNT_DISABLED') return null; // redirect
  if (err.code === 'ROLE_IN_USE') return null; // the Roles page explains it inline
  const reference = err.traceId ? `Reference: ${err.traceId}` : undefined;
  if (err.isNetworkError || err.status >= 500) {
    return { summary: 'Something went wrong. Try again.', detail: reference };
  }
  if (err.status === 401) {
    return { summary: "We couldn't verify your sign-in. Reload the page to try again." };
  }
  if (err.status === 403) return { summary: "You don't have permission to do that." };
  if (err.status === 404) return { summary: "We couldn't find that." };
  return {
    summary: err.problem?.detail ?? err.problem?.title ?? 'Something went wrong. Try again.',
    // A 4xx explains itself; the trace reference is only useful for server faults.
  };
}

function shouldRefreshPermissions(req: HttpRequest<unknown>, err: ApiError): boolean {
  if (req.url.split('?')[0].endsWith('/me')) return false; // avoid refresh loops
  return (
    err.status === 403 &&
    (err.code === 'PERMISSION_DENIED' ||
      err.code === 'ACCESS_PENDING' ||
      err.code === 'ACCOUNT_DISABLED')
  );
}

async function refreshAfterDenied(injector: Injector): Promise<void> {
  const store = injector.get(AuthStore);
  await store.refresh();
  if (store.isRestricted()) {
    await injector.get(Router).navigateByUrl(APP_PATHS.accessPending);
  }
}
