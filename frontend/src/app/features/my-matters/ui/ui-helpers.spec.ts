import { MyMattersTaskItem } from '../../../api/generated/api-client';
import { gridDays, taskShown } from './calendar-tab';
import { MatterTree } from './mm-models';
import { defaultAssetTypeIcon } from '../../../shared/ui/asset-type-chip';
import { daysBefore } from './metrics-work';
import { assigneeParams, dueParams, statusCodes } from './task-list';
import { treeNodes } from './tree-panel';

describe('task grid filters (UI-13)', () => {
  it('each Status chip asks for its statuses; All open is the three open ones', () => {
    expect(statusCodes('open')).toEqual(['NEW', 'IN_PROGRESS', 'ON_HOLD']);
    expect(statusCodes('hold')).toEqual(['ON_HOLD']);
    expect(statusCodes('completed')).toEqual(['COMPLETED']);
  });
});

describe('calendar helpers (UI-15)', () => {
  it('the month grid is whole weeks that start on Sunday', () => {
    const days = gridDays('2026-11');
    expect(days.length % 7).toBe(0);
    expect(new Date(`${days[0]}T00:00:00Z`).getUTCDay()).toBe(0);
    expect(days).toContain('2026-11-01');
    expect(days).toContain('2026-11-30');
    expect(days.length).toBe(35);
  });

  const task = (over: Partial<MyMattersTaskItem>): MyMattersTaskItem =>
    ({
      taskId: 1,
      priorityName: 'Normal',
      statusCode: 'IN_PROGRESS',
      dueDate: '2026-11-05',
      ...over,
    }) as MyMattersTaskItem;

  it('shows what the Shows choice asks for, and never an On Hold task', () => {
    const today = '2026-11-02';
    expect(taskShown(task({ priorityName: 'Critical' }), ['critical'], today)).toBe(true);
    expect(taskShown(task({ priorityName: 'High' }), ['critical'], today)).toBe(false);
    expect(taskShown(task({ priorityName: 'High' }), ['high'], today)).toBe(true);
    expect(taskShown(task({ dueDate: '2026-10-30' }), ['overdue'], today)).toBe(true);
    expect(taskShown(task({ dueDate: '2026-11-05' }), ['overdue'], today)).toBe(false);
    expect(taskShown(task({}), ['all'], today)).toBe(true);
    expect(
      taskShown(task({ statusCode: 'ON_HOLD', priorityName: 'Critical' }), ['all'], today),
    ).toBe(false);
    expect(taskShown(task({}), ['events'], today)).toBe(false);
  });
});

describe('tree nodes (UI-12)', () => {
  const tree: MatterTree = {
    asOfUtc: '',
    activeDays: 7,
    clientCount: 2,
    matterCount: 3,
    clients: [
      {
        clientId: 1,
        clientNumber: '1',
        name: 'Northwind',
        matterCount: 2,
        activeMatterCount: 1,
        openTasks: 9,
        overdue: 3,
        unassigned: 0,
        critical: 0,
        matters: [
          {
            matterId: 10,
            matterRef: '1-1',
            name: 'Breach',
            isSensitive: false,
            isActive: true,
            openTasks: 9,
            overdue: 3,
            unassigned: 0,
            critical: 0,
          },
          {
            matterId: 11,
            matterRef: '1-2',
            name: 'Qui Tam',
            isSensitive: true,
            isActive: false,
            openTasks: 0,
            overdue: 0,
            unassigned: 0,
            critical: 0,
          },
        ],
      },
      {
        clientId: 2,
        clientNumber: '2',
        name: 'Orion',
        matterCount: 1,
        activeMatterCount: 0,
        openTasks: 0,
        overdue: 0,
        unassigned: 0,
        critical: 0,
        matters: [
          {
            matterId: 20,
            matterRef: '2-1',
            name: 'Audit',
            isSensitive: false,
            isActive: false,
            openTasks: 0,
            overdue: 0,
            unassigned: 0,
            critical: 0,
          },
        ],
      },
    ],
  };

  it('draws the dot, the lock and the overdue count from the data', () => {
    const nodes = treeNodes(tree, false);
    expect(nodes.map((n) => n.id)).toEqual(['c:1', 'c:2']);
    const [breach, quiTam] = nodes[0].children!;
    expect(breach).toMatchObject({ dot: 'active', alert: 3, lock: false, count: 9 });
    expect(quiTam).toMatchObject({ dot: 'quiet', lock: true, alert: null });
  });

  it('Active only keeps the active matters and drops clients without one', () => {
    const nodes = treeNodes(tree, true);
    expect(nodes.length).toBe(1);
    expect(nodes[0].children!.map((c) => c.id)).toEqual(['m:10']);
    expect(nodes[0].count).toBe(1);
  });

  it('no data, no nodes', () => {
    expect(treeNodes(null, false)).toEqual([]);
  });
});

describe('grid column filters and Metrics helpers (UI-21)', () => {
  const g = {
    q: '',
    priorities: [],
    assignee: null,
    due: null,
    from: null,
    to: null,
    types: [],
    createdFrom: null,
    createdTo: null,
  };

  it('the Due presets become date ranges from today', () => {
    expect(dueParams({ ...g, due: 'overdue' }, '2026-11-10')).toEqual({ dueTo: '2026-11-09' });
    expect(dueParams({ ...g, due: 'today' }, '2026-11-10')).toEqual({
      dueFrom: '2026-11-10',
      dueTo: '2026-11-10',
    });
    expect(dueParams({ ...g, due: 'week' }, '2026-11-28')).toEqual({
      dueFrom: '2026-11-28',
      dueTo: '2026-12-05',
    });
    expect(dueParams({ ...g, due: 'month' }, '2026-02-10')).toEqual({
      dueFrom: '2026-02-01',
      dueTo: '2026-02-28',
    });
    expect(dueParams({ ...g, due: 'range', from: '2026-01-01', to: null }, '2026-02-10')).toEqual({
      dueFrom: '2026-01-01',
    });
    expect(dueParams(g, '2026-02-10')).toEqual({});
  });

  it('the Assignee filter asks for unassigned tasks or one person', () => {
    expect(assigneeParams({ ...g, assignee: 'none' })).toEqual({ unassigned: 'true' });
    expect(assigneeParams({ ...g, assignee: 7 })).toEqual({ assignee: ['7'] });
    expect(assigneeParams(g)).toEqual({});
  });

  it('the ageing buckets count back from today', () => {
    expect(daysBefore('2026-11-10', 7)).toBe('2026-11-03');
    expect(daysBefore('2026-03-01', 1)).toBe('2026-02-28');
  });

  it('an asset type without an icon gets a stable default by its name or id', () => {
    expect(defaultAssetTypeIcon('Custodian mailbox', 4)).toBe('mail-down');
    expect(defaultAssetTypeIcon('Weird thing', 3)).toBe(defaultAssetTypeIcon('Other thing', 3));
    expect(defaultAssetTypeIcon(null, null)).toBe('database');
  });
});
