import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of, throwError } from 'rxjs';
import { MyWorkClient, PodsClient } from '../../../api/generated/api-client';
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
import { MyWorkPage } from './my-work-page';

/** Positions of the arguments of `getMyWork` (the view comes first, then the shared filters). */
const ARG = {
  view: 0,
  q: 1,
  status: 2,
  pod: 4,
  assignee: 6,
  unassigned: 7,
  creator: 8,
  dueFrom: 16,
  asap: 18,
  completedFrom: 21,
  matterText: 23,
  sort: 28,
  page: 30,
};

const COUNTS = { active: 7, dueSoon: 2, completed: 5, createdByMe: 3 };

describe('MyWorkPage', () => {
  let getMyWork: ReturnType<typeof vi.fn>;
  let harness: RouterTestingHarness;

  async function open(
    url: string,
    options: {
      rows?: ReturnType<typeof aRow>[];
      permissions?: Permission[];
      response?: unknown;
    } = {},
  ) {
    const rows = options.rows ?? [aRow()];
    getMyWork = vi
      .fn()
      .mockReturnValue(options.response ?? of(pageOf(rows, { view: 'active', counts: COUNTS })));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'my-work', component: MyWorkPage }]),
        provideFakeMe(
          new FakeMeApi(withPermissions(...(options.permissions ?? ['Task.View', 'Pod.View']))),
        ),
        ...provideLookups(),
        ...provideQueueChoices(),
        ...provideClock('2026-10-14T15:00:00Z', 'UTC'),
        { provide: MyWorkClient, useValue: { getMyWork } },
        {
          provide: PodsClient,
          useValue: {
            listMyPods: () => of([{ podId: 5, name: 'Pod A', isActive: true, isPrimary: true }]),
            listPods: () => of({ items: [], total: 0, page: 1, pageSize: 100 }),
          },
        },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url, MyWorkPage);
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
  const lastArgs = () => getMyWork.mock.calls[getMyWork.mock.calls.length - 1];
  const tab = (el: HTMLElement, label: string) =>
    Array.from(el.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((t) =>
      t.textContent?.includes(label),
    )!;

  afterEach(() => localStorage.clear());

  it('opens on the Active tab and shows the count of every tab', async () => {
    const el = await open('/my-work');

    expect(lastArgs()[ARG.view]).toBe('active');
    const tabs = Array.from(el.querySelectorAll('[role="tab"]')).map((t) =>
      t.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(tabs).toEqual(['Active (7)', 'Due soon (2)', 'Completed (5)', 'Created by me (3)']);
    expect(tab(el, 'Active').getAttribute('aria-selected')).toBe('true');
    expect(el.querySelector('[role="tabpanel"]')!.getAttribute('aria-labelledby')).toBe(
      'mw-tab-active',
    );
  });

  it('opens on the tab the user last used when the URL names none, and says so', async () => {
    localStorage.setItem('mf.work-view.v1.my-work.1', JSON.stringify({ view: 'dueSoon' }));
    const el = await open('/my-work');
    expect(el.querySelector('[data-restored-notice]')!.textContent).toContain(
      'Restored your last view',
    );

    expect(query()['view']).toBe('dueSoon');
    expect(getMyWork).toHaveBeenCalledTimes(1);
    expect(lastArgs()[ARG.view]).toBe('dueSoon');
  });

  it('lists my tasks with priority, matter, workflow progress, due and status', async () => {
    const el = await open('/my-work');
    const headers = Array.from(el.querySelectorAll('thead th')).map((h) => h.textContent?.trim());
    expect(headers).toEqual(
      expect.arrayContaining([
        'Ref',
        'Title',
        'Matter',
        'Priority',
        'Workflow progress',
        'Due',
        'Status',
      ]),
    );
    const row = el.querySelector('tbody tr')!;
    expect(row.textContent).toContain('00343-00012');
    expect(row.textContent).toContain('2 of 6');
    expect(row.textContent).toContain('Dedup');
    expect(row.textContent).toContain('ASAP');
    expect(row.textContent).toContain('In Progress');
  });

  it('switches tabs through the URL and loads that view', async () => {
    const el = await open('/my-work');
    tab(el, 'Due soon').click();
    await settle();

    expect(query()['view']).toBe('dueSoon');
    expect(lastArgs()[ARG.view]).toBe('dueSoon');
    expect(tab(el, 'Due soon').getAttribute('aria-selected')).toBe('true');
    expect(el.querySelector('[data-help]')!.textContent).toContain('ASAP');

    tab(el, 'Active').click();
    await settle();
    expect(query()['view']).toBeUndefined();
  });

  it('opens a tab from a link and keeps the filters when switching', async () => {
    const el = await open('/my-work?view=createdByMe&priority=1');
    expect(lastArgs()[ARG.view]).toBe('createdByMe');
    tab(el, 'Completed').click();
    await settle();
    expect(query()['view']).toBe('completed');
    expect(query()['priority']).toBe('1');
  });

  it('limits the Completed tab to the last 90 days until the user asks for older tasks', async () => {
    const el = await open('/my-work?view=completed');
    expect(lastArgs()[ARG.completedFrom]).toBe('2026-07-16');
    expect(el.querySelector('[data-help]')!.textContent).toContain('last 90 days');

    el.querySelector<HTMLButtonElement>('[data-help] button')!.click();
    await settle();
    expect(query()['completedFrom']).toBe('2000-01-01');
    expect(lastArgs()[ARG.completedFrom]).toBe('2000-01-01');
    expect(el.querySelector('[data-help]')!.textContent).not.toContain('last 90 days');
  });

  const chips = (el: HTMLElement) =>
    Array.from(el.querySelectorAll('[data-filter-chips] [data-chip]')).map((c) =>
      c.querySelector('.fch__text')!.textContent!.replace(/\s+/g, ' ').trim(),
    );
  const control = (el: HTMLElement, key: string) =>
    el.querySelector<HTMLElement>(`tr[data-filter-row] [data-filter="${key}"]`)!;

  it('applies filters and removes them with their chips', async () => {
    const el = await open('/my-work?pod=5&status=ON_HOLD');
    expect(lastArgs()[ARG.pod]).toEqual([5]);
    expect(lastArgs()[ARG.status]).toEqual(['ON_HOLD']);
    // The Status column is on screen, so its filter is in the row; Pod is not, so its filter is a chip.
    expect(chips(el)).toEqual(['Pod: Pod A (hidden column)']);
    expect(control(el, 'status').textContent).toContain('On Hold');

    el.querySelector<HTMLButtonElement>('[data-chip="pod"] .fch__x')!.click();
    await settle();
    expect(query()['pod']).toBeUndefined();
    expect(query()['status']).toBe('ON_HOLD');
  });

  it('has no default status: every status of the tab until one is chosen', async () => {
    await open('/my-work');
    expect(lastArgs()[ARG.status]).toBeUndefined();
  });

  it('shows the filter row open on the first visit with one control per shown column', async () => {
    const el = await open('/my-work');
    expect(el.querySelector('tr[data-filter-row]')).not.toBeNull();
    for (const key of ['q', 'matterText', 'priority', 'due', 'status']) {
      expect(control(el, key), key).not.toBeNull();
    }
  });

  it('shows what each tab decides itself as disabled controls with the reason, and does not send them', async () => {
    localStorage.setItem(
      'mf.work-table.v3.my-work.1',
      JSON.stringify({
        columns: ['ref', 'title', 'priority', 'assignee', 'creator', 'due', 'status'],
        density: 'comfortable',
      }),
    );
    let el = await open('/my-work?assignee=9&creator=3');
    // Active: Assignee is "me" by definition.
    expect(control(el, 'assignee').hasAttribute('disabled')).toBe(true);
    expect(
      control(el, 'assignee').closest('[data-filter-disabled]')!.getAttribute('title'),
    ).toContain('assigned to you');
    expect(control(el, 'creator').hasAttribute('disabled')).toBe(false);
    expect(lastArgs()[ARG.assignee]).toBeUndefined();
    expect(lastArgs()[ARG.creator]).toEqual([3]);

    TestBed.resetTestingModule();
    el = await open('/my-work?view=createdByMe&assignee=9');
    // Created by me: Assignee is a filter, Creator is the tab.
    expect(control(el, 'assignee').hasAttribute('disabled')).toBe(false);
    expect(lastArgs()[ARG.assignee]).toEqual([9]);
    expect(lastArgs()[ARG.creator]).toBeUndefined();

    TestBed.resetTestingModule();
    el = await open('/my-work?view=dueSoon&dueFrom=2026-10-01&asap=true');
    expect(control(el, 'due').hasAttribute('disabled')).toBe(true);
    expect(lastArgs()[ARG.dueFrom]).toBeUndefined();
    expect(lastArgs()[ARG.asap]).toBeUndefined();
  });

  it('limits the Status choices to what the tab can show', async () => {
    const el = await open('/my-work?view=completed');
    control(el, 'status').click();
    harness.detectChanges();
    await settle();
    const options = Array.from(document.querySelectorAll('mf-filter-popover [data-option]')).map(
      (o) => o.getAttribute('data-option'),
    );
    expect(options).toEqual(['COMPLETED', 'CANCELLED']);
    document.querySelectorAll('mf-filter-popover').forEach((n) => n.remove());
  });

  it('changing tab drops the filters the new tab owns and the statuses it cannot show, and keeps the rest', async () => {
    const el = await open(
      '/my-work?view=createdByMe&assignee=9&priority=1&status=NEW&status=COMPLETED',
    );
    tab(el, 'Active').click();
    await settle();
    expect(query()['view']).toBeUndefined();
    expect(query()['assignee']).toBeUndefined();
    expect(query()['priority']).toBe('1');
    expect(query()['status']).toBe('NEW');

    tab(el, 'Due soon').click();
    await settle();
    expect(query()['status']).toBe('NEW');

    tab(el, 'Completed').click();
    await settle();
    // NEW cannot be on the Completed tab; an explicit empty status is not written when none is left.
    expect(query()['status']).toBeUndefined();
    expect(query()['priority']).toBe('1');
  });

  it('puts the tabs on their own row and the sort note, Columns and Filters in one bar above the grid', async () => {
    const el = await open('/my-work');
    await vi.waitFor(() => {
      harness.detectChanges();
      expect(el.querySelector('[data-grid-toolbar] [data-sort-note]')).not.toBeNull();
    });
    const tabRow = el.querySelector('[data-tab-row]')!;
    expect(tabRow.querySelector('[role="tablist"]')).not.toBeNull();
    expect(tabRow.querySelector('[data-filters-toggle]')).toBeNull();
    // The bar is inside the tab panel: sort note, Columns and the Filters button together, directly above the grid.
    const bar = el.querySelector('[role="tabpanel"] [data-grid-toolbar]')!;
    expect(bar.querySelector('[data-sort-note]')!.textContent).toContain('Sorted by Priority');
    expect(bar.querySelector('.cc-button')).not.toBeNull();
    expect(bar.querySelector('[data-filters-toggle]')).not.toBeNull();
    expect(
      bar.compareDocumentPosition(el.querySelector('mf-work-list')!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(el.querySelector('#fb-q')).toBeNull();
  });

  it('marks tasks created since the previous visit as New, then forgets them at the next visit', async () => {
    const rows = [
      aRow({ taskId: 1, taskNumber: 'TSK-1', createdAtUtc: '2026-10-14T12:00:00Z' }),
      aRow({ taskId: 2, taskNumber: 'TSK-2', createdAtUtc: '2026-10-01T12:00:00Z' }),
    ];
    // First ever visit: nothing is marked.
    let el = await open('/my-work', { rows, response: of(pageOf(rows, { counts: COUNTS })) });
    expect(el.querySelectorAll('[data-new-marker]').length).toBe(0);
    const key = Object.keys(localStorage).find((k) => k.startsWith('mf.my-work.last-visit'))!;
    expect(Number(localStorage.getItem(key))).toBe(new Date('2026-10-14T15:00:00Z').getTime());

    // An earlier visit: the task created after it is New, the older one is not.
    TestBed.resetTestingModule();
    localStorage.setItem(key, String(new Date('2026-10-10T00:00:00Z').getTime()));
    el = await open('/my-work', { rows, response: of(pageOf(rows, { counts: COUNTS })) });
    const marked = el.querySelectorAll('[data-new-marker]');
    expect(marked.length).toBe(1);
    expect(marked[0].closest('tr')!.getAttribute('data-task')).toBe('TSK-1');

    // The visit above was recorded, so the marker is gone the next time.
    TestBed.resetTestingModule();
    el = await open('/my-work', { rows, response: of(pageOf(rows, { counts: COUNTS })) });
    expect(el.querySelectorAll('[data-new-marker]').length).toBe(0);
  });

  it('closes a short list with a friendly line that links to Pod Work and the Task Queue', async () => {
    const el = await open('/my-work');
    const line = el.querySelector('[data-near-empty]')!;
    expect(line.textContent).toContain("That's everything on your plate.");
    const hrefs = Array.from(line.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/pods/work', '/tasks']);
  });

  it('says what an empty tab means and points to Pod Work from Active', async () => {
    let el = await open('/my-work', {
      rows: [],
      response: of(pageOf([], { counts: { active: 0, dueSoon: 0, completed: 0, createdByMe: 0 } })),
    });
    const empty = el.querySelector('tbody [data-empty]')!;
    expect(empty.textContent).toContain(
      'Nothing assigned to you right now. Check Pod Work for unassigned tasks.',
    );
    expect(empty.querySelector('a')!.getAttribute('href')).toBe('/pods/work');

    TestBed.resetTestingModule();
    el = await open('/my-work', {
      permissions: ['Task.View'],
      response: of(pageOf([], { counts: COUNTS })),
    });
    expect(el.querySelector('tbody [data-empty] a')).toBeNull();
  });

  it('shows the filtered empty state and an error with Retry', async () => {
    let el = await open('/my-work?q=zzz', { response: of(pageOf([], { counts: COUNTS })) });
    expect(el.querySelector('tbody [data-empty]')!.textContent).toContain(
      'No tasks match these filters',
    );
    expect(el.querySelector('tr[data-filter-row]')).not.toBeNull();

    TestBed.resetTestingModule();
    el = await open('/my-work', { response: throwError(() => new Error('boom')) });
    expect(el.querySelector('tbody [data-error]')!.textContent).toContain("Couldn't load tasks");
    expect(el.querySelector('tr[data-filter-row]')).not.toBeNull();
    getMyWork.mockReturnValue(of(pageOf([aRow()], { counts: COUNTS })));
    Array.from(el.querySelectorAll<HTMLButtonElement>('tbody button'))
      .find((b) => b.textContent?.trim() === 'Retry')!
      .click();
    await settle();
    expect(el.querySelector('[data-error]')).toBeNull();
  });

  it('sorts and pages through the URL', async () => {
    const el = await open('/my-work');
    el.querySelector<HTMLElement>('th[data-col="priority"] button')!.click();
    await settle();
    expect(lastArgs()[ARG.sort]).toBe('priority');
    expect(query()['sort']).toBe('priority');
  });
});
