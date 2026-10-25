import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { NEVER, throwError } from 'rxjs';
import {
  PrioritiesClient,
  SearchClient,
  SearchResponse,
  StatusLabelsClient,
} from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { Permission } from '../../core/auth/permissions';
import { FakePrioritiesClient, FakeStatusLabelsClient } from '../../core/lookups/lookups-testing';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../shared/testing/org-testing';
import { ok, settle } from '../../shared/testing/org-testing';
import {
  aGroup,
  aHit,
  aResponse,
  anAdvancedPage,
  numericResponse,
} from '../../shared/testing/search-testing';
import { SearchResultsPage } from './search-results-page';

const ALL: Permission[] = ['Client.View', 'Matter.View', 'Project.View', 'Task.View', 'Asset.View'];

describe('SearchResultsPage', () => {
  let api: { search: ReturnType<typeof vi.fn>; advancedSearch: ReturnType<typeof vi.fn> };
  let navigate: ReturnType<typeof vi.spyOn>;

  async function create(
    q: string | undefined,
    response: SearchResponse = numericResponse(),
    permissions = ALL,
    params: { type?: string; page?: string; pageSize?: string } = {},
  ) {
    TestBed.resetTestingModule();
    api = {
      search: vi.fn().mockReturnValue(ok(response)),
      advancedSearch: vi
        .fn()
        .mockReturnValue(ok(anAdvancedPage([aHit()], { total: 1, type: 'matter' }))),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: SearchClient, useValue: api },
        { provide: PrioritiesClient, useClass: FakePrioritiesClient },
        { provide: StatusLabelsClient, useClass: FakeStatusLabelsClient },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(SearchResultsPage);
    fixture.componentRef.setInput('q', q);
    if (params.type !== undefined) fixture.componentRef.setInput('type', params.type);
    if (params.page !== undefined) fixture.componentRef.setInput('page', params.page);
    if (params.pageSize !== undefined) fixture.componentRef.setInput('pageSize', params.pageSize);
    await settle(fixture);
    return fixture;
  }

  const sections = (el: HTMLElement) =>
    Array.from(el.querySelectorAll<HTMLElement>('[data-section]'));
  const tabs = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLElement>('[role=tab]'));
  const tabText = (el: HTMLElement) =>
    tabs(el).map((t) => t.textContent!.replace(/\s+/g, ' ').trim());
  const echo = (el: HTMLElement) => el.querySelector('[data-page-description]')?.textContent ?? '';

  it('groups the hits in sections, one per type the user may view, in the UX order, five of each', async () => {
    const fixture = await create('343');
    const el: HTMLElement = fixture.nativeElement;

    expect(sections(el).map((s) => s.dataset['section'])).toEqual(['matter', 'client', 'task']);
    expect(sections(el)[0].querySelector('h2')!.textContent).toContain('Matters');
    const matterRow = sections(el)[0].querySelector('[data-hit-row]')!;
    expect(matterRow.textContent).toContain('00343-00012');
    expect(matterRow.textContent).toContain('Sensitive');
    expect(matterRow.querySelector('a')!.getAttribute('href')).toBe('/matters/7');
    const taskRow = sections(el)[2].querySelector('[data-hit-row]')!;
    expect(taskRow.textContent).toContain('TSK-1042');
    expect(taskRow.querySelector('[data-status]')!.textContent).toContain('New');
    expect(api.search).toHaveBeenCalledWith(
      '343',
      ['matter', 'client', 'task', 'project', 'asset'],
      5,
    );
    expect(api.advancedSearch).not.toHaveBeenCalled();
  });

  it('is a fixed page with a tab per type the user may view and the true count of each (#466)', async () => {
    const response = aResponse(
      [
        aGroup('client', [aHit({ type: 'client', id: 1, path: '/clients/1' })], false, 1),
        aGroup('matter', [aHit()], true, 12),
        aGroup('project', [], false, 0),
        aGroup('task', [aHit({ type: 'task', id: 5, path: '/tasks/5', status: 'NEW' })], true, 24),
        aGroup('asset', [aHit({ type: 'asset', id: 9, path: '/assets/9' })], true, 1000, true),
      ],
      'review',
    );
    const fixture = await create('review', response);
    const el: HTMLElement = fixture.nativeElement;

    expect(el.querySelector('mf-fixed-page')).not.toBeNull();
    expect(el.querySelector('h1')!.textContent).toContain('Search results');
    expect(el.querySelector('[role=tablist]')!.getAttribute('aria-label')).toBe(
      'Search results by type',
    );
    // Tab order of the review; the All count is the sum of the types (a capped type makes it a lower bound); a zero tab stays.
    expect(tabText(el)).toEqual([
      'All (1,037+)',
      'Matters (12)',
      'Clients (1)',
      'Tasks (24)',
      'Projects (0)',
      'Assets (1,000+)',
    ]);
    expect(tabs(el)[3].getAttribute('aria-label')).toBe('Tasks, 24 results');
    expect(tabs(el)[2].getAttribute('aria-label')).toBe('Clients, 1 result');
    expect(tabs(el)[5].getAttribute('aria-label')).toBe('Assets, 1,000 or more results');
    expect(tabs(el)[0].getAttribute('aria-selected')).toBe('true');
    // The headings of the sections carry the same true counts, not "10+".
    const headings = sections(el).map((s) =>
      s.querySelector('h2')!.textContent!.replace(/\s+/g, ' ').trim(),
    );
    expect(headings).toEqual(['Matters (12)', 'Clients (1)', 'Tasks (24)', 'Assets (1,000+)']);
  });

  it('shows the counts as -- until the answer is in', async () => {
    const fixture = await create('343');
    api.search.mockReturnValue(NEVER);
    fixture.componentRef.setInput('q', '344');
    await settle(fixture);
    expect(tabText(fixture.nativeElement)[0]).toBe('All (--)');
    // Skeleton rows of the grid body (#470), with one polite "Loading results".
    expect(fixture.nativeElement.querySelector('[data-loading]')).not.toBeNull();
    expect(fixture.nativeElement.querySelectorAll('[data-skeleton]').length).toBe(5);
  });

  it('All: "See all N" only where hits are left out, no Show more anywhere (#467)', async () => {
    const response = aResponse(
      [
        aGroup('matter', [aHit()], false, 1),
        aGroup('task', [aHit({ type: 'task', id: 5, path: '/tasks/5', status: 'NEW' })], true, 112),
        aGroup('asset', [aHit({ type: 'asset', id: 9, path: '/assets/9' })], true, 1000, true),
      ],
      'review',
    );
    const fixture = await create('review', response);
    const el: HTMLElement = fixture.nativeElement;
    const more = Array.from(el.querySelectorAll<HTMLElement>('[data-see-all]'));
    expect(more.map((a) => a.textContent!.replace(/\s+/g, ' ').trim())).toEqual([
      'See all 112 tasks',
      'See all 1,000+ assets',
    ]);
    expect(more[0].getAttribute('href')).toContain('type=task');
    expect(el.textContent).not.toContain('Show more');
  });

  it('only has tabs for, searches and shows the types the user may view', async () => {
    const fixture = await create('343', numericResponse(), ['Task.View']);
    expect(api.search).toHaveBeenCalledWith('343', ['task'], 5);
    expect(tabText(fixture.nativeElement).map((t) => t.split(' (')[0])).toEqual(['All', 'Tasks']);
    expect(sections(fixture.nativeElement).map((s) => s.dataset['section'])).toEqual(['task']);

    const two = await create('343', numericResponse(), ['Client.View', 'Matter.View']);
    expect(tabText(two.nativeElement).map((t) => t.split(' (')[0])).toEqual([
      'All',
      'Matters',
      'Clients',
    ]);
  });

  it('opens a type tab from type= on the Advanced endpoint, with the page and page size in the address', async () => {
    const page = anAdvancedPage([aHit({ id: 31, label: 'Matter 31', path: '/matters/31' })], {
      total: 140,
      page: 2,
      pageSize: 50,
    });
    const fixture = await create('demo', numericResponse(), ALL, {
      type: 'matter',
      page: '2',
      pageSize: '50',
    });
    api.advancedSearch.mockReturnValue(ok(page));
    fixture.componentRef.setInput('page', '2');
    fixture.componentRef.setInput('q', 'demo2');
    await settle(fixture);
    const el: HTMLElement = fixture.nativeElement;

    const call = api.advancedSearch.mock.calls.at(-1)!;
    expect(call[0]).toBe('matter');
    expect(call[1]).toBe('demo2');
    expect(call[10]).toBe(2);
    expect(call[11]).toBe(50);
    expect(tabs(el)[1].getAttribute('aria-selected')).toBe('true');
    expect(sections(el).length).toBe(0);
    expect(el.querySelectorAll('[data-hit-row]').length).toBe(1);
    expect(el.querySelector('[data-range]')!.textContent).toContain('51-100 of 140');
  });

  it('an unknown type, or a type the user may not view, opens All and never asks for that type', async () => {
    const unknown = await create('343', numericResponse(), ALL, { type: 'banana' });
    expect(tabs(unknown.nativeElement)[0].getAttribute('aria-selected')).toBe('true');
    expect(sections(unknown.nativeElement).length).toBe(3);
    expect(api.advancedSearch).not.toHaveBeenCalled();

    const denied = await create('343', numericResponse(), ['Client.View'], { type: 'task' });
    expect(tabs(denied.nativeElement)[0].getAttribute('aria-selected')).toBe('true');
    expect(api.advancedSearch).not.toHaveBeenCalled();
  });

  it('a tab click or a page change goes to the address (a history entry), keeping q and resetting the page', async () => {
    const fixture = await create('demo', numericResponse(), ALL, { type: 'matter', page: '3' });
    const el: HTMLElement = fixture.nativeElement;
    tabs(el)[3].click();
    expect(navigate).toHaveBeenLastCalledWith([], {
      queryParams: { type: 'task', page: null },
      queryParamsHandling: 'merge',
      replaceUrl: false,
    });
    tabs(el)[0].click();
    expect(navigate).toHaveBeenLastCalledWith([], {
      queryParams: { type: null, page: null },
      queryParamsHandling: 'merge',
      replaceUrl: false,
    });
  });

  it('changing only the tab or the page never asks for the counts again', async () => {
    const fixture = await create('demo');
    expect(api.search).toHaveBeenCalledTimes(1);
    fixture.componentRef.setInput('type', 'matter');
    await settle(fixture);
    fixture.componentRef.setInput('page', '2');
    await settle(fixture);
    fixture.componentRef.setInput('type', undefined);
    await settle(fixture);
    expect(api.search).toHaveBeenCalledTimes(1);
    expect(api.advancedSearch).toHaveBeenCalledTimes(2); // matter page 1, matter page 2
  });

  it('a page past the end goes to the last page without adding a history entry', async () => {
    const fixture = await create('demo', numericResponse(), ALL, { type: 'matter', page: '9' });
    api.advancedSearch.mockReturnValue(
      ok(anAdvancedPage([], { total: 60, page: 9, pageSize: 25 })),
    );
    fixture.componentRef.setInput('page', '10');
    await settle(fixture);
    expect(navigate).toHaveBeenLastCalledWith([], {
      queryParams: { page: 3 },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  });

  it('the pager changes the page and the page size in the address', async () => {
    const fixture = await create('demo', numericResponse(), ALL, { type: 'matter' });
    api.advancedSearch.mockReturnValue(ok(anAdvancedPage([aHit()], { total: 90, pageSize: 25 })));
    fixture.componentRef.setInput('page', '1');
    fixture.componentRef.setInput('q', 'demo3');
    await settle(fixture);
    const el: HTMLElement = fixture.nativeElement;
    const next = Array.from(el.querySelectorAll<HTMLButtonElement>('.mf-pager__nav button')).find(
      (b) => b.textContent!.trim() === 'Next',
    )!;
    next.click();
    expect(navigate).toHaveBeenLastCalledWith([], {
      queryParams: { page: 2 },
      queryParamsHandling: 'merge',
      replaceUrl: false,
    });
    const size = el.querySelector<HTMLSelectElement>('select')!;
    size.value = '50';
    size.dispatchEvent(new Event('change'));
    expect(navigate).toHaveBeenLastCalledWith([], {
      queryParams: { pageSize: 50, page: null },
      queryParamsHandling: 'merge',
      replaceUrl: false,
    });
  });

  it('a task result remembers this view for the Task page (from=search, the row for Back); other results are plain links (T9, #324)', async () => {
    const fixture = await create('343');
    const el: HTMLElement = fixture.nativeElement;
    const task = sections(el)[2].querySelector<HTMLAnchorElement>(
      '[data-hit-row] a:not([tabindex])',
    )!;
    expect(task.getAttribute('href')).toContain('from=search');
    expect(task.getAttribute('data-row-list')).toBe('search');
    expect(task.getAttribute('data-row-key')).not.toBeNull();
    const matter = sections(el)[0].querySelector<HTMLAnchorElement>('[data-hit-row] a')!;
    expect(matter.getAttribute('href')).toBe('/matters/7');
    expect(matter.getAttribute('data-row-list')).toBeNull();
  });

  it('shows only the columns that fit each type, with the reference as plain text (#469)', async () => {
    const fixture = await create('343');
    const el: HTMLElement = fixture.nativeElement;
    const heads = (i: number) =>
      Array.from(sections(el)[i].querySelectorAll('th')).map((th) => th.textContent!.trim());
    expect(heads(0)).toEqual(['Number', 'Name', 'Client', 'Status']);
    expect(heads(1)).toEqual(['Number', 'Name', 'Status']);
    expect(heads(2)).toEqual(['Ref', 'Title', 'Matter', 'Status']);
    // The name is the only link of the row; the number is text.
    const links = sections(el)[0].querySelectorAll('[data-hit-row] a');
    expect(links.length).toBe(1);
    expect(links[0].getAttribute('href')).toBe('/matters/7');
    expect(sections(el)[0].querySelector('[data-hit-row] td.sg-ref')!.textContent!.trim()).toBe(
      '00343-00012',
    );
  });

  it('never links to a page other than the hit itself: the matter on a task, project or asset row is text (#461)', async () => {
    const response = aResponse(
      [
        aGroup('project', [
          aHit({ type: 'project', id: 3, path: '/projects/3', reference: undefined }),
        ]),
        aGroup('task', [aHit({ type: 'task', id: 5, path: '/tasks/5', status: 'NEW' })]),
        aGroup('asset', [aHit({ type: 'asset', id: 9, path: '/assets/9' })]),
      ],
      'review',
    );
    const fixture = await create('review', response, ['Task.View', 'Project.View', 'Asset.View']);
    const hrefs = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('[data-hit-row] a'),
    ).map((a) => a.getAttribute('href')!.split('?')[0]);
    expect(new Set(hrefs)).toEqual(new Set(['/projects/3', '/tasks/5', '/assets/9']));
    expect(hrefs.some((h) => h.startsWith('/matters'))).toBe(false);
    // The matter reference is on the row, as text with a copy button.
    expect(fixture.nativeElement.querySelector('[data-hit-row] .mf-ref')!.tagName).toBe('SPAN');
  });

  it('echoes the normalized form of a number', async () => {
    const fixture = await create('343');
    expect(echo(fixture.nativeElement)).toContain('00343');
    expect(echo(fixture.nativeElement)).toContain('you typed "343"');
  });

  it('echoes plain text as typed and highlights it in the names', async () => {
    const fixture = await create(
      'merger',
      aResponse([aGroup('matter', [aHit({ label: 'Big Merger Review' })])], 'merger'),
    );
    const el: HTMLElement = fixture.nativeElement;
    expect(echo(el)).toContain('Showing results for "merger"');
    expect(el.querySelector('mark')!.textContent).toBe('Merger');
  });

  it('says what to try when nothing matches, and links to Advanced search', async () => {
    const fixture = await create('zzz', aResponse([aGroup('client', [])], 'zzz'));
    const empty = fixture.nativeElement.querySelector('[data-state=empty]');
    expect(empty.textContent).toContain("No results for 'zzz'. Try a client or matter number");
    expect(empty.querySelector('a')!.getAttribute('href')).toBe('/search/advanced?q=zzz');
  });

  it('asks for more input when the text is too short and does not call the API', async () => {
    const fixture = await create('a');
    expect(fixture.nativeElement.querySelector('[data-state=short]')).not.toBeNull();
    expect(api.search).not.toHaveBeenCalled();
  });

  it('shows an error with a retry', async () => {
    const fixture = await create('343');
    api.search.mockReturnValue(throwError(() => new Error('boom')));
    fixture.componentRef.setInput('q', '344');
    await settle(fixture);
    const error = fixture.nativeElement.querySelector('[data-error]');
    expect(error.textContent).toContain("Couldn't load results.");

    api.search.mockReturnValue(ok(numericResponse()));
    error.querySelector('button').click();
    await settle(fixture);
    expect(sections(fixture.nativeElement).length).toBe(3);
  });

  it('announces the result count in a live region', async () => {
    const fixture = await create('343');
    expect(fixture.nativeElement.querySelector('[data-live]').textContent).toContain(
      '3 results for 343',
    );
  });

  it('searches again when the query in the URL changes', async () => {
    const fixture = await create('343');
    fixture.componentRef.setInput('q', '00343-00012');
    await settle(fixture);
    expect(api.search).toHaveBeenLastCalledWith('00343-00012', expect.any(Array), 5);
  });
});
