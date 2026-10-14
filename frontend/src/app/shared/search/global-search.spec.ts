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
    expect(text[1]).toContain('00343 Acme Corp');
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

  it('marks sensitive matters and inactive records, and shows the matter reference under other records', async () => {
    await create(
      ALL,
      aResponse([
        aGroup('matter', [aHit({ isSensitive: true, isActive: false })]),
        aGroup('asset', [
          aHit({
            type: 'asset',
            id: 5,
            reference: 'EVID-1',
            label: 'Laptop',
            secondary: '00343-00012 Merger Review',
            isSensitive: true,
            path: '/assets/5',
          }),
        ]),
      ]),
    );
    await type('merger');

    const [matter, asset] = options();
    expect(matter.querySelector('.mf-gs__badge')!.textContent).toContain('Sensitive');
    expect(matter.querySelector('.mf-gs__tag')!.textContent).toContain('inactive');
    expect(asset.querySelector('.mf-gs__sub')!.textContent).toContain('00343-00012 Merger Review');
    expect(asset.querySelector('.mf-gs__badge')!.textContent).toContain('Sensitive');
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
