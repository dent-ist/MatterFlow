import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { Location } from '@angular/common';
import { Router, TitleStrategy, provideRouter } from '@angular/router';
import { MfTitleStrategy, PageTitle } from '../../core/title/page-title';
import { ANNOUNCE_MAX_MS, ANNOUNCE_QUIET_MS, RouteAnnouncer } from './route-announcer';

@Component({ template: '', changeDetection: ChangeDetectionStrategy.OnPush })
class Blank {}

describe('RouteAnnouncer (S9a, #624)', () => {
  function setup() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'clients', title: 'Clients', component: Blank },
          { path: 'matters', title: 'Matters', component: Blank },
          { path: 'matters/:id', title: 'Matter', component: Blank },
        ]),
        { provide: TitleStrategy, useExisting: MfTitleStrategy },
      ],
    });
    const fixture = TestBed.createComponent(RouteAnnouncer);
    const router = TestBed.inject(Router);
    router.setUpLocationChangeListener(); // the browser's Back button reaches the router through this
    const region = (): HTMLElement =>
      (fixture.nativeElement as HTMLElement).querySelector('[data-route-announcer]')!;
    const text = (): string => {
      fixture.detectChanges();
      return region().textContent!; // exactly the title, no padding
    };
    return { fixture, router, region, text };
  }

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('is a visually hidden polite status region', () => {
    const { region } = setup();
    expect(region().getAttribute('role')).toBe('status');
    expect(region().getAttribute('aria-live')).toBe('polite');
    expect(region().classList.contains('mf-sr-only')).toBe(true);
  });

  it('says nothing for the first navigation, then the document title once for each page change', async () => {
    const { router, text } = setup();
    await router.navigateByUrl('/clients');
    vi.advanceTimersByTime(ANNOUNCE_MAX_MS + 100);
    expect(text()).toBe('');

    await router.navigateByUrl('/matters');
    expect(text()).toBe('');
    vi.advanceTimersByTime(ANNOUNCE_QUIET_MS + 10);
    expect(text()).toBe('Matters - MatterFlow');
    expect(text()).toBe(TestBed.inject(Title).getTitle());
  });

  it('waits for a record page to pin its name and announces that, not the generic route title', async () => {
    const { router, text } = setup();
    await router.navigateByUrl('/clients');
    await router.navigateByUrl('/matters/7');
    vi.advanceTimersByTime(ANNOUNCE_QUIET_MS - 50);
    TestBed.inject(PageTitle).set('00107-00001 Merger: Tasks');
    // The mutation observer is asynchronous: let it run, then the quiet period starts again.
    await Promise.resolve();
    vi.advanceTimersByTime(ANNOUNCE_QUIET_MS - 50);
    expect(text()).toBe('');
    vi.advanceTimersByTime(100);
    expect(text()).toBe('00107-00001 Merger: Tasks - MatterFlow');
  });

  it('says nothing for a change of the query only', async () => {
    const { router, text } = setup();
    await router.navigateByUrl('/clients');
    await router.navigateByUrl('/matters');
    vi.advanceTimersByTime(ANNOUNCE_QUIET_MS + 10);
    expect(text()).toBe('Matters - MatterFlow');
    await router.navigateByUrl('/matters?tab=closed');
    expect(text()).toBe('Matters - MatterFlow'); // not cleared, nothing new
    vi.advanceTimersByTime(ANNOUNCE_QUIET_MS + 10);
    expect(text()).toBe('Matters - MatterFlow');
  });

  it('says nothing for a Back navigation', async () => {
    const { router, text } = setup();
    await router.navigateByUrl('/clients');
    await router.navigateByUrl('/matters');
    vi.advanceTimersByTime(ANNOUNCE_QUIET_MS + 10);
    expect(text()).toBe('Matters - MatterFlow');
    await router.navigateByUrl('/clients');
    vi.advanceTimersByTime(ANNOUNCE_QUIET_MS + 10);
    expect(text()).toBe('Clients - MatterFlow');

    TestBed.inject(Location).back(); // Back to /matters is a popstate navigation
    await vi.waitFor(() => expect(router.url).toBe('/matters'));
    expect(text()).toBe('Clients - MatterFlow'); // not cleared, not changed
    vi.advanceTimersByTime(ANNOUNCE_MAX_MS + 100);
    expect(text()).toBe('Clients - MatterFlow');
  });

  it('clears the region at the start of an announcement so the same title is read again', async () => {
    const { router, text } = setup();
    await router.navigateByUrl('/clients');
    await router.navigateByUrl('/matters');
    vi.advanceTimersByTime(ANNOUNCE_QUIET_MS + 10);
    expect(text()).toBe('Matters - MatterFlow');
    await router.navigateByUrl('/clients');
    expect(text()).toBe(''); // cleared first
    vi.advanceTimersByTime(ANNOUNCE_QUIET_MS + 10);
    expect(text()).toBe('Clients - MatterFlow');
  });
});
