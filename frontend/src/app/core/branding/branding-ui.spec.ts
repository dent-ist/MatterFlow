import { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NEVER } from 'rxjs';
import { MyAvailabilityClient, SearchClient } from '../../api/generated/api-client';
import { AuthStore } from '../auth/auth.store';
import { Permission } from '../auth/permissions';
import { ForbiddenPage } from '../../features/system/pages/forbidden-page';
import { NotFoundPage } from '../../features/system/pages/not-found-page';
import { ErrorPage } from '../../features/system/pages/error-page';
import { AppShell } from '../../shared/layout/app-shell';
import { searchBoxName, searchBoxPlaceholder } from '../../shared/search/search-meta';
import {
  FakeMeApi,
  ok,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../shared/testing/org-testing';
import { DEFAULT_BRANDING, applyBranding } from './branding';

const CUSTOM = {
  appName: 'Smith & Co Legal Hold Services',
  iconUrl: '/api/v1/branding/icon?v=0123456789ab',
  iconKind: 'png' as const,
  version: '0123456789ab',
};

/** Epic #850, BR-04: every place that says the application name reads it from the branding setting and binds it as text. */
describe('the application name in the screens', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    applyBranding(DEFAULT_BRANDING);
    document.head.querySelectorAll('link[data-mf-icon]').forEach((l) => l.remove());
  });

  async function shell(permissions: Permission[] = ['Task.View']) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: MyAvailabilityClient, useValue: { getMyAvailability: () => NEVER } },
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        {
          provide: SearchClient,
          useValue: { search: vi.fn().mockReturnValue(ok({ query: '', groups: [] })) },
        },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    const fixture = TestBed.createComponent(AppShell);
    await settle(fixture);
    return fixture;
  }

  it('the header shows the default name and mark until an administrator changes them', async () => {
    const el = (await shell()).nativeElement as HTMLElement;
    const logo = el.querySelector('.mf-logo')!;
    expect(logo.querySelector('[data-app-name]')!.textContent).toBe('MatterFlow');
    expect(logo.getAttribute('aria-label')).toBe('MatterFlow home');
    expect(logo.querySelector('img')!.getAttribute('src')).toBe('favicon.svg');
    expect(logo.querySelector('img')!.getAttribute('alt')).toBe('');
  });

  it('the header shows a custom name (as text) and icon, next to each other, and follows a change', async () => {
    applyBranding(CUSTOM);
    const fixture = await shell();
    const el = fixture.nativeElement as HTMLElement;
    const logo = el.querySelector('.mf-logo')!;
    expect(logo.querySelector('[data-app-name]')!.textContent).toBe(CUSTOM.appName);
    expect(logo.getAttribute('aria-label')).toBe(`${CUSTOM.appName} home`);
    expect(logo.querySelector('img')!.getAttribute('src')).toBe(CUSTOM.iconUrl);

    applyBranding({ ...CUSTOM, appName: 'Renamed' });
    await settle(fixture);
    expect(logo.querySelector('[data-app-name]')!.textContent).toBe('Renamed');
  });

  it('a name that looks like markup is shown as plain text, never as HTML', async () => {
    // The server refuses < and > (BRANDING_NAME_INVALID_CHARS); this proves the binding is text even if one slipped in.
    const fixture = await shell();
    applyBranding({ ...DEFAULT_BRANDING, appName: '<img src=x onerror=alert(1)>' });
    await settle(fixture);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.mf-logo [data-app-name]')!.textContent).toBe(
      '<img src=x onerror=alert(1)>',
    );
    expect(el.querySelector('.mf-logo img[src="x"]')).toBeNull();
  });

  it('falls back to the built-in mark when the custom icon cannot be loaded', async () => {
    applyBranding(CUSTOM);
    const fixture = await shell();
    const img = (fixture.nativeElement as HTMLElement).querySelector<HTMLImageElement>(
      '.mf-logo img',
    )!;
    img.dispatchEvent(new Event('error'));
    await settle(fixture);
    expect(img.getAttribute('src')).toBe('favicon.svg');
  });

  it('the global search is named after the application', async () => {
    applyBranding({ ...CUSTOM, appName: 'Acme' });
    const el = (await shell(['Task.View'])).nativeElement as HTMLElement;
    expect(el.querySelector('[role="search"]')!.getAttribute('aria-label')).toBe('Search Acme');
    expect(searchBoxName(() => false)).toBe('Search Acme');
    expect(searchBoxName(() => false, 'Other')).toBe('Search Other');
    expect(searchBoxPlaceholder(() => false, 'Other')).toBe('Search Other... (Ctrl+K)');
  });

  async function render(page: Type<unknown>) {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideFakeMe(new FakeMeApi(withPermissions('Task.View')))],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    const fixture = TestBed.createComponent(page);
    await settle(fixture);
    return fixture.nativeElement as HTMLElement;
  }

  it('the 403, 404 and error pages carry the name; the error text and the 404 search use it too', async () => {
    applyBranding({ ...CUSTOM, appName: 'Acme' });
    for (const page of [ForbiddenPage, NotFoundPage, ErrorPage] as Type<unknown>[]) {
      TestBed.resetTestingModule();
      const el = await render(page);
      expect(el.querySelector('[data-state-brand]')!.textContent).toBe('Acme');
    }

    TestBed.resetTestingModule();
    expect((await render(ErrorPage)).querySelector('[data-state-reason]')!.textContent).toContain(
      'Acme could not load your account.',
    );
    TestBed.resetTestingModule();
    expect(
      (await render(NotFoundPage))
        .querySelector('[data-not-found-search]')!
        .getAttribute('placeholder'),
    ).toBe('Search Acme');
  });

  it('the pages still say MatterFlow when nothing was changed', async () => {
    const el = await render(NotFoundPage);
    expect(el.querySelector('[data-state-brand]')!.textContent).toBe('MatterFlow');
    expect(el.querySelector('[data-not-found-search]')!.getAttribute('placeholder')).toBe(
      'Search MatterFlow',
    );
  });
});
