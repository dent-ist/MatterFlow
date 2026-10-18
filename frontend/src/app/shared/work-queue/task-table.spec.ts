import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MessageService } from 'primeng/api';
import { TaskQueueRow } from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../core/auth/auth-testing';
import { Permission } from '../../core/auth/permissions';
import { aRow, provideClock, provideLookups } from './work-queue-testing';
import { KeyboardShortcuts } from '../layout/keyboard-shortcuts';
import { TaskTable } from './task-table';

describe('TaskTable', () => {
  let fixture: ComponentFixture<TaskTable>;
  const el = () => fixture.nativeElement as HTMLElement;

  async function create(
    rows: TaskQueueRow[],
    columns: string[],
    inputs: Record<string, unknown> = {},
    permissions: Permission[] = [],
  ) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        MessageService,
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        ...provideLookups(),
        ...provideClock('2026-10-14T15:00:00Z', 'America/Chicago'),
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    fixture = TestBed.createComponent(TaskTable);
    fixture.componentRef.setInput('rows', rows);
    fixture.componentRef.setInput('columns', columns);
    for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  const cell = (key: string) => el().querySelector(`tbody td[data-col="${key}"]`) as HTMLElement;

  it('shows the ref, a title link to the task and a compact matter link without a copy button', async () => {
    await create([aRow()], ['ref', 'title', 'matter'], {}, ['Matter.View']);

    expect(cell('ref').textContent?.trim()).toBe('TSK-1042');
    const title = cell('title').querySelector('a')!;
    expect(title.textContent?.trim()).toBe('Process Smith custodians');
    expect(title.getAttribute('href')).toBe('/tasks/1042');
    const matter = cell('matter').querySelector('a')!;
    expect(matter.textContent?.trim()).toBe('00343-00012');
    expect(matter.getAttribute('href')).toBe('/matters/7');
    // #197: the tooltip is on the cell (client and matter name); the name is line 2.
    expect(cell('matter').querySelector('[title]')!.getAttribute('title')).toBe(
      'Acme Corp · Merger Review',
    );
    expect(cell('matter').querySelector('[data-matter-name]')!.textContent).toContain(
      'Merger Review',
    );
    expect(cell('matter').querySelector('button')).toBeNull();
    expect(cell('matter').querySelector('[aria-label="Sensitive matter"]')).toBeNull();
  });

  it('shows the matter reference as plain text, not a link, without Matter.View (BUG-7)', async () => {
    await create([aRow()], ['ref', 'title', 'matter'], {}, ['Task.View']);
    expect(cell('matter').querySelector('a')).toBeNull();
    expect(cell('matter').querySelector('span.mf-ref')!.textContent?.trim()).toBe('00343-00012');
  });

  it('shows the matter name even without Matter.View, appends (inactive), and only the reference in Compact (#197)', async () => {
    await create([aRow({ matterIsActive: false })], ['ref', 'title', 'matter'], {}, ['Task.View']);
    expect(cell('matter').querySelector('a')).toBeNull();
    expect(cell('matter').querySelector('[data-matter-name]')!.textContent).toContain(
      'Merger Review (inactive)',
    );
    const f = TestBed.createComponent(TaskTable);
    f.componentRef.setInput('rows', [aRow()]);
    f.componentRef.setInput('columns', ['ref', 'title', 'matter']);
    f.componentRef.setInput('density', 'compact');
    f.detectChanges();
    await f.whenStable();
    expect(f.nativeElement.querySelector('td[data-col="matter"] [data-matter-name]')).toBeNull();
    expect(f.nativeElement.querySelector('td[data-col="matter"] .mf-ref')).not.toBeNull();
  });

  it('marks a sensitive matter with an icon that has a text alternative', async () => {
    await create([aRow({ matterIsSensitive: true })], ['matter']);
    expect(cell('matter').querySelector('[aria-label="Sensitive matter"]')).not.toBeNull();
  });

  it('always shows Ref and Title, even when the saved columns omit them', async () => {
    await create([aRow()], ['status']);
    const headers = Array.from(el().querySelectorAll('th')).map((th) => th.textContent?.trim());
    expect(headers).toEqual(['Ref', 'Title', 'Status']);
  });

  describe('On Hold rows (#165, #182)', () => {
    const held = (extra: Partial<TaskQueueRow> = {}) =>
      aRow({
        status: 'ON_HOLD',
        statusLabel: 'On Hold',
        holdReason: 'Waiting for the custodian',
        holdReasonTruncated: false,
        ...extra,
      });

    it('shows the reason under the pill, a pause marker named On hold in Ref, and the full text as the tooltip', async () => {
      await create([held()], ['ref', 'title', 'status']);
      const line = cell('status').querySelector('[data-hold-reason]')!;
      expect(line.textContent?.trim()).toBe('Waiting for the custodian');
      expect(cell('status').querySelector('div')!.getAttribute('title')).toBe(
        'Waiting for the custodian',
      );
      const mark = cell('ref').querySelector('[data-hold-mark]')!;
      expect(mark.getAttribute('aria-label')).toBe('On hold');
      expect(mark.getAttribute('role')).toBe('img');
      expect(cell('title').querySelector('[data-hold-hint]')!.textContent).toContain(
        'Waiting: Waiting for the custodian',
      );
      expect(cell('title').querySelector('.wt-title')!.classList.contains('wt-dim')).toBe(false);
    });

    it('adds an ellipsis to the tooltip of a reason the server cut', async () => {
      await create([held({ holdReason: 'x'.repeat(200), holdReasonTruncated: true })], ['status']);
      expect(cell('status').querySelector('div')!.getAttribute('title')).toBe(
        'x'.repeat(200) + '...',
      );
    });

    it('draws no line in Compact density (only the tooltip and the screen reader text)', async () => {
      await create([held()], ['status'], { density: 'compact' });
      const host = cell('status').querySelector('mf-hold-note')!;
      expect(host.classList.contains('quiet')).toBe(true);
      expect(cell('status').querySelector('div')!.getAttribute('title')).toBe(
        'Waiting for the custodian',
      );
    });

    it('shows nothing for an On Hold row without a reason, for a resumed row, or in the status of other rows', async () => {
      await create(
        [held({ holdReason: undefined }), aRow({ taskId: 2, holdReason: 'stale' })],
        ['ref', 'status'],
      );
      const rows = el().querySelectorAll('tbody tr');
      expect(rows[0].querySelector('[data-hold-reason]')).toBeNull();
      expect(rows[0].querySelector('[data-hold-mark]')).not.toBeNull();
      expect(rows[1].querySelector('[data-hold-reason]')).toBeNull();
      expect(rows[1].querySelector('[data-hold-mark]')).toBeNull();
    });
  });

  it('shows ASAP as a plain label with a small icon (not a pill) and never as overdue', async () => {
    await create([aRow({ isAsap: true, isOverdue: false })], ['due']);
    const pill = cell('due').querySelector('.dc--asap')!;
    expect(pill.querySelector('.dc-l1')!.textContent?.trim()).toBe('ASAP');
    expect(pill.querySelector('.pi-bolt')).not.toBeNull();
    expect(pill.getAttribute('title')).toBe('No due date set. Handle promptly.');
    expect(cell('due').textContent).not.toContain('Overdue');
    expect(el().querySelector('.wt-row--overdue')).toBeNull();
  });

  it('shows an overdue due date with text and an icon, and a bar on the row (not color alone)', async () => {
    await create(
      [aRow({ isAsap: false, isOverdue: true, dueDate: '2026-10-10', status: 'IN_PROGRESS' })],
      ['due'],
    );
    const due = cell('due');
    expect(due.querySelector('.dc-l1')!.textContent).toBe('Oct 10');
    expect(due.querySelector('.dc-l2')!.textContent).toContain('Overdue 4d');
    expect(due.querySelector('.pi-exclamation-circle')).not.toBeNull();
    expect(el().querySelector('tbody tr')!.classList).toContain('wt-row--overdue');
  });

  it('puts the date on line 1 and the overdue text on line 2, one spoken sentence (#209)', async () => {
    await create(
      [aRow({ isAsap: false, isOverdue: true, dueDate: '2026-10-10', status: 'IN_PROGRESS' })],
      ['due'],
    );
    expect(cell('due').querySelector('.dc-l1')!.textContent).toBe('Oct 10');
    expect(cell('due').querySelector('.dc-sr')!.textContent).toBe('Due Oct 10, overdue 4 days');
    expect(cell('due').querySelector('.dc--inline')).toBeNull();
  });

  it('gives the title its full text as a tooltip because the cell shows at most two lines', async () => {
    await create([aRow({ title: 'A very long title '.repeat(10) })], ['ref', 'title']);
    const link = cell('title').querySelector('a.wt-title')!;
    expect(link.getAttribute('title')).toBe('A very long title '.repeat(10));
  });

  it('holds only the type icon and the title in the Title cell: no subline, no New pill, no progress fold, whatever the inputs (#196)', async () => {
    await create([aRow({ assignedAtUtc: '2026-10-14T10:00:00Z' })], ['ref', 'title', 'progress'], {
      newSince: Date.parse('2026-10-13T00:00:00Z'),
    });
    const noExtras = () => {
      const t = cell('title');
      for (const sel of [
        '.wt-subline',
        '.wt-sub',
        '[data-title-context]',
        '[data-title-progress]',
        '[data-new-marker]',
        '[data-sub-task]',
        '[data-sub-ref]',
        '.wt-new',
      ])
        expect(t.querySelector(sel), sel).toBeNull();
      expect(t.textContent?.replace(/\s+/g, ' ').trim()).toBe('Process Smith custodians');
    };
    noExtras();
    // The dot stays in the Ref cell (A5).
    expect(cell('ref').querySelector('[data-new-dot]')!.getAttribute('aria-label')).toBe('New');
    const inner = fixture.componentInstance as unknown as {
      boxWidth: { set(n: number): void };
    };
    // Narrow box: progress drops out as a column and is not folded under the title.
    inner.boxWidth.set(900);
    fixture.detectChanges();
    noExtras();
    fixture.componentRef.setInput('density', 'compact');
    fixture.detectChanges();
    noExtras();
    fixture.componentRef.setInput('hideContext', true);
    fixture.detectChanges();
    noExtras();
  });

  it('hideContext hides the Matter and Client columns (#196)', async () => {
    await create([aRow()], ['ref', 'title', 'matter', 'client'], { hideContext: true });
    const keys = Array.from(el().querySelectorAll('th')).map((th) => th.textContent?.trim());
    expect(keys).toEqual(['Ref', 'Title']);
  });

  it('links the Matter reference only with Matter.View, and shows the client in its own column', async () => {
    await create([aRow()], ['ref', 'title', 'matter', 'client'], {}, ['Matter.View']);
    expect(cell('matter').querySelector('a')!.getAttribute('href')).toBe('/matters/7');
    expect(cell('client').textContent?.trim()).toBe('Acme Corp');
  });

  it('shows closed work calmly: no ASAP bolt, a muted priority and a plain due date (C2)', async () => {
    await create(
      [
        aRow({ taskId: 1, status: 'COMPLETED', statusLabel: 'Completed', isAsap: true }),
        aRow({
          taskId: 2,
          status: 'CANCELLED',
          statusLabel: 'Cancelled',
          dueDate: '2026-10-01',
          isOverdue: true,
        }),
        aRow({ taskId: 3 }),
      ],
      ['priority', 'due'],
    );
    const due = Array.from(el().querySelectorAll('tbody td[data-col="due"]'));
    expect(due[0].querySelector('.pi-bolt')).toBeNull();
    expect(due[0].querySelector('.dc-l1')!.textContent?.trim()).toBe('-');
    expect(due[1].querySelector('.dc--overdue, .pi-exclamation-circle')).toBeNull();
    expect(due[1].textContent).not.toContain('Overdue');
    expect(due[2].querySelector('.pi-bolt')).not.toBeNull();
    const badges = Array.from(el().querySelectorAll('tbody td[data-col="priority"] .badge'));
    expect(badges[0].classList).toContain('muted');
    expect(badges[1].classList).toContain('muted');
    expect(badges[2].classList).not.toContain('muted');
  });

  it('shows Age as "12 d" with the created time, and how long a closed task took (B3)', async () => {
    await create(
      [
        aRow({ taskId: 1, createdAtUtc: '2026-10-02T12:00:00Z' }),
        aRow({
          taskId: 2,
          status: 'COMPLETED',
          statusLabel: 'Completed',
          createdAtUtc: '2026-09-01T12:00:00Z',
          closedAtUtc: '2026-09-13T12:00:00Z',
        }),
      ],
      ['age'],
    );
    const ages = Array.from(el().querySelectorAll<HTMLElement>('tbody td[data-col="age"] span'));
    expect(ages[0].textContent?.trim()).toBe('12 d');
    expect(ages[0].getAttribute('title')).toMatch(/^Created Oct 2, 2026/);
    expect(ages[1].textContent?.trim()).toBe('12 d');
    expect(ages[1].getAttribute('title')).toMatch(/^Took 12 d\. Created Sep 1, 2026/);
  });

  it('marks tasks assigned since the last visit with a "New" text badge, only when asked', async () => {
    const rows = [
      aRow({ taskId: 1, createdAtUtc: '2026-10-14T10:00:00Z' }),
      aRow({ taskId: 2, createdAtUtc: '2026-10-01T10:00:00Z' }),
      // Created long ago, handed to this person after the last visit: new to them.
      aRow({
        taskId: 3,
        createdAtUtc: '2026-09-01T10:00:00Z',
        assignedAtUtc: '2026-10-14T10:00:00Z',
      }),
      // Created recently but assigned before the last visit: already seen.
      aRow({
        taskId: 4,
        createdAtUtc: '2026-10-14T10:00:00Z',
        assignedAtUtc: '2026-10-05T10:00:00Z',
      }),
    ];
    await create(rows, ['ref', 'title']);
    expect(el().querySelector('[data-new-dot]')).toBeNull();
    fixture.componentRef.setInput('newSince', new Date('2026-10-10T00:00:00Z').getTime());
    fixture.detectChanges();
    const markers = el().querySelectorAll('[data-new-dot]');
    expect(markers.length).toBe(2);
    expect(markers[0].getAttribute('aria-label')).toBe('New');
    expect(markers[0].closest('tr')!.querySelector('.wt-title')).not.toBeNull();
  });

  it('shows the task type icon before the title, with the type name as its tooltip', async () => {
    await create([aRow({ taskTypeIconKey: 'cpu-2' })], ['ref', 'title']);
    const icon = cell('title').querySelector('[data-type-icon]')!;
    expect(icon.getAttribute('title')).toBe('Data Processing');
    expect(icon.querySelector('mf-task-type-icon svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('has no Actions column: Pod Work\'s "Assign to me" lives in the Assignee cell (#199)', async () => {
    await create([aRow({ assignedUser: undefined, status: 'NEW' })], ['ref', 'title', 'assignee'], {
      assignLink: true,
    });
    expect(el().querySelector('th.wt-actions, td.wt-actions')).toBeNull();
    expect(el().querySelectorAll('thead th').length).toBe(3);
  });

  it('keeps the "Scroll sideways" hint in the page but visible only when the table overflows', async () => {
    await create([aRow()], ['ref', 'title']);
    const hint = el().querySelector('[data-scroll-hint]')!;
    expect(hint.classList).not.toContain('wt-hint--show');
  });

  it('says "Due today" with a clock icon, "Tomorrow" in words, and shows later dates plainly (viewer zone)', async () => {
    await create(
      [
        aRow({ taskId: 1, isAsap: false, dueDate: '2026-10-14' }),
        aRow({ taskId: 2, isAsap: false, dueDate: '2026-10-15' }),
        aRow({ taskId: 3, isAsap: false, dueDate: '2026-10-16' }),
        aRow({
          taskId: 4,
          isAsap: false,
          dueDate: '2026-10-28',
          dueAtUtc: '2026-10-28T20:00:00Z',
        }),
      ],
      ['due'],
    );
    const dues = Array.from(el().querySelectorAll('tbody td[data-col="due"]'));
    const line = (n: number, l: 1 | 2) =>
      dues[n].querySelector(`.dc-l${l}`)?.textContent?.replace(/\s+/g, ' ').trim();
    expect(line(0, 1)).toBe('Oct 14');
    expect(line(0, 2)).toBe('Due today');
    expect(dues[0].querySelector('.pi-clock')).not.toBeNull();
    expect(dues[0].querySelector('.dc--today')).not.toBeNull();
    expect(line(1, 1)).toBe('Oct 15');
    expect(line(1, 2)).toBe('Tomorrow');
    expect(dues[1].querySelector('.pi')).toBeNull();
    expect(line(2, 1)).toBe('Oct 16');
    expect(line(2, 2)).toBe('In 2 days');
    expect(line(3, 1)).toBe('Oct 28');
    expect(dues[3].querySelector('.dc')!.getAttribute('title')).toBe('Oct 28, 2026, 3:00 PM CDT');
    expect(line(3, 2)).toBeUndefined();
  });

  it('mutes the due date of a closed task and never calls it overdue', async () => {
    await create(
      [aRow({ isAsap: false, isOverdue: false, dueDate: '2026-01-01', status: 'COMPLETED' })],
      ['due'],
    );
    expect(cell('due').querySelector('.dc-l1')!.textContent).toBe('Jan 1');
    expect(cell('due').textContent).not.toContain('Overdue');
    expect(cell('due').querySelector('.dc--closed')).not.toBeNull();
  });

  it('shows who the task is assigned to, "Unassigned" in muted italics, and inactive people', async () => {
    await create(
      [
        aRow({ taskId: 1 }),
        aRow({ taskId: 2, assignedUser: undefined }),
        aRow({ taskId: 3, assignedUser: { userId: 4, displayName: 'Sam K.', isActive: false } }),
      ],
      ['assignee', 'pod'],
    );
    const assignees = Array.from(el().querySelectorAll('tbody td[data-col="assignee"]'));
    expect(assignees[0].textContent?.trim()).toBe('Tariq Malik');
    expect(assignees[1].querySelector('.wt-unassigned')?.textContent).toBe('Unassigned');
    expect(assignees[2].textContent).toContain('Sam K.');
    expect(assignees[2].textContent).toContain('(inactive)');
  });

  it('shows priority and status badges with their labels', async () => {
    await create([aRow()], ['priority', 'status']);
    expect(cell('priority').querySelector('mf-priority-badge')?.textContent).toContain('Critical');
    expect(cell('status').querySelector('[data-status="IN_PROGRESS"]')?.textContent).toContain(
      'In Progress',
    );
  });

  it('shows the resolved count and the current step on one line, without a bar (A3)', async () => {
    await create([aRow()], ['progress']);
    const progress = cell('progress');
    expect(progress.textContent?.replace(/\s+/g, ' ').trim()).toBe('2 of 6 done · Dedup');
    expect(progress.querySelector('progress')).toBeNull();
    expect(progress.querySelector('.wt-progress')?.getAttribute('title')).toBe(
      '2 of 6 steps done. Current step: Dedup',
    );
  });

  it('makes the current step of an open task a link to the Workflow section at that step (M12.3)', async () => {
    await create([aRow()], ['progress']);
    const link = cell('progress').querySelector<HTMLAnchorElement>('[data-step-link]')!;
    expect(link.textContent?.trim()).toBe('Dedup');
    expect(link.getAttribute('href')).toBe('/tasks/1042?tab=workflow&step=903');
    expect(link.getAttribute('aria-label')).toBe(
      'Workflow progress: 2 of 6 done, current step Dedup. Open step.',
    );
  });

  it('shows the step as plain text on a closed task', async () => {
    await create([aRow({ status: 'COMPLETED', statusLabel: 'Completed' })], ['progress']);
    expect(cell('progress').querySelector('[data-step-link]')).toBeNull();
    expect(cell('progress').textContent).toContain('Dedup');
  });

  it('says when every step is resolved or the workflow has no steps', async () => {
    await create(
      [
        aRow({
          taskId: 1,
          workflow: {
            stepsTotal: 2,
            stepsResolved: 2,
            currentStepNumber: undefined,
            currentStepName: undefined,
          },
        }),
        aRow({
          taskId: 2,
          workflow: {
            stepsTotal: 0,
            stepsResolved: 0,
            currentStepNumber: undefined,
            currentStepName: undefined,
          },
        }),
      ],
      ['progress'],
    );
    const cells = Array.from(el().querySelectorAll('tbody td[data-col="progress"]'));
    expect(cells[0].textContent).toContain('All steps resolved');
    expect(cells[1].textContent?.trim()).toBe('-');
  });

  it('shows the age in days and optional columns', async () => {
    await create(
      [aRow({ createdAtUtc: '2026-10-04T12:00:00Z' })],
      ['age', 'client', 'project', 'type', 'created'],
    );
    expect(cell('age').textContent?.trim()).toBe('10 d');
    expect(cell('client').textContent?.trim()).toBe('Acme Corp');
    expect(cell('project').textContent?.trim()).toBe('-');
    expect(cell('type').textContent?.trim()).toBe('Data Processing');
    expect(cell('created').textContent?.trim()).toBe('Oct 4, 2026');
  });

  it('announces the sort state on the header and emits the field when a header is activated', async () => {
    await create([aRow()], ['priority', 'due', 'status'], { sort: 'due', dir: 'desc' });
    const header = (key: string) => el().querySelector(`th[data-col="${key}"]`)!;
    expect(header('due').getAttribute('aria-sort')).toBe('descending');
    expect(header('priority').getAttribute('aria-sort')).toBe('none');
    expect(header('title').getAttribute('aria-sort')).toBe('none');
    expect(header('matter')).toBeNull();

    const emitted: string[] = [];
    fixture.componentInstance.sortChange.subscribe((f) => emitted.push(f));
    header('priority').querySelector('button')!.click();
    header('status').querySelector('button')!.click();
    expect(emitted).toEqual(['priority', 'status']);
  });

  it('makes the Assignee and Client headers sort buttons with aria-sort', async () => {
    await create([aRow()], ['client', 'assignee', 'pod'], { sort: 'assignee', dir: 'asc' });
    const header = (key: string) => el().querySelector(`th[data-col="${key}"]`)!;
    expect(header('assignee').getAttribute('aria-sort')).toBe('ascending');
    expect(header('client').getAttribute('aria-sort')).toBe('none');
    expect(header('pod').getAttribute('aria-sort')).toBeNull();

    const emitted: string[] = [];
    fixture.componentInstance.sortChange.subscribe((f) => emitted.push(f));
    header('client').querySelector('button')!.click();
    header('assignee').querySelector('button')!.click();
    expect(emitted).toEqual(['client', 'assignee']);
  });

  it('has no sort indicator under the default order', async () => {
    await create([aRow()], ['priority', 'due']);
    const sorts = Array.from(el().querySelectorAll('th[aria-sort]')).map((h) =>
      h.getAttribute('aria-sort'),
    );
    expect(sorts.every((s) => s === 'none')).toBe(true);
  });

  it('shows loading as eight skeleton rows under the headers, with one status row, and marks the table busy (G4)', async () => {
    await create([], ['ref', 'title', 'status'], { state: 'loading' });
    expect(el().querySelectorAll('thead th').length).toBe(3);
    const skeletons = el().querySelectorAll('tbody tr[data-skeleton]');
    expect(skeletons.length).toBe(8);
    expect(skeletons[0].getAttribute('aria-hidden')).toBe('true');
    // The cells carry the real columns, so the fixed widths apply.
    expect(
      Array.from(skeletons[0].querySelectorAll('td')).map((td) => td.getAttribute('data-col')),
    ).toEqual(['ref', 'title', 'status']);
    expect(el().querySelectorAll('tbody [data-loading]').length).toBe(1);
    expect(el().querySelector('tbody [data-loading]')!.textContent).toContain('Loading tasks');
    expect(el().querySelector('table')!.getAttribute('aria-busy')).toBe('true');
  });

  it('puts the whole title in the tooltip in both densities (#196)', async () => {
    await create([aRow()], ['ref', 'title']);
    const link = () => cell('title').querySelector<HTMLAnchorElement>('a.wt-title')!;
    expect(link().getAttribute('title')).toBe('Process Smith custodians');
    expect(el().querySelector('table')!.classList).not.toContain('wt--compact');

    fixture.componentRef.setInput('density', 'compact');
    fixture.detectChanges();
    expect(el().querySelector('table')!.classList).toContain('wt--compact');
    expect(link().getAttribute('title')).toBe('Process Smith custodians');
  });

  it('on a narrow box drops the optional columns by the one rule and keeps Ref (BUG-14, #196, #201)', async () => {
    await create([aRow()], ['ref', 'title', 'priority', 'due', 'status', 'pod', 'age']);
    const keys = () => Array.from(el().querySelectorAll('th')).map((th) => th.textContent?.trim());
    const inner = fixture.componentInstance as unknown as {
      boxWidth: { set(n: number): void };
    };
    expect(keys()).toEqual(['Ref', 'Title', 'Priority', 'Pod', 'Due', 'Status', 'Age']);
    // 112 + 112 + 136 + 140 + 140 + 64 = 704 px of columns: 904 px leaves the Title 200 px; below it Age drops first, then Pod.
    inner.boxWidth.set(904);
    fixture.detectChanges();
    expect(keys()).toEqual(['Ref', 'Title', 'Priority', 'Pod', 'Due', 'Status', 'Age']);
    inner.boxWidth.set(900);
    fixture.detectChanges();
    expect(keys()).toEqual(['Ref', 'Title', 'Priority', 'Pod', 'Due', 'Status']);
    inner.boxWidth.set(760);
    fixture.detectChanges();
    expect(keys()).toEqual(['Ref', 'Title', 'Priority', 'Due', 'Status']);
    expect(el().querySelector('table')!.classList).not.toContain('wt--narrow');

    inner.boxWidth.set(664);
    fixture.detectChanges();
    expect(keys()).toEqual(['Ref', 'Title', 'Priority', 'Due', 'Status']);
    expect(el().querySelector('table')!.classList).toContain('wt--narrow');
    expect(el().querySelector('[data-sub-task]')).toBeNull();
  });

  it('has a colgroup with one col per shown column; the Title has no width and colWidths sets the others (#200)', async () => {
    await create([aRow()], ['ref', 'title', 'due', 'status']);
    const table = el().querySelector('table')!;
    const cols = () => Array.from(table.querySelectorAll('colgroup > col')) as HTMLElement[];
    expect(cols().map((c) => c.getAttribute('data-col'))).toEqual([
      'ref',
      'title',
      'due',
      'status',
    ]);
    expect(cols()[1].style.width).toBe('');
    expect(cols()[2].style.width).toBe('var(--w-due)');
    // The header, the body and the colgroup have the same number of columns.
    expect(table.querySelectorAll('thead th').length).toBe(cols().length);
    expect(table.querySelectorAll('tbody tr[data-task] td').length).toBe(cols().length);
    const px = (name: string) => table.style.getPropertyValue(name);
    expect(px('--w-due')).toBe(`${136 / 14}rem`);
    expect(px('--w-title')).toBe('');

    fixture.componentRef.setInput('colWidths', { due: 9, title: 40, status: 2 });
    fixture.detectChanges();
    expect(px('--w-due')).toBe('9rem');
    // Clamped to the column's minimum (112 px) and never set for the Title.
    expect(px('--w-status')).toBe(`${112 / 14}rem`);
    expect(px('--w-title')).toBe('');
    expect(parseFloat(table.style.getPropertyValue('--wt-min'))).toBeGreaterThan(20);
  });

  it('shows the error and the empty list as a row of the body, with the headers staying', async () => {
    await create([], ['ref', 'title'], { state: 'error' });
    expect(el().querySelector('thead th')).not.toBeNull();
    expect(el().querySelector('tbody [data-error]')).not.toBeNull();

    fixture.componentRef.setInput('state', 'ready');
    fixture.componentRef.setInput('emptyText', 'No tasks here.');
    fixture.detectChanges();
    expect(el().querySelector('tbody [data-empty="none"]')!.textContent).toContain(
      'No tasks here.',
    );
    fixture.componentRef.setInput('filtered', true);
    fixture.detectChanges();
    expect(el().querySelector('tbody [data-empty="filtered"]')!.textContent).toContain(
      'No tasks match these filters',
    );
  });

  it('keeps the old rows, dimmed, while refreshing', async () => {
    await create([aRow()], ['ref', 'title'], { state: 'loading' });
    expect(el().querySelector('tbody [data-loading]')).toBeNull();
    expect(el().querySelectorAll('tbody tr').length).toBe(1);
    expect(el().querySelector('.wt-wrap')!.classList).toContain('wt-dim');
  });

  it('shows the "Assign to me" link-button only in the Assignee cell of unassigned open rows', async () => {
    await create(
      [
        aRow({ taskId: 1, assignedUser: undefined, status: 'NEW' }),
        aRow({ taskId: 2 }),
        aRow({ taskId: 3, assignedUser: undefined, status: 'CANCELLED' }),
      ],
      ['ref', 'title', 'assignee'],
      { assignLink: true },
      ['Task.Assign'],
    );
    const buttons = el().querySelectorAll<HTMLButtonElement>('tbody [data-assign-link]');
    expect(buttons.length).toBe(1);
    expect(buttons[0].getAttribute('aria-label')).toBe('Assign TSK-1042 to me');
    expect(buttons[0].closest('td')!.getAttribute('data-col')).toBe('assignee');
  });

  it('has a caption for screen readers and a real table structure', async () => {
    await create([aRow()], ['ref', 'title'], { caption: 'Task Queue' });
    expect(el().querySelector('caption')!.textContent?.trim()).toBe('Task Queue');
    expect(el().querySelectorAll('th[scope="col"]').length).toBe(2);
  });

  describe('Due-sorted dividers (#232)', () => {
    const rows = [
      aRow({ taskId: 1, taskNumber: 'TSK-1' }),
      aRow({ taskId: 2, taskNumber: 'TSK-2' }),
      aRow({ taskId: 3, taskNumber: 'TSK-3' }),
    ];
    const counts = {
      asap: 51,
      overdue: 101,
      today: 0,
      tomorrow: 0,
      thisWeek: 0,
      later: 0,
      closed: 0,
    };

    it('puts a divider before each bucket with the whole count and "continued", spanning every shown column', async () => {
      await create(rows, ['ref', 'title', 'due', 'status'], {
        sort: 'due',
        dir: 'asc',
        groupBuckets: counts,
        groupOffset: 50,
      });
      const headers = Array.from(el().querySelectorAll('tr[mfGroupHeader]'));
      expect(headers.map((h) => h.getAttribute('data-group'))).toEqual(['asap', 'overdue']);
      expect(headers[0].textContent).toContain('ASAP (51 tasks), continued');
      expect(headers[1].textContent).toContain('Overdue (101 tasks)');
      expect(headers[0].querySelector('th')!.getAttribute('colspan')).toBe('4');
      // The divider rows are not task rows: the key model and the row count only see tr[data-task].
      expect(el().querySelectorAll('tbody tr[data-task]')).toHaveLength(3);
    });

    it('mirrors the dividers when descending', async () => {
      await create(rows, ['title', 'due'], {
        sort: 'due',
        dir: 'desc',
        groupDir: 'desc',
        groupBuckets: { ...counts, asap: 1, overdue: 1, later: 1 },
      });
      const keys = Array.from(el().querySelectorAll('tr[mfGroupHeader]')).map((h) =>
        h.getAttribute('data-group'),
      );
      expect(keys).toEqual(['later', 'overdue', 'asap']);
    });

    it('names where ASAP goes in the Due header tooltip, only while sorted by Due', async () => {
      await create(rows, ['title', 'due'], { sort: 'due', dir: 'asc' });
      const btn = () => el().querySelector<HTMLElement>('th[data-col="due"] button.wt-sort')!;
      expect(btn().getAttribute('title')).toBe('Due (ASAP first)');
      fixture.componentRef.setInput('dir', 'desc');
      fixture.detectChanges();
      expect(btn().getAttribute('title')).toBe('Due (ASAP last)');
      fixture.componentRef.setInput('sort', 'priority');
      fixture.detectChanges();
      expect(btn().getAttribute('title')).toBeNull();
    });
  });

  describe('inline editing', () => {
    it('shows plain values when the user has no permission to change them', async () => {
      await create([aRow()], ['priority', 'assignee', 'status']);
      expect(el().querySelector('mf-row-edit')).toBeNull();
      expect(el().querySelector('[data-inline-trigger]')).toBeNull();
    });

    it('turns Status, Priority and Assignee into editors for a user who may change them', async () => {
      await create([aRow()], ['priority', 'assignee', 'status'], {}, [
        'Task.SetPriority',
        'Task.Assign',
        'Task.ChangeStatus',
      ]);
      expect(cell('priority').querySelector('[data-inline-trigger]')).not.toBeNull();
      expect(cell('assignee').querySelector('[data-inline-trigger]')).not.toBeNull();
      expect(cell('status').querySelector('[data-inline-trigger]')).not.toBeNull();
    });

    it('edits only what the permissions allow and never a closed task assignee or priority', async () => {
      await create(
        [aRow({ status: 'COMPLETED', statusLabel: 'Completed' })],
        ['priority', 'assignee', 'status'],
        {},
        ['Task.SetPriority', 'Task.Assign', 'Task.Reopen'],
      );
      expect(cell('priority').querySelector('[data-inline-trigger]')).toBeNull();
      expect(cell('assignee').querySelector('[data-inline-trigger]')).toBeNull();
      expect(cell('status').querySelector('[data-inline-trigger]')).not.toBeNull();
    });
  });

  it('shows the closed date in the viewer zone with the time in the tooltip, and a dash for open tasks (C1)', async () => {
    await create(
      [
        aRow({ taskId: 1, status: 'COMPLETED', closedAtUtc: '2026-10-17T02:30:00Z' }),
        aRow({ taskId: 2, closedAtUtc: undefined }),
      ],
      ['closed', 'status'],
    );
    const cells = Array.from(el().querySelectorAll('tbody td[data-col="closed"]'));
    // 02:30 UTC is still Oct 16 in Chicago.
    expect(cells[0].textContent?.trim()).toBe('Oct 16, 2026');
    expect(cells[0].querySelector('[title]')!.getAttribute('title')).toBe(
      'Oct 16, 2026, 9:30 PM CDT',
    );
    expect(cells[1].textContent?.trim()).toBe('-');
  });

  describe('keyboard (#181)', () => {
    // The switch is stored in localStorage; do not leave it off for the specs that follow.
    afterEach(() => localStorage.clear());
    const key = (target: Element, k: string, init: KeyboardEventInit = {}) => {
      const event = new KeyboardEvent('keydown', {
        key: k,
        bubbles: true,
        cancelable: true,
        ...init,
      });
      target.dispatchEvent(event);
      return event;
    };
    const rows = [aRow({ taskId: 1 }), aRow({ taskId: 2 }), aRow({ taskId: 3 })];
    const title = (id: number) =>
      el().querySelector<HTMLElement>(`a.wt-title[data-task-id="${id}"]`)!;
    const perms: Permission[] = ['Task.SetPriority', 'Task.ChangeStatus'];

    it('j, k and the arrows move between the title links; the ends stay put', async () => {
      await create(rows, ['priority', 'status'], { from: 'my-work' }, perms);
      title(1).focus();
      key(title(1), 'j');
      expect(document.activeElement).toBe(title(2));
      key(title(2), 'ArrowDown');
      expect(document.activeElement).toBe(title(3));
      key(title(3), 'j');
      expect(document.activeElement).toBe(title(3));
      key(title(3), 'k');
      expect(document.activeElement).toBe(title(2));
      key(title(2), 'ArrowUp');
      expect(document.activeElement).toBe(title(1));
      key(title(1), 'ArrowUp');
      expect(document.activeElement).toBe(title(1));
    });

    it('skips rows of a collapsed group (hidden rows)', async () => {
      await create(rows, ['status']);
      el().querySelector('tr[data-task]:nth-of-type(2)')?.setAttribute('hidden', '');
      title(1).focus();
      key(title(1), 'j');
      expect(document.activeElement).toBe(title(3));
      key(title(3), 'k');
      expect(document.activeElement).toBe(title(1));
    });

    it('keeps the link carrying from= (Enter is the link itself)', async () => {
      await create(rows, ['status'], { from: 'my-work' });
      expect(title(1).getAttribute('href')).toBe('/tasks/1?from=my-work');
    });

    it('s and p click the Status and Priority triggers of the row; p does nothing without the permission', async () => {
      await create(rows, ['priority', 'status'], {}, ['Task.ChangeStatus']);
      const status = el().querySelector<HTMLElement>(
        'tr[data-task="TSK-1042"] td[data-col="status"] [data-inline-trigger]',
      )!;
      const click = vi.spyOn(status, 'click');
      title(2).focus();
      expect(key(title(1), 's').defaultPrevented).toBe(true);
      expect(click).toHaveBeenCalled();
      expect(key(title(1), 'p').defaultPrevented).toBe(false);
    });

    it('character keys do nothing while the shortcuts are off, arrows still work', async () => {
      await create(rows, ['status'], {}, perms);
      TestBed.inject(KeyboardShortcuts).setEnabled(false);
      title(1).focus();
      expect(key(title(1), 'j').defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(title(1));
      key(title(1), 'ArrowDown');
      expect(document.activeElement).toBe(title(2));
    });

    it('leaves keys typed in a text field alone, and ignores Ctrl+J', async () => {
      await create(rows, ['status']);
      const input = document.createElement('input');
      cell('title').appendChild(input);
      expect(key(input, 'j').defaultPrevented).toBe(false);
      expect(key(title(1), 'j', { ctrlKey: true }).defaultPrevented).toBe(false);
    });

    it('waits while a g is pending (g then p is Pod Work)', async () => {
      await create(rows, ['priority'], {}, perms);
      const service = TestBed.inject(KeyboardShortcuts);
      service.handleGo(new KeyboardEvent('keydown', { key: 'g' }));
      expect(key(title(1), 'p').defaultPrevented).toBe(false);
    });
  });
});
