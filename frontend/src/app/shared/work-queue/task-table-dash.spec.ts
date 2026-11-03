import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TaskQueueRow, UsersLookupClient } from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../core/auth/auth-testing';
import { Permission } from '../../core/auth/permissions';
import { aRow, provideClock, provideLookups } from './work-queue-testing';
import { TaskTable } from './task-table';

/** The Dashboard Summary cells of the shared task table (epic #1063, decision AS items 2 to 4). */
describe('TaskTable, Dashboard Summary cells', () => {
  let fixture: ComponentFixture<TaskTable>;
  const el = () => fixture.nativeElement as HTMLElement;
  const cell = (key: string) => el().querySelector(`tbody td[data-col="${key}"]`) as HTMLElement;

  async function create(rows: TaskQueueRow[], columns: string[], permissions: Permission[] = []) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        ...provideLookups(),
        ...provideClock('2026-11-03T15:42:00Z', 'America/New_York'),
        { provide: UsersLookupClient, useValue: { lookupUsers: () => Promise.resolve([]) } },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    fixture = TestBed.createComponent(TaskTable);
    fixture.componentRef.setInput('rows', rows);
    fixture.componentRef.setInput('columns', columns);
    fixture.componentRef.setInput('dash', true);
    fixture.componentRef.setInput('reorderable', true);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('shows the Type as the icon only, named by the type (tooltip and accessible name, keyboard reachable)', async () => {
    await create([aRow({ taskTypeName: 'Data Processing' })], ['ref', 'typeIcon', 'title']);
    const heads = Array.from(el().querySelectorAll('thead tr:first-child th')).map((th) =>
      th.textContent?.trim(),
    );
    expect(heads).toEqual(['Ref', 'Type', 'Title']);
    const icon = cell('typeIcon').querySelector('[data-type-icon-only]') as HTMLElement;
    expect(icon.getAttribute('role')).toBe('img');
    expect(icon.getAttribute('aria-label')).toBe('Task type: Data Processing');
    expect(icon.getAttribute('tabindex')).toBe('0');
    // The name is not repeated as visible text.
    expect(cell('typeIcon').textContent?.trim()).toBe('');
    expect(cell('typeIcon').querySelector('[data-type-chip]')).not.toBeNull();
  });

  it('shows the Due as the date and +9d on one line, red, with the words in the name', async () => {
    await create(
      [aRow({ isAsap: false, dueAtUtc: '2026-10-25T14:00:00Z', dueDate: '2026-10-25' })],
      ['ref', 'title', 'due'],
    );
    const due = cell('due');
    expect(due.querySelector('[data-due-date]')?.textContent?.trim()).toBe('10/25 10:00 AM');
    expect(due.querySelector('[data-due-suffix]')?.textContent?.trim()).toBe('+9d');
    expect(due.querySelector('.ds')?.classList.contains('ds--over')).toBe(true);
    expect(due.textContent).toContain('9 days overdue');
    expect(due.querySelector('[data-due-suffix-cell]')?.getAttribute('title')).toContain(
      '9 days overdue',
    );
    // One line: no second-line element of the standard cell.
    expect(due.querySelector('.dc-l2')).toBeNull();
  });

  it('has no suffix for a task due tomorrow', async () => {
    await create(
      [aRow({ isAsap: false, dueAtUtc: '2026-11-04T15:00:00Z', dueDate: '2026-11-04' })],
      ['ref', 'title', 'due'],
    );
    expect(cell('due').querySelector('[data-due-suffix]')).toBeNull();
  });

  it('draws the word Unassigned and an Assign control for an unassigned task when the viewer may assign', async () => {
    await create(
      [aRow({ assignedUser: undefined })],
      ['ref', 'title', 'assignee'],
      ['Task.Assign', 'Task.View'],
    );
    const c = cell('assignee');
    expect(c.querySelector('[data-dash-assign]')).not.toBeNull();
    expect(c.textContent).toContain('Unassigned');
    const button = c.querySelector('[data-inline-trigger]') as HTMLElement;
    expect(button.textContent?.trim()).toBe('Assign');
    expect(button.getAttribute('aria-label')).toBe('Assign TSK-1042');
  });

  it('shows only the word Unassigned without the assign permission (no Assign control)', async () => {
    await create([aRow({ assignedUser: undefined })], ['ref', 'title', 'assignee'], ['Task.View']);
    const c = cell('assignee');
    expect(c.querySelector('[data-inline-trigger]')).toBeNull();
    expect(c.textContent?.trim()).toBe('Unassigned');
  });

  it('shows how long an unassigned task has waited in the Unassigned for column', async () => {
    await create(
      [aRow({ assignedUser: undefined, ['unassignedForMinutes']: 168 } as Partial<TaskQueueRow>)],
      ['ref', 'title', 'assignee', 'unassignedFor'],
      ['Task.View'],
    );
    expect(cell('unassignedFor').textContent?.trim()).toBe('2 h 48 m');
    const heads = Array.from(el().querySelectorAll('thead tr:first-child th')).map((th) =>
      th.textContent?.trim(),
    );
    expect(heads).toContain('Unassigned for');
  });
});
