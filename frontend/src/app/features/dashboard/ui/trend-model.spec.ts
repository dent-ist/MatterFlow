import { convertToParamMap } from '@angular/router';
import {
  DashboardTrend,
  DashboardTrendDay,
  DashboardTrendType,
} from '../../../api/generated/api-client';
import {
  ALL_STYLE,
  DEFAULT_CHOICE,
  MAX_TYPES,
  MEASURE_STYLES,
  TYPE_STYLES,
  TrendChoice,
  buildView,
  chartHeading,
  choiceFromParams,
  choiceFromStored,
  choiceToParams,
  cleanTypeIds,
  dayQuery,
  freeSlot,
  hasTrendParams,
  linkNote,
  sameChoice,
  typeRows,
} from './trend-model';

const day = (date: string, n: number): DashboardTrendDay => ({
  date,
  created: n,
  completed: n + 1,
  overdue: n + 2,
  onTime: n + 3,
  late: n + 4,
});

function type(id: number, name: string, created: number, completed = 0): DashboardTrendType {
  return {
    id,
    name,
    iconKey: 'file-text',
    isActive: true,
    created,
    completed,
    overdue: 0,
    onTime: 0,
    late: 0,
    createdQuery: `createdFrom=2026-10-01&type=${id}`,
    completedQuery: `status=COMPLETED&completedFrom=2026-10-01&type=${id}`,
    overdueQuery: `overdue=true&type=${id}`,
  } as DashboardTrendType;
}

const DATA = {
  all: [day('2026-10-01', 1), day('2026-10-02', 2)],
  byTaskType: [
    { taskTypeId: 5, points: [day('2026-10-01', 10), day('2026-10-02', 20)] },
    { taskTypeId: 7, points: [day('2026-10-01', 30), day('2026-10-02', 40)] },
  ],
  types: [type(5, 'Alpha', 3), type(7, 'Beta', 9)],
} as unknown as DashboardTrend;

const params = (o: Record<string, string>) => convertToParamMap(o);

describe('trend model', () => {
  describe('address and storage', () => {
    it('reads the choices from the address and falls back for anything invalid', () => {
      const c = choiceFromParams(
        params({ types: '3,x,3,-1,9', metric: 'overdue', all: '0', due: 'overdue,late,bogus' }),
      );
      expect(c).toEqual({
        types: [3, 9],
        showAll: false,
        metric: 'overdue',
        due: ['overdue', 'late'],
      });
      expect(choiceFromParams(params({ metric: 'nope' }))).toEqual(DEFAULT_CHOICE);
      expect(hasTrendParams(params({ tab: 'trends' }))).toBe(false);
      expect(hasTrendParams(params({ types: '1' }))).toBe(true);
    });

    it('keeps at most eight ids and writes only what differs from the default', () => {
      expect(cleanTypeIds([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(cleanTypeIds(['4', 4, 0, 1.5, null])).toEqual([4]);
      expect(choiceToParams(DEFAULT_CHOICE)).toEqual({
        types: null,
        metric: null,
        all: null,
        due: null,
      });
      const c: TrendChoice = { types: [1, 2], showAll: false, metric: 'onTime', due: ['onTime'] };
      expect(choiceToParams(c)).toEqual({
        types: '1,2',
        metric: 'onTime',
        all: '0',
        due: 'ontime',
      });
      expect(choiceFromParams(params(choiceToParams(c) as Record<string, string>))).toEqual(c);
    });

    it('reads stored choices defensively', () => {
      expect(choiceFromStored(null)).toEqual(DEFAULT_CHOICE);
      expect(choiceFromStored('x')).toEqual(DEFAULT_CHOICE);
      expect(
        choiceFromStored({
          types: [2, 'a', 2],
          showAll: false,
          metric: 'late',
          due: ['overdue', 'x'],
        }),
      ).toEqual({
        types: [2],
        showAll: false,
        metric: 'late',
        due: ['overdue'],
      });
      expect(sameChoice(DEFAULT_CHOICE, { ...DEFAULT_CHOICE })).toBe(true);
      expect(sameChoice(DEFAULT_CHOICE, { ...DEFAULT_CHOICE, types: [1] })).toBe(false);
    });
  });

  describe('lines', () => {
    it('the default chart is Created and Completed of All task types, plus the ticked Due dates lines', () => {
      const v = buildView(DEFAULT_CHOICE, DATA, new Map(), DATA.types);
      expect(v.defaultMode).toBe(true);
      expect(v.lines.map((l) => [l.key, l.values.join()])).toEqual([
        ['all-created', '1,2'],
        ['all-completed', '2,3'],
      ]);
      expect(v.lines[0].style).toBe(MEASURE_STYLES.created);
      const due = buildView(
        { ...DEFAULT_CHOICE, due: ['overdue', 'late'] },
        DATA,
        new Map(),
        DATA.types,
      );
      expect(due.lines.map((l) => l.key)).toEqual([
        'all-created',
        'all-completed',
        'all-overdue',
        'all-late',
      ]);
      expect(due.lines[2].values).toEqual([3, 4]);
      const hidden = buildView(
        { ...DEFAULT_CHOICE, showAll: false, due: ['onTime'] },
        DATA,
        new Map(),
        DATA.types,
      );
      expect(hidden.lines.map((l) => l.key)).toEqual(['all-onTime']);
      expect(
        buildView({ ...DEFAULT_CHOICE, showAll: false }, DATA, new Map(), DATA.types).lines,
      ).toEqual([]);
    });

    it('with task types checked one metric is drawn for All and for each type, the Due dates lines are not', () => {
      const choice: TrendChoice = {
        types: [7, 5],
        showAll: true,
        metric: 'overdue',
        due: ['late'],
      };
      const v = buildView(
        choice,
        DATA,
        new Map([
          [7, 0],
          [5, 3],
        ]),
        DATA.types,
      );
      expect(v.defaultMode).toBe(false);
      expect(v.lines.map((l) => [l.key, l.values.join()])).toEqual([
        ['all', '3,4'],
        ['type-7', '32,42'],
        ['type-5', '12,22'],
      ]);
      expect(v.lines[0].style).toBe(ALL_STYLE);
      expect(v.lines[1].style).toBe(TYPE_STYLES[0]);
      expect(v.lines[2].style).toBe(TYPE_STYLES[3]);
      expect(v.lines[1].typeId).toBe(7);
      expect(v.measures).toEqual(['overdue']);
      expect(
        buildView(
          { ...choice, showAll: false },
          DATA,
          new Map([
            [7, 0],
            [5, 3],
          ]),
          DATA.types,
        ).lines.length,
      ).toBe(2);
    });

    it('names the chart after what it draws', () => {
      expect(chartHeading(['created', 'completed'])).toBe('Tasks created and completed per day');
      expect(chartHeading(['created'])).toBe('Tasks created per day');
      expect(chartHeading(['overdue'])).toBe('Overdue tasks at the end of each day');
      expect(chartHeading(['created', 'completed', 'overdue'])).toBe(
        'Tasks created, completed and overdue per day',
      );
      expect(chartHeading([])).toBe('Tasks per day');
    });

    it('gives a type the lowest free colour slot', () => {
      expect(freeSlot(new Map())).toBe(0);
      expect(
        freeSlot(
          new Map([
            [1, 0],
            [2, 2],
          ]),
        ),
      ).toBe(1);
      expect(MAX_TYPES).toBe(TYPE_STYLES.length);
    });
  });

  describe('legend and links', () => {
    it('sorts types by the total of the shown metric, largest first, then by name', () => {
      const types = [
        type(1, 'Zed', 5),
        type(2, 'Alpha', 5),
        type(3, 'Mid', 9),
        type(4, 'Idle', 0, 12),
      ];
      expect(typeRows(types, 'created').map((r) => r.name)).toEqual([
        'Mid',
        'Alpha',
        'Zed',
        'Idle',
      ]);
      expect(typeRows(types, 'completed').map((r) => r.name)).toEqual([
        'Idle',
        'Alpha',
        'Mid',
        'Zed',
      ]);
      expect(typeRows(types, 'created')[0].query).toBe('createdFrom=2026-10-01&type=3');
      expect(typeRows(types, 'overdue')[0].query).toContain('overdue=true');
    });

    it('builds the Task Queue query of a day, filtered by task type, and says when the link lists more than is counted', () => {
      expect(dayQuery('created', '2026-10-02', 5, false)).toBe(
        'createdFrom=2026-10-02&createdTo=2026-10-02&type=5',
      );
      expect(dayQuery('completed', '2026-10-02', null, false)).toBe(
        'status=COMPLETED&completedFrom=2026-10-02&completedTo=2026-10-02',
      );
      expect(dayQuery('overdue', '2026-10-02', 5, false)).toBe(
        'status=NEW&status=IN_PROGRESS&status=ON_HOLD&dueTo=2026-10-02&type=5',
      );
      expect(dayQuery('overdue', '2026-10-02', null, true)).toBe(
        'status=NEW&status=IN_PROGRESS&status=ON_HOLD&overdue=true',
      );
      expect(dayQuery('late', '2026-10-02', 7, false)).toContain('status=COMPLETED');
      expect(linkNote('created')).toBeNull();
      expect(linkNote('overdue')).toContain('still open');
      expect(linkNote('onTime')).toContain('every task completed');
    });
  });
});
