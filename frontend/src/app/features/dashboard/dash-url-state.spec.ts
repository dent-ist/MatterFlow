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
import { DEFAULT_PERIOD, periodToParams } from './dashboard-period';

const map = (o: Record<string, string | string[]>) => convertToParamMap(o);

describe('dash URL defaults (one list per tab)', () => {
  it('lists the defaults of every tab', () => {
    expect(DASH_DEFAULTS.summary).toEqual({});
    expect(DASH_DEFAULTS.breakdowns).toEqual({});
    expect(DASH_DEFAULTS.trends).toEqual({ metric: DEFAULT_CHOICE.metric });
    expect(DASH_DEFAULTS.swimlane).toEqual({ group: 'none', sort: 'priority', days: '7' });
    expect(DASH_DEFAULTS.users).toEqual({
      view: 'workload',
      uavail: 'all',
      cov: 'type',
    });
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

  it('writes nothing for default Users filters, Workload view and the 30 day period', () => {
    const p = withoutDefaults('users', {
      ...filtersToParams(DEFAULT_FILTERS),
      view: 'workload',
      ...periodToParams(DEFAULT_PERIOD),
    });
    expect(Object.values(p).every((v) => v === null)).toBe(true);
    expect(periodToParams({ ...DEFAULT_PERIOD, key: '90d' }).period).toBe('90d');
  });

  it('writes nothing for the default Trends choice (as before)', () => {
    const p = withoutDefaults('trends', choiceToParams(DEFAULT_CHOICE));
    expect(Object.values(p).every((v) => v === null)).toBe(true);
  });
});

describe('canonicalParams', () => {
  it('keeps an explicit all=1 / all=0 on Trends: they differ from the automatic default (no parameter)', () => {
    for (const all of ['0', '1']) {
      const raw = map({ tab: 'trends', types: 'a,b', all });
      expect(canonicalParams(raw, 'trends')['all']).toBe(all);
    }
  });

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

  it('keeps the page-wide pod and a valid period, whatever the tab', () => {
    expect(canonicalParams(map({ tab: 'summary', pod: '3', period: '90d' }), 'summary')).toEqual({
      tab: 'summary',
      pod: '3',
      period: '90d',
    });
    expect(canonicalParams(map({ tab: 'users', period: '12m' }), 'users')).toEqual({
      tab: 'users',
      period: '12m',
    });
  });

  it('leaves the default period (30 days) out and drops dates that do not belong to a custom period', () => {
    expect(canonicalParams(map({ tab: 'trends', period: '30d' }), 'trends')).toEqual({
      tab: 'trends',
    });
    expect(
      canonicalParams(
        map({ tab: 'trends', period: '90d', from: '2026-01-01', to: '2026-01-09' }),
        'trends',
      ),
    ).toEqual({ tab: 'trends', period: '90d' });
  });

  it('keeps a valid custom range and drops an invalid one with its dates (memory applies)', () => {
    const good = map({ tab: 'trends', period: 'custom', from: '2026-10-01', to: '2026-10-09' });
    expect(canonicalParams(good, 'trends')).toEqual({
      tab: 'trends',
      period: 'custom',
      from: '2026-10-01',
      to: '2026-10-09',
    });
    const bads: Record<string, string>[] = [
      { period: 'custom', from: '2026-10-09', to: '2026-10-01' },
      { period: 'custom', from: '2024-01-01', to: '2026-10-01' },
      { period: 'custom' },
      { period: 'quarter' },
      { from: '2026-10-01', to: '2026-10-09' },
    ];
    for (const bad of bads) {
      expect(canonicalParams(map({ tab: 'trends', ...bad }), 'trends')).toEqual({ tab: 'trends' });
    }
  });

  it('keeps the period when the person moves between tabs', () => {
    expect('period' in clearedTabParams('trends')).toBe(false);
    expect('from' in clearedTabParams('users')).toBe(false);
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

describe('canonicalParams and the page-wide scope (P1)', () => {
  const member = {
    isValid: (v: string) => ['all', 'mine', '1', '2', '3'].includes(v),
    defaultValue: 'mine',
  };
  const loner = { isValid: (v: string) => ['all', '1', '2', '3'].includes(v), defaultValue: 'all' };

  it('keeps a scope that differs from the default and drops the default itself', () => {
    expect(canonicalParams(map({ tab: 'trends', pod: 'all' }), 'trends', member)['pod']).toBe(
      'all',
    );
    expect(canonicalParams(map({ pod: '2' }), 'summary', member)['pod']).toBe('2');
    expect(canonicalParams(map({ pod: 'mine' }), 'summary', member)['pod']).toBeUndefined();
    expect(canonicalParams(map({ pod: 'all' }), 'summary', loner)['pod']).toBeUndefined();
    expect(canonicalParams(map({ pod: 'MINE' }), 'summary', member)['pod']).toBeUndefined();
  });

  it('drops a scope the person cannot use or that is no scope at all', () => {
    expect(canonicalParams(map({ pod: '9' }), 'summary', member)['pod']).toBeUndefined();
    expect(canonicalParams(map({ pod: 'mine' }), 'summary', loner)['pod']).toBeUndefined();
    expect(canonicalParams(map({ pod: 'x' }), 'summary', member)['pod']).toBeUndefined();
    expect(canonicalParams(map({ pod: '1 OR 1=1' }), 'summary', member)['pod']).toBeUndefined();
  });

  it('keeps a well-formed scope as it is until the choices are known', () => {
    expect(canonicalParams(map({ pod: '5' }), 'summary', null)['pod']).toBe('5');
    expect(canonicalParams(map({ pod: 'zzz' }), 'summary', null)['pod']).toBeUndefined();
  });

  it('reads the old Users Pod filter once into pod and rewrites the address', () => {
    const raw = map({ tab: 'users', upod: '2', uavail: 'out' });
    const out = canonicalParams(raw, 'users', loner);
    expect(out).toEqual({ tab: 'users', pod: '2', uavail: 'out' });
    expect(sameParams(raw, out)).toBe(false);
    // A link that names both: pod wins.
    expect(canonicalParams(map({ pod: '3', upod: '2' }), 'users', loner)['pod']).toBe('3');
    // The old value of the default is simply dropped.
    expect(canonicalParams(map({ upod: 'all' }), 'users', loner)['pod']).toBeUndefined();
  });

  it('does not clear the scope when a tab is chosen (it follows the person), and the tabs no longer own a pod parameter', () => {
    for (const tab of DASHBOARD_TABS) expect(clearedTabParams(tab)['pod']).toBeUndefined();
    expect(Object.keys(clearedTabParams('summary'))).not.toContain('upod');
    expect(viewToParams(DEFAULT_VIEW)['pod']).toBeUndefined();
    expect(filtersToParams(DEFAULT_FILTERS)['upod']).toBeUndefined();
  });
});
