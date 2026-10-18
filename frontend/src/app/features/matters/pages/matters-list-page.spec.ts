import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { MessageService } from 'primeng/api';
import { MattersClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { Permission } from '../../../core/auth/permissions';
import {
  FakeMeApi,
  aMatter,
  buttonByLabel,
  fakeQuery,
  ok,
  pageOfMatters,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../../shared/testing/org-testing';
import { MattersListPage } from './matters-list-page';

describe('MattersListPage', () => {
  let api: { listMatters: ReturnType<typeof vi.fn> };
  let writeText: ReturnType<typeof vi.fn>;
  let query: ReturnType<typeof fakeQuery>;
  let navigate: ReturnType<typeof vi.fn>;

  async function create(
    permissions: Permission[] = ['Matter.View', 'Matter.Create'],
    params: Record<string, string> = {},
  ) {
    localStorage.clear();
    api = {
      listMatters: vi.fn().mockReturnValue(
        ok(
          pageOfMatters(
            aMatter(),
            aMatter({
              matterId: 8,
              matterRef: '00001-00012',
              clientNumber: '00001',
              clientName: 'Beta LLC',
              clientId: 2,
              isSensitive: true,
              isActive: false,
            }),
          ),
        ),
      ),
    };
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    query = fakeQuery();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        query.provider,
        MessageService,
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: MattersClient, useValue: api },
      ],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true) as never;
    await TestBed.inject(AuthStore).ensureLoaded();
    query.set(params);
    const fixture = TestBed.createComponent(MattersListPage);
    await settle(fixture);
    return fixture;
  }

  it('shows the combined reference in monospace with a copy button, the client and the status', async () => {
    const fixture = await create();
    const rows = fixture.nativeElement.querySelectorAll('tbody tr');

    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector('.mf-ref')?.textContent).toBe('00343-00012');
    expect(rows[0].querySelector('.mf-ref')?.getAttribute('href')).toBe('/matters/7');
    expect(rows[1].querySelector('.mf-ref')?.textContent).toBe('00001-00012');
    expect(rows[0].textContent).toContain('00343 Acme Corp');
    expect(rows[1].textContent).toContain('Inactive');

    rows[0].querySelector('button')!.click();
    await settle(fixture);
    expect(writeText).toHaveBeenCalledWith('00343-00012');
  });

  it('flags sensitive matters in the list', async () => {
    const fixture = await create();
    const rows = fixture.nativeElement.querySelectorAll('tbody tr');

    expect(rows[0].textContent).not.toContain('Sensitive');
    expect(rows[1].textContent).toContain('Sensitive');
  });

  const control = <T extends HTMLElement>(el: HTMLElement, name: string): T =>
    el.querySelector<T>(`[aria-label="Filter by ${name}"]`)!;

  it('has column filters instead of a search box; Sensitive is under Other filters; Active is shown, not counted', async () => {
    const fixture = await create();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('#matter-search, #matter-status, mf-search-box')).toBeNull();
    expect(el.querySelector('[data-filter-row]')).toBeNull(); // closed by default
    el.querySelector<HTMLButtonElement>('[data-filters-toggle]')!.click();
    await settle(fixture);

    expect(control<HTMLInputElement>(el, 'Matter reference')).not.toBeNull();
    expect(control<HTMLInputElement>(el, 'Name')).not.toBeNull();
    expect(control<HTMLInputElement>(el, 'Client')).not.toBeNull();
    expect(control<HTMLSelectElement>(el, 'Status').value).toBe('active');
    expect(control(el, 'Sensitive')).toBeNull(); // no column: Other filters
    expect(el.querySelector('[data-filter-count]')).toBeNull();

    el.querySelector<HTMLButtonElement>('[data-more-filters]')!.click();
    await settle(fixture);
    expect(el.querySelector('[data-more-filter="isSensitive"]')).not.toBeNull();
  });

  it('passes the filters, client, status, page and sort of the URL to the API', async () => {
    const fixture = await create(['Matter.View'], {
      matterRef: '343-12',
      name: 'merger',
      client: 'acme',
      clientId: '1',
      isSensitive: 'true',
      status: 'inactive',
    });
    fixture.componentRef.setInput('page', '3');
    fixture.componentRef.setInput('sort', '-name');
    await settle(fixture);

    expect(api.listMatters).toHaveBeenLastCalledWith(
      undefined,
      1,
      false,
      true,
      '343-12',
      'merger',
      'acme',
      3,
      25,
      '-name',
    );
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-chip="clientId"]')?.textContent).toContain(
      'Client: 00343 Acme Corp',
    );
    expect(control<HTMLInputElement>(el, 'Client').value).toBe('acme');
    expect(el.querySelector('[data-chip="isSensitive"]')?.textContent).toContain('Sensitive: Yes');
  });

  it('writes filter changes to the URL (text with replaceUrl) and removes the client chip through the URL', async () => {
    const fixture = await create(['Matter.View'], { clientId: '1' });
    const el: HTMLElement = fixture.nativeElement;

    const name = control<HTMLInputElement>(el, 'Name');
    name.value = 'merger';
    name.dispatchEvent(new Event('input'));
    name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(navigate).toHaveBeenLastCalledWith([], {
      queryParams: { name: 'merger', page: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });

    el.querySelector<HTMLButtonElement>('[data-chip="clientId"] button')!.click();
    expect(navigate).toHaveBeenLastCalledWith([], {
      queryParams: { clientId: null, page: null },
      queryParamsHandling: 'merge',
    });
  });

  it('keeps the headers and the filter row when nothing matches', async () => {
    const fixture = await create(['Matter.View'], { client: 'zzz' });
    api.listMatters.mockReturnValue(ok(pageOfMatters()));
    fixture.componentRef.setInput('sort', 'name'); // forces a reload
    await settle(fixture);
    const el: HTMLElement = fixture.nativeElement;

    expect(el.querySelector('[data-empty=filtered]')?.textContent).toContain(
      'No matters match these filters',
    );
    expect(el.querySelector('thead th')).not.toBeNull();
    expect(el.querySelector('[data-filter-row]')).not.toBeNull();
  });

  it('hides New matter without Matter.Create', async () => {
    const fixture = await create(['Matter.View']);

    expect(buttonByLabel(fixture.nativeElement, 'New matter')).toBeUndefined();
  });
});
