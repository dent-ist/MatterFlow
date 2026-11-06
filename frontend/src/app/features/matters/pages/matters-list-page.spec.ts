import { ddSelect } from '../../../testing/dropdown-testing.spec-util';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import {
  ClientsClient,
  MatterManagersClient,
  MatterResponse,
  MattersClient,
  MyMattersClient,
} from '../../../api/generated/api-client';
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

const ANN = { userId: 11, displayName: 'Ann Lee', isActive: true };
const BOB = { userId: 12, displayName: 'Bob Roe', isActive: true };

describe('MattersListPage', () => {
  let api: { listMatters: ReturnType<typeof vi.fn>; setMatterManagers: ReturnType<typeof vi.fn> };
  let managers: { lookupMatterManagers: ReturnType<typeof vi.fn> };
  let myMatters: { getMyMattersData: ReturnType<typeof vi.fn> };
  let writeText: ReturnType<typeof vi.fn>;
  let query: ReturnType<typeof fakeQuery>;
  let navigate: ReturnType<typeof vi.fn>;

  async function create(
    permissions: Permission[] = ['Matter.View', 'Matter.Create'],
    params: Record<string, string> = {},
    matters: MatterResponse[] = [
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
    ],
    columns: string[] = [],
  ) {
    localStorage.clear();
    const counts = {
      assets: 19,
      active: 16,
      inactive: 1,
      pendingDisposition: 2,
      disposed: 0,
      size: [{ unit: 'GB', value: 640.2, assets: 15 }],
    };
    myMatters = {
      getMyMattersData: vi.fn().mockReturnValue(
        ok({
          totals: counts,
          matters: [
            {
              matterId: 7,
              matterRef: '00343-00012',
              matterName: 'Merger Review',
              clientName: 'Acme Corp',
              matterIsActive: true,
              counts,
              query: 'matterId=7&matterManagedByMe=true',
            },
          ],
          types: [],
          warnings: {},
          scopeQuery: '',
        }),
      ),
    };
    api = {
      listMatters: vi.fn().mockReturnValue(ok(pageOfMatters(...matters))),
      setMatterManagers: vi.fn().mockImplementation((id: number) => ok(aMatter({ matterId: id }))),
    };
    managers = {
      lookupMatterManagers: vi.fn().mockReturnValue(
        ok([
          { userId: 11, displayName: 'Ann Lee', availability: { state: 'AVAILABLE' } },
          { userId: 12, displayName: 'Bob Roe', availability: { state: 'AVAILABLE' } },
        ]),
      ),
    };
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    query = fakeQuery();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        query.provider,
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: MattersClient, useValue: api },
        { provide: MatterManagersClient, useValue: managers },
        { provide: MyMattersClient, useValue: myMatters },
        { provide: ClientsClient, useValue: { listClients: vi.fn(), getClient: vi.fn() } },
      ],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true) as never;
    await TestBed.inject(AuthStore).ensureLoaded();
    if (columns.length > 0) {
      // The Columns menu choice of this person (MD-28): the default columns plus the extras asked for.
      const user = TestBed.inject(AuthStore).profile()?.userId;
      const base = [
        'matterRef',
        'name',
        'client',
        'primaryManager',
        'secondaryManager',
        'openTasks',
        'overdue',
        'status',
      ];
      localStorage.setItem(
        `mf.grid.v1.matters.${user ?? 'anon'}`,
        JSON.stringify({ v: 1, o: [], s: [...base, ...columns] }),
      );
    }
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
    // The name is the one link to the matter; the reference is plain mono text (WP9, #268).
    expect(rows[0].querySelector('.mf-ref')?.getAttribute('href')).toBeNull();
    expect(rows[0].querySelector('a.pg-clip')?.getAttribute('href')).toBe('/matters/7');
    expect(rows[1].querySelector('.mf-ref')?.textContent).toBe('00001-00012');
    expect(rows[0].textContent).toContain('00343 Acme Corp');
    expect(rows[1].textContent).toContain('Inactive');

    rows[0].querySelector('button')!.click();
    await settle(fixture);
    expect(writeText).toHaveBeenCalledWith('00343-00012');
  });

  it('offers On hold, At risk, Data size and Pending disposition as optional columns, none by default, remembered in this browser (PM v2, #881)', async () => {
    const plain = await create(['Matter.View', 'Task.View', 'Asset.View', 'Matter.BeManager']);
    const heads = () =>
      Array.from(plain.nativeElement.querySelectorAll('thead th')).map((t) =>
        (t as HTMLElement).textContent!.trim(),
      );
    expect(heads()).not.toContain('On Hold');
    expect(myMatters.getMyMattersData).not.toHaveBeenCalled();

    (plain.nativeElement.querySelector('[data-grid-columns]') as HTMLButtonElement).click();
    plain.detectChanges();
    const root: HTMLElement = plain.nativeElement;
    const boxes = Array.from(
      root.querySelectorAll<HTMLInputElement>('[data-grid-columns-panel] input'),
    ).filter((b) => ['onHold', 'atRisk', 'dataSize', 'pending'].includes(b.dataset['column']!));
    expect(boxes.map((b) => b.getAttribute('data-column'))).toEqual([
      'onHold',
      'atRisk',
      'dataSize',
      'pending',
    ]);
    boxes[0].checked = true;
    boxes[0].dispatchEvent(new Event('change'));
    await settle(plain);
    expect(heads()).toContain('On Hold');
    const stored = JSON.parse(
      localStorage.getItem(
        `mf.grid.v1.matters.${TestBed.inject(AuthStore).profile()?.userId ?? 'anon'}`,
      )!,
    );
    expect(stored.s).toContain('onHold');
    expect(stored.s).not.toContain('atRisk');
  });

  it('shows the counts of the chosen columns, and the size and pending count from the Data API', async () => {
    const fixture = await create(
      ['Matter.View', 'Task.View', 'Asset.View', 'Matter.BeManager'],
      {},
      [aMatter({ onHoldTaskCount: 3, atRiskTaskCount: 0 })],
      ['onHold', 'atRisk', 'dataSize', 'pending'],
    );
    const row = fixture.nativeElement.querySelector('tbody tr') as HTMLElement;
    expect(myMatters.getMyMattersData).toHaveBeenCalledWith('mine');
    expect(row.querySelector('[data-cell=onHold] a')!.textContent!.trim()).toBe('3');
    expect(row.querySelector('[data-cell=onHold] a')!.getAttribute('href')).toContain(
      'status=ON_HOLD',
    );
    expect(row.querySelector('[data-cell=atRisk] a')).toBeNull();
    expect(row.querySelector('[data-cell=atRisk]')!.textContent!.trim()).toBe('-0');
    expect(row.querySelector('[data-cell=dataSize]')!.textContent!.trim()).toBe('640.2 GB');
    expect(row.querySelector('[data-cell=pending] a')!.textContent!.trim()).toBe('2');
    expect(row.querySelector('[data-cell=pending] a')!.getAttribute('href')).toContain(
      'status=pending',
    );
  });

  it('leaves out the columns a permission hides: no On hold without Task.View, no Data size without Asset.View', async () => {
    // Asset.View and Task.View without the right to manage matters: the Data API would answer 403, so those two columns are not offered either.
    const noManage = await create(['Matter.View', 'Task.View', 'Asset.View'], {}, [aMatter()]);
    (noManage.nativeElement.querySelector('[data-grid-columns]') as HTMLButtonElement).click();
    noManage.detectChanges();
    const offered: HTMLElement = noManage.nativeElement;
    expect(
      Array.from(offered.querySelectorAll('[data-grid-columns-panel] input'))
        .map((b) => b.getAttribute('data-column'))
        .filter((k) => ['onHold', 'atRisk', 'dataSize', 'pending'].includes(k!)),
    ).toEqual(['onHold', 'atRisk']);
    TestBed.resetTestingModule();
    const fixture = await create(
      ['Matter.View'],
      {},
      [aMatter()],
      ['onHold', 'atRisk', 'dataSize', 'pending'],
    );
    // The Columns menu itself stays (base columns can be hidden), but no extra column is offered or drawn.
    expect(fixture.nativeElement.querySelector('[data-col-head]')).toBeNull();
    expect(myMatters.getMyMattersData).not.toHaveBeenCalled();
  });

  it('flags sensitive matters in the list', async () => {
    const fixture = await create();
    const rows = fixture.nativeElement.querySelectorAll('tbody tr');

    expect(rows[0].textContent).not.toContain('Sensitive');
    expect(rows[1].textContent).toContain('Sensitive');
  });

  const control = <T extends HTMLElement>(el: HTMLElement, name: string): T =>
    el.querySelector<T>(`[aria-label^="Filter by ${name}"]`)!;
  /** The toolbar's Search box: it drives the `name` filter (LC-01). */
  const search = (el: HTMLElement): HTMLInputElement =>
    el.querySelector<HTMLInputElement>('[data-list-search] input')!;

  it('has column filters instead of a search box; Sensitive is a select after Status, no Other filters; Active is shown, not counted', async () => {
    const fixture = await create();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('#matter-search, #matter-status')).toBeNull();
    // Search is the first zone of the list toolbar, Columns and Select are in it (not in the page header), the title row has the count chip (LC-01, LC-02).
    expect(el.querySelector('mf-list-toolbar [data-list-search] input')).not.toBeNull();
    expect(
      el.querySelector('mf-page-header [data-filters-toggle], mf-page-header mf-grid-columns'),
    ).toBeNull();
    expect(el.querySelector('mf-list-toolbar mf-grid-columns')).not.toBeNull();
    expect(el.querySelector('[data-filter-row]')).not.toBeNull(); // open by default (WP8 #270)

    expect(control<HTMLInputElement>(el, 'CM Number')).not.toBeNull();
    expect(control<HTMLInputElement>(el, 'Name')).toBeNull(); // the Search box
    expect(control<HTMLInputElement>(el, 'Client')).not.toBeNull();
    expect(ddSelect(el, 'Filter by Status').value).toBe('active');
    const sensitive = ddSelect(el, 'Filter by Sensitive');
    expect(sensitive.value).toBe('');
    expect(Array.from(sensitive.options).map((o) => o.value)).toEqual(['', 'true', 'false']);
    expect(sensitive.options[1].textContent?.trim()).toBe('Sensitive: Yes');
    // Beside Status in the same cell, after it.
    const status = ddSelect(el, 'Filter by Status');
    expect(status.button.closest('td')).toBe(sensitive.button.closest('td'));
    expect(
      status.button.compareDocumentPosition(sensitive.button) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(el.querySelector('[data-more-filters]')).toBeNull();
    expect(el.querySelector('[data-filter-count]')).toBeNull();

    sensitive.value = 'true';
    sensitive.dispatchEvent(new Event('change'));
    expect(navigate).toHaveBeenLastCalledWith([], {
      queryParams: { isSensitive: 'true', page: null },
      queryParamsHandling: 'merge',
    });
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
      'merger',
      1,
      false,
      true,
      '343-12',
      undefined,
      'acme',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      3,
      50,
      '-name',
    );
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-chip="clientId"]')?.textContent).toContain(
      'Client: 00343 Acme Corp',
    );
    expect(control<HTMLInputElement>(el, 'Client').value).toBe('acme');
    // The chips show with the row open too (LC-01); the Search text (merger) is in the box and makes no chip.
    expect(ddSelect(el, 'Filter by Sensitive').value).toBe('true');
    expect(el.querySelector('[data-chip="isSensitive"]')?.textContent).toContain('Sensitive: Yes');
    expect(el.querySelector('[data-chip="name"]')).toBeNull();
    el.querySelector<HTMLButtonElement>('[data-filters-toggle]')!.click();
    await settle(fixture);
    expect(el.querySelector('[data-chip="isSensitive"]')?.textContent).toContain('Sensitive: Yes');
    expect(el.querySelectorAll('[data-clear-filters]').length).toBe(1);
  });

  it('keeps an old ?isSensitive=true link working and says how many inactive matters are hidden', async () => {
    const fixture = await create(['Matter.View'], { isSensitive: 'true' });
    api.listMatters.mockImplementation((...args: unknown[]) =>
      ok(args[2] === false ? { ...pageOfMatters(aMatter()), total: 4 } : pageOfMatters(aMatter())),
    );
    fixture.componentRef.setInput('sort', 'name');
    await settle(fixture);
    const el: HTMLElement = fixture.nativeElement;
    expect(api.listMatters).toHaveBeenCalledWith(
      undefined,
      undefined,
      true,
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      1,
      50,
      'name',
    );
    expect(api.listMatters).toHaveBeenCalledWith(
      undefined,
      undefined,
      false,
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      1,
      1,
      'name',
    );
    expect(el.querySelector('[data-hidden-hint]')?.textContent).toContain('4 inactive hidden');
  });

  it('keeps a long name on one line (ellipsis and tooltip) and the sensitive badge beside it (D-45, #1174)', async () => {
    const fixture = await create();
    const first = fixture.nativeElement.querySelectorAll('tbody tr')[1];
    expect(first.querySelector('.pg-namecell .pg-clip')).not.toBeNull();
    expect(first.querySelector('.pg-namecell mf-sensitive-badge')).not.toBeNull();
    expect(first.querySelector('.pg-clip')?.getAttribute('title')).toBeTruthy();
    expect(first.querySelector('.pg-name')).toBeNull();
  });

  it('writes filter changes to the URL (text with replaceUrl) and removes the client chip through the URL', async () => {
    const fixture = await create(['Matter.View'], { clientId: '1' });
    const el: HTMLElement = fixture.nativeElement;

    const name = search(el);
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

    expect(buttonByLabel(fixture.nativeElement, 'New Matter')).toBeUndefined();
  });

  it('opens New matter as a pop-up dialog on the list instead of navigating (MD-22, #1026)', async () => {
    const fixture = await create(['Matter.View', 'Matter.Create']);
    buttonByLabel(fixture.nativeElement, 'New Matter')!.click();
    await settle(fixture);

    const dialog = document.body.querySelector('.mf-formdlg');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain('New Matter');
    expect(dialog?.querySelector('[data-panel-primary]')?.textContent).toContain('Create Matter');
    expect(navigate).not.toHaveBeenCalledWith(['/matters/new']);
  });

  it('has a handle on every resizable column header and none on the selection and action columns (MD-21, #1025)', async () => {
    const fixture = await create(['Matter.View', 'Client.View']);
    const el: HTMLElement = fixture.nativeElement;
    const labels = Array.from(el.querySelectorAll('thead tr:first-child th > .mf-resize')).map(
      (h) => h.getAttribute('aria-label'),
    );
    expect(labels).toContain('Resize CM Number column');
    expect(labels).toContain('Resize Matter Name column');
    expect(labels).toContain('Resize Primary PM column');
  });

  it('reorders and hides columns from the shared Columns menu, remembers it per person, and resets (MD-28, #1032)', async () => {
    const fixture = await create(['Matter.View', 'Client.View', 'Task.View']);
    const el: HTMLElement = fixture.nativeElement;
    const heads = () =>
      Array.from(el.querySelectorAll('thead tr:first-child th')).map((h) => h.textContent!.trim());
    expect(heads().slice(0, 3)).toEqual(['CM Number', 'Matter Name', 'Client']);
    el.querySelector<HTMLButtonElement>('[data-grid-columns]')!.click();
    fixture.detectChanges();
    // Client moves left of Name by the keyboard-reachable button.
    el.querySelector<HTMLButtonElement>('[data-move="client:left"]')!.click();
    await settle(fixture);
    expect(heads().slice(0, 3)).toEqual(['CM Number', 'Client', 'Matter Name']);
    const key = `mf.grid.v1.matters.${TestBed.inject(AuthStore).profile()?.userId ?? 'anon'}`;
    expect(JSON.parse(localStorage.getItem(key)!).o.slice(0, 3)).toEqual([
      'matterRef',
      'client',
      'name',
    ]);
    // Hide Overdue; Name cannot be hidden.
    const box = (k: string) =>
      el.querySelector<HTMLInputElement>(`[data-grid-columns-panel] [data-column="${k}"]`)!;
    expect(box('name').disabled).toBe(true);
    box('overdue').checked = false;
    box('overdue').dispatchEvent(new Event('change'));
    await settle(fixture);
    expect(heads()).not.toContain('Overdue');
    el.querySelector<HTMLButtonElement>('[data-grid-columns-reset]')!.click();
    await settle(fixture);
    expect(heads().slice(0, 3)).toEqual(['CM Number', 'Matter Name', 'Client']);
    expect(heads()).toContain('Overdue');
    expect(localStorage.getItem(key)).toBeNull();
  });

  describe('Open tasks and Overdue (WP9, #266, #268)', () => {
    const heads = (el: HTMLElement) =>
      Array.from(el.querySelectorAll('thead tr:first-child th')).map((h) => h.textContent!.trim());

    it('has Reference, Name, Client, Open tasks, Overdue and Status; the counts link to the Task Queue scoped to the matter', async () => {
      const fixture = await create(['Matter.View', 'Client.View', 'Task.View']);
      api.listMatters.mockReturnValue(
        ok(pageOfMatters(aMatter({ matterId: 7, openTaskCount: 5, overdueTaskCount: 2 }))),
      );
      fixture.componentRef.setInput('sort', 'name');
      await settle(fixture);
      const el: HTMLElement = fixture.nativeElement;

      expect(heads(el)).toEqual([
        'CM Number',
        'Matter Name',
        'Client',
        'Primary PM',
        'Open Tasks',
        'Overdue',
        'Status',
        'Actions', // the row's quick actions (epic #758), for people who can see tasks, from 900 px
      ]);
      const row = el.querySelector('tbody tr')!;
      expect(row.querySelector('[data-count=open] a')?.getAttribute('href')).toBe(
        '/tasks?matter=7&status=NEW&status=IN_PROGRESS&status=ON_HOLD',
      );
      expect(row.querySelector('[data-count=overdue] a')?.getAttribute('href')).toBe(
        '/tasks?matter=7&status=NEW&status=IN_PROGRESS&status=ON_HOLD&overdue=true',
      );
      // Name is the one link to the matter, the Client column stays a link to the client.
      const links = Array.from(row.querySelectorAll('a')).filter((a) => !a.closest('[data-count]'));
      expect(links.map((a) => a.getAttribute('href'))).toEqual(['/matters/7', '/clients/1']);
    });

    it('leaves the count columns out without Task.View and no longer shows the Projects count', async () => {
      const fixture = await create(['Matter.View']);
      const el: HTMLElement = fixture.nativeElement;
      expect(heads(el)).toEqual(['CM Number', 'Matter Name', 'Client', 'Primary PM', 'Status']);
      expect(el.querySelector('[data-count]')).toBeNull();
    });

    it('shows the Client column as plain text without Client.View (a link exists only when it can be followed, #285)', async () => {
      const fixture = await create(['Matter.View']);
      const row = fixture.nativeElement.querySelector('tbody tr') as HTMLElement;
      expect(row.textContent).toContain('00343 Acme Corp');
      expect(row.querySelector('a[href^="/clients"]')).toBeNull();
    });

    it('keeps the copy button out of the Tab order and marks the name link for the Back focus (#281, #282)', async () => {
      const fixture = await create(['Matter.View']);
      const row = fixture.nativeElement.querySelector('tbody tr') as HTMLElement;
      const copy = row.querySelector('button[data-row-stop]') as HTMLButtonElement;
      expect(copy.getAttribute('tabindex')).toBe('-1');
      expect(copy.getAttribute('aria-label')).toBe('Copy matter number');
      const name = row.querySelector('a.pg-clip') as HTMLAnchorElement;
      expect(name.getAttribute('data-row-list')).toBe('matters');
      expect(name.getAttribute('data-row-key')).toBe('7');
    });

    it('sorts by Overdue descending first', async () => {
      const fixture = await create(['Matter.View', 'Task.View']);
      const el: HTMLElement = fixture.nativeElement;
      const overdue = Array.from(el.querySelectorAll('thead th')).find((h) =>
        h.textContent!.includes('Overdue'),
      )!;
      overdue.querySelector('button')!.click();
      expect(navigate).toHaveBeenLastCalledWith([], {
        queryParams: { sort: '-overdue', page: null },
        queryParamsHandling: 'merge',
      });
    });
  });
  describe('project managers (epic #667)', () => {
    const pm = (el: HTMLElement, row: number, which: 'primary' | 'secondary') => {
      const tr = el.querySelectorAll('tbody tr')[row];
      return tr.querySelector(`[data-${which}-manager]`)?.textContent?.trim();
    };

    it('shows the Primary and the Secondary manager; an empty cell stays empty', async () => {
      const fixture = await create(['Matter.View'], {}, [
        aMatter({ matterId: 1, primaryManager: ANN, secondaryManager: BOB }),
        aMatter({ matterId: 2, matterRef: '00343-00013', primaryManager: undefined }),
        aMatter({ matterId: 3, matterRef: '00343-00014', secondaryManager: BOB }),
      ]);
      const el: HTMLElement = fixture.nativeElement;
      // Secondary PM is one click away in Columns (off by default so the default columns fit 1366, D-43a).
      el.querySelector<HTMLButtonElement>('[data-grid-columns]')!.click();
      fixture.detectChanges();
      const box = el.querySelector<HTMLInputElement>(
        '[data-grid-columns-panel] [data-column="secondaryManager"]',
      )!;
      box.checked = true;
      box.dispatchEvent(new Event('change'));
      await settle(fixture);

      expect(pm(el, 0, 'primary')).toBe('Ann Lee');
      expect(pm(el, 0, 'secondary')).toBe('Bob Roe');
      expect(pm(el, 1, 'primary')).toBe('');
      expect(pm(el, 1, 'secondary')).toBe('');
      expect(pm(el, 2, 'primary')).toBe('');
      expect(pm(el, 2, 'secondary')).toBe('Bob Roe');
      // A matter without a manager is normal: no wording, no badge, no warning anywhere on the page.
      expect(el.textContent).not.toMatch(/unassigned|no manager|no project manager|warning/i);
      expect(el.querySelector('mf-badge[severity=danger], .pg-warn')).toBeNull();
    });

    it('sorts by the manager columns and offers the eligible people plus None as filter choices', async () => {
      const fixture = await create(['Matter.View']);
      const el: HTMLElement = fixture.nativeElement;

      const header = Array.from(el.querySelectorAll('thead tr:first-child th')).find(
        (h) => h.textContent?.trim() === 'Primary PM',
      )!;
      header.querySelector('button')!.click();
      expect(navigate).toHaveBeenLastCalledWith([], {
        queryParams: { sort: 'primaryManager', page: null },
        queryParamsHandling: 'merge',
      });

      const select = ddSelect(el, 'Filter by Primary PM');
      expect(Array.from(select.options).map((o) => o.textContent?.trim())).toEqual([
        'Any',
        'None',
        'Ann Lee',
        'Bob Roe',
      ]);
      select.value = '11';
      select.dispatchEvent(new Event('change'));
      expect(navigate).toHaveBeenLastCalledWith([], {
        queryParams: { primaryManager: '11', page: null },
        queryParamsHandling: 'merge',
      });
    });

    it('sends the manager filters to the API: a person, None, and Mine', async () => {
      await create(['Matter.View', 'Matter.BeManager'], {
        primaryManager: '11',
        secondaryManager: 'none',
        mine: 'true',
      });

      const call = api.listMatters.mock.calls.at(-1)!;
      // primaryManagerId, secondaryManagerId, managerId, managedByMe, hasNoManager, hasPrimaryManager, hasSecondaryManager
      expect(call.slice(7, 14)).toEqual([
        11,
        undefined,
        undefined,
        true,
        undefined,
        undefined,
        false,
      ]);
    });

    describe('My matters / All', () => {
      const managedByMe = (call: unknown[]) => call[10];

      it('does not exist for people who cannot be a project manager', async () => {
        const fixture = await create(['Matter.View', 'Matter.AssignManagers']);
        expect(fixture.nativeElement.querySelector('[data-scope-switch]')).toBeNull();
        expect(fixture.nativeElement.querySelector('[data-scope-line]')).toBeNull();
        expect(managedByMe(api.listMatters.mock.calls.at(-1)!)).toBeUndefined();
      });

      it('opens a plain link on the matters the person manages, says so, and counts "of" all', async () => {
        const fixture = await create(['Matter.View', 'Matter.BeManager', 'Matter.AssignManagers']);
        const el: HTMLElement = fixture.nativeElement;
        const calls = api.listMatters.mock.calls;
        expect(calls.some((c) => managedByMe(c) === true)).toBe(true);
        expect(el.querySelector('[data-scope="mine"]')?.getAttribute('aria-pressed')).toBe('true');
        expect(el.querySelector('[data-scope="all"]')?.getAttribute('aria-pressed')).toBe('false');
        expect(el.querySelector('[data-scope-line]')?.textContent).toContain('Matters you manage');
        // The same list without the scope, one row, gives the "of".
        expect(calls.some((c) => managedByMe(c) === undefined && c[15] === 1)).toBe(true);
        // The address names the scope in force.
        expect(navigate).toHaveBeenCalledWith(
          [],
          expect.objectContaining({ queryParams: { scope: 'mine' }, replaceUrl: true }),
        );
      });

      it('is not added to a link that carries filters of the list (the address wins)', async () => {
        await create(['Matter.View', 'Matter.BeManager', 'Matter.AssignManagers'], {
          clientId: '1',
        });
        expect(api.listMatters.mock.calls.every((c) => managedByMe(c) === undefined)).toBe(true);
      });

      it('follows ?scope=all for a holder of Matter.AssignManagers and remembers a choice', async () => {
        const fixture = await create(['Matter.View', 'Matter.BeManager', 'Matter.AssignManagers'], {
          scope: 'all',
        });
        const el: HTMLElement = fixture.nativeElement;
        expect(api.listMatters.mock.calls.every((c) => managedByMe(c) === undefined)).toBe(true);
        expect(el.querySelector('[data-scope="all"]')?.getAttribute('aria-pressed')).toBe('true');
        el.querySelector<HTMLButtonElement>('[data-scope="mine"]')!.click();
        expect(navigate).toHaveBeenLastCalledWith(
          [],
          expect.objectContaining({
            queryParams: { scope: 'mine', page: null },
            queryParamsHandling: 'merge',
          }),
        );
        expect(localStorage.getItem('mf.scope.matters.1')).toBe('mine');
      });

      it('keeps a project manager without Matter.AssignManagers on mine: no switch, ?scope=all is ignored', async () => {
        const fixture = await create(['Matter.View', 'Matter.BeManager'], { scope: 'all' });
        expect(fixture.nativeElement.querySelector('[data-scope-switch]')).toBeNull();
        expect(api.listMatters.mock.calls.filter((c) => c[15] !== 1).map(managedByMe)).toEqual([
          true,
        ]);
        expect(fixture.nativeElement.querySelector('[data-scope-line]')?.textContent).toContain(
          'Matters you manage',
        );
      });

      it('explains an empty scope and offers Show all matters with the permission', async () => {
        const fixture = await create(
          ['Matter.View', 'Matter.BeManager', 'Matter.AssignManagers'],
          {},
          [],
        );
        const el: HTMLElement = fixture.nativeElement;
        expect(el.textContent).toContain('You do not manage any matter yet.');
        el.querySelector<HTMLButtonElement>('[data-show-all-matters]')!.click();
        expect(navigate).toHaveBeenLastCalledWith(
          [],
          expect.objectContaining({ queryParams: { scope: 'all', page: null } }),
        );
      });
    });

    it('shows the managers on a phone card only when set', async () => {
      const fixture = await create(['Matter.View'], {}, [
        aMatter({ matterId: 1, primaryManager: ANN, secondaryManager: BOB }),
        aMatter({ matterId: 2, matterRef: '00343-00013' }),
        aMatter({ matterId: 3, matterRef: '00343-00014', secondaryManager: BOB }),
      ]);
      const page = fixture.componentInstance as unknown as {
        managersLine: (m: MatterResponse) => string;
      };

      expect(page.managersLine(aMatter({ primaryManager: ANN, secondaryManager: BOB }))).toBe(
        'PM: Ann Lee / Bob Roe',
      );
      expect(page.managersLine(aMatter({ secondaryManager: BOB }))).toBe('PM: Bob Roe');
      expect(page.managersLine(aMatter())).toBe('');
    });

    it('has no tick boxes and no bulk action without Matter.AssignManagers', async () => {
      const fixture = await create(['Matter.View', 'Matter.Edit']);
      const el: HTMLElement = fixture.nativeElement;

      expect(
        el.querySelector('[data-select-row], [data-select-all], [data-bulk-managers]'),
      ).toBeNull();
    });

    it('ticks rows, offers Set project managers, and saves each matter with its own row version', async () => {
      const fixture = await create(['Matter.View', 'Matter.AssignManagers'], {}, [
        aMatter({ matterId: 1, rowVersion: 'V1', primaryManager: ANN }),
        aMatter({ matterId: 2, matterRef: '00343-00013', rowVersion: 'V2', secondaryManager: ANN }),
        aMatter({ matterId: 3, matterRef: '00343-00014', rowVersion: 'V3' }),
      ]);
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-selection-bar], [data-select-row]')).toBeNull(); // the grid is normal until Select
      el.querySelector<HTMLButtonElement>('[data-select-mode]')!.click();
      await settle(fixture);

      const boxes = el.querySelectorAll<HTMLInputElement>('[data-select-row]');
      expect(boxes[0].getAttribute('aria-label')).toBe('Select 00343-00012 Merger Review');
      boxes[0].click();
      boxes[1].click();
      await settle(fixture);
      expect(el.querySelector('[data-selection-count]')?.textContent).toContain('2 selected');

      el.querySelector<HTMLButtonElement>('[data-bulk-managers]')!.click();
      await settle(fixture);
      const dialog = document.body.querySelector('[data-managers-dialog]')!;
      expect(dialog.querySelector('[data-managers-bulk-note]')?.textContent).toContain(
        '2 matters selected',
      );
      const secondary = dialog.querySelector<HTMLSelectElement>('[data-manager-select=secondary]')!;
      expect(secondary.value).toBe('__keep__');
      secondary.value = '12';
      secondary.dispatchEvent(new Event('change'));
      await settle(fixture);
      document.body.querySelector<HTMLButtonElement>('[data-panel-primary] button')!.click();
      await settle(fixture);

      // The Primary stays what each matter has; the Secondary is Bob on both; each call carries its matter's own row version.
      expect(api.setMatterManagers).toHaveBeenCalledWith(1, {
        primaryManagerId: 11,
        secondaryManagerId: 12,
        rowVersion: 'V1',
      });
      expect(api.setMatterManagers).toHaveBeenCalledWith(2, {
        primaryManagerId: undefined,
        secondaryManagerId: 12,
        rowVersion: 'V2',
      });
      expect(api.setMatterManagers).toHaveBeenCalledTimes(2);
      expect(api.listMatters.mock.calls.length).toBeGreaterThan(1); // reloaded
    });
  });
});
