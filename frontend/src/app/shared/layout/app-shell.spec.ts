import { TestBed } from '@angular/core/testing';
import { NEVER } from 'rxjs';
import { Router, provideRouter } from '@angular/router';
import { MyAvailabilityClient, SearchClient } from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { Permission } from '../../core/auth/permissions';
import { FakeMeApi, profileOf, provideFakeMe, withPermissions } from '../../core/auth/auth-testing';
import { ok, settle } from '../testing/org-testing';
import { AppShell } from './app-shell';
import { versionLabel, versionName } from './app-version';
import { SkipTarget } from './skip-target';
import { MATTERS_ROUTES } from '../../features/matters/matters.routes';
import { PROJECTS_ROUTES } from '../../features/projects/projects.routes';
import { CLIENTS_ROUTES } from '../../features/clients/clients.routes';

describe('AppShell header search', () => {
  beforeEach(() => localStorage.clear());

  async function create(permissions: Permission[]) {
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

  const navLabels = (fixture: { nativeElement: HTMLElement }): string[] =>
    Array.from(fixture.nativeElement.querySelectorAll('nav a')).map((a) => a.textContent!.trim());

  it('highlights the list a task was opened from, else Task Queue (M7)', async () => {
    const stub = { path: '**', children: [] };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([stub]),
        { provide: MyAvailabilityClient, useValue: { getMyAvailability: () => NEVER } },
        provideFakeMe(new FakeMeApi(withPermissions('Task.View', 'Pod.View'))),
        { provide: SearchClient, useValue: { search: vi.fn() } },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    const fixture = TestBed.createComponent(AppShell);
    const router = TestBed.inject(Router);
    const current = async (url: string): Promise<string[]> => {
      await router.navigateByUrl(url);
      await settle(fixture);
      return Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll('nav a.mf-active'),
      ).map((a) => a.textContent!.trim());
    };
    expect(await current('/tasks/12?from=my-work')).toEqual(['My Work']);
    expect(await current('/tasks/12?from=pod-work')).toEqual(['Pod Work']);
    expect(await current('/tasks/12?from=task-queue')).toEqual(['Task Queue']);
    expect(await current('/tasks/12?from=nonsense')).toEqual(['Task Queue']);
    expect(await current('/tasks/12')).toEqual(['Task Queue']);
    expect(await current('/tasks?from=my-work')).toEqual(['Task Queue']);
    expect(await current('/my-work')).toEqual(['My Work']);
  });

  describe('the global Create task button (S1, #625)', () => {
    const flagOf = (routes: typeof MATTERS_ROUTES, path: string): unknown =>
      routes.find((r) => r.path === path)?.data?.['hidesGlobalCreateTask'];

    it('is flagged off on the Matter and Project record routes only', () => {
      expect(flagOf(MATTERS_ROUTES, ':matterId')).toBe(true);
      expect(flagOf(PROJECTS_ROUTES, ':projectId')).toBe(true);
      for (const [routes, paths] of [
        [MATTERS_ROUTES, ['', 'new', ':matterId/edit']],
        [PROJECTS_ROUTES, ['', 'new', ':projectId/edit']],
        [CLIENTS_ROUTES, ['', 'new', ':clientId/edit', ':clientId']],
      ] as const) {
        for (const p of paths) expect(flagOf(routes, p), p).toBeUndefined();
      }
    });

    it('is hidden by the route flag, on /tasks/new, and shown elsewhere; never without Task.Create', async () => {
      TestBed.configureTestingModule({
        providers: [
          provideRouter([
            { path: 'matters/:id', data: { hidesGlobalCreateTask: true }, children: [] },
            { path: '**', children: [] },
          ]),
          { provide: MyAvailabilityClient, useValue: { getMyAvailability: () => NEVER } },
          provideFakeMe(new FakeMeApi(withPermissions('Task.View', 'Task.Create'))),
          { provide: SearchClient, useValue: { search: vi.fn() } },
        ],
      });
      await TestBed.inject(AuthStore).ensureLoaded();
      const fixture = TestBed.createComponent(AppShell);
      const router = TestBed.inject(Router);
      const shown = async (url: string): Promise<boolean> => {
        await router.navigateByUrl(url);
        await settle(fixture);
        return !!(fixture.nativeElement as HTMLElement).querySelector('.mf-create');
      };
      expect(await shown('/clients/3')).toBe(true);
      expect(await shown('/matters/7')).toBe(false);
      expect(await shown('/tasks')).toBe(true);
      expect(await shown('/tasks/new')).toBe(false);
      expect(await shown('/matters/7/edit')).toBe(true);
      TestBed.resetTestingModule();
      expect((await create(['Task.View'])).nativeElement.querySelector('.mf-create')).toBeNull();
    });
  });

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

  it('groups the rail under Work and Records, each list labelled by its heading (S6, #621)', async () => {
    const fixture = await create([
      'Task.View',
      'Pod.View',
      'Client.View',
      'Matter.View',
      'Asset.View',
      'AssetType.Manage',
    ]);
    const el = fixture.nativeElement as HTMLElement;
    const groups = Array.from(el.querySelectorAll<HTMLElement>('[data-nav-group]')).map((g) => ({
      heading: g.querySelector('.mf-nav-heading')!.textContent!.trim(),
      labelledBy: g.querySelector('ul')!.getAttribute('aria-labelledby'),
      headingId: g.querySelector('.mf-nav-heading')!.id,
      items: Array.from(g.querySelectorAll('a')).map((a) => a.textContent!.trim()),
    }));
    expect(groups.map((g) => [g.heading, g.items])).toEqual([
      ['Work', ['My Work', 'Task Queue', 'Pod Work']],
      ['Records', ['Clients', 'Matters', 'Assets']],
    ]);
    for (const g of groups) expect(g.labelledBy).toBe(g.headingId);
    // The two "assets" items differ in words (S5, #620), also in the tooltip of the icon rail.
    const names = Array.from(el.querySelectorAll('nav a')).map((a) => a.textContent!.trim());
    expect(names).toContain('Asset types');
    expect(names).toContain('Assets');
    expect(el.querySelector<HTMLElement>('nav a[data-tip="Asset types"]')).not.toBeNull();
  });

  it('offers a manager with Task.View and Matter.View the short menu: My Matters first, My Work behind More (#691, #775)', async () => {
    const fixture = await create(['Matter.BeManager', 'Matter.View', 'Task.View']);
    expect(navLabels(fixture)).toEqual(['My Matters', 'Matters', 'Tasks']);
    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('[data-nav-more-toggle]')!
      .click();
    fixture.detectChanges();
    expect(navLabels(fixture)).toEqual(['My Matters', 'Matters', 'Tasks', 'My Work']);
  });

  describe('the compact menu of a person who lands on My Matters (epic #758, PX-17)', () => {
    const PM: Permission[] = [
      'Matter.BeManager',
      'Matter.View',
      'Matter.AssignManagers',
      'Task.View',
      'Client.View',
      'Project.View',
      'Asset.View',
      'Pod.View',
    ];
    const toggle = (f: { nativeElement: HTMLElement }) =>
      f.nativeElement.querySelector<HTMLButtonElement>('[data-nav-more-toggle]')!;
    const moreLinks = (f: { nativeElement: HTMLElement }) =>
      Array.from(f.nativeElement.querySelectorAll('[data-nav-more-list] a')).map((a) =>
        a.textContent!.trim(),
      );

    it('lists My Matters, Matters, Tasks and Assets, and no Pod Work; More is collapsed by default', async () => {
      const fixture = await create(PM);
      expect(navLabels(fixture)).toEqual(['My Matters', 'Matters', 'Tasks', 'Assets']);
      expect(toggle(fixture).getAttribute('aria-expanded')).toBe('false');
      expect(toggle(fixture).getAttribute('aria-controls')).toBe('mf-nav-more-list');
      expect(moreLinks(fixture)).toEqual([]);
      // One heading, read by assistive technology only.
      const headings = (fixture.nativeElement as HTMLElement).querySelectorAll('.mf-nav-heading');
      expect(headings).toHaveLength(1);
      expect(headings[0].classList).toContain('mf-sr-only');
    });

    it('keeps every route reachable: More holds Clients, Projects and My Work, and the choice is remembered', async () => {
      const fixture = await create(PM);
      toggle(fixture).click();
      fixture.detectChanges();
      expect(toggle(fixture).getAttribute('aria-expanded')).toBe('true');
      expect(moreLinks(fixture)).toEqual(['Clients', 'Projects', 'My Work']);
      expect(localStorage.getItem('mf.nav.more.1')).toBe('1');
      TestBed.resetTestingModule();
      const again = await create(PM);
      expect(toggle(again).getAttribute('aria-expanded')).toBe('true');
      toggle(again).click();
      again.detectChanges();
      expect(localStorage.getItem('mf.nav.more.1')).toBe('0');
    });

    it('opens More by itself on a page inside the group, so the current item is visible', async () => {
      TestBed.configureTestingModule({
        providers: [
          provideRouter([{ path: '**', children: [] }]),
          { provide: MyAvailabilityClient, useValue: { getMyAvailability: () => NEVER } },
          provideFakeMe(new FakeMeApi(withPermissions(...PM))),
          { provide: SearchClient, useValue: { search: vi.fn() } },
        ],
      });
      await TestBed.inject(AuthStore).ensureLoaded();
      const fixture = TestBed.createComponent(AppShell);
      await TestBed.inject(Router).navigateByUrl('/clients');
      await settle(fixture);
      expect(toggle(fixture).getAttribute('aria-expanded')).toBe('true');
      expect(
        (fixture.nativeElement as HTMLElement).querySelector('[data-nav-more-list] a.mf-active')
          ?.textContent,
      ).toContain('Clients');
    });

    it('leaves everybody else the full menu: no manager permission, no Task.View, and a System Admin who is not a Project Manager', async () => {
      expect(navLabels(await create(['Task.View', 'Pod.View', 'Client.View']))).toEqual([
        'My Work',
        'Task Queue',
        'Pod Work',
        'Clients',
      ]);
      TestBed.resetTestingModule();
      const noMore = await create(['Task.View', 'Pod.View']);
      expect(noMore.nativeElement.querySelector('[data-nav-more]')).toBeNull();
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          provideRouter([]),
          { provide: MyAvailabilityClient, useValue: { getMyAvailability: () => NEVER } },
          provideFakeMe(new FakeMeApi(profileOf({ isSystemAdmin: true, roles: ['System Admin'] }))),
          { provide: SearchClient, useValue: { search: vi.fn() } },
        ],
      });
      await TestBed.inject(AuthStore).ensureLoaded();
      const admin = TestBed.createComponent(AppShell);
      await settle(admin);
      expect(navLabels(admin)).toContain('Pod Work');
      expect(navLabels(admin)).toContain('Task Queue');
      expect(admin.nativeElement.querySelector('[data-nav-more]')).toBeNull();
    });
  });

  it('shows the version at the foot of the nav, read as "Version 0.1.1", not a link or a button (MM-44, #940)', async () => {
    const fixture = await create(['Task.View']);
    const nav = (fixture.nativeElement as HTMLElement).querySelector('nav')!;
    const version = nav.querySelector<HTMLElement>('[data-testid="nav-version"]')!;
    expect(version.textContent!.replace(/\s+/g, ' ').trim()).toBe(
      `${versionName()}${versionLabel()}`,
    );
    expect(version.querySelector('.mf-sr-only')!.textContent).toBe(versionName());
    expect(version.querySelector('[aria-hidden="true"]')!.textContent).toBe(versionLabel());
    expect(version.getAttribute('data-tip')).toBe(versionName());
    expect(version.closest('a,button')).toBeNull();
    expect(nav.lastElementChild).toBe(version);
  });

  it('hides My Matters without Task.View or without Matter.View, never disabled (#691)', async () => {
    expect(navLabels(await create(['Matter.BeManager', 'Matter.View']))).not.toContain(
      'My Matters',
    );
    TestBed.resetTestingModule();
    expect(navLabels(await create(['Matter.BeManager', 'Task.View']))).not.toContain('My Matters');
  });

  it('draws no group label for a group with nothing in it (S6, #621)', async () => {
    const fixture = await create(['Client.View']);
    const headings = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.mf-nav-heading'),
    ).map((h) => h.textContent!.trim());
    expect(headings).toEqual(['Records']);
  });

  it('shows Pod Work with Pod.View and Task.View (#549)', async () => {
    expect(navLabels(await create(['Task.View', 'Pod.View']))).toContain('Pod Work');
  });

  it('hides Pod Work without Task.View, even with Pod.View: no dead link (#549)', async () => {
    expect(navLabels(await create(['Pod.View', 'Dashboard.View']))).not.toContain('Pod Work');
  });

  it('hides Pod Work without Pod.View (#549)', async () => {
    expect(navLabels(await create(['Task.View']))).not.toContain('Pod Work');
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

  it('keeps the help out of the header: Keyboard shortcuts lives in the account menu', async () => {
    const fixture = await create(['Matter.View']);
    expect(fixture.nativeElement.querySelector('[data-shortcut-help-button]')).toBeNull();
    expect(fixture.nativeElement.querySelector('mf-user-menu')).not.toBeNull();
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

    it('names the search row by id: aria-controls matches an element that exists (#587)', async () => {
      const fixture = await create(['Task.View']);
      const button = q(fixture, '[data-testid=search-button]');
      const id = button.getAttribute('aria-controls')!;
      expect(id).toBe('mf-search-row');
      expect(fixture.nativeElement.querySelector('#' + id)).toBe(q(fixture, 'mf-global-search'));
    });

    it('has no search icon when the user may not search', async () => {
      const fixture = await create(['Pod.View']);
      expect(q(fixture, '[data-testid=search-button]')).toBeNull();
    });
  });

  describe('skip to list link (#586)', () => {
    const link = (f: { nativeElement: HTMLElement }) =>
      f.nativeElement.querySelector('a[data-skip-list]') as HTMLAnchorElement | null;

    it('is drawn only while an element with the target id exists, and its href names that element', async () => {
      const fixture = await create(['Task.View']);
      const skip = TestBed.inject(SkipTarget);
      const focus = vi.fn();
      const host = document.createElement('section');
      const off = skip.register({ label: 'Skip to task list', focus, element: host });
      await settle(fixture);
      // The element exists but is not in the document yet: no link.
      expect(link(fixture)).toBeNull();
      document.body.appendChild(host);
      await vi.waitFor(() => expect(link(fixture)).not.toBeNull());
      await settle(fixture);
      expect(link(fixture)!.getAttribute('href')).toBe('#mf-list');
      expect(document.getElementById('mf-list')).toBe(host);
      expect(host.getAttribute('tabindex')).toBe('-1');
      link(fixture)!.click();
      expect(focus).toHaveBeenCalled();
      // The element goes away (loading, error): the link goes with it.
      host.remove();
      await vi.waitFor(() => expect(link(fixture)).toBeNull());
      off();
    });

    it('follows a page-chosen id and disappears when the page unregisters', async () => {
      const fixture = await create(['Task.View']);
      const skip = TestBed.inject(SkipTarget);
      const host = document.createElement('section');
      document.body.appendChild(host);
      const off = skip.register({
        label: 'Skip to table',
        id: 'users-table',
        element: host,
        focus: vi.fn(),
      });
      await vi.waitFor(() => expect(link(fixture)?.getAttribute('href')).toBe('#users-table'));
      off();
      await vi.waitFor(() => expect(link(fixture)).toBeNull());
      expect(host.hasAttribute('id')).toBe(false);
      host.remove();
    });
  });
});
