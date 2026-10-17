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
    expect(matter.getAttribute('title')).toBe('Merger Review');
    expect(cell('matter').querySelector('button')).toBeNull();
    expect(cell('matter').querySelector('[aria-label="Sensitive matter"]')).toBeNull();
  });

  it('shows the matter reference as plain text, not a link, without Matter.View (BUG-7)', async () => {
    await create([aRow()], ['ref', 'title', 'matter'], {}, ['Task.View']);
    expect(cell('matter').querySelector('a')).toBeNull();
    expect(cell('matter').querySelector('span.mf-ref')!.textContent?.trim()).toBe('00343-00012');
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
    const pill = cell('due').querySelector('.wt-asap')!;
    expect(pill.textContent?.trim()).toBe('ASAP');
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
    expect(due.textContent).toContain('Oct 10, 2026');
    expect(due.textContent).toContain('Overdue 4d');
    expect(due.querySelector('.pi-exclamation-circle')).not.toBeNull();
    expect(el().querySelector('tbody tr')!.classList).toContain('wt-row--overdue');
  });

  it('keeps the due date on one line: date, a dot and the overdue text (UXR-09)', async () => {
    await create(
      [aRow({ isAsap: false, isOverdue: true, dueDate: '2026-10-10', status: 'IN_PROGRESS' })],
      ['due'],
    );
    expect(cell('due').textContent!.replace(/\s+/g, ' ').trim()).toBe('Oct 10, 2026 · Overdue 4d');
    expect(cell('due').querySelector('.wt-due')).not.toBeNull();
  });

  it('gives the title its full text as a tooltip because the cell shows at most two lines', async () => {
    await create([aRow({ title: 'A very long title '.repeat(10) })], ['ref', 'title']);
    const link = cell('title').querySelector('a.wt-title')!;
    expect(link.getAttribute('title')).toBe('A very long title '.repeat(10));
  });

  it('leaves out the client and matter line when the page already says it (hideContext, UXR4-02)', async () => {
    await create([aRow()], ['ref', 'title'], { hideContext: true });
    expect(cell('title').querySelector('[data-title-context]')).toBeNull();
  });

  it('puts the New marker on the line under the title, so it never cuts the title (UXR4-02)', async () => {
    await create([aRow({ assignedAtUtc: '2026-10-14T10:00:00Z' })], ['ref', 'title'], {
      newSince: Date.parse('2026-10-13T00:00:00Z'),
    });
    const marker = cell('title').querySelector('[data-new-marker]')!;
    expect(marker.textContent?.trim()).toBe('New');
    expect(marker.closest('a')).toBeNull();
    expect(marker.parentElement!.classList).toContain('wt-subline');
    // The same fact as a dot in the Ref cell (A5), so it shows when the title is long.
    const dot = cell('ref').querySelector('[data-new-dot]')!;
    expect(dot.getAttribute('aria-label')).toBe('New');
  });

  it('folds Workflow progress under the title and drops Matter and Project when the box is narrow (UXR4-02)', async () => {
    await create([aRow()], ['ref', 'title', 'matter', 'project', 'progress', 'due', 'status']);
    const keys = () => Array.from(el().querySelectorAll('th')).map((th) => th.textContent?.trim());
    expect(keys()).toEqual([
      'Ref',
      'Title',
      'Matter',
      'Project',
      'Workflow progress',
      'Due',
      'Status',
    ]);
    expect(cell('title').querySelector('[data-title-progress]')).toBeNull();

    (fixture.componentInstance as unknown as { boxWidth: { set(n: number): void } }).boxWidth.set(
      1000,
    );
    fixture.detectChanges();
    expect(keys()).toEqual(['Ref', 'Title', 'Matter', 'Project', 'Due', 'Status']);
    expect(cell('title').querySelector('[data-title-progress]')!.textContent).toContain(
      '2 of 6 done · Dedup',
    );
    (fixture.componentInstance as unknown as { boxWidth: { set(n: number): void } }).boxWidth.set(
      780,
    );
    fixture.detectChanges();
    expect(keys()).toEqual(['Ref', 'Title', 'Due', 'Status']);
  });

  it('shows the client and matter name in a muted second line under the title', async () => {
    await create([aRow()], ['ref', 'title']);
    const sub = cell('title').querySelector('[data-title-context]')!;
    // No Matter column: the reference leads the line, in monospace (A2), as the tooltip says in full.
    const text = () => sub.textContent?.replace(/\s+/g, ' ').trim();
    expect(text()).toBe('00343-00012 · Acme Corp · Merger Review');
    expect(sub.getAttribute('title')).toBe('00343-00012 · Acme Corp · Merger Review');
    expect(sub.querySelector('.wt-mono')?.textContent).toBe('00343-00012');
    expect(sub.querySelector('a')).toBeNull();
  });

  it('links the reference in the line under the title only with Matter.View, and leaves it out when the Matter column shows it', async () => {
    await create([aRow()], ['ref', 'title', 'matter']);
    expect(cell('title').querySelector('[data-sub-ref]')).toBeNull();
    expect(cell('title').querySelector('[data-title-context]')?.getAttribute('title')).toBe(
      'Acme Corp · Merger Review',
    );
  });

  it('links the reference under the title to the Matter with Matter.View (A2, BUG-7)', async () => {
    await create([aRow()], ['ref', 'title'], {}, ['Matter.View']);
    const link = cell('title').querySelector<HTMLAnchorElement>('a[data-sub-ref]')!;
    expect(link.getAttribute('href')).toBe('/matters/7');
    expect(link.classList).toContain('wt-mono');
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
    expect(due[0].textContent?.trim()).toBe('-');
    expect(due[1].querySelector('.wt-due--overdue, .pi-exclamation-circle')).toBeNull();
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
    expect(el().querySelector('[data-new-marker]')).toBeNull();
    fixture.componentRef.setInput('newSince', new Date('2026-10-10T00:00:00Z').getTime());
    fixture.detectChanges();
    const markers = el().querySelectorAll('[data-new-marker]');
    expect(markers.length).toBe(2);
    expect(markers[0].textContent?.trim()).toBe('New');
    expect(markers[0].closest('tr')!.querySelector('.wt-title')).not.toBeNull();
  });

  it('shows the task type icon before the title, with the type name as its tooltip', async () => {
    await create([aRow({ taskTypeIconKey: 'cpu-2' })], ['ref', 'title']);
    const icon = cell('title').querySelector('[data-type-icon]')!;
    expect(icon.getAttribute('title')).toBe('Data Processing');
    expect(icon.querySelector('mf-task-type-icon svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('marks the Actions column so it can stay visible while the table scrolls', async () => {
    await create([aRow({ assignedUser: undefined, status: 'NEW' })], ['ref', 'title'], {
      showAssign: true,
    });
    expect(el().querySelector('th.wt-actions')).not.toBeNull();
    expect(el().querySelector('td.wt-actions .wt-action')).not.toBeNull();
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
    const text = (n: number) => dues[n].textContent!.replace(/\s+/g, ' ').trim();
    expect(text(0)).toBe('Oct 14, 2026 · Due today');
    expect(dues[0].querySelector('.pi-clock')).not.toBeNull();
    expect(dues[0].querySelector('.wt-due--soon')).not.toBeNull();
    expect(text(1)).toBe('Oct 15, 2026 · Tomorrow');
    expect(dues[1].querySelector('.pi')).toBeNull();
    expect(text(2)).toBe('Oct 16, 2026');
    expect(text(3)).toBe('Oct 28, 2026, 3:00 PM CDT');
  });

  it('mutes the due date of a closed task and never calls it overdue', async () => {
    await create(
      [aRow({ isAsap: false, isOverdue: false, dueDate: '2026-01-01', status: 'COMPLETED' })],
      ['due'],
    );
    expect(cell('due').textContent).toContain('Jan 1, 2026');
    expect(cell('due').textContent).not.toContain('Overdue');
    expect(cell('due').querySelector('.wt-due--closed')).not.toBeNull();
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

  it('puts the whole title in the tooltip, and in Compact the line under it, the task number and the progress as well (M3, M3-Compact)', async () => {
    await create([aRow()], ['ref', 'title']);
    const link = () => cell('title').querySelector<HTMLAnchorElement>('a.wt-title')!;
    expect(link().getAttribute('title')).toBe('Process Smith custodians');
    expect(el().querySelector('table')!.classList).not.toContain('wt--compact');

    fixture.componentRef.setInput('density', 'compact');
    fixture.detectChanges();
    expect(el().querySelector('table')!.classList).toContain('wt--compact');
    expect(link().getAttribute('title')).toBe(
      'Process Smith custodians\nTSK-1042 · 00343-00012 · Acme Corp · Merger Review',
    );
  });

  it('on a tablet moves the task number under the title and lets the due cell wrap (BUG-14)', async () => {
    await create([aRow()], ['ref', 'title', 'priority', 'due', 'status', 'pod', 'age']);
    const keys = () => Array.from(el().querySelectorAll('th')).map((th) => th.textContent?.trim());
    const inner = fixture.componentInstance as unknown as {
      boxWidth: { set(n: number): void };
      tablet: { set(v: boolean): void };
    };
    inner.boxWidth.set(900);
    inner.tablet.set(true);
    fixture.detectChanges();
    expect(keys()).toEqual(['Title', 'Priority', 'Due', 'Status']);
    expect(cell('title').querySelector('[data-sub-task]')!.textContent).toBe('TSK-1042');
    expect(el().querySelector('table')!.classList).not.toContain('wt--narrow');

    inner.boxWidth.set(664);
    fixture.detectChanges();
    expect(el().querySelector('table')!.classList).toContain('wt--narrow');
    expect(cell('title').querySelector('[data-title-context]')!.getAttribute('title')).toBe(
      'TSK-1042 · 00343-00012 · Acme Corp · Merger Review',
    );

    // A phone keeps the sideways-scrolling table until the cards of M11: the number stays in its own column.
    inner.tablet.set(false);
    inner.boxWidth.set(343);
    fixture.detectChanges();
    expect(keys()[0]).toBe('Ref');
    expect(el().querySelector('[data-sub-task]')).toBeNull();
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

  it('offers "Assign to me" only on unassigned open rows', async () => {
    await create(
      [
        aRow({ taskId: 1, assignedUser: undefined, status: 'NEW' }),
        aRow({ taskId: 2 }),
        aRow({ taskId: 3, assignedUser: undefined, status: 'CANCELLED' }),
      ],
      ['ref', 'title'],
      { showAssign: true },
    );
    const buttons = el().querySelectorAll<HTMLButtonElement>('tbody .wt-action');
    expect(buttons.length).toBe(1);
    expect(buttons[0].getAttribute('aria-label')).toBe('Assign to me, TSK-1042');

    const emitted: number[] = [];
    fixture.componentInstance.assignToMe.subscribe((r) => emitted.push(r.taskId));
    buttons[0].click();
    expect(emitted).toEqual([1]);
  });

  it('has a caption for screen readers and a real table structure', async () => {
    await create([aRow()], ['ref', 'title'], { caption: 'Task Queue' });
    expect(el().querySelector('caption')!.textContent?.trim()).toBe('Task Queue');
    expect(el().querySelectorAll('th[scope="col"]').length).toBe(2);
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
