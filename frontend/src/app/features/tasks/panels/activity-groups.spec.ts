import { anActivity } from './task-panels-testing';
import { formatRange, groupActivity } from './activity-groups';

/** A "Comment added" event `minutes` after 4:00 PM UTC on Oct 13 (event ids rise with time). */
function comment(id: number, minutes: number, userId = 5, overrides = {}) {
  return anActivity({
    eventId: id,
    eventType: 'COMMENT_ADDED',
    category: 'COMMENTS',
    summary: 'Comment added',
    actor: { userId, displayName: userId === 5 ? 'Dana P.' : 'Tariq K.', isActive: true },
    occurredAtUtc: new Date(Date.UTC(2026, 9, 13, 16, minutes)).toISOString(),
    commentId: id * 10,
    excerpt: `Note ${id}`,
    ...overrides,
  });
}
const newestFirst = <T extends { eventId: number }>(list: T[]): T[] =>
  [...list].sort((a, b) => b.eventId - a.eventId);

describe('groupActivity', () => {
  it('folds 3 or more comments by one person, each within 10 minutes of the next', () => {
    const rows = groupActivity(newestFirst([comment(1, 0), comment(2, 4), comment(3, 9)]));
    expect(rows.length).toBe(1);
    const group = rows[0];
    expect(group.kind).toBe('group');
    if (group.kind === 'group') {
      expect(group.events.map((e) => e.eventId)).toEqual([3, 2, 1]);
      expect(group.key).toBe(3);
      expect(group.actorName).toBe('Dana P.');
    }
  });

  it('leaves 2 comments alone', () => {
    const rows = groupActivity(newestFirst([comment(1, 0), comment(2, 4)]));
    expect(rows.map((r) => r.kind)).toEqual(['event', 'event']);
  });

  it('chains runs: a long conversation of short pauses is one group', () => {
    const list = Array.from({ length: 12 }, (_, i) => comment(i + 1, i * 8));
    const rows = groupActivity(newestFirst(list));
    expect(rows.length).toBe(1);
    expect(rows[0].kind === 'group' && rows[0].events.length).toBe(12);
  });

  it('splits at a pause longer than 10 minutes', () => {
    const rows = groupActivity(
      newestFirst([comment(1, 0), comment(2, 2), comment(3, 4), comment(4, 30), comment(5, 31)]),
    );
    expect(rows.map((r) => r.kind)).toEqual(['event', 'event', 'group']);
  });

  it('never mixes people', () => {
    const rows = groupActivity(
      newestFirst([comment(1, 0), comment(2, 1, 6), comment(3, 2), comment(4, 3)]),
    );
    expect(rows.every((r) => r.kind === 'event')).toBe(true);
  });

  it('never folds other event types, edits, deletes or reasons', () => {
    const other = (id: number, type: string, summary: string) =>
      comment(id, id, 5, { eventType: type, summary });
    expect(
      groupActivity(
        newestFirst([
          other(1, 'COMMENT_EDITED', 'Comment edited'),
          other(2, 'COMMENT_EDITED', 'Comment edited'),
          other(3, 'COMMENT_EDITED', 'Comment edited'),
          other(4, 'COMMENT_ADDED', 'On hold reason added'),
          other(5, 'COMMENT_ADDED', 'On hold reason added'),
          other(6, 'COMMENT_ADDED', 'On hold reason added'),
        ]),
      ).every((r) => r.kind === 'event'),
    ).toBe(true);
    const status = [1, 2, 3].map((id) => anActivity({ eventId: id }));
    expect(groupActivity(status).every((r) => r.kind === 'event')).toBe(true);
  });

  it('a different event in between breaks the run, and events without a comment id never fold', () => {
    const broken = groupActivity(
      newestFirst([
        comment(1, 0),
        comment(2, 1),
        anActivity({ eventId: 3, occurredAtUtc: '2026-10-13T16:02:00Z' }),
        comment(4, 3),
        comment(5, 4),
      ]),
    );
    expect(broken.every((r) => r.kind === 'event')).toBe(true);
    const noIds = [1, 2, 3].map((id) => comment(id, id, 5, { commentId: undefined }));
    expect(groupActivity(newestFirst(noIds)).every((r) => r.kind === 'event')).toBe(true);
  });

  it('keeps the order of the surrounding events', () => {
    const rows = groupActivity([
      anActivity({ eventId: 20 }),
      ...newestFirst([comment(1, 0), comment(2, 1), comment(3, 2)]),
      anActivity({ eventId: 0 }),
    ]);
    expect(rows.map((r) => r.kind)).toEqual(['event', 'group', 'event']);
  });
});

describe('formatRange', () => {
  const at = (h: number, m: number, d = 13): string =>
    new Date(Date.UTC(2026, 9, d, h, m)).toISOString();

  it('shares the AM or PM', () => {
    expect(formatRange(at(16, 3), at(16, 5), 'UTC')).toBe('4:03 to 4:05 PM');
  });
  it('shows both halves across noon', () => {
    expect(formatRange(at(11, 58), at(12, 3), 'UTC')).toBe('11:58 AM to 12:03 PM');
  });
  it('shows one time for one minute', () => {
    expect(formatRange(at(16, 3), at(16, 3), 'UTC')).toBe('4:03 PM');
  });
  it('shows the days across midnight', () => {
    expect(formatRange(at(23, 58, 13), at(0, 3, 14), 'UTC')).toBe(
      'Oct 13, 11:58 PM to Oct 14, 12:03 AM',
    );
  });
  it('uses the viewer zone', () => {
    expect(formatRange(at(16, 3), at(16, 5), 'America/New_York')).toBe('12:03 to 12:05 PM');
  });
});
