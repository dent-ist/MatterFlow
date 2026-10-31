import { feedTitle, feedWhat } from './feed-format';
import { FeedItem } from './mm-models';

const base: FeedItem = {
  itemKey: 'k',
  kind: 'OVERDUE',
  occurredAtUtc: '2026-10-30T10:00:00Z',
  isUnread: true,
  actorName: null,
  matterId: 1,
  matterRef: '1-1',
  matterName: 'M',
  clientId: 1,
  clientName: 'C',
  taskId: 5,
  taskNumber: 'TSK-5',
  taskTitle: 'Review',
  assetId: null,
  assetName: null,
  assetTypeName: null,
  fromStatus: null,
  toStatus: null,
  onHoldReason: null,
  onHoldDays: null,
  daysOverdue: null,
  oldDueDate: null,
  newDueDate: null,
};

describe('feed text', () => {
  it('says each kind in words', () => {
    expect(feedWhat({ ...base, daysOverdue: 3 })).toBe('3 days overdue');
    expect(feedWhat({ ...base, kind: 'OVERDUE', daysOverdue: 1 })).toBe('1 day overdue');
    expect(
      feedWhat({ ...base, kind: 'ON_HOLD', onHoldDays: 6, onHoldReason: 'Waiting for client' }),
    ).toBe('On hold for 6 days: Waiting for client');
    expect(
      feedWhat({
        ...base,
        kind: 'NEW_STATUS_UPDATES',
        fromStatus: 'NEW',
        toStatus: 'IN_PROGRESS',
        actorName: 'Ann',
      }),
    ).toBe('New to In Progress by Ann');
    expect(feedWhat({ ...base, kind: 'NEW_COMMENTS', actorName: 'Ann' })).toBe('Ann commented');
    expect(
      feedWhat({
        ...base,
        kind: 'NEW_ASSETS',
        taskId: null,
        assetName: 'Laptop',
        assetTypeName: 'Device',
      }),
    ).toBe('Asset added: Laptop (Device)');
  });

  it('says how far a due date moved and which way', () => {
    const w = feedWhat({
      ...base,
      kind: 'DUE_DATE_UPDATED',
      oldDueDate: '2026-11-04',
      newDueDate: '2026-11-07',
    });
    expect(w).toContain('3 days later');
    expect(
      feedWhat({ ...base, kind: 'DUE_DATE_UPDATED', oldDueDate: '2026-11-07', newDueDate: null }),
    ).toContain('ASAP');
  });

  it('titles a task item with its number and an asset item with its name', () => {
    expect(feedTitle(base)).toBe('TSK-5 Review');
    expect(feedTitle({ ...base, taskId: null, assetName: 'Laptop' })).toBe('Laptop');
  });
});
