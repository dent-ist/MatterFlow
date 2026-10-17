import { emptyState } from './queue-filters';
import { openInQueueParams } from './queue-link';

const ctx = { userId: 7, now: new Date('2026-10-14T15:00:00Z'), zone: 'UTC' };

describe('openInQueueParams (M10)', () => {
  it('Active: assigned to me, every open status', () => {
    expect(openInQueueParams('active', emptyState(), ctx)).toEqual({
      assignee: ['7'],
      status: ['NEW', 'IN_PROGRESS', 'ON_HOLD'],
    });
  });

  it('carries the column filters and the sort, not the page or the tab', () => {
    const state = emptyState();
    state.filters.priority = [3];
    state.filters.matterText = 'merger';
    state.sort = 'due';
    state.dir = 'desc';
    state.page = 4;
    state.view = 'dueSoon';
    const out = openInQueueParams('active', state, ctx);
    expect(out).toMatchObject({ priority: ['3'], matterText: 'merger', sort: 'due', dir: 'desc' });
    expect(out['page']).toBeUndefined();
    expect(out['view']).toBeUndefined();
  });

  it('keeps a Status the person chose', () => {
    const state = emptyState();
    state.filters.status = ['ON_HOLD'];
    expect(openInQueueParams('active', state, ctx)['status']).toEqual(['ON_HOLD']);
  });

  it('Due soon and overdue: explicit dates only, so ASAP is out and overdue is in', () => {
    const state = emptyState();
    state.filters.overdue = true;
    state.filters.dueFrom = '2026-10-01';
    expect(openInQueueParams('dueSoon', state, ctx)).toEqual({
      assignee: ['7'],
      status: ['NEW', 'IN_PROGRESS', 'ON_HOLD'],
      asap: 'false',
      dueTo: '2026-10-16',
    });
  });

  it('Closed: closed statuses and the 90-day window', () => {
    expect(openInQueueParams('completed', emptyState(), ctx)).toEqual({
      assignee: ['7'],
      status: ['COMPLETED', 'CANCELLED'],
      completedFrom: '2026-07-16',
    });
  });

  it('Closed: all time has no start, a chosen range wins', () => {
    const all = { ...emptyState(), closedAll: true };
    expect(openInQueueParams('completed', all, ctx)['completedFrom']).toBeUndefined();
    const range = emptyState();
    range.filters.completedFrom = '2026-01-01';
    range.filters.completedTo = '2026-02-01';
    expect(openInQueueParams('completed', range, ctx)).toMatchObject({
      completedFrom: '2026-01-01',
      completedTo: '2026-02-01',
    });
  });

  it('Created by me: creator is me and every status, so the total equals the tab', () => {
    expect(openInQueueParams('createdByMe', emptyState(), ctx)).toEqual({
      creator: ['7'],
      status: '',
    });
  });

  it('drops an Assignee the tab owns', () => {
    const state = emptyState();
    state.filters.assignee = [99];
    expect(openInQueueParams('active', state, ctx)['assignee']).toEqual(['7']);
  });
});
