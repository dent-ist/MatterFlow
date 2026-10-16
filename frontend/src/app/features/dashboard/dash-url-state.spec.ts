import { convertToParamMap } from '@angular/router';
import {
  DASH_DEFAULTS,
  canonicalParams,
  clearedTabParams,
  sameParams,
  tabFallback,
  withoutDefaults,
} from './dash-url-state';
import { DASHBOARD_TABS } from './dashboard-prefs';
import { viewToParams, DEFAULT_VIEW } from './swimlane/swimlane-model';
import { DEFAULT_CHOICE, choiceToParams } from './ui/trend-model';
import { filtersToParams, DEFAULT_FILTERS } from './users/users-model';
import { DEFAULT_PERIOD, periodToParams } from './users/coverage-model';

const map = (o: Record<string, string | string[]>) => convertToParamMap(o);

describe('dash URL defaults (one list per tab)', () => {
  it('lists the defaults of every tab', () => {
    expect(DASH_DEFAULTS.summary).toEqual({});
    expect(DASH_DEFAULTS.breakdowns).toEqual({});
    expect(DASH_DEFAULTS.trends).toEqual({ all: '1', metric: DEFAULT_CHOICE.metric });
    expect(DASH_DEFAULTS.swimlane).toEqual({ group: 'none', sort: 'priority', days: '7' });
    expect(DASH_DEFAULTS.users).toEqual({ view: 'workload', uavail: 'all', cp: '30' });
    expect(Object.keys(DASH_DEFAULTS).sort()).toEqual([...DASHBOARD_TABS].sort());
  });

  it('writes nothing for the default Swimlane view, and only what differs otherwise', () => {
    const none = withoutDefaults('swimlane', viewToParams(DEFAULT_VIEW));
    expect(Object.values(none).every((v) => v === null)).toBe(true);
    const grouped = withoutDefaults(
      'swimlane',
      viewToParams({ ...DEFAULT_VIEW, groupBy: 'assignee' }),
    );
    expect(grouped['group']).toBe('assignee');
    expect(grouped['sort']).toBeNull();
    expect(grouped['days']).toBeNull();
  });

  it('writes nothing for default Users filters, Workload view and the 30 day Coverage period', () => {
    const p = withoutDefaults('users', {
      ...filtersToParams(DEFAULT_FILTERS),
      view: 'workload',
      ...periodToParams(DEFAULT_PERIOD),
    });
    expect(Object.values(p).every((v) => v === null)).toBe(true);
    expect(
      withoutDefaults('users', periodToParams({ ...DEFAULT_PERIOD, period: '90' }))['cp'],
    ).toBe('90');
  });

  it('writes nothing for the default Trends choice (as before)', () => {
    const p = withoutDefaults('trends', choiceToParams(DEFAULT_CHOICE));
    expect(Object.values(p).every((v) => v === null)).toBe(true);
  });
});

describe('canonicalParams', () => {
  it('leaves a link alone when it already says the right thing', () => {
    const raw = map({ tab: 'swimlane' });
    expect(sameParams(raw, canonicalParams(raw, 'swimlane'))).toBe(true);
    const plain = map({});
    expect(sameParams(plain, canonicalParams(plain, 'summary'))).toBe(true);
  });

  it('removes defaults written explicitly', () => {
    const raw = map({ tab: 'swimlane', group: 'none', sort: 'priority', days: '7' });
    expect(canonicalParams(raw, 'swimlane')).toEqual({ tab: 'swimlane' });
    expect(sameParams(raw, canonicalParams(raw, 'swimlane'))).toBe(false);
  });

  it('keeps a value that differs from the default', () => {
    const raw = map({ tab: 'swimlane', group: 'client', days: '7' });
    expect(canonicalParams(raw, 'swimlane')).toEqual({ tab: 'swimlane', group: 'client' });
  });

  it('keeps repeated values and drops unknown parameters', () => {
    const raw = map({ tab: 'swimlane', type: ['3', '4'], utm: 'x' });
    expect(canonicalParams(raw, 'swimlane')).toEqual({ tab: 'swimlane', type: ['3', '4'] });
  });

  it('rewrites a tab the person cannot open to the tab shown', () => {
    expect(canonicalParams(map({ tab: 'breakdowns' }), 'summary')).toEqual({ tab: 'summary' });
  });

  it('keeps the new page-wide parameters of other issues', () => {
    expect(canonicalParams(map({ tab: 'summary', pod: '3', period: '90' }), 'summary')).toEqual({
      tab: 'summary',
      pod: '3',
      period: '90',
    });
  });
});

describe('clearedTabParams', () => {
  it('clears the parameters of the other tabs and keeps those of the target', () => {
    const cleared = clearedTabParams('users');
    expect(cleared['group']).toBeNull();
    expect(cleared['types']).toBeNull();
    expect('upod' in cleared).toBe(false);
  });
});

describe('tabFallback (R1)', () => {
  it('is null for no request and for a permitted tab', () => {
    expect(tabFallback(null, ['summary'])).toBeNull();
    expect(tabFallback('summary', ['summary'])).toBeNull();
  });
  it('names a forbidden tab and flags an unknown one', () => {
    expect(tabFallback('breakdowns', ['summary'])).toEqual({
      kind: 'forbidden',
      tab: 'breakdowns',
    });
    expect(tabFallback('xyz', ['summary'])).toEqual({ kind: 'unknown' });
  });
});
