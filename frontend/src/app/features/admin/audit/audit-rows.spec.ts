import { AuditSearchItem } from '../../../api/generated/api-client';
import { AuditGroup } from './audit-links';
import {
  LONG_VALUE,
  clockText,
  dayLabel,
  eventPhrase,
  isLongValue,
  stampText,
  withDayDividers,
} from './audit-rows';

const item = (id: number, at: string): AuditSearchItem =>
  ({
    auditEventId: id,
    occurredAtUtc: at,
    actor: { userId: 1, displayName: 'Test User 50' },
    eventType: 'COMMENT_ADDED',
    object: { type: 'Task', id: '1', label: undefined },
    summary: 'Comment added',
    correlationId: `c${id}`,
    correlationEventCount: 1,
  }) as AuditSearchItem;

const group = (...items: AuditSearchItem[]): AuditGroup => ({
  key: `${items[0].correlationId}:${items[0].auditEventId}`,
  items,
});

describe('audit rows', () => {
  const zone = 'America/New_York';
  // 2026-10-20 12:00 in New York.
  const now = new Date('2026-10-20T16:00:00Z');

  it('labels a day Today, Oct 19 or Oct 19, 2025', () => {
    const today = { year: 2026, month: 10, day: 20 };
    expect(dayLabel(today, today)).toBe('Today');
    expect(dayLabel({ year: 2026, month: 10, day: 19 }, today)).toBe('Oct 19');
    expect(dayLabel({ year: 2025, month: 10, day: 19 }, today)).toBe('Oct 19, 2025');
  });

  it('puts a divider on the first event of each day in the viewer zone, and none inside a day', () => {
    const blocks = withDayDividers(
      [
        group(item(5, '2026-10-20T15:00:00Z')),
        group(item(4, '2026-10-20T04:30:00Z')), // 12:30 AM on Oct 20 in New York
        group(item(3, '2026-10-20T03:30:00Z')), // 11:30 PM on Oct 19 in New York (UTC says Oct 20)
        group(item(2, '2026-10-19T14:00:00Z')),
        group(item(1, '2025-12-31T23:00:00Z')),
      ],
      zone,
      now,
    );
    expect(blocks.map((b) => b.day)).toEqual(['Today', null, 'Oct 19', null, 'Dec 31, 2025']);
  });

  it('keeps the day label of a group on its first event and does not repeat a day across pages', () => {
    const first = withDayDividers([group(item(3, '2026-10-20T15:00:00Z'))], zone, now);
    const both = withDayDividers(
      [group(item(3, '2026-10-20T15:00:00Z')), group(item(2, '2026-10-20T14:00:00Z'))],
      zone,
      now,
    );
    expect(first[0].day).toBe('Today');
    expect(both.map((b) => b.day)).toEqual(['Today', null]);
  });

  it('shows the time alone, with the whole stamp and zone for the tooltip', () => {
    const e = item(1, '2026-10-20T04:27:00Z');
    expect(clockText(e, zone)).toBe('12:27 AM');
    expect(stampText(e, zone)).toBe('Oct 20, 2026, 12:27 AM EDT');
  });

  it('names an event by what happened and who did it', () => {
    expect(eventPhrase(item(1, '2026-10-20T04:27:00Z'))).toBe('Comment added by Test User 50');
  });

  it('clamps long or shortened values only', () => {
    expect(isLongValue('short', false)).toBe(false);
    expect(isLongValue('x'.repeat(LONG_VALUE + 1), false)).toBe(true);
    expect(isLongValue('short', true)).toBe(true);
    expect(isLongValue(undefined, false)).toBe(false);
  });
});
