import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Connectivity } from '../../core/http/connectivity';
import { ConnectionBanner } from './connection-banner';

describe('ConnectionBanner (#611)', () => {
  beforeEach(() => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  });
  afterEach(() => vi.restoreAllMocks());

  function render() {
    const fixture = TestBed.createComponent(ConnectionBanner);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, c: TestBed.inject(Connectivity) };
  }

  it('shows nothing while online, but keeps the polite live region', () => {
    const { el } = render();
    expect(el.querySelector('[data-offline-banner]')).toBeNull();
    const region = el.querySelector('[data-connection-status]')!;
    expect(region.getAttribute('role')).toBe('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
  });

  it('offline: the wording of the review and a Retry button; then "Back online."', () => {
    const { fixture, el, c } = render();
    c.unreachable();
    c.unreachable();
    fixture.detectChanges();
    const bar = el.querySelector('[data-offline-banner]')!;
    expect(bar.textContent).toContain(
      "You're offline. Pages you have open still work; changes can't be saved.",
    );
    expect(bar.querySelector('button')!.textContent!.trim()).toBe('Retry');
    c.reachable();
    fixture.detectChanges();
    expect(el.querySelector('[data-offline-banner]')).toBeNull();
    expect(el.querySelector('[data-back-online]')!.textContent).toContain('Back online.');
  });

  it('Retry asks the server', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    const { fixture, el, c } = render();
    c.unreachable();
    c.unreachable();
    fixture.detectChanges();
    el.querySelector<HTMLButtonElement>('[data-offline-retry]')!.click();
    await fixture.whenStable();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
