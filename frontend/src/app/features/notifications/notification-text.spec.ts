import {
  NotificationLike,
  absoluteTime,
  announcementText,
  groupLink,
  groupNotifications,
  groupSummary,
  notificationLink,
  relativeTime,
} from './notification-text';

describe('notification text', () => {
  const zone = 'America/Chicago';
  const now = new Date('2026-10-22T18:00:00Z');

  it('announces one item or the count with the latest', () => {
    expect(announcementText([])).toBe('');
    expect(announcementText([{ message: 'A' }])).toBe('New notification: A');
    expect(announcementText([{ message: 'C' }, { message: 'B' }, { message: 'A' }])).toBe(
      '3 new notifications. Latest: C',
    );
  });

  it('words the age: just now, minutes, hours, yesterday, then the date', () => {
    expect(relativeTime('2026-10-22T17:59:40Z', now, zone)).toBe('just now');
    expect(relativeTime('2026-10-22T17:55:00Z', now, zone)).toBe('5 min ago');
    expect(relativeTime('2026-10-22T17:00:00Z', now, zone)).toBe('1 h ago');
    expect(relativeTime('2026-10-22T14:00:00Z', now, zone)).toBe('4 h ago');
    expect(relativeTime('2026-10-21T20:00:00Z', now, zone)).toBe('yesterday');
    expect(relativeTime('2026-10-18T20:00:00Z', now, zone)).toBe('Oct 18');
    expect(relativeTime('2025-10-18T20:00:00Z', now, zone)).toBe('Oct 18, 2025');
    expect(relativeTime('nonsense', now, zone)).toBe('');
  });

  it('gives the absolute time with the zone', () => {
    expect(absoluteTime('2026-10-22T17:00:00Z', zone)).toContain('Oct 22, 2026');
    expect(absoluteTime('nonsense', zone)).toBe('');
  });

  it('builds links from kind and id only', () => {
    expect(notificationLink({ objectKind: 'Task', objectId: 7 })).toEqual(['/tasks', 7]);
    expect(notificationLink({ objectKind: 'Matter', objectId: 3 })).toEqual(['/matters', 3]);
  });

  it('puts the matter one click away for every project manager event of epic #753 (PX-25)', () => {
    // What the API sends per event (objectKind): the matter itself for MatterManagerSet, the task for the other three. The task page carries the
    // matter in its crumb (Tasks > matter > TSK-n) and in its context line, so the matter is one click from the link.
    const events: Record<string, { kind: string; opens: string }> = {
      MatterTaskOverdue: { kind: 'Task', opens: '/tasks' },
      MatterTaskCreated: { kind: 'Task', opens: '/tasks' },
      MatterTaskStalled: { kind: 'Task', opens: '/tasks' },
      MatterManagerSet: { kind: 'Matter', opens: '/matters' },
    };
    for (const [event, { kind, opens }] of Object.entries(events)) {
      expect(notificationLink({ objectKind: kind, objectId: 11 }), event).toEqual([opens, 11]);
    }
  });

  describe('grouping the overdue notices (PM v2, #884)', () => {
    function n(id: number, over: Partial<NotificationLike> = {}): NotificationLike {
      return {
        objectKind: 'Task',
        objectId: 100 + id,
        message: `Overdue by 2 days - TSK-${id} "T" on M`,
        createdUtc: '2026-10-22T14:00:00Z',
        isRead: false,
        groupKey: 'overdue:2026-10-22:manager',
        matterId: id % 3,
        ...over,
      };
    }

    it('makes one group of the notices that share a key, at the place of the newest, and leaves the others alone', () => {
      const other = n(9, { groupKey: null, matterId: 1 });
      const entries = groupNotifications([n(1), other, n(2), n(3, { isRead: true })]);
      expect(entries.map((e) => e.kind)).toEqual(['group', 'single']);
      const group = entries[0];
      if (group.kind !== 'group') throw new Error('expected a group');
      expect(group.items).toHaveLength(3);
      expect(group.unread).toBe(2);
      expect(group.tasks).toBe(3);
      expect(group.matters).toBe(3);
      expect(group.manager).toBe(true);
    });

    it('keeps a lone overdue notice as it is (a group needs two)', () => {
      expect(groupNotifications([n(1)]).map((e) => e.kind)).toEqual(['single']);
    });

    it('keeps different days and different recipients apart', () => {
      const entries = groupNotifications([
        n(1),
        n(2),
        n(3, { groupKey: 'overdue:2026-10-21:manager' }),
        n(4, { groupKey: 'overdue:2026-10-21:manager' }),
        n(5, { groupKey: 'overdue:2026-10-22:assignee' }),
      ]);
      expect(entries.map((e) => e.kind)).toEqual(['group', 'group', 'single']);
    });

    it('words the summary reason first and the link by who the tasks are for', () => {
      expect(groupSummary({ manager: true, tasks: 13, matters: 3 })).toBe(
        'Overdue - 13 tasks on 3 matters',
      );
      expect(groupSummary({ manager: false, tasks: 1, matters: 1 })).toBe(
        'Overdue - 1 of your task on 1 matter',
      );
      expect(groupLink({ manager: true }).queryParams).toEqual({
        managedByMe: 'true',
        overdue: 'true',
        status: ['NEW', 'IN_PROGRESS', 'ON_HOLD'],
      });
      expect(groupLink({ manager: false }).commands).toEqual(['/my-work']);
    });
  });
});
