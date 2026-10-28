import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Observable, Subject, of, throwError } from 'rxjs';
import { PodsClient, TaskQueueClient, TaskQueueRow } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../../core/auth/auth-testing';
import { Permission } from '../../../core/auth/permissions';
import {
  aRow,
  pageOf,
  provideClock,
  provideLookups,
  provideQueueChoices,
} from '../../../shared/work-queue/work-queue-testing';
import { WorkList } from '../../../shared/work-queue/work-list';
import { TaskQueuePage } from './task-queue-page';

/** Positions of the arguments of `getTaskQueue` (`group` first, then the shared filters, sort and paging). */
const ARG = {
  group: 0,
  q: 1,
  status: 2,
  priority: 3,
  pod: 4,
  noPod: 5,
  assignee: 6,
  unassigned: 7,
  creator: 8,
  asap: 18,
  overdue: 19,
  matterText: 23,
  clientText: 24,
  projectText: 25,
  updatedFrom: 26,
  updatedTo: 27,
  managedByMe: 28,
  managerId: 29,
  role: 30,
  dueWithin: 31,
  sort: 35,
  dir: 36,
  page: 37,
  pageSize: 38,
};

const OPEN = ['NEW', 'IN_PROGRESS', 'ON_HOLD'];

describe('TaskQueuePage', () => {
  let getTaskQueue: ReturnType<typeof vi.fn>;
  let harness: RouterTestingHarness;

  async function open(
    url: string,
    options: {
      rows?: TaskQueueRow[];
      total?: number;
      permissions?: Permission[];
      response?: Observable<unknown>;
      primaryPod?: number | null;
    } = {},
  ) {
    const rows = options.rows ?? [
      aRow(),
      aRow({ taskId: 1043, taskNumber: 'TSK-1043', title: 'Second' }),
    ];
    getTaskQueue = vi
      .fn()
      .mockReturnValue(
        options.response ?? of(pageOf(rows, { total: options.total ?? rows.length })),
      );
    const pods = {
      listMyPods: () =>
        of(
          options.primaryPod === null
            ? []
            : [{ podId: options.primaryPod ?? 5, name: 'Pod A', isActive: true, isPrimary: true }],
        ),
      listPods: () =>
        of({ items: [{ podId: 6, name: 'Pod B' }], total: 1, page: 1, pageSize: 100 }),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'tasks', component: TaskQueuePage }]),
        provideFakeMe(
          new FakeMeApi(
            withPermissions(...(options.permissions ?? ['Task.View', 'Task.Create', 'Pod.View'])),
          ),
        ),
        ...provideLookups(),
        ...provideQueueChoices(),
        ...provideClock('2026-10-14T15:00:00Z'),
        { provide: TaskQueueClient, useValue: { getTaskQueue } },
        { provide: PodsClient, useValue: pods },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url, TaskQueuePage);
    await settle();
    // Under load the first render can lag behind whenStable: wait for the page itself (the table is there in every state), never a fixed time.
    await vi.waitFor(() => {
      harness.detectChanges();
      expect(harness.routeNativeElement?.querySelector('table')).not.toBeNull();
    });
    return harness.routeNativeElement as HTMLElement;
  }

  async function settle() {
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => setTimeout(r));
      harness.detectChanges();
    }
    await harness.fixture.whenStable();
    harness.detectChanges();
  }

  const router = () => TestBed.inject(Router);
  const query = () => router().parseUrl(router().url).queryParams;
  const lastArgs = () => getTaskQueue.mock.calls[getTaskQueue.mock.calls.length - 1];
  const chips = (el: HTMLElement) =>
    Array.from(el.querySelectorAll('[data-filter-chips] [data-chip]')).map((c) =>
      c.querySelector('.fch__text')!.textContent!.replace(/\s+/g, ' ').trim(),
    );
  const filterInput = (el: HTMLElement, key: string) =>
    el.querySelector<HTMLInputElement>(`tr[data-filter-row] input[data-filter="${key}"]`)!;

  /** Types into a column text filter and presses Enter, which applies at once. */
  async function typeFilter(el: HTMLElement, key: string, text: string) {
    const input = filterInput(el, key);
    input.value = text;
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await settle();
  }

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('turns a dashboard deep link into the matching API request', async () => {
    await open('/tasks?overdue=true&status=NEW&status=IN_PROGRESS');

    expect(getTaskQueue).toHaveBeenCalledTimes(1);
    const args = lastArgs();
    expect(args[ARG.status]).toEqual(['NEW', 'IN_PROGRESS']);
    expect(args[ARG.overdue]).toBe(true);
    expect(args[ARG.page]).toBe(1);
    expect(args[ARG.pageSize]).toBe(50);
    expect(args[ARG.sort]).toBeUndefined();
    expect(args[ARG.group]).toBeUndefined(); // only a Due sort asks for dividers (#232)
  });

  it('hands the response counts to the quick views (not narrowed by the filters in the address)', async () => {
    const views = {
      open: 442,
      unassigned: 157,
      overdue: 101,
      dueSoon: 96,
      asap: 51,
      onHold: 64,
      myPod: 12,
      recentlyCompleted: 7,
      createdByMe: 3,
    };
    const el = await open('/tasks?priority=2&status=NEW', {
      response: of(pageOf([aRow()], { views })),
    });
    const button = (key: string) => el.querySelector(`mf-quick-views [data-view="${key}"]`)!;
    expect(button('allOpen').getAttribute('data-count')).toBe('442');
    expect(button('overdue').getAttribute('data-count')).toBe('101');
    expect(button('myPod').getAttribute('data-count')).toBe('12');
  });

  it('passes every filter parameter of a deep link through with the same meaning', async () => {
    await open(
      '/tasks?q=dedup&priority=1&priority=2&pod=5&assignee=9&unassigned=true&creator=3&matterText=343-12&clientText=Acme&projectText=Phase&updatedFrom=2026-10-01&updatedTo=2026-10-07&sort=due&dir=desc&page=2&pageSize=25',
    );
    const args = lastArgs();
    expect(args[ARG.q]).toBe('dedup');
    expect(args[ARG.priority]).toEqual([1, 2]);
    expect(args[ARG.pod]).toEqual([5]);
    expect(args[ARG.assignee]).toEqual([9]);
    expect(args[ARG.unassigned]).toBe(true);
    expect(args[ARG.creator]).toEqual([3]);
    expect([args[ARG.matterText], args[ARG.clientText], args[ARG.projectText]]).toEqual([
      '343-12',
      'Acme',
      'Phase',
    ]);
    expect([args[ARG.updatedFrom], args[ARG.updatedTo]]).toEqual(['2026-10-01', '2026-10-07']);
    expect([args[ARG.sort], args[ARG.dir], args[ARG.page], args[ARG.pageSize]]).toEqual([
      'due',
      'desc',
      2,
      25,
    ]);
  });

  it('a link with filters and no status asks for every status, as such links always did', async () => {
    await open('/tasks?assignee=9&priority=2');
    expect(lastArgs()[ARG.status]).toBeUndefined();
  });

  describe('pager and remembered page size (#237)', () => {
    const footer = (el: HTMLElement) =>
      el.querySelector('mf-pager')!.textContent!.replace(/\s+/g, ' ');

    it('reads "Showing 101-150 of 442", "Page 3 of 9" and First and Last go to pages 1 and 9', async () => {
      const el = await open('/tasks?page=3', { total: 442 });
      expect(footer(el)).toContain('Showing 101-150 of 442');
      expect(footer(el)).toContain('Page 3 of 9');
      const button = (name: string) =>
        Array.from(el.querySelectorAll<HTMLButtonElement>('mf-pager button')).find(
          (b) => b.textContent!.trim() === name,
        )!;
      button('Last').click();
      await settle();
      expect(query()['page']).toBe('9');
      expect(lastArgs()[ARG.page]).toBe(9);
      button('First').click();
      await settle();
      expect(query()['page']).toBeUndefined();
      expect(lastArgs()[ARG.page]).toBe(1);
    });

    it('remembers the size chosen in the footer; an explicit size in a link wins and does not overwrite it', async () => {
      let el = await open('/tasks', { total: 442 });
      const select = el.querySelector<HTMLSelectElement>('mf-pager select')!;
      select.value = '100';
      select.dispatchEvent(new Event('change'));
      await settle();
      expect(query()['pageSize']).toBe('100');
      expect(localStorage.getItem('mf.work-table.v3.queue.1.page-size')).toBe('100');

      // A link with no size (the Dashboard) gets 100; one with pageSize=25 gets 25 and the preference stays 100.
      TestBed.resetTestingModule();
      localStorage.setItem('mf.work-table.v3.queue.1.page-size', '100');
      el = await open('/tasks', { total: 442 });
      expect(lastArgs()[ARG.pageSize]).toBe(100);
      expect(footer(el)).toContain('Page 1 of 5');
      TestBed.resetTestingModule();
      el = await open('/tasks?pageSize=25', { total: 442 });
      expect(lastArgs()[ARG.pageSize]).toBe(25);
      expect(footer(el)).toContain('Page 1 of 18');
      expect(localStorage.getItem('mf.work-table.v3.queue.1.page-size')).toBe('100');
    });
  });

  it('starts a bare /tasks on the open statuses without touching the address, with one request', async () => {
    const el = await open('/tasks');

    expect(query()).toEqual({});
    expect(getTaskQueue).toHaveBeenCalledTimes(1);
    expect(lastArgs()[ARG.status]).toEqual(OPEN);
    // The default is shown in its cell and is neither counted nor a chip.
    expect(el.querySelector('tr[data-filter-row] [data-filter="status"]')!.textContent).toContain(
      'Open',
    );
    expect(el.querySelector('[data-filters-toggle]')!.textContent).not.toContain('(');
    expect(chips(el)).toEqual([]);
    expect(el.querySelector('[data-restored-notice]')).toBeNull();
  });

  it('opens a bare /tasks on the view the user last used, says so, and loads once', async () => {
    localStorage.setItem(
      'mf.work-view.v1.queue.1',
      JSON.stringify({ status: ['NEW'], overdue: 'true', sort: 'due', dir: 'desc' }),
    );
    const el = await open('/tasks');

    expect(query()['status']).toBe('NEW');
    expect(query()['overdue']).toBe('true');
    expect(getTaskQueue).toHaveBeenCalledTimes(1);
    expect(lastArgs()[ARG.status]).toEqual(['NEW']);
    expect(lastArgs()[ARG.sort]).toBe('due');
    // Sorted by Due: the page asks for the due buckets (#232).
    expect(lastArgs()[ARG.group]).toBe('due');
    expect(el.querySelector('[data-restored-text]')!.textContent).toMatch(
      /^Restored your last view: .*Status/,
    );

    // The filters are not a quick view here, so the notice lists them in the chip words.
    // Reset to default goes back to the plain link and the open statuses, and forgets the view.
    el.querySelector<HTMLButtonElement>('[data-restored-notice] button')!.click();
    await settle();
    expect(query()).toEqual({});
    expect(lastArgs()[ARG.status]).toEqual(OPEN);
    expect(el.querySelector('[data-restored-notice]')).toBeNull();
    TestBed.resetTestingModule();
    const again = await open('/tasks');
    expect(query()).toEqual({});
    expect(again.querySelector('[data-restored-notice]')).toBeNull();
  });

  it('does not call the default view "restored": a remembered default is just the page', async () => {
    localStorage.setItem('mf.work-view.v1.queue.1', JSON.stringify({ status: OPEN }));
    const el = await open('/tasks');
    expect(query()).toEqual({});
    expect(el.querySelector('[data-restored-notice]')).toBeNull();
  });

  it('remembers the view it loaded, but not the search text', async () => {
    await open('/tasks?status=NEW&q=abc&priority=2');

    const saved = JSON.parse(localStorage.getItem('mf.work-view.v1.queue.1')!);
    expect(saved).toEqual({ status: ['NEW'], priority: ['2'] });
  });

  it('lists the rows, opens the task from the title and shows the filter row open with the chips of the URL', async () => {
    const el = await open('/tasks?status=NEW&status=IN_PROGRESS&status=ON_HOLD&priority=1');

    expect(el.querySelectorAll('tbody tr').length).toBe(2);
    expect(el.querySelector('tbody a')!.getAttribute('href')).toBe('/tasks/1042?from=task-queue');
    expect(el.textContent).toContain('Showing 1-2 of 2');
    // The row is open on this screen, so only filters on hidden columns would also show as chips; the default Open is never a chip.
    expect(el.querySelector('tr[data-filter-row]')).not.toBeNull();
    expect(el.querySelector('[data-filters-toggle]')!.textContent).toContain('(1)');
    expect(chips(el)).toEqual([]);
  });

  it('shows a filter on a hidden column as a chip, and the chip removes it', async () => {
    const el = await open('/tasks?status=NEW&clientText=Acme&creator=2');
    // Client and Creator are not in the default columns.
    expect(chips(el)).toEqual([
      'Client: Acme (hidden column)',
      'Creator: Pat Partner (hidden column)',
    ]);

    el.querySelector<HTMLButtonElement>('[data-chip="clientText"] .fch__x')!.click();
    await settle();
    expect(query()['clientText']).toBeUndefined();
    expect(query()['creator']).toBe('2');
    expect(lastArgs()[ARG.clientText]).toBeUndefined();
  });

  it('reads the project manager link: tasks on matters I manage, a removable chip, sent to the API', async () => {
    const el = await open('/tasks?managedByMe=true&status=NEW&status=ON_HOLD&role=secondary');
    expect(chips(el)).toContain('On matters I manage');
    expect(chips(el)).toContain('As: Secondary manager');
    expect(lastArgs()[ARG.managedByMe]).toBe(true);
    expect(lastArgs()[ARG.role]).toBe('secondary');
    expect(lastArgs()[ARG.status]).toEqual(['NEW', 'ON_HOLD']);

    el.querySelector<HTMLButtonElement>('[data-chip="managedByMe"] .fch__x')!.click();
    await settle();
    expect(query()['managedByMe']).toBeUndefined();
    expect(lastArgs()[ARG.managedByMe]).toBeUndefined();
    expect(query()['role']).toBe('secondary');
  });

  it('sends dueWithin and the on-hold sort from a My Matters link', async () => {
    await open('/tasks?managedByMe=true&dueWithin=3&status=NEW&sort=onHoldSince&dir=asc');
    expect(lastArgs()[ARG.dueWithin]).toBe(3);
    expect(lastArgs()[ARG.sort]).toBe('onHoldSince');
    expect(lastArgs()[ARG.dir]).toBe('asc');
  });

  it('typing in a column filter writes the address, resets the page and reloads once', async () => {
    const el = await open('/tasks?status=NEW&page=3');
    const before = getTaskQueue.mock.calls.length;

    await typeFilter(el, 'matterText', '343-12');
    expect(query()['matterText']).toBe('343-12');
    expect(query()['page']).toBeUndefined();
    expect(getTaskQueue.mock.calls.length).toBe(before + 1);
    expect(lastArgs()[ARG.matterText]).toBe('343-12');
    expect(lastArgs()[ARG.status]).toEqual(['NEW']);
  });

  it('a filter chosen on a plain /tasks keeps the open statuses in the address, so the list does not widen', async () => {
    const el = await open('/tasks');
    await typeFilter(el, 'q', 'dedup');

    expect(query()['q']).toBe('dedup');
    expect(query()['status']).toEqual(OPEN);
    expect(lastArgs()[ARG.status]).toEqual(OPEN);
    expect(lastArgs()[ARG.q]).toBe('dedup');
  });

  it('removing a chip and Clear filters update the address and reload; clearing returns to the plain link', async () => {
    const el = await open('/tasks?status=NEW&priority=1&overdue=true&clientText=Acme');
    el.querySelector<HTMLButtonElement>('[data-chip="clientText"] .fch__x')!.click();
    await settle();
    expect(query()['clientText']).toBeUndefined();
    expect(query()['priority']).toBe('1');

    el.querySelector<HTMLButtonElement>('[data-clear-filters]')!.click();
    await settle();
    expect(query()).toEqual({});
    expect(lastArgs()[ARG.overdue]).toBeUndefined();
    expect(lastArgs()[ARG.status]).toEqual(OPEN);
    expect(getTaskQueue).toHaveBeenCalledTimes(3);
  });

  it('sorts by a column header, flips the direction, and resets to the default order', async () => {
    const el = await open('/tasks?status=NEW');
    const header = (col: string) =>
      el.querySelector<HTMLElement>(`thead th[data-col="${col}"] button`)!;

    header('priority').click();
    await settle();
    expect(query()['sort']).toBe('priority');
    expect(query()['dir']).toBe('asc');
    expect([lastArgs()[ARG.sort], lastArgs()[ARG.dir]]).toEqual(['priority', 'asc']);
    expect(el.querySelector('th[data-col="priority"]')!.getAttribute('aria-sort')).toBe(
      'ascending',
    );

    header('priority').click();
    await settle();
    expect(query()['dir']).toBe('desc');

    // The sorted-by note is in the footer; "Reset sort" is at the right end of row 2.
    expect(el.querySelector('[data-toolbar-row2] [data-reset-sort]')).not.toBeNull();
    expect(el.querySelector('.mf-pager [data-sort-note]')!.textContent).toContain(
      'Sorted by Priority',
    );
    el.querySelector<HTMLButtonElement>('[data-reset-sort]')!.click();
    await settle();
    expect(el.querySelector('[data-reset-sort]')).toBeNull();
    expect(query()['sort']).toBeUndefined();
    expect(lastArgs()[ARG.sort]).toBeUndefined();
  });

  it('the restored notice sits in row 2 and goes with the first action (a sort, a page change), not before', async () => {
    localStorage.setItem(
      'mf.work-view.v1.queue.1',
      JSON.stringify({ status: ['NEW'], overdue: 'true' }),
    );
    const el = await open('/tasks');
    expect(el.querySelector('[data-toolbar-row2] [data-restored-notice]')).not.toBeNull();
    await settle();
    expect(el.querySelector('[data-restored-notice]')).not.toBeNull();
    el.querySelector<HTMLElement>('thead th[data-col="priority"] button')!.click();
    await settle();
    expect(el.querySelector('[data-restored-notice]')).toBeNull();
  });

  it('sorting on a plain /tasks keeps the open statuses', async () => {
    const el = await open('/tasks');
    el.querySelector<HTMLElement>('thead th[data-col="due"] button')!.click();
    await settle();
    expect(lastArgs()[ARG.status]).toEqual(OPEN);
    expect(lastArgs()[ARG.sort]).toBe('due');
  });

  it('names the restored quick view once, without repeating its filter ("Restored your last view: Overdue.")', async () => {
    localStorage.setItem(
      'mf.work-view.v1.queue.1',
      JSON.stringify({ status: OPEN, overdue: 'true' }),
    );
    const el = await open('/tasks');
    expect(el.querySelector('[data-restored-text]')!.textContent!.trim()).toBe(
      'Restored your last view: Overdue.',
    );
  });

  it('names the pressed view in the title, the caption and one live message (TQ36)', async () => {
    const el = await open('/tasks', { total: 101 });
    expect(document.title).toBe('Task Queue - MatterFlow');
    expect(el.querySelector('caption')!.textContent!.trim()).toBe('Task Queue');

    el.querySelector<HTMLButtonElement>('[data-view="overdue"]')!.click();
    await settle();
    expect(document.title).toBe('Task Queue: Overdue - MatterFlow');
    expect(el.querySelector('caption')!.textContent!.trim()).toBe('Task Queue: Overdue');
    // Exactly one results message: the bar's own live region stays silent for work lists.
    expect(el.querySelector('[data-filter-live]')!.textContent!.trim()).toBe('');
    expect(el.querySelector('mf-work-list [role="status"]')!.textContent!.trim()).toBe(
      'Overdue: 101 tasks, page 1 of 3, showing 1 to 50',
    );
  });

  it('says an empty view is good news, and offers Clear filters only for other filters (TQ33)', async () => {
    let el = await open('/tasks?overdue=true&status=NEW&status=IN_PROGRESS&status=ON_HOLD', {
      rows: [],
    });
    let empty = el.querySelector('tbody [data-empty]')!;
    expect(empty.textContent).toContain('Nothing is overdue.');
    expect(empty.textContent).not.toContain('Clear filters');

    TestBed.resetTestingModule();
    el = await open('/tasks?overdue=true&priority=1&status=NEW&status=IN_PROGRESS&status=ON_HOLD', {
      rows: [],
    });
    empty = el.querySelector('tbody [data-empty]')!;
    expect(empty.textContent).toContain('No tasks match these filters');
    expect(empty.textContent).toContain('Clear filters');

    TestBed.resetTestingModule();
    el = await open('/tasks?sort=due', { rows: [], permissions: ['Task.View'] });
    empty = el.querySelector('tbody [data-empty]')!;
    expect(empty.textContent).toContain('No tasks yet.');
    expect(empty.textContent).not.toContain('Create task');
  });

  it('applies a quick view as a preset that replaces the filters', async () => {
    const el = await open('/tasks?q=old&priority=2');
    const view = (key: string) => el.querySelector<HTMLButtonElement>(`[data-view="${key}"]`)!;

    view('overdue').click();
    await settle();
    expect(query()).toEqual({ status: OPEN, overdue: 'true', sort: 'priority', dir: 'asc' });
    expect(view('overdue').getAttribute('aria-pressed')).toBe('true');
    // The pressed view owns its filters: no chip and no "Filters (n)" for them.
    expect(chips(el)).toEqual([]);
    expect(el.querySelector('[data-filters-toggle]')?.textContent).not.toContain('(1)');

    view('unassigned').click();
    await settle();
    expect(query()['unassigned']).toBe('true');
    expect(query()['overdue']).toBeUndefined();
    expect(query()['sort']).toBe('priorityAge');

    // All open is the plain link; a manual change un-presses a view.
    view('allOpen').click();
    await settle();
    expect(query()).toEqual({});
    expect(view('allOpen').getAttribute('aria-pressed')).toBe('true');
    await typeFilter(el, 'q', 'x');
    expect(view('allOpen').getAttribute('aria-pressed')).toBe('false');
  });

  it('Recently completed sorts by Closed and swaps Due for Closed without touching the saved columns', async () => {
    const el = await open('/tasks?status=NEW');
    const headers = () =>
      Array.from(el.querySelectorAll('thead th[data-col]')).map((th) =>
        th.getAttribute('data-col'),
      );
    expect(headers()).toContain('due');
    expect(headers()).not.toContain('closed');

    el.querySelector<HTMLButtonElement>('[data-more-views]')!.click();
    await settle();
    el.querySelector<HTMLButtonElement>(
      'mf-filter-popover [data-view="recentlyCompleted"]',
    )!.click();
    await settle();
    // The window is the Dashboard tile's: 30 days with today, so Oct 14 starts on Sep 15 (#224).
    expect(query()['completedFrom']).toBe('2026-09-15');
    expect(query()['sort']).toBe('closed');
    expect(query()['dir']).toBe('desc');
    expect(headers()).toContain('closed');
    expect(headers()).not.toContain('due');
    expect(el.textContent).not.toContain('Showing 0 of');

    // Back on a view without an overlay: the user's own set is shown again and the sort is the default order.
    el.querySelector<HTMLButtonElement>('[data-view="allOpen"]')!.click();
    await settle();
    expect(query()['sort']).toBeUndefined();
    expect(headers()).toContain('due');
    expect(headers()).not.toContain('closed');
  });

  it('reads the counts again after an inline edit, without reloading the rows', async () => {
    await open('/tasks?status=NEW');
    const before = getTaskQueue.mock.calls.length;
    const list = harness.fixture.debugElement.query(By.directive(WorkList))
      .componentInstance as WorkList;
    list.rowChange.emit(aRow({ title: 'Edited' }));
    await settle();
    expect(getTaskQueue.mock.calls.length).toBe(before + 1);
    expect(harness.routeNativeElement!.querySelectorAll('tbody tr[data-task]').length).toBe(2);
  });

  it('"My pod" filters on the primary Pod and is hidden, not disabled, without one (#223)', async () => {
    let el = await open('/tasks?status=NEW', { primaryPod: 5 });
    const myPod = () => el.querySelector<HTMLButtonElement>('[data-view="myPod"]')!;
    expect(myPod().disabled).toBe(false);
    myPod().click();
    await settle();
    expect(query()['pod']).toBe('5');
    expect(lastArgs()[ARG.pod]).toEqual([5]);

    TestBed.resetTestingModule();
    el = await open('/tasks?status=NEW', { primaryPod: null });
    expect(el.querySelector('[data-view="myPod"]')).toBeNull();
    expect(
      Array.from(el.querySelectorAll('mf-quick-views button')).some((b) =>
        b.hasAttribute('disabled'),
      ),
    ).toBe(false);
    // A bookmarked link to a pod still works as a filter.
    TestBed.resetTestingModule();
    el = await open('/tasks?status=NEW&pod=5', { primaryPod: null });
    expect(lastArgs()[ARG.pod]).toEqual([5]);
  });

  it('hides "Created by me" without Task.Create, and the link still filters (#223)', async () => {
    let el = await open('/tasks', { permissions: ['Task.View'] });
    expect(el.querySelector('[data-view="createdByMe"]')).toBeNull();
    TestBed.resetTestingModule();
    el = await open('/tasks?creator=1&status=NEW', { permissions: ['Task.View'] });
    expect(lastArgs()[ARG.creator]).toEqual([1]);
    expect(el.querySelector('mf-quick-views [aria-pressed="true"]')).toBeNull();
  });

  it('Created by me starts on Open: the address has creator only, the Status cell reads Open (#222)', async () => {
    let el = await open('/tasks');
    el.querySelector<HTMLButtonElement>('[data-view="createdByMe"]')!.click();
    await settle();
    expect(query()).toEqual({ creator: '1' });
    expect(lastArgs()[ARG.status]).toEqual(OPEN);
    expect(lastArgs()[ARG.creator]).toEqual([1]);
    expect(el.querySelector('[data-view="createdByMe"]')!.getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(chips(el)).toEqual([]);

    // A link with creator alone reads the same way after a reload; another creator means what it says.
    TestBed.resetTestingModule();
    el = await open('/tasks?creator=1');
    expect(lastArgs()[ARG.status]).toEqual(OPEN);
    expect(el.querySelector('[data-view="createdByMe"]')!.getAttribute('aria-pressed')).toBe(
      'true',
    );
    TestBed.resetTestingModule();
    await open('/tasks?creator=2');
    expect(lastArgs()[ARG.status]).toBeUndefined();
  });

  it('the Status chip widens Created by me to every status, and only that writes an empty status= (#222)', async () => {
    const el = await open('/tasks?creator=1');
    // Status taken off Open: "Status: All" and `status=`.
    await router().navigateByUrl('/tasks?creator=1&status=');
    await settle();
    expect(lastArgs()[ARG.status]).toBeUndefined();
    // The Status cell says so (its chip shows when the column is hidden); the creator is a filter now, not a view.
    expect(el.querySelector('tr[data-filter-row] [data-filter="status"]')!.textContent).toContain(
      'All',
    );
    expect(chips(el)).toEqual(['Creator: 1 (hidden column)']);
    expect(el.querySelector('[data-view="createdByMe"]')!.getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('presses Due soon for the Dashboard link by shape and keeps extra filters as chips (#221)', async () => {
    const dueSoon = '?status=NEW&status=IN_PROGRESS&status=ON_HOLD&asap=false&overdue=false';
    let el = await open(`/tasks${dueSoon}&dueTo=2026-10-16`);
    const view = () => el.querySelector('[data-view="dueSoon"]')!;
    expect(view().getAttribute('aria-pressed')).toBe('true');
    expect(chips(el)).toEqual([]);
    expect(el.querySelector('mf-filters-toggle')!.textContent).not.toMatch(/\(\d\)/);
    expect(document.title).toBe('Task Queue: Due soon - MatterFlow');

    TestBed.resetTestingModule();
    el = await open(`/tasks${dueSoon}&dueTo=2026-10-16&priority=1`);
    expect(view().getAttribute('aria-pressed')).toBe('true');
    expect(el.querySelector('mf-filters-toggle')!.textContent).toContain('(1)');

    // Three days out is not Due soon: a plain filter, no view pressed.
    TestBed.resetTestingModule();
    el = await open(`/tasks${dueSoon}&dueTo=2026-10-17`);
    expect(el.querySelector('mf-quick-views [aria-pressed="true"]')).toBeNull();
    expect(el.querySelector('mf-filters-toggle')!.textContent).toContain('(');
  });

  it('Due soon and ASAP and On hold are one click: filters, order and tooltip (#220)', async () => {
    const el = await open('/tasks');
    el.querySelector<HTMLButtonElement>('[data-view="dueSoon"]')!.click();
    await settle();
    expect(query()).toMatchObject({
      status: OPEN,
      asap: 'false',
      overdue: 'false',
      dueTo: '2026-10-16',
      sort: 'due',
      dir: 'asc',
    });
    expect(lastArgs()[ARG.asap]).toBe(false);
    el.querySelector<HTMLButtonElement>('[data-view="asap"]')!.click();
    await settle();
    expect(query()).toMatchObject({ status: OPEN, asap: 'true' });
    expect(query()['dueTo']).toBeUndefined();
    expect(query()['sort']).toBeUndefined();
    el.querySelector<HTMLButtonElement>('[data-view="onHold"]')!.click();
    await settle();
    expect(query()).toEqual({ status: 'ON_HOLD' });
    expect(el.querySelector('[data-view="onHold"]')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('opens All open instead of a restored Created by me the viewer can no longer use (#223)', async () => {
    localStorage.setItem('mf.work-view.v1.queue.1', JSON.stringify({ status: OPEN, creator: '1' }));
    const el = await open('/tasks', { permissions: ['Task.View'] });
    expect(el.querySelector('[data-restored-notice]')).toBeNull();
    expect(lastArgs()[ARG.creator]).toBeUndefined();
  });

  it('pages with Previous and Next and changes the page size', async () => {
    const el = await open('/tasks?status=NEW', { total: 120 });
    expect(el.textContent).toContain('Showing 1-50 of 120');
    const next = Array.from(el.querySelectorAll<HTMLButtonElement>('mf-pager button')).find(
      (b) => b.textContent?.trim() === 'Next',
    )!;
    next.click();
    await settle();
    expect(query()['page']).toBe('2');
    expect(lastArgs()[ARG.page]).toBe(2);

    const size = el.querySelector<HTMLSelectElement>('.mf-pager__size select')!;
    size.value = '25';
    size.dispatchEvent(new Event('change'));
    await settle();
    expect(query()['pageSize']).toBe('25');
    expect(query()['page']).toBeUndefined();
  });

  it('keeps the headers and the filter row while loading, with the loading state as a row of the body', async () => {
    const pending = new Subject<unknown>();
    const el = await open('/tasks?status=NEW', { response: pending });
    expect(
      el.querySelector('tbody[mfgridbody] [data-loading], tbody [data-loading]'),
    ).not.toBeNull();
    expect(el.querySelectorAll('thead th').length).toBeGreaterThan(3);
    expect(el.querySelector('tr[data-filter-row]')).not.toBeNull();
    expect(el.querySelector('table')!.getAttribute('aria-busy')).toBe('true');

    pending.next(pageOf([aRow()]));
    pending.complete();
    await settle();
    expect(el.querySelector('[data-loading]')).toBeNull();
    expect(el.querySelectorAll('tbody tr').length).toBe(1);
  });

  it('shows the error as a row of the body with Retry, keeping the headers and the filter row', async () => {
    const el = await open('/tasks?status=NEW', { response: throwError(() => new Error('boom')) });
    expect(el.querySelector('tbody [data-error]')!.textContent).toContain("Couldn't load tasks");
    expect(el.querySelector('tr[data-filter-row]')).not.toBeNull();

    getTaskQueue.mockReturnValue(of(pageOf([aRow()])));
    Array.from(el.querySelectorAll<HTMLButtonElement>('tbody [data-error] button, tbody button'))
      .find((b) => b.textContent?.trim() === 'Retry')!
      .click();
    await settle();
    expect(getTaskQueue).toHaveBeenCalledTimes(2);
    expect(el.querySelector('[data-error]')).toBeNull();
    expect(el.querySelectorAll('tbody tr').length).toBe(1);
  });

  it('says "No open tasks." with Create task when permitted, and "No tasks match these filters" with Clear filters when filtered', async () => {
    let el = await open('/tasks?status=NEW', { rows: [] });
    // Filters are set, so the filtered message applies.
    let empty = el.querySelector('tbody [data-empty]')!;
    expect(empty.getAttribute('data-empty')).toBe('filtered');
    expect(empty.textContent).toContain('No tasks match these filters');
    expect(el.querySelector('tr[data-filter-row]')).not.toBeNull();

    TestBed.resetTestingModule();
    el = await open('/tasks?sort=due', { rows: [] });
    empty = el.querySelector('tbody [data-empty]')!;
    expect(empty.getAttribute('data-empty')).toBe('none');
    expect(empty.textContent).toContain('No tasks yet.');
    expect(empty.textContent).toContain('Create task');
  });

  it('leaves the one global Create task button to the app header (UXR-23)', async () => {
    const el = await open('/tasks?status=NEW');
    expect(el.querySelector('mf-page-header')!.textContent).not.toContain('Create task');
  });

  it('remembers the chosen columns and density for the user', async () => {
    let el = await open('/tasks?status=NEW');
    el.querySelector<HTMLButtonElement>('.cc-button')!.click();
    harness.detectChanges();
    const input = (label: string) =>
      Array.from(el.querySelectorAll<HTMLLabelElement>('.cc-check'))
        .find((l) => l.textContent?.includes(label))!
        .querySelector('input')!;
    input('Client').click();
    input('Compact').click();
    harness.detectChanges();
    expect(el.querySelector('th[data-col="client"]')).not.toBeNull();
    // The Client filter now sits in the row, under its column.
    await settle();
    expect(filterInput(el, 'clientText')).not.toBeNull();
    expect(el.querySelector('table')!.classList).toContain('wt--compact');

    TestBed.resetTestingModule();
    el = await open('/tasks?status=NEW');
    expect(el.querySelector('th[data-col="client"]')).not.toBeNull();
    expect(el.querySelector('table')!.classList).toContain('wt--compact');
  });

  it('puts one filter control under each column, Title or Ref across two', async () => {
    const el = await open('/tasks');
    const cells = Array.from(el.querySelectorAll('tr[data-filter-row] td'));
    expect(cells[0].getAttribute('colspan')).toBe('2');
    expect(filterInput(el, 'q').getAttribute('aria-label')).toBe('Filter by Title or Ref');
    expect(filterInput(el, 'matterText').getAttribute('aria-label')).toBe(
      'Filter by Matter Number',
    );
    for (const key of ['priority', 'assignee', 'due', 'status']) {
      expect(el.querySelector(`tr[data-filter-row] [data-filter="${key}"]`), key).not.toBeNull();
    }
  });

  it('focuses the Title or Ref filter on "/" unless typing in a field', async () => {
    const el = await open('/tasks?status=NEW');
    document.body.appendChild(el);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', cancelable: true }));
    await settle();
    expect(document.activeElement).toBe(filterInput(el, 'q'));
    (document.activeElement as HTMLElement).blur();

    const other = document.createElement('input');
    document.body.appendChild(other);
    other.focus();
    other.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));
    expect(document.activeElement).toBe(other);
    other.remove();
  });

  describe('My matters / All (epic #758)', () => {
    const PM: Permission[] = ['Task.View', 'Matter.BeManager', 'Matter.AssignManagers'];

    it('is not there for people who cannot be a project manager', async () => {
      const el = await open('/tasks', { permissions: ['Task.View', 'Matter.AssignManagers'] });
      expect(el.querySelector('[data-scope-switch]')).toBeNull();
      expect(lastArgs()[ARG.managedByMe]).toBeUndefined();
      expect(query()['scope']).toBeUndefined();
    });

    it('opens a plain link on the tasks of the matters the person manages and names it in the address', async () => {
      const el = await open('/tasks', { permissions: PM });
      expect(lastArgs()[ARG.managedByMe]).toBe(true);
      expect(query()['scope']).toBe('mine');
      expect(el.querySelector('[data-scope="mine"]')?.getAttribute('aria-pressed')).toBe('true');
      expect(el.querySelector('[data-scope-line]')?.textContent).toContain(
        'Tasks on matters you manage',
      );
      // The scope in the address is no new request.
      expect(getTaskQueue).toHaveBeenCalledTimes(1);
    });

    it('leaves a link with filters alone: no remembered scope is added, the address stays as it is', async () => {
      await open('/tasks?overdue=true&status=NEW', { permissions: PM });
      expect(lastArgs()[ARG.managedByMe]).toBeUndefined();
      expect(query()['scope']).toBeUndefined();
    });

    it('All removes the filter, is remembered, and Back restores the choice', async () => {
      const el = await open('/tasks', { permissions: PM });
      el.querySelector<HTMLButtonElement>('[data-scope="all"]')!.click();
      await settle();
      expect(query()['scope']).toBe('all');
      expect(lastArgs()[ARG.managedByMe]).toBeUndefined();
      expect(localStorage.getItem('mf.scope.task-queue.1')).toBe('all');
      await TestBed.inject(Router).navigateByUrl('/tasks');
      await settle();
      // The remembered choice opens the plain link on All.
      expect(query()['scope']).toBe('all');
    });

    it('keeps an explicit managerId link as it is and a restored view keeps the scope', async () => {
      localStorage.setItem(
        'mf.work-view.v1.queue.1',
        JSON.stringify({ status: OPEN, priority: '2' }),
      );
      await open('/tasks', { permissions: PM });
      await vi.waitFor(() => expect(query()['priority']).toBe('2'));
      expect(query()['scope']).toBe('mine');
      expect(lastArgs()[ARG.managedByMe]).toBe(true);
    });

    it('keeps a project manager without Matter.AssignManagers on mine even for ?scope=all', async () => {
      const el = await open('/tasks?scope=all', { permissions: ['Task.View', 'Matter.BeManager'] });
      expect(lastArgs()[ARG.managedByMe]).toBe(true);
      expect(el.querySelector('[data-scope-switch]')).toBeNull();
      expect(query()['scope']).toBe('mine');
    });
  });
});
