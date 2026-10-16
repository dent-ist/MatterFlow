import {
  HttpClient,
  HttpContext,
  HttpErrorResponse,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { MessageService } from 'primeng/api';
import { FakeMeApi, provideFakeMe, withPermissions } from '../auth/auth-testing';
import { AuthStore } from '../auth/auth.store';
import { USER_TIME_ZONE } from '../time/clock';
import { ErrorReferenceStore } from './error-reference-store';
import { ApiError } from './api-error';
import {
  CSRF_HEADER,
  MF_HTTP_INTERCEPTORS,
  QuietRequests,
  SKIP_ERROR_TOAST,
  TIME_ZONE_HEADER,
  toastFor,
} from './interceptors';

function setup(zone: string | null = 'America/Chicago') {
  const messages = { add: vi.fn() };
  const me = new FakeMeApi(withPermissions('Task.View'));
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(withInterceptors(MF_HTTP_INTERCEPTORS)),
      provideHttpClientTesting(),
      { provide: USER_TIME_ZONE, useValue: zone },
      { provide: MessageService, useValue: messages },
      provideFakeMe(me),
    ],
  });
  return {
    http: TestBed.inject(HttpClient),
    ctrl: TestBed.inject(HttpTestingController),
    messages,
    me,
  };
}

describe('HTTP interceptors', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('adds X-Time-Zone from the browser zone to every request', () => {
    const { http, ctrl } = setup('America/Chicago');
    http.get('/api/v1/tasks').subscribe();
    http.post('/api/v1/tasks', {}).subscribe();
    const [get, post] = ctrl.match(() => true);
    expect(get.request.headers.get(TIME_ZONE_HEADER)).toBe('America/Chicago');
    expect(post.request.headers.get(TIME_ZONE_HEADER)).toBe('America/Chicago');
  });

  it('omits X-Time-Zone when no zone can be determined', () => {
    const { http, ctrl } = setup(null);
    http.get('/api/v1/tasks').subscribe();
    expect(ctrl.expectOne('/api/v1/tasks').request.headers.has(TIME_ZONE_HEADER)).toBe(false);
  });

  it('adds the CSRF header to state-changing requests only', () => {
    const { http, ctrl } = setup();
    http.get('/a').subscribe();
    http.head('/b').subscribe();
    http.post('/c', {}).subscribe();
    http.put('/d', {}).subscribe();
    http.delete('/e').subscribe();
    const header = (url: string) => ctrl.expectOne(url).request.headers.get(CSRF_HEADER);
    expect(header('/a')).toBeNull();
    expect(header('/b')).toBeNull();
    expect(header('/c')).toBe('web');
    expect(header('/d')).toBe('web');
    expect(header('/e')).toBe('web');
  });

  it('converts ProblemDetails failures to ApiError and toasts', async () => {
    const { http, ctrl, messages } = setup();
    let caught: unknown;
    http.post('/api/v1/tasks/1/status', {}).subscribe({ error: (e) => (caught = e) });
    ctrl.expectOne('/api/v1/tasks/1/status').flush(
      {
        code: 'INVALID_STATUS_TRANSITION',
        title: 'Invalid status transition',
        detail: 'Cannot move a Completed task to On Hold.',
        status: 409,
        traceId: '00-abc',
      },
      { status: 409, statusText: 'Conflict' },
    );
    expect(caught).toBeInstanceOf(ApiError);
    const err = caught as ApiError;
    expect(err.status).toBe(409);
    expect(err.code).toBe('INVALID_STATUS_TRANSITION');
    expect(err.message).toBe('Cannot move a Completed task to On Hold.');
    expect(messages.add).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'error',
        summary: 'Cannot move a Completed task to On Hold.',
        detail: undefined,
      }),
    );
  });

  it('holds back the toast for a failed page load so an inline alert can show the reference (UXR-18)', () => {
    vi.useFakeTimers();
    try {
      const { http, ctrl, messages } = setup();
      http.get('/api/v1/clients').subscribe({ error: () => undefined });
      ctrl
        .expectOne('/api/v1/clients')
        .flush({ status: 500, traceId: '00-ref', title: 'Boom' }, { status: 500, statusText: 'x' });
      expect(messages.add).not.toHaveBeenCalled();
      expect(TestBed.inject(ErrorReferenceStore).reference()).toBe('00-ref');

      TestBed.inject(ErrorReferenceStore).claim(); // an inline alert showed it
      vi.advanceTimersByTime(1000);
      expect(messages.add).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('still toasts a failed page load when no inline alert claims it', () => {
    vi.useFakeTimers();
    try {
      const { http, ctrl, messages } = setup();
      http.get('/api/v1/clients').subscribe({ error: () => undefined });
      ctrl
        .expectOne('/api/v1/clients')
        .flush({ status: 500, traceId: '00-ref' }, { status: 500, statusText: 'x' });
      vi.advanceTimersByTime(1000);
      expect(messages.add).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'error', detail: 'Reference: 00-ref' }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('reads problem+json from Blob error bodies (the generated client requests blobs)', async () => {
    const { http, ctrl, messages } = setup();
    let caught: unknown;
    http
      .get('/api/v1/priorities', { responseType: 'blob' })
      .subscribe({ error: (e) => (caught = e) });
    const body = new Blob([
      JSON.stringify({ code: 'IN_USE', detail: 'Tasks use this priority.', status: 409 }),
    ]);
    ctrl.expectOne('/api/v1/priorities').flush(body, { status: 409, statusText: 'Conflict' });
    await vi.waitFor(() => expect(caught).toBeInstanceOf(ApiError));

    const err = caught as ApiError;
    expect(err.code).toBe('IN_USE');
    expect(err.message).toBe('Tasks use this priority.');
    expect(messages.add).toHaveBeenCalledWith(
      expect.objectContaining({ summary: 'Tasks use this priority.' }),
    );
  });

  it('does not toast field-level validation errors', () => {
    const { http, ctrl, messages } = setup();
    let caught: ApiError | undefined;
    http.post('/x', {}).subscribe({ error: (e) => (caught = e) });
    ctrl.expectOne('/x').flush(
      {
        code: 'VALIDATION_FAILED',
        errors: { title: [{ code: 'REQUIRED', message: 'Required' }] },
      },
      { status: 400, statusText: 'Bad Request' },
    );
    expect(caught?.hasFieldErrors).toBe(true);
    expect(messages.add).not.toHaveBeenCalled();
  });

  it('shows the generic message for 5xx and network failures', () => {
    const { http, ctrl, messages } = setup();
    http.get('/x').subscribe({ error: () => undefined });
    ctrl.expectOne('/x').flush('boom', { status: 500, statusText: 'Server Error' });
    http.get('/y').subscribe({ error: () => undefined });
    ctrl.expectOne('/y').error(new ProgressEvent('error'));
    expect(messages.add).toHaveBeenCalledTimes(2);
    for (const call of messages.add.mock.calls) {
      expect(call[0].summary).toBe('Something went wrong. Try again.');
    }
  });

  it('honours SKIP_ERROR_TOAST', () => {
    const { http, ctrl, messages } = setup();
    http
      .get('/x', { context: new HttpContext().set(SKIP_ERROR_TOAST, true) })
      .subscribe({ error: () => undefined });
    ctrl.expectOne('/x').flush({}, { status: 500, statusText: 'Server Error' });
    expect(messages.add).not.toHaveBeenCalled();
  });

  it('does not toast a failure of a request started inside QuietRequests.run, and still toasts the others', () => {
    const { http, ctrl, messages } = setup();
    const errors: unknown[] = [];
    TestBed.inject(QuietRequests).run(() =>
      http.get('/quiet').subscribe({ error: (e: unknown) => errors.push(e) }),
    );
    http.get('/loud').subscribe({ error: () => undefined });
    ctrl.expectOne('/quiet').flush({}, { status: 500, statusText: 'Server Error' });
    expect(errors.length).toBe(1);
    expect(errors[0]).toBeInstanceOf(ApiError);
    expect(messages.add).not.toHaveBeenCalled();
    ctrl.expectOne('/loud').flush({}, { status: 500, statusText: 'Server Error' });
    expect(messages.add).toHaveBeenCalledTimes(1);
  });

  it('QuietRequests.runInline never toasts but hands the error reference to the inline alert', () => {
    const { http, ctrl, messages } = setup();
    TestBed.inject(QuietRequests).runInline(() =>
      http.get('/inline').subscribe({ error: () => undefined }),
    );
    ctrl
      .expectOne('/inline')
      .flush({ traceId: 'abc-123' }, { status: 500, statusText: 'Server Error' });
    expect(messages.add).not.toHaveBeenCalled();
    expect(TestBed.inject(ErrorReferenceStore).reference()).toBe('abc-123');
  });

  it('parses problem details from blob error bodies (generated NSwag client)', async () => {
    const { http, ctrl, messages } = setup();
    let caught: unknown;
    http
      .get('/api/v1/users/1', { responseType: 'blob' })
      .subscribe({ error: (e: unknown) => (caught = e) });
    const body = new Blob([JSON.stringify({ code: 'LAST_ADMIN', detail: 'Keep one admin.' })], {
      type: 'application/problem+json',
    });
    ctrl.expectOne('/api/v1/users/1').flush(body, { status: 409, statusText: 'Conflict' });
    await new Promise((r) => setTimeout(r, 20));

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).code).toBe('LAST_ADMIN');
    expect(messages.add).toHaveBeenCalledWith(
      expect.objectContaining({ summary: 'Keep one admin.' }),
    );
  });

  it('refreshes permissions after 403 PERMISSION_DENIED', async () => {
    const { http, ctrl, me, messages } = setup();
    await TestBed.inject(AuthStore).ensureLoaded();
    expect(me.calls).toBe(1);
    http.post('/api/v1/tasks', {}).subscribe({ error: () => undefined });
    ctrl
      .expectOne('/api/v1/tasks')
      .flush({ code: 'PERMISSION_DENIED', status: 403 }, { status: 403, statusText: 'Forbidden' });
    await new Promise((r) => setTimeout(r));
    expect(me.calls).toBe(2);
    expect(messages.add).toHaveBeenCalledWith(
      expect.objectContaining({ summary: "You don't have permission to do that." }),
    );
  });

  it('redirects to Access Pending when a 403 reveals permissions were removed', async () => {
    const { http, ctrl, me } = setup();
    const store = TestBed.inject(AuthStore);
    await store.ensureLoaded();
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    me.current = { ...withPermissions(), status: 'ACCESS_PENDING' };
    http.get('/api/v1/tasks').subscribe({ error: () => undefined });
    ctrl
      .expectOne('/api/v1/tasks')
      .flush({ code: 'ACCESS_PENDING' }, { status: 403, statusText: 'Forbidden' });
    await new Promise((r) => setTimeout(r));
    expect(navigate).toHaveBeenCalledWith('/access-pending');
  });

  it('does not refresh permissions when /me itself fails (no loop)', async () => {
    const { http, ctrl, me } = setup();
    http.get('/api/v1/me').subscribe({ error: () => undefined });
    ctrl
      .expectOne('/api/v1/me')
      .flush({ code: 'PERMISSION_DENIED' }, { status: 403, statusText: 'Forbidden' });
    await new Promise((r) => setTimeout(r));
    expect(me.calls).toBe(0);
  });
});

describe('toastFor', () => {
  const make = (status: number, body: object = {}) =>
    ApiError.from(new HttpErrorResponse({ status, error: body }));

  it('suppresses conflict, pending and disabled codes', () => {
    expect(toastFor(make(409, { code: 'CONCURRENCY_CONFLICT' }))).toBeNull();
    expect(toastFor(make(403, { code: 'ACCESS_PENDING' }))).toBeNull();
    expect(toastFor(make(403, { code: 'ACCOUNT_DISABLED' }))).toBeNull();
  });

  it('maps 401, 403 and 404 to copy-deck messages', () => {
    expect(toastFor(make(403))?.summary).toBe("You don't have permission to do that.");
    expect(toastFor(make(404))?.summary).toBe("We couldn't find that.");
    expect(toastFor(make(401))?.summary).toContain('verify your sign-in');
  });
});
