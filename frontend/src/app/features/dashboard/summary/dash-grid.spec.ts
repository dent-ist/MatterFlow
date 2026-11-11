import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { DashboardSummary, TaskQueueClient, TaskQueueRow } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../../core/auth/auth-testing';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import {
  aRow,
  pageOf,
  provideLookups,
  provideQueueChoices,
} from '../../../shared/work-queue/work-queue-testing';
import { DashGrid } from './dash-grid';

const OPEN = 'status=NEW&status=IN_PROGRESS&status=ON_HOLD';
const count = (n: number, query: string) => ({ count: n, query });
const summary = {
  period: { days: 30, from: '2026-09-15', to: '2026-10-14', key: '30d' },
  open: count(128, OPEN),
  unassigned: count(2, `${OPEN}&unassigned=true`),
  overdue: count(0, `${OPEN}&overdue=true`),
  onHold: count(0, 'status=ON_HOLD'),
  scope: { scope: 'all', podIds: [], unassignedNoPod: 0 },
} as unknown as DashboardSummary;

const first = aRow({ taskId: 21, taskNumber: 'TSK-21', assignedUser: undefined, rowVersion: 'A' });
const second = aRow({ taskId: 24, taskNumber: 'TSK-24', assignedUser: undefined, rowVersion: 'A' });
const person = { userId: 1, displayName: 'Test User', isActive: true };

/** `onRowChange` is protected (the work list calls it); the spec drives it the way the inline Assign pick does. */
interface Driver {
  onRowChange(row: TaskQueueRow): void;
  rows(): TaskQueueRow[];
  total(): number;
}

async function open(card: 'unassigned' | null) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideFakeMe(new FakeMeApi(withPermissions('Task.View', 'Task.Assign', 'Dashboard.View'))),
      { provide: TaskQueueClient, useValue: { getTaskQueue: () => of(pageOf([first, second])) } },
      ...provideLookups(),
      ...provideQueueChoices(),
      { provide: USER_TIME_ZONE, useValue: 'UTC' },
      { provide: Clock, useValue: { now: () => new Date('2026-10-14T15:45:00Z') } },
    ],
  });
  await TestBed.inject(AuthStore).ensureLoaded();
  const fixture = TestBed.createComponent(DashGrid);
  fixture.componentRef.setInput('summary', summary);
  fixture.componentRef.setInput('card', card);
  const assigned = vi.fn();
  fixture.componentInstance.assigned.subscribe(assigned);
  fixture.detectChanges();
  await fixture.whenStable();
  return { grid: fixture.componentInstance as unknown as Driver, assigned };
}

describe('DashGrid inline assign (#1363)', () => {
  it('takes the task out of the Unassigned grid on the commit that follows the optimistic row', async () => {
    const { grid, assigned } = await open('unassigned');
    expect(grid.rows().map((r) => r.taskId)).toEqual([21, 24]);
    expect(grid.total()).toBe(2);

    // Step 1: the optimistic row (a person, the same row version). It shows in place; nothing leaves yet.
    grid.onRowChange({ ...first, assignedUser: person });
    expect(grid.rows().map((r) => r.taskId)).toEqual([21, 24]);
    expect(grid.rows()[0].assignedUser?.displayName).toBe('Test User');
    expect(assigned).not.toHaveBeenCalled();

    // Step 2: the server's row (a new row version). The grid already holds the optimistic copy; the commit still removes the task.
    grid.onRowChange({ ...first, assignedUser: person, rowVersion: 'B' });
    expect(grid.rows().map((r) => r.taskId)).toEqual([24]);
    expect(grid.total()).toBe(1);
    expect(assigned).toHaveBeenCalledTimes(1);
    expect(assigned).toHaveBeenCalledWith({ taskNumber: 'TSK-21', name: 'Test User' });
  });

  it('puts the task back and tells nobody when the assignment fails', async () => {
    const { grid, assigned } = await open('unassigned');
    grid.onRowChange({ ...first, assignedUser: person });
    grid.onRowChange(first); // the failure path restores the old row
    expect(grid.rows().map((r) => r.taskId)).toEqual([21, 24]);
    expect(grid.rows()[0].assignedUser).toBeUndefined();
    expect(assigned).not.toHaveBeenCalled();
    expect(grid.total()).toBe(2);
  });

  it('does not announce a second assignment on a retry after a failure that was not committed', async () => {
    const { grid, assigned } = await open('unassigned');
    grid.onRowChange({ ...first, assignedUser: person });
    grid.onRowChange(first);
    grid.onRowChange({ ...first, assignedUser: person });
    grid.onRowChange({ ...first, assignedUser: person, rowVersion: 'B' });
    expect(assigned).toHaveBeenCalledTimes(1);
    expect(grid.rows().map((r) => r.taskId)).toEqual([24]);
  });

  it('keeps the row in place in a grid that is not the Unassigned card, but still tells the page', async () => {
    const { grid, assigned } = await open(null);
    grid.onRowChange({ ...first, assignedUser: person });
    grid.onRowChange({ ...first, assignedUser: person, rowVersion: 'B' });
    expect(grid.rows().map((r) => r.taskId)).toEqual([21, 24]);
    expect(grid.rows()[0].rowVersion).toBe('B');
    expect(assigned).toHaveBeenCalledTimes(1);
  });

  it('does not call a change of an already assigned task an assignment', async () => {
    const { grid, assigned } = await open(null);
    const mine = { ...first, assignedUser: person };
    grid.onRowChange(mine); // optimistic (unassigned -> person)
    grid.onRowChange({ ...mine, rowVersion: 'B' }); // commit: one assignment
    grid.onRowChange({ ...mine, rowVersion: 'C', title: 'Renamed' }); // a later edit of the assigned task
    expect(assigned).toHaveBeenCalledTimes(1);
  });
});
