import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TaskQueueRow } from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../core/auth/auth-testing';
import { Permission } from '../../core/auth/permissions';
import { TaskCardList, initialsOf } from './task-card-list';
import { TaskTable } from './task-table';
import { aRow, provideClock, provideLookups } from './work-queue-testing';

describe('initialsOf', () => {
  it('takes the first letters of the first and last word', () => {
    expect(initialsOf('Tariq Malik')).toBe('TM');
    expect(initialsOf('  ana  maria  de la cruz ')).toBe('AC');
    expect(initialsOf('Prince')).toBe('P');
    expect(initialsOf('   ')).toBe('?');
  });
});

describe('TaskCardList', () => {
  let fixture: ComponentFixture<TaskCardList>;
  const el = () => fixture.nativeElement as HTMLElement;
  const cards = () => Array.from(el().querySelectorAll<HTMLElement>('li[data-task]'));

  async function create(
    rows: TaskQueueRow[],
    columns: string[],
    inputs: Record<string, unknown> = {},
    permissions: Permission[] = [],
  ) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        ...provideLookups(),
        ...provideClock('2026-10-14T15:00:00Z', 'America/Chicago'),
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    fixture = TestBed.createComponent(TaskCardList);
    fixture.componentRef.setInput('rows', rows);
    fixture.componentRef.setInput('columns', columns);
    for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  const DEFAULT = ['ref', 'title', 'matter', 'priority', 'due', 'status'];

  it('is a list of articles, each with a heading link to the task and a name that reads the number and title', async () => {
    await create([aRow(), aRow({ taskId: 2, taskNumber: 'TSK-2', title: 'Second' })], DEFAULT);
    expect(el().querySelectorAll('ul.tc-list > li').length).toBe(2);
    const first = cards()[0];
    expect(first.getAttribute('data-task')).toBe('TSK-1042');
    const article = first.querySelector('article')!;
    expect(article.getAttribute('aria-label')).toBe('TSK-1042, Process Smith custodians');
    const heading = article.querySelector('h2')!;
    const link = heading.querySelector<HTMLAnchorElement>('a.wt-title')!;
    expect(link.textContent?.trim()).toBe('Process Smith custodians');
    expect(link.getAttribute('href')).toBe('/tasks/1042');
    expect(link.getAttribute('data-task-id')).toBe('1042');
    expect(el().querySelector('table')).toBeNull();
  });

  it('keeps the list in the order of the rows and carries the from parameter of the list', async () => {
    await create([aRow()], DEFAULT, {
      linkParams: { from: 'my-work' },
      linkState: { returnTo: '/my-work' },
    });
    expect(el().querySelector('a.wt-title')!.getAttribute('href')).toBe('/tasks/1042?from=my-work');
  });

  it('line 2 is the client and the matter reference, a link only with Matter.View', async () => {
    await create([aRow()], DEFAULT, {}, ['Matter.View']);
    const sub = el().querySelector('[data-card-matter]')!;
    expect(sub.textContent).toContain('Acme Corp');
    const link = sub.querySelector('a')!;
    expect(link.textContent?.trim()).toBe('00343-00012');
    expect(link.getAttribute('href')).toBe('/matters/7');
    TestBed.resetTestingModule();
    await create([aRow()], DEFAULT, {}, ['Task.View']);
    expect(el().querySelector('[data-card-matter] a')).toBeNull();
    expect(el().querySelector('[data-card-matter] span.mf-ref')!.textContent?.trim()).toBe(
      '00343-00012',
    );
  });

  it('marks a sensitive matter with a labelled icon', async () => {
    await create([aRow({ matterIsSensitive: true })], DEFAULT);
    expect(el().querySelector('[aria-label="Sensitive matter"]')).not.toBeNull();
  });

  it('shows the three chips: Priority, the two-line Due and Status (text where the person cannot edit)', async () => {
    await create([aRow({ dueDate: '2026-10-20', isAsap: false })], DEFAULT);
    const chips = el().querySelector('[data-card-chips]')!;
    expect(chips.querySelector('[data-col="priority"] [data-priority]')!.textContent).toContain(
      'Critical',
    );
    expect(chips.querySelector('[data-col="due"] .dc')).not.toBeNull();
    expect(chips.querySelector('[data-col="due"] .dc--inline')).toBeNull();
    expect(chips.querySelector('[data-col="status"] [data-status="IN_PROGRESS"]')).not.toBeNull();
    expect(el().querySelector('[data-inline-trigger]')).toBeNull();
  });

  it('makes Priority, Status and Assignee buttons for a person who may change them', async () => {
    await create([aRow()], [...DEFAULT, 'assignee'], {}, [
      'Task.SetPriority',
      'Task.Assign',
      'Task.ChangeStatus',
    ]);
    const card = cards()[0];
    expect(card.querySelector('[data-col="priority"] [data-inline-trigger]')).not.toBeNull();
    expect(card.querySelector('[data-col="status"] [data-inline-trigger]')).not.toBeNull();
    expect(card.querySelector('[data-col="assignee"] [data-inline-trigger]')).not.toBeNull();
  });

  it('follows the columns of the tab: the Closed tab has the Closed date and Status, no Priority or Due', async () => {
    await create(
      [
        aRow({
          status: 'COMPLETED',
          statusLabel: 'Completed',
          closedAtUtc: '2026-10-12T15:00:00Z',
          dueDate: '2026-10-01',
        }),
      ],
      ['ref', 'title', 'matter', 'status', 'closed'],
    );
    const chips = el().querySelector('[data-card-chips]')!;
    expect(chips.querySelector('[data-col="priority"]')).toBeNull();
    expect(chips.querySelector('[data-col="due"]')).toBeNull();
    expect(chips.querySelector('[data-col="closed"]')!.textContent?.trim()).toBe('Closed Oct 12');
    expect(chips.querySelector('[data-col="status"]')).not.toBeNull();
    expect(el().querySelector('[data-card-meta]')).toBeNull();
  });

  it('shows the year of a closed date outside the current year', async () => {
    await create(
      [
        aRow({
          status: 'CANCELLED',
          statusLabel: 'Cancelled',
          closedAtUtc: '2025-03-02T15:00:00Z',
        }),
      ],
      ['status', 'closed'],
    );
    expect(el().querySelector('[data-col="closed"]')!.textContent?.trim()).toBe(
      'Closed Mar 2, 2025',
    );
  });

  it('a closed task shows no Due and a muted Priority badge', async () => {
    await create(
      [
        aRow({
          status: 'COMPLETED',
          statusLabel: 'Completed',
          closedAtUtc: '2026-10-12T15:00:00Z',
        }),
      ],
      DEFAULT,
    );
    expect(el().querySelector('[data-col="due"]')).toBeNull();
    expect(el().querySelector('[data-col="priority"] .badge')!.classList).toContain('muted');
  });

  it('line 4 is the assignee with initials, and the task number', async () => {
    await create([aRow()], [...DEFAULT, 'assignee']);
    const meta = el().querySelector('[data-card-meta]')!;
    expect(meta.querySelector('[data-avatar]')!.textContent?.trim()).toBe('TM');
    expect(meta.querySelector('[data-col="assignee"]')!.textContent).toContain('Tariq Malik');
    expect(meta.querySelector('.tc-num')!.textContent?.trim()).toBe('TSK-1042');
  });

  it('says Unassigned (muted), marks an inactive person, and offers Assign to me on Pod Work', async () => {
    await create([aRow({ assignedUser: undefined })], [...DEFAULT, 'assignee'], {}, [
      'Task.Assign',
    ]);
    expect(
      el().querySelector('[data-col="assignee"] [data-inline-trigger]')!.textContent,
    ).toContain('Unassigned');
    TestBed.resetTestingModule();
    await create(
      [aRow({ assignedUser: { userId: 9, displayName: 'Tariq Malik', isActive: false } })],
      [...DEFAULT, 'assignee'],
    );
    expect(el().querySelector('[data-col="assignee"]')!.textContent).toContain('(inactive)');
    TestBed.resetTestingModule();
    await create([aRow({ assignedUser: undefined })], DEFAULT, { assignLink: true }, [
      'Task.Assign',
    ]);
    expect(el().querySelector('[data-assign-link]')!.textContent?.trim()).toBe('Assign to me');
  });

  it('puts the task number on line 2 when the tab has no assignee line', async () => {
    await create([aRow()], DEFAULT);
    expect(el().querySelector('[data-card-meta]')).toBeNull();
    expect(el().querySelector('[data-card-matter] .tc-num')!.textContent?.trim()).toBe('TSK-1042');
  });

  it('shows the hold reason as its own chip line, without the old "Waiting:" prefix', async () => {
    await create(
      [
        aRow({
          status: 'ON_HOLD',
          statusLabel: 'On Hold',
          holdReason: 'Awaiting the custodian',
          holdReasonTruncated: false,
        }),
      ],
      DEFAULT,
    );
    const chip = el().querySelector('[data-hold-chip]')!;
    expect(chip.textContent).toContain('Awaiting the custodian');
    expect(chip.textContent).not.toContain('Waiting:');
    expect(chip.getAttribute('title')).toMatch(/Awaiting the custodian$/);
  });

  it('marks overdue open tasks, shows the New dot only where asked, and mutes a task that is leaving', async () => {
    await create(
      [
        aRow({ isOverdue: true, assignedAtUtc: '2026-10-13T12:00:00Z' }),
        aRow({ taskId: 2, taskNumber: 'TSK-2', isOverdue: true, status: 'COMPLETED' }),
      ],
      DEFAULT,
      { newSince: new Date('2026-10-12T00:00:00Z').getTime(), leaving: new Set([2]) },
    );
    const [a, b] = cards();
    expect(a.classList).toContain('tc--overdue');
    expect(a.querySelector('[data-new-dot]')!.getAttribute('aria-label')).toBe('New');
    expect(b.classList).not.toContain('tc--overdue');
    expect(b.querySelector('[data-new-dot]')).toBeNull();
    expect(b.getAttribute('data-leaving')).toBe('true');
  });

  it('draws group headers where a bucket starts and hides the cards of a collapsed group', async () => {
    const rows = [
      aRow(),
      aRow({ taskId: 2, taskNumber: 'TSK-2' }),
      aRow({ taskId: 3, taskNumber: 'TSK-3' }),
    ];
    await create(rows, DEFAULT, {
      groups: [
        { key: 'overdue', label: 'Overdue', count: 2, start: 0, length: 2, continued: false },
        { key: 'later', label: 'Later', count: 1, start: 2, length: 1, continued: true },
      ],
      hiddenAt: [true, true, false],
      collapsed: new Set(['overdue']),
    });
    const headers = Array.from(el().querySelectorAll<HTMLElement>('li.tc-group'));
    const text = (h: HTMLElement) => h.textContent?.replace(/\s+/g, ' ').trim();
    expect(text(headers[0])).toBe('Overdue (2 tasks)');
    expect(text(headers[1])).toBe('Later (1 task), continued');
    expect(headers[0].querySelector('button')!.getAttribute('aria-expanded')).toBe('false');
    expect(headers[1].querySelector('button')!.getAttribute('aria-expanded')).toBe('true');
    expect(cards().map((c) => c.hidden)).toEqual([true, true, false]);
    let toggled = '';
    fixture.componentInstance.toggled.subscribe((k) => (toggled = k));
    headers[1].querySelector('button')!.click();
    expect(toggled).toBe('later');
  });

  it('shows placeholder cards and a polite status while loading', async () => {
    await create([], DEFAULT, { state: 'ready', skeleton: true });
    expect(el().querySelectorAll('li[data-skeleton]').length).toBe(6);
    expect(el().querySelector('[data-loading]')!.getAttribute('role')).toBe('status');
    expect(el().querySelector('ul')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows the empty states (first run text, filtered with Clear filters) and the error with Retry', async () => {
    await create([], DEFAULT, { empty: true, emptyText: 'Nothing here yet.' });
    expect(el().querySelector('[data-empty="none"]')!.textContent).toContain('Nothing here yet.');
    fixture.componentRef.setInput('filtered', true);
    fixture.detectChanges();
    expect(el().querySelector('[data-empty="filtered"]')!.textContent).toContain(
      'No tasks match these filters',
    );
    let cleared = false;
    fixture.componentInstance.clear.subscribe(() => (cleared = true));
    el().querySelector<HTMLButtonElement>('[data-empty] button')!.click();
    expect(cleared).toBe(true);
    fixture.componentRef.setInput('state', 'error');
    fixture.detectChanges();
    expect(el().querySelector('[data-error] [role="alert"]')!.textContent).toContain(
      "Couldn't load tasks.",
    );
    let retried = false;
    fixture.componentInstance.retry.subscribe(() => (retried = true));
    el().querySelector<HTMLButtonElement>('[data-error] button')!.click();
    expect(retried).toBe(true);
  });

  it('reports a click on the title so the list can remember the row', async () => {
    await create([aRow()], DEFAULT);
    let drilled: TaskQueueRow | null = null;
    fixture.componentInstance.drilled.subscribe((d) => (drilled = d.row));
    el()
      .querySelector<HTMLAnchorElement>('a.wt-title')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
    expect((drilled as TaskQueueRow | null)?.taskId).toBe(1042);
  });
});

describe('TaskTable on a phone', () => {
  const original = window.matchMedia;
  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: original,
    });
  });

  async function create(phone: boolean, phoneCards: boolean) {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: () => ({
        matches: phone,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }),
    });
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideFakeMe(new FakeMeApi(withPermissions())),
        ...provideLookups(),
        ...provideClock('2026-10-14T15:00:00Z', 'America/Chicago'),
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    const fixture = TestBed.createComponent(TaskTable);
    fixture.componentRef.setInput('rows', [aRow()]);
    fixture.componentRef.setInput('columns', ['ref', 'title', 'status']);
    fixture.componentRef.setInput('phoneCards', phoneCards);
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('renders cards instead of the table on a phone for a list that asks for them', async () => {
    const el = await create(true, true);
    expect(el.querySelector('table')).toBeNull();
    expect(el.querySelectorAll('mf-task-card-list li[data-task]').length).toBe(1);
  });

  it('keeps the table above the breakpoint, and on grids that do not ask for cards (Matter, Project)', async () => {
    let el = await create(false, true);
    expect(el.querySelector('table')).not.toBeNull();
    expect(el.querySelector('mf-task-card-list')).toBeNull();
    TestBed.resetTestingModule();
    el = await create(true, false);
    expect(el.querySelector('table')).not.toBeNull();
  });
});
