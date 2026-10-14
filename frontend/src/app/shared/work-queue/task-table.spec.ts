import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TaskQueueRow } from '../../api/generated/api-client';
import { aRow, provideClock, provideLookups } from './work-queue-testing';
import { TaskTable } from './task-table';

describe('TaskTable', () => {
  let fixture: ComponentFixture<TaskTable>;
  const el = () => fixture.nativeElement as HTMLElement;

  async function create(
    rows: TaskQueueRow[],
    columns: string[],
    inputs: Record<string, unknown> = {},
  ) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        ...provideLookups(),
        ...provideClock('2026-10-14T15:00:00Z', 'America/Chicago'),
      ],
    });
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
    await create([aRow()], ['ref', 'title', 'matter']);

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

  it('marks a sensitive matter with an icon that has a text alternative', async () => {
    await create([aRow({ matterIsSensitive: true })], ['matter']);
    expect(cell('matter').querySelector('[aria-label="Sensitive matter"]')).not.toBeNull();
  });

  it('always shows Ref and Title, even when the saved columns omit them', async () => {
    await create([aRow()], ['status']);
    const headers = Array.from(el().querySelectorAll('th')).map((th) => th.textContent?.trim());
    expect(headers).toEqual(['Ref', 'Title', 'Status']);
  });

  it('shows ASAP as a labelled pill and never as overdue', async () => {
    await create([aRow({ isAsap: true, isOverdue: false })], ['due']);
    const pill = cell('due').querySelector('.wt-asap')!;
    expect(pill.textContent?.trim()).toBe('ASAP');
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

  it('shows "Due soon" with a clock icon and a timed due date in the viewer zone', async () => {
    await create(
      [
        aRow({ taskId: 1, isAsap: false, dueDate: '2026-10-15' }),
        aRow({
          taskId: 2,
          isAsap: false,
          dueDate: '2026-10-28',
          dueAtUtc: '2026-10-28T20:00:00Z',
        }),
      ],
      ['due'],
    );
    const dues = Array.from(el().querySelectorAll('tbody td[data-col="due"]'));
    expect(dues[0].textContent).toContain('Due soon');
    expect(dues[0].querySelector('.pi-clock')).not.toBeNull();
    expect(dues[1].textContent).toContain('Oct 28, 2026 3:00 PM CDT');
    expect(dues[1].textContent).not.toContain('Due soon');
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

  it('shows the current step and the resolved count with an accessible progress bar', async () => {
    await create([aRow()], ['progress']);
    const progress = cell('progress');
    expect(progress.textContent).toContain('Step 3/6: Dedup');
    expect(progress.textContent).toContain('2 of 6 resolved');
    expect(progress.querySelector('progress')?.getAttribute('aria-label')).toBe(
      '2 of 6 steps resolved',
    );
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
    expect(cell('age').textContent?.trim()).toBe('10d');
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
    expect(header('title').getAttribute('aria-sort')).toBeNull();

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

  it('shows five skeleton rows while loading and marks the table busy', async () => {
    await create([], ['ref', 'title'], { loading: true });
    expect(el().querySelectorAll('tbody tr.wt-skeleton').length).toBe(5);
    expect(el().querySelector('table')!.getAttribute('aria-busy')).toBe('true');
  });

  it('keeps the old rows, dimmed, while refreshing', async () => {
    await create([aRow()], ['ref', 'title'], { loading: true });
    expect(el().querySelectorAll('tbody tr.wt-skeleton').length).toBe(0);
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
    expect(buttons[0].getAttribute('aria-label')).toBe('Assign TSK-1042 to me');

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
});
