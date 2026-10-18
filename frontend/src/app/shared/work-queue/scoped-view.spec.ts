import { WorkStripItem } from './work-strip';
import {
  SCOPED_VIEWS,
  VIEW_EMPTY,
  VIEW_FIXED,
  ownTabItems,
  parseScopedView,
  scopedViewFilters,
  scopedViewOwns,
} from './scoped-view';

describe('scoped views of the Matter and Project Tasks grids', () => {
  it('reads only the four known values from the address; anything else is the open list', () => {
    expect(SCOPED_VIEWS.map((v) => parseScopedView(v))).toEqual([
      'overdue',
      'dueSoon',
      'asap',
      'onHold',
    ]);
    for (const bad of ['open', 'Overdue', 'nonsense', '', null, undefined]) {
      expect(parseScopedView(bad)).toBeNull();
    }
  });

  it('stands for the Dashboard filters, so the grid total is the strip number', () => {
    const open = ['NEW', 'IN_PROGRESS', 'ON_HOLD'];
    expect(scopedViewFilters('overdue', '2026-10-16')).toEqual({ status: open, overdue: true });
    expect(scopedViewFilters('asap', '2026-10-16')).toEqual({ status: open, asap: true });
    expect(scopedViewFilters('onHold', '2026-10-16')).toEqual({ status: ['ON_HOLD'] });
    expect(scopedViewFilters('dueSoon', '2026-10-16')).toEqual({
      status: open,
      asap: false,
      overdue: false,
      dueFrom: null,
      dueTo: '2026-10-16',
    });
  });

  it('owns Status always and Due only for Due soon, and says so in words', () => {
    expect(scopedViewOwns(null)).toEqual([]);
    expect(scopedViewOwns('overdue')).toEqual(['status']);
    expect(scopedViewOwns('onHold')).toEqual(['status']);
    expect(scopedViewOwns('dueSoon')).toEqual(['status', 'due']);
    expect(VIEW_FIXED.onHold.status).toBe('On hold');
    expect(VIEW_FIXED.dueSoon.due).toBe('Next 2 days');
    for (const v of SCOPED_VIEWS) expect(VIEW_EMPTY[v]).toMatch(/\.$/);
  });

  it('points the Overview items at the own Tasks tab: Open is the plain tab, the others add the view', () => {
    const items: WorkStripItem[] = ['open', 'overdue', 'dueSoon', 'asap', 'onHold'].map((key) => ({
      key,
      label: key,
      count: 1,
      link: { path: '/tasks', queryParams: { matter: '7' } },
    }));
    expect(ownTabItems(items, '/matters/7').map((i) => i.link)).toEqual([
      { path: '/matters/7', queryParams: { tab: 'tasks' } },
      { path: '/matters/7', queryParams: { tab: 'tasks', view: 'overdue' } },
      { path: '/matters/7', queryParams: { tab: 'tasks', view: 'dueSoon' } },
      { path: '/matters/7', queryParams: { tab: 'tasks', view: 'asap' } },
      { path: '/matters/7', queryParams: { tab: 'tasks', view: 'onHold' } },
    ]);
  });
});
