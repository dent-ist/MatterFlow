import { aRow } from './work-queue-testing';
import { canEditField, rowFromTask, statusChoices } from './inline-edit';

const all = (): boolean => true;
const actions = (status: string, has: (p: string) => boolean = all, matterIsActive = true) =>
  statusChoices({ status, matterIsActive }, has).map((c) => c.action);

describe('statusChoices (TaskLifecycle matrix)', () => {
  it('offers exactly the matrix cells of each status', () => {
    expect(actions('NEW')).toEqual(['START', 'HOLD', 'COMPLETE', 'CANCEL']);
    expect(actions('IN_PROGRESS')).toEqual(['HOLD', 'COMPLETE', 'CANCEL']);
    expect(actions('ON_HOLD')).toEqual(['RESUME', 'CANCEL']);
    expect(actions('COMPLETED')).toEqual(['REOPEN', 'CANCEL']);
    expect(actions('CANCELLED')).toEqual(['REOPEN']);
  });

  it('leaves out the transitions whose permission the user lacks', () => {
    const has = (p: string) => p === 'Task.ChangeStatus';
    expect(actions('NEW', has)).toEqual(['START', 'HOLD']);
    expect(actions('COMPLETED', has)).toEqual([]);
  });

  it('keeps Reopen but marks it blocked while the matter is inactive', () => {
    const [reopen] = statusChoices({ status: 'CANCELLED', matterIsActive: false }, all);
    expect(reopen.action).toBe('REOPEN');
    expect(reopen.blockedReason).toContain('Matter is inactive');
  });
});

describe('canEditField', () => {
  it('needs the permission and an open task for priority and assignee', () => {
    const open = aRow({ status: 'ON_HOLD' });
    expect(canEditField('priority', open, (p) => p === 'Task.SetPriority')).toBe(true);
    expect(canEditField('priority', open, (p) => p === 'Task.Assign')).toBe(false);
    expect(canEditField('assignee', open, (p) => p === 'Task.Assign')).toBe(true);
    const closed = aRow({ status: 'COMPLETED' });
    expect(canEditField('assignee', closed, all)).toBe(false);
    expect(canEditField('priority', closed, all)).toBe(false);
  });

  it('is editable for status only when some transition is permitted', () => {
    expect(canEditField('status', aRow(), () => false)).toBe(false);
    expect(canEditField('status', aRow(), all)).toBe(true);
  });
});

describe('rowFromTask', () => {
  it('takes status, priority, assignment and rowVersion from the response', () => {
    const next = rowFromTask(aRow(), {
      status: 'ON_HOLD',
      statusLabel: 'On Hold',
      priority: { priorityId: 3, label: 'Low', color: 'low', sortOrder: 3 },
      assignedPod: undefined,
      assignedUser: undefined,
      isAsap: false,
      isOverdue: true,
      statusChangedAtUtc: '2026-10-14T00:00:00Z',
      rowVersion: 'BBBB',
    } as never);
    expect(next.status).toBe('ON_HOLD');
    expect(next.priority.label).toBe('Low');
    expect(next.assignedUser).toBeUndefined();
    expect(next.rowVersion).toBe('BBBB');
    expect(next.title).toBe('Process Smith custodians');
  });
});
