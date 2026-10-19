import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { throwError } from 'rxjs';
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
import { aGroup, aHit, aResponse, numericResponse } from '../../shared/testing/search-testing';
import { SearchResultsPage } from './search-results-page';

const ALL: Permission[] = ['Client.View', 'Matter.View', 'Project.View', 'Task.View', 'Asset.View'];

describe('SearchResultsPage', () => {
  let api: { search: ReturnType<typeof vi.fn> };

  async function create(
    q: string | undefined,
    response: SearchResponse = numericResponse(),
    permissions = ALL,
  ) {
    api = { search: vi.fn().mockReturnValue(ok(response)) };
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
    const fixture = TestBed.createComponent(SearchResultsPage);
    fixture.componentRef.setInput('q', q);
    await settle(fixture);
    return fixture;
  }

  const sections = (el: HTMLElement) =>
    Array.from(el.querySelectorAll<HTMLElement>('[data-section]'));

  it('groups the hits in sections, one per type the user may view, in the UX order', async () => {
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
      10,
    );
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

  it('shows only the columns that fit each type, with the reference as a link', async () => {
    const fixture = await create('343');
    const el: HTMLElement = fixture.nativeElement;
    const heads = (i: number) =>
      Array.from(sections(el)[i].querySelectorAll('th')).map((th) => th.textContent!.trim());
    expect(heads(0)).toEqual(['Reference', 'Name', 'Client', 'Status']);
    expect(heads(1)).toEqual(['Reference', 'Name', 'Status']);
    expect(heads(2)).toEqual(['Reference', 'Title', 'Requestor', 'Matter', 'Status']);
    const refLink = sections(el)[0].querySelector('[data-hit-row] td a')!;
    expect(refLink.getAttribute('href')).toBe('/matters/7');
  });

  it('echoes the normalized form of a number', async () => {
    const fixture = await create('343');
    expect(fixture.nativeElement.querySelector('[data-echo]').textContent).toContain('00343');
    expect(fixture.nativeElement.querySelector('[data-echo]').textContent).toContain(
      'you typed "343"',
    );
  });

  it('echoes plain text as typed and highlights it in the names', async () => {
    const fixture = await create(
      'merger',
      aResponse([aGroup('matter', [aHit({ label: 'Big Merger Review' })])], 'merger'),
    );
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-echo]')!.textContent).toContain('Showing results for "merger"');
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
    const error = fixture.nativeElement.querySelector('[data-state=error]');
    expect(error.textContent).toContain('Search is unavailable. Try again.');

    api.search.mockReturnValue(ok(numericResponse()));
    error.querySelector('button').click();
    await settle(fixture);
    expect(sections(fixture.nativeElement).length).toBe(3);
  });

  it('loads more of one type with "Show more" and leaves the other sections alone', async () => {
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        aHit({
          id: i + 1,
          label: `Matter ${i + 1}`,
          reference: `00343-${String(i + 1).padStart(5, '0')}`,
          path: `/matters/${i + 1}`,
        }),
      );
    const fixture = await create(
      'matter',
      aResponse(
        [
          aGroup('matter', many(10), true),
          aGroup('client', [
            aHit({ type: 'client', id: 1, label: 'Matter Co', path: '/clients/1' }),
          ]),
        ],
        'matter',
      ),
    );
    const el: HTMLElement = fixture.nativeElement;
    expect(sections(el)[0].querySelectorAll('[data-hit-row]').length).toBe(10);

    api.search.mockReturnValue(ok(aResponse([aGroup('matter', many(25), true)], 'matter')));
    el.querySelector<HTMLElement>('p-button[data-show-more=matter] button')!.click();
    await settle(fixture);

    expect(api.search).toHaveBeenLastCalledWith('matter', ['matter'], 25);
    expect(sections(el)[0].querySelectorAll('[data-hit-row]').length).toBe(25);
    expect(sections(el)[1].querySelectorAll('[data-hit-row]').length).toBe(1);
  });

  it('stops offering "Show more" at the cap and points to Advanced search instead', async () => {
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => aHit({ id: i + 1, label: `Matter ${i + 1}` }));
    const fixture = await create('matter', aResponse([aGroup('matter', many(10), true)], 'matter'));
    const el: HTMLElement = fixture.nativeElement;

    for (const size of [25, 40, 50]) {
      api.search.mockReturnValue(ok(aResponse([aGroup('matter', many(size), true)], 'matter')));
      el.querySelector<HTMLElement>('p-button[data-show-more=matter] button')!.click();
      await settle(fixture);
    }

    expect(api.search).toHaveBeenLastCalledWith('matter', ['matter'], 50);
    expect(el.querySelector('[data-show-more=matter]')).toBeNull();
    expect(el.querySelector('[data-capped] a')!.getAttribute('href')).toBe(
      '/search/advanced?type=matter&q=matter',
    );
  });

  it('keeps the results on screen when "Show more" fails', async () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      aHit({ id: i + 1, label: `Matter ${i + 1}` }),
    );
    const fixture = await create('matter', aResponse([aGroup('matter', many, true)], 'matter'));
    const el: HTMLElement = fixture.nativeElement;

    api.search.mockReturnValue(throwError(() => new Error('boom')));
    el.querySelector<HTMLElement>('p-button[data-show-more=matter] button')!.click();
    await settle(fixture);

    expect(el.querySelector('[data-state=more-error]')).not.toBeNull();
    expect(sections(el)[0].querySelectorAll('[data-hit-row]').length).toBe(10);
  });

  it('only searches and shows the types the user may view', async () => {
    const fixture = await create('343', numericResponse(), ['Client.View']);
    expect(api.search).toHaveBeenCalledWith('343', ['client'], 10);
    expect(sections(fixture.nativeElement).map((s) => s.dataset['section'])).toEqual(['client']);
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
    expect(api.search).toHaveBeenLastCalledWith('00343-00012', expect.any(Array), 10);
  });
});
