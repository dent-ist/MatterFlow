import { convertToParamMap } from '@angular/router';
import { recordStripItems, recordStripQuery } from './record-strip';
import {
  BuiltInViewKey,
  ViewContext,
  matchBuiltIn,
  parseQueueState,
  taskQueueArgs,
} from './queue-filters';
import { VIEW_TIPS } from './work-vocabulary';

const ctx = { dueSoonTo: '2026-10-20' };
const scope = { kind: 'client', id: 107 } as const;
const full = { openTasks: 12, overdue: 3, dueSoon: 2, asap: 4, onHold: 1 };

const viewContext: ViewContext = {
  userId: 5,
  primaryPodId: null,
  recentFrom: '2026-09-19',
  dueSoonTo: ctx.dueSoonTo,
  canCreate: true,
};

describe('recordStripItems', () => {
  it('maps the summary to Open, Overdue, Due soon, ASAP, On hold in that order, with the glossary tooltips', () => {
    const items = recordStripItems(full, scope, ctx);
    expect(items.map((i) => [i.key, i.label, i.count])).toEqual([
      ['open', 'Open', 12],
      ['overdue', 'Overdue', 3],
      ['dueSoon', 'Due soon', 2],
      ['asap', 'ASAP', 4],
      ['onHold', 'On hold', 1],
    ]);
    expect(items.map((i) => i.hint)).toEqual([
      VIEW_TIPS.allOpen,
      VIEW_TIPS.overdue,
      VIEW_TIPS.dueSoon,
      VIEW_TIPS.asap,
      VIEW_TIPS.onHold,
    ]);
    expect(items.filter((i) => i.alert).map((i) => i.key)).toEqual(['overdue']);
  });

  it('links every item to the Task Queue scoped to the record', () => {
    const items = recordStripItems(full, scope, ctx);
    expect(items.every((i) => i.link?.path === '/tasks')).toBe(true);
    expect(items.map((i) => i.link!.queryParams)).toEqual([
      { client: '107', status: ['NEW', 'IN_PROGRESS', 'ON_HOLD'] },
      { client: '107', status: ['NEW', 'IN_PROGRESS', 'ON_HOLD'], overdue: 'true' },
      {
        client: '107',
        status: ['NEW', 'IN_PROGRESS', 'ON_HOLD'],
        asap: 'false',
        overdue: 'false',
        dueTo: '2026-10-20',
      },
      { client: '107', status: ['NEW', 'IN_PROGRESS', 'ON_HOLD'], asap: 'true' },
      { client: '107', status: ['ON_HOLD'] },
    ]);
  });

  it('scopes by matter and project the same way', () => {
    expect(recordStripQuery('overdue', { kind: 'matter', id: 9 }, ctx.dueSoonTo)['matter']).toBe(
      '9',
    );
    expect(recordStripQuery('asap', { kind: 'project', id: 3 }, ctx.dueSoonTo)['project']).toBe(
      '3',
    );
  });

  it('gives no items when the numbers are absent (no Task.View), never zeros', () => {
    expect(recordStripItems({}, scope, ctx)).toEqual([]);
    expect(
      recordStripItems(
        { openTasks: null, overdue: null, dueSoon: null, asap: null, onHold: null },
        scope,
        ctx,
      ),
    ).toEqual([]);
  });

  it('gives unknown counts while the summary is loading, and keeps real zeros', () => {
    expect(recordStripItems(null, scope, ctx).map((i) => i.count)).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
    const zero = recordStripItems(
      { openTasks: 0, overdue: 0, dueSoon: 0, asap: 0, onHold: 0 },
      scope,
      ctx,
    );
    expect(zero.map((i) => i.count)).toEqual([0, 0, 0, 0, 0]);
  });

  it('produces links the Task Queue reads as the matching quick view, scoped by the record', () => {
    const expected: Record<string, BuiltInViewKey | null> = {
      open: null, // All open is matched exactly only (#221): the scope makes the filters extra
      overdue: 'overdue',
      dueSoon: 'dueSoon',
      asap: 'asap',
      onHold: 'onHold',
    };
    for (const item of recordStripItems(full, scope, ctx)) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(item.link!.queryParams!)) {
        for (const one of Array.isArray(v) ? v : [v]) params.append(k, String(one));
      }
      const state = parseQueueState(convertToParamMap(queryMap(params)));
      expect(state.filters.client).toBe(107);
      expect(matchBuiltIn(state.filters, viewContext)?.key ?? null).toBe(expected[item.key]);
      // The API call the queue makes carries the scope.
      expect(taskQueueArgs(state)).toContain(107);
    }
  });
});

function queryMap(params: URLSearchParams): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const key of new Set(params.keys())) {
    const all = params.getAll(key);
    out[key] = all.length > 1 ? all : all[0];
  }
  return out;
}
