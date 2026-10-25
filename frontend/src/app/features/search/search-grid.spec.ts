import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PrioritiesClient, StatusLabelsClient } from '../../api/generated/api-client';
import { FakePrioritiesClient, FakeStatusLabelsClient } from '../../core/lookups/lookups-testing';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../shared/testing/org-testing';
import { settle } from '../../shared/testing/org-testing';
import { aHit } from '../../shared/testing/search-testing';
import { SearchGrid } from './search-grid';

describe('mf-search-grid (#468, #469, #470)', () => {
  async function create(inputs: Record<string, unknown>) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideFakeMe(new FakeMeApi(withPermissions('Task.View'))),
        { provide: PrioritiesClient, useClass: FakePrioritiesClient },
        { provide: StatusLabelsClient, useClass: FakeStatusLabelsClient },
      ],
    });
    const fixture = TestBed.createComponent(SearchGrid);
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    await settle(fixture);
    return fixture.nativeElement as HTMLElement;
  }
  const heads = (el: HTMLElement) =>
    Array.from(el.querySelectorAll('th')).map((th) => th.textContent!.trim());

  it('shows an asset with Type and Matter number, no URL text and the URL as the row tooltip', async () => {
    const url = 'https://share.example.com/' + 'x'.repeat(500);
    const el = await create({
      type: 'asset',
      label: 'Assets',
      hits: [
        aHit({
          type: 'asset',
          id: 9,
          label: 'Review set',
          reference: url,
          secondary: 'Production',
          path: '/assets/9',
          isActive: true,
        }),
      ],
    });
    expect(heads(el)).toEqual(['Name', 'Type', 'Matter number', 'Status']);
    const row = el.querySelector('[data-hit-row]')!;
    expect(row.textContent).not.toContain('https://');
    expect(row.getAttribute('title')).toBe(url);
    expect(row.querySelector('[data-cell=assetType]')!.textContent).toContain('Production');
    expect(row.querySelector('[data-cell=matterNumber]')!.textContent).toContain('00343-00012');
  });

  it('marks a sensitive matter once, with a named lock for the other types, and says "Other matter" outside my matters', async () => {
    const el = await create({
      type: 'project',
      label: 'Projects',
      hits: [
        aHit({
          type: 'project',
          id: 3,
          path: '/projects/3',
          isSensitive: true,
          inMyMatters: false,
        }),
      ],
    });
    expect(el.querySelectorAll('[data-sensitive-marker]').length).toBe(1);
    expect(el.querySelector('mf-sensitive-badge')).toBeNull();
    expect(el.querySelector('[data-other-matter]')!.textContent).toContain('Other matter');
  });

  it('shows skeleton rows while loading, the error with Retry, and the empty text (grid-body contract)', async () => {
    const loading = await create({ type: 'task', label: 'Tasks', state: 'loading' });
    expect(loading.querySelectorAll('[data-skeleton]').length).toBe(5);
    expect(loading.querySelector('[data-loading]')!.textContent).toContain('Loading results');

    const failed = await create({ type: 'task', label: 'Tasks', state: 'error' });
    expect(failed.querySelector('[data-error]')!.textContent).toContain("Couldn't load results.");
    expect(failed.querySelector('button')!.textContent).toContain('Retry');

    const empty = await create({ type: 'task', label: 'Tasks', emptyText: "No results for 'x'." });
    expect(empty.querySelector('[data-empty]')!.textContent).toContain("No results for 'x'.");
  });
});
