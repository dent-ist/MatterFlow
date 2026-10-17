import { TestBed } from '@angular/core/testing';
import { NEVER } from 'rxjs';
import { provideRouter } from '@angular/router';
import { MessageService } from 'primeng/api';
import { MyAvailabilityClient, SearchClient } from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { Permission } from '../../core/auth/permissions';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../core/auth/auth-testing';
import { ok, settle } from '../testing/org-testing';
import { AppShell } from './app-shell';

describe('AppShell header search', () => {
  async function create(permissions: Permission[]) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        MessageService,
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

  const navLabels = (fixture: { nativeElement: HTMLElement }): string[] =>
    Array.from(fixture.nativeElement.querySelectorAll('nav a')).map((a) => a.textContent!.trim());

  it('shows the Dashboard menu item only with Dashboard.View and a tab permission (R2; ViewCoverage alone does not count)', async () => {
    expect(navLabels(await create(['Task.View']))).not.toContain('Dashboard');
    TestBed.resetTestingModule();
    expect(navLabels(await create(['Task.View', 'Dashboard.ViewSummary']))).not.toContain(
      'Dashboard',
    );
    TestBed.resetTestingModule();
    expect(navLabels(await create(['Task.View', 'Dashboard.View']))).not.toContain('Dashboard');
    TestBed.resetTestingModule();
    expect(
      navLabels(await create(['Task.View', 'Dashboard.View', 'Dashboard.ViewCoverage'])),
    ).not.toContain('Dashboard');
    TestBed.resetTestingModule();
    expect(
      navLabels(await create(['Task.View', 'Dashboard.View', 'Dashboard.ViewTrends'])),
    ).toContain('Dashboard');
  });

  it('shows the global search combobox to anyone who may view a searchable type', async () => {
    const fixture = await create(['Task.View']);
    const box = fixture.nativeElement.querySelector('mf-global-search input[role=combobox]');
    expect(box).not.toBeNull();
    expect(box.getAttribute('placeholder')).toContain('Ctrl+K');
  });

  it('hides the search when the user may view none of the searchable types', async () => {
    const fixture = await create(['Pod.View']);
    expect(fixture.nativeElement.querySelector('mf-global-search')).toBeNull();
  });

  it('focuses the search with Ctrl+K', async () => {
    const fixture = await create(['Matter.View']);
    const event = new KeyboardEvent('keydown', {
      key: 'k',
      ctrlKey: true,
      cancelable: true,
      bubbles: true,
    });
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(
      fixture.nativeElement.querySelector('mf-global-search input'),
    );
  });

  it('opens the shortcut list with ? and lists Ctrl+K, but not while typing', async () => {
    const fixture = await create(['Matter.View']);
    const input = fixture.nativeElement.querySelector('mf-global-search input') as HTMLInputElement;
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }));
    await settle(fixture);
    expect(document.body.querySelector('[data-shortcut-help]')).toBeNull();

    (document.activeElement as HTMLElement).blur();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }));
    // The list loads on first use.
    await vi.waitFor(() =>
      expect(document.body.querySelector('[data-shortcut-help]')).not.toBeNull(),
    );
    await settle(fixture);
    const help = document.body.querySelector('[data-shortcut-help]');
    expect(help).not.toBeNull();
    expect(help!.textContent).toContain('Ctrl');
    expect(help!.textContent).toContain('Search matters');
    expect(document.body.querySelector('[role=dialog]')!.textContent).toContain(
      'Keyboard shortcuts',
    );
  });

  it('has a Keyboard shortcuts button for people who do not know the key', async () => {
    const fixture = await create(['Matter.View']);
    const button = fixture.nativeElement.querySelector(
      '[data-shortcut-help-button]',
    ) as HTMLButtonElement;
    expect(button.getAttribute('aria-label')).toBe('Keyboard shortcuts');
  });

  describe('phone menu (#164)', () => {
    const q = (f: { nativeElement: HTMLElement }, sel: string) =>
      f.nativeElement.querySelector(sel) as HTMLElement;

    it('has a Menu button before the logo and the search, closed by default', async () => {
      const fixture = await create(['Task.View']);
      const header = q(fixture, 'header');
      const first = header.querySelector('button, a') as HTMLElement;
      expect(first.getAttribute('aria-label')).toBe('Menu');
      expect(first.getAttribute('aria-expanded')).toBe('false');
      expect(first.getAttribute('aria-controls')).toBe('mf-nav');
      expect(q(fixture, 'nav').getAttribute('aria-label')).toBe('Main');
      expect(q(fixture, 'nav').classList).not.toContain('mf-nav--open');
    });

    it('opens the panel, moves focus into it, traps Tab, and Esc closes it and returns focus', async () => {
      const fixture = await create(['Task.View']);
      const button = q(fixture, '[data-testid=nav-menu-button]') as HTMLButtonElement;
      button.click();
      await settle(fixture);
      expect(button.getAttribute('aria-expanded')).toBe('true');
      expect(q(fixture, 'nav').classList).toContain('mf-nav--open');
      expect(q(fixture, '[data-testid=nav-backdrop]')).not.toBeNull();
      await vi.waitFor(() => expect(q(fixture, 'nav').contains(document.activeElement)).toBe(true));

      const nav = q(fixture, 'nav');
      const items = Array.from(nav.querySelectorAll<HTMLElement>('a[href], button'));
      items[items.length - 1].focus();
      const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      document.dispatchEvent(tab);
      expect(tab.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(items[0]);

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await settle(fixture);
      expect(nav.classList).not.toContain('mf-nav--open');
      expect(button.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(button);
    });

    it('closes on the backdrop and on the Close menu button', async () => {
      const fixture = await create(['Task.View']);
      const button = q(fixture, '[data-testid=nav-menu-button]') as HTMLButtonElement;
      button.click();
      await settle(fixture);
      q(fixture, '[data-testid=nav-backdrop]').click();
      await settle(fixture);
      expect(q(fixture, 'nav').classList).not.toContain('mf-nav--open');
      expect(document.activeElement).toBe(button);

      button.click();
      await settle(fixture);
      q(fixture, '[data-testid=nav-close]').click();
      await settle(fixture);
      expect(q(fixture, 'nav').classList).not.toContain('mf-nav--open');
    });

    it('offers a search icon button that shows the search row', async () => {
      const fixture = await create(['Task.View']);
      const button = q(fixture, '[data-testid=search-button]') as HTMLButtonElement;
      expect(button.getAttribute('aria-label')).toBe('Search');
      button.click();
      await settle(fixture);
      expect(q(fixture, 'header').classList).toContain('mf-header--search-open');
    });

    it('has no search icon when the user may not search', async () => {
      const fixture = await create(['Pod.View']);
      expect(q(fixture, '[data-testid=search-button]')).toBeNull();
    });
  });
});
