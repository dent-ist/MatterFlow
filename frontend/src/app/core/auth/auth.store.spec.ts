import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ApiError } from '../http/api-error';
import { Clock } from '../time/clock';
import { FakeMeApi, profileOf, provideFakeMe, withPermissions } from './auth-testing';
import { AuthStore, FOCUS_REFRESH_THROTTLE_MS } from './auth.store';

function setup(initial: ConstructorParameters<typeof FakeMeApi>[0]) {
  const api = new FakeMeApi(initial);
  const clock = { time: 1_000_000, now: () => new Date(clock.time) };
  TestBed.configureTestingModule({
    providers: [provideFakeMe(api), { provide: Clock, useValue: clock }],
  });
  return { api, clock, store: TestBed.inject(AuthStore) };
}

const apiError = (status: number, code: string) =>
  ApiError.from(new HttpErrorResponse({ status, error: { code, status } }));

describe('AuthStore', () => {
  it('loads /me once and exposes profile and permissions', async () => {
    const { api, store } = setup(withPermissions('Task.View', 'Client.View'));
    expect(store.isAuthenticated()).toBe(false);
    await Promise.all([store.ensureLoaded(), store.ensureLoaded()]);
    await store.ensureLoaded();
    expect(api.calls).toBe(1);
    expect(store.isAuthenticated()).toBe(true);
    expect(store.displayName()).toBe('Test User');
    expect(store.has('Task.View')).toBe(true);
    expect(store.has('Task.Create')).toBe(false);
    expect(store.hasAny(['Task.Create', 'Client.View'])).toBe(true);
    expect(store.hasAny([])).toBe(true);
    expect(store.isPending()).toBe(false);
  });

  it('treats ACCESS_PENDING as restricted with no permissions', async () => {
    const { store } = setup(profileOf({ status: 'ACCESS_PENDING', permissions: ['Task.View'] }));
    await store.ensureLoaded();
    expect(store.isPending()).toBe(true);
    expect(store.isRestricted()).toBe(true);
    expect(store.has('Task.View')).toBe(false);
  });

  it('treats an active user with zero permissions as pending', async () => {
    const { store } = setup(profileOf());
    await store.ensureLoaded();
    expect(store.isPending()).toBe(true);
  });

  it('system admin implicitly has every permission', async () => {
    const { store } = setup(profileOf({ isSystemAdmin: true }));
    await store.ensureLoaded();
    expect(store.isPending()).toBe(false);
    expect(store.has('Audit.View')).toBe(true);
  });

  it('flags disabled accounts, from status or an ACCOUNT_DISABLED error', async () => {
    const a = setup(profileOf({ status: 'DISABLED' }));
    await a.store.ensureLoaded();
    expect(a.store.isDisabled()).toBe(true);
    expect(a.store.isPending()).toBe(false);
    expect(a.store.isRestricted()).toBe(true);

    TestBed.resetTestingModule();
    const b = setup(apiError(403, 'ACCOUNT_DISABLED'));
    await b.store.ensureLoaded();
    expect(b.store.isDisabled()).toBe(true);
  });

  it('maps a 403 ACCESS_PENDING error to the pending state', async () => {
    const { store } = setup(apiError(403, 'ACCESS_PENDING'));
    await store.ensureLoaded();
    expect(store.isPending()).toBe(true);
  });

  it('reports an error state, without rejecting, when /me fails', async () => {
    const { api, store } = setup(apiError(500, 'X'));
    await store.ensureLoaded();
    expect(store.state()).toBe('error');
    expect(store.isAuthenticated()).toBe(false);
    api.current = withPermissions('Task.View');
    await store.ensureLoaded(); // retries because state is not ready
    expect(store.state()).toBe('ready');
  });

  it('refresh() picks up permission changes', async () => {
    const { api, store } = setup(profileOf({ status: 'ACCESS_PENDING' }));
    await store.ensureLoaded();
    expect(store.isPending()).toBe(true);
    api.current = withPermissions('Task.View');
    await store.refresh();
    expect(store.isPending()).toBe(false);
    expect(store.has('Task.View')).toBe(true);
  });

  it('keeps the last good profile when a refresh fails', async () => {
    const { api, store } = setup(withPermissions('Task.View'));
    await store.ensureLoaded();
    api.current = apiError(500, 'X');
    await store.refresh();
    expect(store.has('Task.View')).toBe(true);
    expect(store.state()).toBe('ready');
  });

  it('refreshes on window focus at most once per 60 seconds', async () => {
    const { api, clock, store } = setup(withPermissions('Task.View'));
    await store.ensureLoaded();
    const target = new EventTarget() as unknown as Window;
    const stop = store.startFocusRefresh(target);

    const tick = () => new Promise((resolve) => setTimeout(resolve));

    target.dispatchEvent(new Event('focus'));
    await tick();
    expect(api.calls).toBe(1); // throttled

    clock.time += FOCUS_REFRESH_THROTTLE_MS;
    target.dispatchEvent(new Event('focus'));
    await tick();
    expect(api.calls).toBe(2);

    clock.time += 1;
    target.dispatchEvent(new Event('focus'));
    await tick();
    expect(api.calls).toBe(2); // throttled again

    stop();
    clock.time += FOCUS_REFRESH_THROTTLE_MS;
    target.dispatchEvent(new Event('focus'));
    await tick();
    expect(api.calls).toBe(2);
  });
});
