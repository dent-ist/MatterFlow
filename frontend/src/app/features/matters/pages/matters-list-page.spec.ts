import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import {
  MatterManagersClient,
  MatterResponse,
  MattersClient,
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
  ) {
    localStorage.clear();
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
    // The name is the one link to the matter; the reference is plain mono text (WP9, #268).
    expect(rows[0].querySelector('.mf-ref')?.getAttribute('href')).toBeNull();
    expect(rows[0].querySelector('a.pg-name')?.getAttribute('href')).toBe('/matters/7');
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

  it('has column filters instead of a search box; Sensitive is a select after Status, no Other filters; Active is shown, not counted', async () => {
    const fixture = await create();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('#matter-search, #matter-status, mf-search-box')).toBeNull();
    expect(el.querySelector('[data-filter-row]')).not.toBeNull(); // open by default (WP8 #270)

    expect(control<HTMLInputElement>(el, 'Matter reference')).not.toBeNull();
    expect(control<HTMLInputElement>(el, 'Name')).not.toBeNull();
    expect(control<HTMLInputElement>(el, 'Client')).not.toBeNull();
    expect(control<HTMLSelectElement>(el, 'Status').value).toBe('active');
    const sensitive = control<HTMLSelectElement>(el, 'Sensitive');
    expect(sensitive.value).toBe('');
    expect(Array.from(sensitive.options).map((o) => o.value)).toEqual(['', 'true', 'false']);
    expect(sensitive.options[1].textContent?.trim()).toBe('Sensitive: Yes');
    // Beside Status in the same cell, after it.
    const status = control<HTMLSelectElement>(el, 'Status');
    expect(status.closest('td')).toBe(sensitive.closest('td'));
    expect(
      status.compareDocumentPosition(sensitive) & Node.DOCUMENT_POSITION_FOLLOWING,
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
      undefined,
      1,
      false,
      true,
      '343-12',
      'merger',
      'acme',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      3,
      25,
      '-name',
    );
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-chip="clientId"]')?.textContent).toContain(
      'Client: 00343 Acme Corp',
    );
    expect(control<HTMLInputElement>(el, 'Client').value).toBe('acme');
    // The row is open: the inputs show the values, the only chip is the one for the link-only client.
    expect(el.querySelector('[data-chip="isSensitive"]')).toBeNull();
    expect(control<HTMLSelectElement>(el, 'Sensitive').value).toBe('true');
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
      25,
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

  it('clamps a long name at two lines and keeps the sensitive badge beside it', async () => {
    const fixture = await create();
    const first = fixture.nativeElement.querySelectorAll('tbody tr')[1];
    expect(first.querySelector('.pg-namecell .pg-name')).not.toBeNull();
    expect(first.querySelector('.pg-namecell mf-sensitive-badge')).not.toBeNull();
    expect(first.querySelector('.pg-name')?.getAttribute('title')).toBeTruthy();
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
        'Matter reference',
        'Name',
        'Client',
        'Project manager',
        'Secondary project manager',
        'Open tasks',
        'Overdue',
        'Status',
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
      expect(heads(el)).toEqual([
        'Matter reference',
        'Name',
        'Client',
        'Project manager',
        'Secondary project manager',
        'Status',
      ]);
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
      const name = row.querySelector('a.pg-name') as HTMLAnchorElement;
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
        (h) => h.textContent?.trim() === 'Project manager',
      )!;
      header.querySelector('button')!.click();
      expect(navigate).toHaveBeenLastCalledWith([], {
        queryParams: { sort: 'primaryManager', page: null },
        queryParamsHandling: 'merge',
      });

      const select = control<HTMLSelectElement>(el, 'Project manager');
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
      document.body
        .querySelector<HTMLButtonElement>(
          '[data-confirm-primary] button, button[data-confirm-primary]',
        )!
        .click();
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
