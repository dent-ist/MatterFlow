import {
  absoluteTime,
  announcementText,
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
});
