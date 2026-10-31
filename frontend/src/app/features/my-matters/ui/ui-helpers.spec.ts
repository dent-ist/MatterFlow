import { MyMattersTaskItem } from '../../../api/generated/api-client';
import { gridDays, taskShown } from './calendar-tab';
import { MatterTree } from './mm-models';
import { statusShowParams } from './task-list';
import { treeNodes } from './tree-panel';

describe('task grid filters (UI-13)', () => {
  it('All open and Everything ask for the three open statuses and nothing else', () => {
    expect(statusShowParams('open', 'everything', 1)).toEqual({
      status: ['NEW', 'IN_PROGRESS', 'ON_HOLD'],
    });
  });

  it('Overdue, At risk and Due in 7 days never include On Hold', () => {
    const p = statusShowParams('open', 'overdue', 1);
    expect(p['status']).toEqual(['NEW', 'IN_PROGRESS']);
    expect(p['overdue']).toBe('true');
    expect(statusShowParams('hold', 'overdue', 1)['status']).toEqual([]);
    expect(statusShowParams('open', 'risk', 1)['atRisk']).toBe('true');
    expect(statusShowParams('open', 'due7', 1)['dueWithin']).toBe('7');
  });

  it('Critical and Unassigned apply to every status and combine with the status chip', () => {
    const c = statusShowParams('completed', 'critical', 7);
    expect(c['status']).toEqual(['COMPLETED']);
    expect(c['priority']).toEqual(['7']);
    expect(statusShowParams('hold', 'unassigned', 1)).toEqual({
      status: ['ON_HOLD'],
      unassigned: 'true',
    });
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
