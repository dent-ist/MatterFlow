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
});
