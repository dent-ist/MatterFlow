import { convertToParamMap } from '@angular/router';
import { TYPE_STYLES } from '../../../shared/charts/chart-palette';
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
  TrendChoice,
  allVisible,
  FIRST_BACKLOG,
  backlogOptions,
  buildView,
  choiceFromParams,
  choiceFromStored,
  choiceToParams,
  cleanTypeIds,
  dayQuery,
  flowOptions,
  freeSlot,
  hasTrendParams,
  linkNote,
  namesBacklog,
  niceMax,
  niceScale,
  normalizeChoice,
  sameChoice,
  toggleAllMode,
  typeRows,
} from './trend-model';

const day = (date: string, n: number): DashboardTrendDay => ({
  date,
  created: n,
  completed: n + 1,
  overdue: n + 2,
  onTime: n + 3,
  late: n + 4,
  open: n + 100,
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
    open: 0,
    openQuery: `status=NEW&type=${id}`,
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
  describe('axis', () => {
    // [peak, expected top, expected ticks]
    const table: [number, number, number[]][] = [
      [0, 4, [0, 1, 2, 3, 4]],
      [1, 4, [0, 1, 2, 3, 4]],
      [3, 4, [0, 1, 2, 3, 4]],
      [7, 8, [0, 2, 4, 6, 8]],
      [21, 25, [0, 5, 10, 15, 20, 25]],
      [99, 150, [0, 50, 100, 150]],
      [100, 150, [0, 50, 100, 150]],
      [101, 150, [0, 50, 100, 150]],
      [152, 200, [0, 50, 100, 150, 200]],
      [1234, 1500, [0, 500, 1000, 1500]],
    ];
    it.each(table)('peak %d gives top %d', (peak, max, ticks) => {
      expect(niceMax(peak)).toBe(max);
      expect(niceScale(peak)).toEqual({ max, ticks });
    });

    it('peak 21 gives max 25, not 50, and every tick is a whole number on a round step', () => {
      expect(niceMax(21)).toBe(25);
      for (let peak = 0; peak <= 3000; peak += 7) {
        const { max, ticks } = niceScale(peak);
        expect(max).toBeGreaterThanOrEqual(Math.max(4, peak));
        expect(ticks[0]).toBe(0);
        expect(ticks[ticks.length - 1]).toBe(max);
        expect(ticks.length).toBeGreaterThanOrEqual(3);
        expect(ticks.length).toBeLessThanOrEqual(7);
        expect(ticks.every(Number.isInteger)).toBe(true);
      }
    });
  });

  describe('address and storage', () => {
    it('reads the choices from the address and falls back for anything invalid', () => {
      const c = choiceFromParams(params({ types: '3,x,3,-1,9', metric: 'late', all: '1' }));
      expect(c).toEqual({ types: [3, 9], all: 'on', metric: 'late', bmetric: 'open' });
      expect(choiceFromParams(params({ metric: 'nope' }))).toEqual(DEFAULT_CHOICE);
      expect(choiceFromParams(params({ all: '0' })).all).toBe('off');
      expect(hasTrendParams(params({ tab: 'trends' }))).toBe(false);
      expect(hasTrendParams(params({ types: '1' }))).toBe(true);
      expect(hasTrendParams(params({ bmetric: 'overdue' }))).toBe(true);
    });

    it('keeps at most eight ids and writes only what differs from the default', () => {
      expect(cleanTypeIds([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(cleanTypeIds(['4', 4, 0, 1.5, null])).toEqual([4]);
      expect(choiceToParams(DEFAULT_CHOICE)).toEqual({
        types: null,
        metric: null,
        bmetric: null,
        all: null,
        due: null,
      });
      const c: TrendChoice = { types: [1, 2], all: 'off', metric: 'onTime', bmetric: 'overdue' };
      expect(choiceToParams(c)).toEqual({
        types: '1,2',
        metric: 'ontime',
        bmetric: 'overdue',
        all: '0',
        due: null,
      });
      expect(choiceFromParams(params(choiceToParams(c) as Record<string, string>))).toEqual(c);
      const explicit: TrendChoice = { ...c, all: 'on', metric: 'completed' };
      expect(choiceToParams(explicit)['all']).toBe('1');
      expect(choiceFromParams(params(choiceToParams(explicit) as Record<string, string>))).toEqual(
        explicit,
      );
    });

    it('maps the legacy parameters: due=ontime / late are flow measures, metric=overdue and due=overdue are the backlog', () => {
      expect(choiceFromParams(params({ due: 'overdue,ontime' })).metric).toBe('onTime');
      expect(choiceFromParams(params({ due: 'late' })).metric).toBe('late');
      expect(choiceFromParams(params({ due: 'overdue' }))).toEqual({
        ...DEFAULT_CHOICE,
        bmetric: 'overdue',
      });
      // metric=overdue with types: the types are compared in the backlog panel (Overdue); the flow panel gets its first single measure.
      const legacy = choiceFromParams(params({ tab: 'trends', types: '5,7', metric: 'overdue' }));
      expect(legacy).toEqual({ types: [5, 7], all: 'auto', metric: 'created', bmetric: 'overdue' });
      expect(choiceFromParams(params({ types: '5', metric: 'onTime' })).metric).toBe('onTime');
      expect(namesBacklog(params({ due: 'ontime,overdue' }))).toBe(true);
      expect(namesBacklog(params({ types: '5', metric: 'overdue' }))).toBe(true);
      expect(namesBacklog(params({ types: '5' }))).toBe(false);
      // The legacy `due` is dropped from the address when the view is written back.
      expect(choiceToParams(choiceFromParams(params({ due: 'late' })))['due']).toBeNull();
    });

    it('reads stored choices defensively, including the first version of the storage', () => {
      expect(choiceFromStored(null)).toEqual(DEFAULT_CHOICE);
      expect(choiceFromStored('x')).toEqual(DEFAULT_CHOICE);
      expect(
        choiceFromStored({ types: [2, 'a', 2], all: 'on', metric: 'late', bmetric: 'overdue' }),
      ).toEqual({ types: [2], all: 'on', metric: 'late', bmetric: 'overdue' });
      // First version: `metric: created` next to no types meant the two-line chart; showAll true was the (automatic) default.
      expect(choiceFromStored({ types: [], showAll: true, metric: 'created', due: [] })).toEqual(
        DEFAULT_CHOICE,
      );
      expect(choiceFromStored({ types: [2], showAll: true, metric: 'completed', due: [] })).toEqual(
        { types: [2], all: 'auto', metric: 'completed', bmetric: 'open' },
      );
      expect(choiceFromStored({ types: [2], showAll: false, metric: 'overdue', due: [] }).all).toBe(
        'off',
      );
      expect(sameChoice(DEFAULT_CHOICE, { ...DEFAULT_CHOICE })).toBe(true);
      expect(sameChoice(DEFAULT_CHOICE, { ...DEFAULT_CHOICE, types: [1] })).toBe(false);
    });
  });

  describe('state machine', () => {
    it('picking the first type turns a two-line measure into the first single measure and says so', () => {
      const r = normalizeChoice({ ...DEFAULT_CHOICE, types: [5] }, DEFAULT_CHOICE);
      expect(r.choice.metric).toBe('created');
      expect(r.choice.bmetric).toBe(FIRST_BACKLOG);
      expect(r.announcement).toBe('Showing Created and Open to compare task types.');
      // A single measure stays and nothing is announced.
      const keep = normalizeChoice(
        { ...DEFAULT_CHOICE, types: [5], metric: 'late', bmetric: 'overdue' },
        null,
      );
      expect(keep.choice.metric).toBe('late');
      expect(keep.choice.bmetric).toBe('overdue');
      expect(keep.announcement).toBeNull();
      // Only the control that changed is named.
      expect(
        normalizeChoice({ ...DEFAULT_CHOICE, types: [5], bmetric: 'overdue' }, null).announcement,
      ).toBe('Showing Created to compare task types.');
    });

    it('All task types is automatic: hidden while types are compared, back when none is left', () => {
      expect(allVisible(DEFAULT_CHOICE)).toBe(true);
      expect(allVisible({ ...DEFAULT_CHOICE, types: [5], metric: 'created' })).toBe(false);
      const on: TrendChoice = { ...DEFAULT_CHOICE, types: [5], metric: 'created', all: 'on' };
      expect(allVisible(on)).toBe(true);
      // The user ticked All: it sticks. Removing the last type forgets an explicit choice that only made sense with types.
      expect(normalizeChoice({ ...on, types: [] }, on).choice.all).toBe('auto');
      // ... and Created, which picking the first type chose for the user, goes back to the two-line view; other measures stay.
      expect(normalizeChoice({ ...on, types: [] }, on).choice.metric).toBe('both');
      expect(normalizeChoice({ ...on, types: [], metric: 'late' }, on).choice.metric).toBe('late');
      // Open, which picking the first type chose for the backlog panel, goes back to Open and overdue; Overdue stays.
      const compared: TrendChoice = { ...on, bmetric: 'open' };
      expect(normalizeChoice({ ...compared, types: [] }, compared).choice.bmetric).toBe('both');
      const overdueKept: TrendChoice = { ...on, bmetric: 'overdue' };
      expect(normalizeChoice({ ...overdueKept, types: [] }, overdueKept).choice.bmetric).toBe(
        'overdue',
      );
      // Toggling: with types, ticking All is explicit; unticking it again is back to automatic.
      const auto: TrendChoice = { ...DEFAULT_CHOICE, types: [5], metric: 'created' };
      expect(toggleAllMode(auto).all).toBe('on');
      expect(toggleAllMode(on).all).toBe('auto');
      // Without types, unticking All is explicit (an empty chart), ticking it again is automatic.
      expect(toggleAllMode(DEFAULT_CHOICE).all).toBe('off');
      expect(toggleAllMode({ ...DEFAULT_CHOICE, all: 'off' }).all).toBe('auto');
    });

    it('offers the two-line measure only while no type is compared, and never a disabled option', () => {
      expect(flowOptions(DEFAULT_CHOICE)).toEqual([
        'both',
        'created',
        'completed',
        'onTime',
        'late',
      ]);
      expect(flowOptions({ ...DEFAULT_CHOICE, types: [5], metric: 'created' })).toEqual([
        'created',
        'completed',
        'onTime',
        'late',
      ]);
      expect(backlogOptions(DEFAULT_CHOICE)).toEqual(['both', 'open', 'overdue']);
      expect(backlogOptions({ ...DEFAULT_CHOICE, types: [5], bmetric: 'open' })).toEqual([
        'open',
        'overdue',
      ]);
    });
  });

  describe('lines', () => {
    it('the default view: panel 1 is Created and Completed of All task types, panel 2 is Open and Overdue of All', () => {
      const v = buildView(DEFAULT_CHOICE, DATA, new Map(), DATA.types);
      expect(v.defaultMode).toBe(true);
      expect(v.flows.lines.map((l) => [l.key, l.values.join()])).toEqual([
        ['flows-all-created', '1,2'],
        ['flows-all-completed', '2,3'],
      ]);
      expect(v.flows.lines[0].style).toBe(MEASURE_STYLES.created);
      expect(v.flows.height).toBe(320);
      expect(v.flows.title).toBe('Created and completed');
      expect(v.backlog.lines.map((l) => [l.key, l.panel, l.values.join()])).toEqual([
        ['backlog-all-open', 'backlog', '101,102'],
        ['backlog-all-overdue', 'backlog', '3,4'],
      ]);
      expect(v.backlog.lines[0].style).toBe(MEASURE_STYLES.open);
      expect(v.backlog.height).toBe(200);
      expect(v.backlog.title).toBe('Backlog at end of day');
      expect(v.flows.measureNote).toBeNull();
    });

    it('a single flow measure draws one line of All; On time and Completed late are flow measures', () => {
      const v = buildView({ ...DEFAULT_CHOICE, metric: 'onTime' }, DATA, new Map(), DATA.types);
      expect(v.flows.lines.map((l) => [l.name, l.values.join()])).toEqual([['On time', '4,5']]);
      expect(v.flows.title).toBe('Created and completed');
      const hidden = buildView({ ...DEFAULT_CHOICE, all: 'off' }, DATA, new Map(), DATA.types);
      expect(hidden.flows.lines).toEqual([]);
      expect(hidden.backlog.lines).toEqual([]);
    });

    it('with task types checked both panels compare them; All task types is hidden for scale unless ticked', () => {
      const slots = new Map([
        [7, 0],
        [5, 3],
      ]);
      const choice: TrendChoice = {
        types: [7, 5],
        all: 'auto',
        metric: 'completed',
        bmetric: 'overdue',
      };
      const v = buildView(choice, DATA, slots, DATA.types);
      expect(v.defaultMode).toBe(false);
      expect(v.flows.lines.map((l) => [l.key, l.values.join()])).toEqual([
        ['flows-type-7', '31,41'],
        ['flows-type-5', '11,21'],
      ]);
      expect(v.backlog.lines.map((l) => [l.key, l.values.join()])).toEqual([
        ['backlog-type-7', '32,42'],
        ['backlog-type-5', '12,22'],
      ]);
      expect(v.flows.lines[0].style).toBe(TYPE_STYLES[0]);
      expect(v.backlog.lines[1].style).toBe(TYPE_STYLES[3]);
      expect(v.flows.lines[0].typeId).toBe(7);
      expect(v.flows.measureNote).toBe('Completed');
      expect(v.backlog.measureNote).toBe('Overdue');
      const withAll = buildView({ ...choice, all: 'on' }, DATA, slots, DATA.types);
      expect(withAll.flows.lines.map((l) => l.key)).toEqual([
        'flows-all',
        'flows-type-7',
        'flows-type-5',
      ]);
      expect(withAll.flows.lines[0].style).toBe(ALL_STYLE);
      expect(withAll.backlog.lines[0].values).toEqual([3, 4]);
    });

    it('draws Open for All task types and for each compared type in panel 2', () => {
      const slots = new Map([[5, 0]]);
      const one = buildView({ ...DEFAULT_CHOICE, bmetric: 'open' }, DATA, slots, DATA.types);
      expect(one.backlog.lines.map((l) => [l.name, l.values.join()])).toEqual([
        ['Open', '101,102'],
      ]);
      const compared = buildView(
        { types: [5], all: 'auto', metric: 'created', bmetric: 'open' },
        DATA,
        slots,
        DATA.types,
      );
      expect(compared.backlog.lines.map((l) => [l.key, l.values.join()])).toEqual([
        ['backlog-type-5', '110,120'],
      ]);
      expect(compared.backlog.measureNote).toBe('Open');
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

    it('reads the backlog choice from the address, the legacy words and the storage', () => {
      expect(choiceFromParams(params({ bmetric: 'open' })).bmetric).toBe('open');
      expect(choiceFromParams(params({ bmetric: 'both' })).bmetric).toBe('both');
      expect(choiceFromParams(params({ bmetric: 'nope' })).bmetric).toBe('both');
      expect(choiceFromParams(params({ metric: 'overdue' })).bmetric).toBe('overdue');
      // A written address round-trips; `both` is the default and is not written.
      expect(choiceToParams({ ...DEFAULT_CHOICE, bmetric: 'open' })['bmetric']).toBe('open');
      expect(choiceToParams(DEFAULT_CHOICE)['bmetric']).toBeNull();
      expect(choiceFromStored({ types: [], bmetric: 'open' }).bmetric).toBe('open');
      expect(choiceFromStored({ types: [], bmetric: 'x' }).bmetric).toBe('both');
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
      expect(dayQuery('open', '2026-10-02', 5, false)).toBe(
        'status=NEW&status=IN_PROGRESS&status=ON_HOLD&createdTo=2026-10-02&type=5',
      );
      expect(dayQuery('open', '2026-10-02', null, true)).toBe(
        'status=NEW&status=IN_PROGRESS&status=ON_HOLD',
      );
      expect(linkNote('open')).toContain('created by that day');
      expect(linkNote('created')).toBeNull();
      expect(linkNote('overdue')).toContain('still open');
      expect(linkNote('onTime')).toContain('every task completed');
    });
  });
});
