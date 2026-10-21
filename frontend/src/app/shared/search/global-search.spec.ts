import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { throwError } from 'rxjs';
import { SearchClient } from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { Permission } from '../../core/auth/permissions';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../core/auth/auth-testing';
import { aGroup, aHit, aResponse, numericResponse } from '../testing/search-testing';
import { ok, settle } from '../testing/org-testing';
import { GlobalSearch } from './global-search';

const ALL: Permission[] = ['Client.View', 'Matter.View', 'Project.View', 'Task.View', 'Asset.View'];

describe('mf-global-search (header typeahead)', () => {
  let api: { search: ReturnType<typeof vi.fn> };
  let fixture: ComponentFixture<GlobalSearch>;
  let router: Router;

  // The component loads the API client module lazily; warm it so the first typed query is not racing a chunk load.
  beforeAll(async () => {
    await import('../../api/generated/api-client');
    await import('../../core/lookups/lookup-store');
  });

  const el = (): HTMLElement => fixture.nativeElement;
  const box = (): HTMLInputElement => el().querySelector('input')!;
  const options = (): HTMLElement[] => Array.from(el().querySelectorAll('[role=option]'));
  const live = (): string => el().querySelector('[data-live]')!.textContent!.trim();

  async function create(permissions: Permission[] = ALL, response = numericResponse()) {
    api = { search: vi.fn().mockReturnValue(ok(response)) };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: SearchClient, useValue: api },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(GlobalSearch);
    fixture.componentRef.setInput('debounceMs', 0);
    await settle(fixture);
  }

  async function type(value: string): Promise<void> {
    box().value = value;
    box().dispatchEvent(new Event('input'));
    await settle(fixture);
  }

  function key(name: string): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key: name, cancelable: true, bubbles: true });
    box().dispatchEvent(event);
    fixture.detectChanges();
    return event;
  }

  it('is an ARIA 1.2 combobox with a listbox popup that opens when results arrive', async () => {
    await create();
    expect(box().getAttribute('role')).toBe('combobox');
    expect(box().getAttribute('aria-autocomplete')).toBe('list');
    expect(box().getAttribute('aria-expanded')).toBe('false');
    expect(box().getAttribute('aria-label')).toContain('Search');

    await type('343');

    expect(box().getAttribute('aria-expanded')).toBe('true');
    const listbox = el().querySelector('[role=listbox]')!;
    expect(box().getAttribute('aria-controls')).toBe(listbox.id);
    expect(listbox.getAttribute('aria-label')).toBeTruthy();
    expect(api.search).toHaveBeenCalledWith(
      '343',
      ['matter', 'client', 'task', 'project', 'asset'],
      5,
    );
  });

  it('tells the user a single non-digit character is too short instead of showing nothing (UAT2-08)', async () => {
    await create();
    await type('a');
    expect(api.search).not.toHaveBeenCalled();
    expect(el().querySelector('[data-state=hint]')?.textContent).toContain('at least 2 characters');
    expect(live()).toContain('at least 2 characters');

    await type('3');
    expect(el().querySelector('[data-state=hint]')).toBeNull();
    expect(api.search).toHaveBeenCalled();
  });

  it('shows hits grouped Matters, Clients, Tasks in the UX order and skips empty groups', async () => {
    await create();
    await type('343');

    const groups = Array.from(el().querySelectorAll('[role=group]'));
    expect(
      groups.map((g) =>
        el()
          .querySelector(`#${g.getAttribute('aria-labelledby')}`)!
          .textContent!.trim(),
      ),
    ).toEqual(['Matters', 'Clients', 'Tasks']);
    const text = options().map((o) => o.textContent!.replace(/\s+/g, ' ').trim());
    expect(text[0]).toContain('00343-00012');
    expect(text[0]).toContain('Merger Review');
    expect(text[0]).toContain('Acme Corp');
    expect(text[0]).toContain('Sensitive');
    expect(text[1]).toContain('00343');
    expect(text[1]).toContain('Acme Corp');
    expect(text[2]).toContain('TSK-1042');
    expect(text.at(-1)).toBe('View all results for "343"');
  });

  it('requires two characters (or one digit) before it searches', async () => {
    await create();
    await type('a');
    expect(api.search).not.toHaveBeenCalled();
    expect(el().querySelector('[role=listbox]')).toBeNull();

    await type('7');
    expect(api.search).toHaveBeenCalledWith('7', expect.any(Array), 5);
  });

  it('debounces: only the last text of a burst is searched', async () => {
    await create();
    fixture.componentRef.setInput('debounceMs', 20);
    await type('ac');
    await type('acm');
    await type('acme');
    await new Promise((r) => setTimeout(r, 60));
    fixture.detectChanges();

    expect(api.search).toHaveBeenCalledTimes(1);
    expect(api.search).toHaveBeenCalledWith('acme', expect.any(Array), 5);
  });

  it('moves with Arrow keys through hits and "View all", exposing the active option to assistive technology', async () => {
    await create();
    await type('343');

    key('ArrowDown');
    expect(box().getAttribute('aria-activedescendant')).toBe(options()[0].id);
    expect(options()[0].getAttribute('aria-selected')).toBe('true');
    expect(options()[1].getAttribute('aria-selected')).toBe('false');

    key('ArrowDown');
    key('ArrowDown');
    key('ArrowDown');
    expect(options().at(-1)!.id).toBe(box().getAttribute('aria-activedescendant'));
    key('ArrowDown'); // wraps to the first hit
    expect(box().getAttribute('aria-activedescendant')).toBe(options()[0].id);
    key('ArrowUp'); // and back to "View all"
    expect(box().getAttribute('aria-activedescendant')).toBe(options().at(-1)!.id);
    key('Home');
    expect(box().getAttribute('aria-activedescendant')).toBe(options()[0].id);
    key('End');
    expect(box().getAttribute('aria-activedescendant')).toBe(options().at(-1)!.id);
  });

  it('opens the active hit with Enter', async () => {
    await create();
    await type('343');

    key('ArrowDown');
    key('ArrowDown'); // the client
    const enter = key('Enter');

    expect(enter.defaultPrevented).toBe(true);
    expect(router.navigateByUrl).toHaveBeenCalledWith('/clients/1');
    expect(box().getAttribute('aria-expanded')).toBe('false');
  });

  it('goes to the results page with Enter when no hit is active, and from the "View all" row', async () => {
    await create();
    await type('  343 ');

    key('Enter');
    expect(router.navigate).toHaveBeenLastCalledWith(['/search'], { queryParams: { q: '343' } });

    await type('343');
    key('End');
    key('Enter');
    expect(router.navigate).toHaveBeenLastCalledWith(['/search'], { queryParams: { q: '343' } });
  });

  it('opens a hit with the mouse without taking focus from the box', async () => {
    await create();
    await type('343');
    const option = options()[2];

    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    option.dispatchEvent(down);
    option.click();

    expect(down.defaultPrevented).toBe(true);
    expect(router.navigateByUrl).toHaveBeenCalledWith('/tasks/1042');
  });

  it('closes with Escape, then clears the text with a second Escape', async () => {
    await create();
    await type('343');

    key('Escape');
    expect(el().querySelector('[role=listbox]')).toBeNull();
    expect(box().getAttribute('aria-expanded')).toBe('false');
    expect(box().value).toBe('343');

    key('Escape');
    expect(box().value).toBe('');
  });

  it('closes when focus leaves or the user clicks elsewhere', async () => {
    await create();
    await type('343');
    document.body.click();
    fixture.detectChanges();
    expect(box().getAttribute('aria-expanded')).toBe('false');

    box().dispatchEvent(new FocusEvent('focus'));
    fixture.detectChanges();
    expect(box().getAttribute('aria-expanded')).toBe('true');
  });

  it('announces the number of results and the empty and error states through a live region', async () => {
    await create();
    await type('343');
    expect(live()).toContain('3 results available');

    api.search.mockReturnValue(ok(aResponse([aGroup('client', [])], 'zzz')));
    await type('zzz');
    const empty =
      "No results for 'zzz'. Try a client or matter number, a task title, or an asset name.";
    expect(el().querySelector('[data-state=empty]')!.textContent!.trim()).toBe(empty);
    expect(live()).toBe(empty);

    api.search.mockReturnValue(throwError(() => new Error('boom')));
    await type('zzzz');
    expect(el().querySelector('[data-state=error]')!.textContent).toContain(
      'Search is unavailable. Try again.',
    );
    expect(live()).toBe('Search is unavailable. Try again.');
  });

  it('says "Searching" while the request is out', async () => {
    await create();
    fixture.componentRef.setInput('debounceMs', 200);
    await type('acme');
    expect(el().querySelector('[data-state=loading]')).not.toBeNull();
    expect(live()).toBe('Searching');
  });

  it('retries a failed search from the panel', async () => {
    await create();
    api.search.mockReturnValueOnce(throwError(() => new Error('boom')));
    await type('343');
    expect(el().querySelector('[data-state=error]')).not.toBeNull();

    el().querySelector<HTMLButtonElement>('[data-state=error] button')!.click();
    await settle(fixture);
    expect(options().length).toBeGreaterThan(0);
  });

  it('ignores an answer that arrives after the text changed', async () => {
    await create();
    let release!: (value: ReturnType<typeof numericResponse>) => void;
    const slow = new Promise<ReturnType<typeof numericResponse>>((r) => (release = r));
    api.search.mockReturnValueOnce({
      subscribe: (o: { next: (v: unknown) => void }) => void slow.then((v) => o.next(v)),
    });
    await type('old');
    api.search.mockReturnValue(
      ok(aResponse([aGroup('client', [aHit({ type: 'client', id: 9, label: 'Newer' })])], 'newer')),
    );
    await type('newer');
    release(numericResponse());
    await settle(fixture);

    expect(options().map((o) => o.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('Newer')]),
    );
    expect(options().some((o) => o.textContent!.includes('Process custodian data'))).toBe(false);
  });

  it('only asks for, and shows, the types the user may view', async () => {
    await create(['Client.View']);
    await type('343');

    expect(api.search).toHaveBeenCalledWith('343', ['client'], 5);
    const labels = Array.from(el().querySelectorAll('.mf-gs__group')).map((g) =>
      g.textContent!.trim(),
    );
    expect(labels).toEqual(['Clients']); // the matter and task groups of the (over-generous) response are not rendered
  });

  it('marks sensitive matters with the badge and inactive records with Inactive', async () => {
    await create(
      ALL,
      aResponse([aGroup('matter', [aHit({ isSensitive: true, isActive: false })])]),
    );
    await type('merger');

    const [matter] = options();
    expect(matter.querySelector('mf-sensitive-badge')!.textContent).toContain('Sensitive');
    expect(matter.textContent).toContain('Inactive');
  });

  describe('option lines (BUG-2, BUG-6, S4)', () => {
    const url = 'https://share.example.com/' + 'x'.repeat(1000);
    const asset = (overrides = {}) =>
      aHit({
        type: 'asset',
        id: 5,
        reference: url,
        label: 'Review laptop',
        secondary: 'Laptop',
        matterRef: '00343-00012',
        matterName: 'Merger Review',
        path: '/assets/5',
        ...overrides,
      });
    const task = (overrides = {}) =>
      aHit({
        type: 'task',
        id: 9,
        reference: 'TSK-9',
        label: 'Review documents',
        secondary: 'Pat Partner',
        status: 'NEW',
        path: '/tasks/9',
        ...overrides,
      });
    const sub = (o: HTMLElement) => o.querySelector('.mf-gs__sub')?.textContent?.trim();

    it('shows an asset as its name, then Type and Matter number, never the URL as text', async () => {
      await create(ALL, aResponse([aGroup('asset', [asset()])]));
      await type('review');

      const [option] = options();
      expect(option.querySelector('.mf-gs__ref')).toBeNull();
      expect(option.querySelector('.mf-gs__main')!.textContent).not.toContain('https://');
      expect(option.textContent).not.toContain('xxxx');
      expect(option.querySelector('.mf-gs__label')!.textContent!.trim()).toBe('Review laptop');
      expect(sub(option)).toBe('Laptop · 00343-00012 · Merger Review');
      expect(option.getAttribute('title')).toBe(url);
    });

    it('shows an asset without a Matter permission with its type only', async () => {
      await create(
        ALL,
        aResponse([aGroup('asset', [asset({ matterRef: undefined, matterName: undefined })])]),
      );
      await type('review');
      expect(sub(options()[0])).toBe('Laptop');
    });

    it('keeps the reference-first line for matters, clients, projects and tasks', async () => {
      await create(
        ALL,
        aResponse([
          aGroup('matter', [aHit()]),
          aGroup('task', [task()]),
          aGroup('project', [
            aHit({
              type: 'project',
              id: 3,
              reference: undefined,
              label: 'Data room',
              path: '/projects/3',
            }),
          ]),
        ]),
      );
      await type('review');
      const [matter, task1, project] = options();
      expect(matter.querySelector('.mf-gs__ref')!.textContent).toBe('00343-00012');
      expect(sub(matter)).toBe('Acme Corp');
      expect(task1.querySelector('.mf-gs__ref')!.textContent).toBe('TSK-9');
      expect(project.querySelector('.mf-gs__ref')).toBeNull();
      expect(sub(project)).toBe('00343-00012 · Merger Review');
    });

    it('shows Matter number, Matter name and Status for a task and never the requestor', async () => {
      await create(ALL, aResponse([aGroup('task', [task()])]));
      await type('review');
      const text = options()[0].textContent!;
      expect(sub(options()[0])).toBe('00343-00012 · Merger Review · New');
      expect(text).not.toContain('Pat Partner');
      expect(text).not.toContain('[');
    });

    it('marks a sensitive matter once per task, project and asset option with a named lock, not the badge', async () => {
      await create(
        ALL,
        aResponse([
          aGroup('matter', [aHit({ isSensitive: true })]),
          aGroup('task', [task({ isSensitive: true }), task({ id: 10, isSensitive: false })]),
          aGroup('project', [
            aHit({
              type: 'project',
              id: 3,
              reference: undefined,
              label: 'Data room',
              isSensitive: true,
              path: '/projects/3',
            }),
          ]),
          aGroup('asset', [asset({ isSensitive: true })]),
        ]),
      );
      await type('review');

      const [matter, sensitiveTask, ordinaryTask, project, assetOption] = options();
      expect(matter.querySelectorAll('mf-sensitive-badge')).toHaveLength(1);
      expect(matter.querySelector('[data-sensitive-marker]')).toBeNull();
      for (const o of [sensitiveTask, project, assetOption]) {
        expect(o.querySelector('mf-sensitive-badge')).toBeNull();
        const markers = o.querySelectorAll('[data-sensitive-marker]');
        expect(markers).toHaveLength(1);
        expect(markers[0].getAttribute('role')).toBe('img');
        expect(markers[0].getAttribute('aria-label')).toBe('Sensitive matter');
      }
      expect(ordinaryTask.querySelector('[data-sensitive-marker]')).toBeNull();
    });
  });

  describe('panel structure (BUG-1, BUG-3)', () => {
    it('makes the one scroller a named, focusable region while the list overflows, and not before', async () => {
      await create();
      await type('343');
      const scroller = el().querySelector<HTMLElement>('[data-search-scroll]')!;
      expect(scroller.contains(el().querySelector('[role=listbox]'))).toBe(true);
      expect(scroller.getAttribute('role')).toBeNull(); // everything fits: no empty Tab stop

      Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 500 });
      Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 100 });
      window.dispatchEvent(new Event('resize'));
      fixture.detectChanges();

      expect(scroller.getAttribute('role')).toBe('region');
      expect(scroller.getAttribute('aria-label')).toBe('Search suggestions');
      expect(scroller.getAttribute('tabindex')).toBe('0');
      // The focus stays in the input: it is still the combobox with the active descendant.
      expect(box().getAttribute('role')).toBe('combobox');
    });

    it('puts "View all results" last, inside the listbox, and ArrowUp from the input reaches it', async () => {
      await create();
      await type('343');
      const all = el().querySelector<HTMLElement>('[data-view-all]')!;
      expect(all.getAttribute('role')).toBe('option');
      expect(el().querySelector('[role=listbox]')!.contains(all)).toBe(true);
      expect(options().at(-1)).toBe(all);
      key('ArrowUp');
      expect(box().getAttribute('aria-activedescendant')).toBe(all.id);
      expect(all.getAttribute('aria-selected')).toBe('true');
      expect(all.textContent!.trim()).toBe('View all results for "343"');
    });

    it('opens the full results page with Enter on the footer', async () => {
      await create();
      await type('343');
      key('ArrowUp');
      key('Enter');
      expect(router.navigate).toHaveBeenCalledWith(['/search'], { queryParams: { q: '343' } });
    });

    it('scrolls the active option into view as the arrows move', async () => {
      await create();
      await type('343');
      const scrolled: string[] = [];
      for (const o of options()) {
        o.scrollIntoView = vi.fn(() => void scrolled.push(o.id));
      }
      key('ArrowDown');
      key('ArrowDown');
      await settle(fixture);
      expect(scrolled.length).toBeGreaterThan(0);
      expect(scrolled.at(-1)).toBe(box().getAttribute('aria-activedescendant'));
    });
  });

  it('highlights the typed text in labels', async () => {
    await create(ALL, aResponse([aGroup('matter', [aHit({ label: 'Merger Review' })])]));
    await type('review');
    expect(el().querySelector('mark')!.textContent).toBe('Review');
  });

  it('focus() puts the cursor in the box (Ctrl+K)', async () => {
    await create();
    fixture.componentInstance.focus();
    expect(document.activeElement).toBe(box());
  });
});
