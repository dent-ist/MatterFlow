import { resultColumns } from './report-column-defs';
import { GridLayoutState, captureLayout, layoutKey, resolveLayout } from './report-view-layout';

const columns = resultColumns([
  { name: 'Matter', type: 'text' },
  { name: 'Hours', type: 'decimal' },
  { name: 'Open Tasks', type: 'integer' },
  { name: 'Due', type: 'date' },
  { name: 'Active', type: 'boolean' },
]);
const keys = columns.map((c) => c.key);
const col = (name: string, hidden = false, width?: number) => ({ name, hidden, width });

const state = (over: Partial<GridLayoutState> = {}): GridLayoutState => ({
  columns,
  order: keys,
  shown: keys,
  widths: {},
  sort: null,
  filterJson: undefined,
  pageSize: 50,
  ...over,
});

describe('saved view layout (#722)', () => {
  describe('captureLayout', () => {
    it('stores every column in the order of the grid, hidden ones flagged, with the widths the person set', () => {
      const layout = captureLayout(
        state({
          order: ['Hours', 'Matter', 'Open Tasks', 'Due', 'Active'],
          shown: ['Hours', 'Matter', 'Due'],
          widths: { Matter: 240, Hours: 100 },
        }),
      );
      expect(layout.columns).toEqual([
        { name: 'Hours', hidden: false, width: 100 },
        { name: 'Matter', hidden: false, width: 240 },
        { name: 'Open Tasks', hidden: true },
        { name: 'Due', hidden: false },
        { name: 'Active', hidden: true },
      ]);
      expect(layout.sort).toEqual([]);
      expect(layout.filters).toEqual([]);
      expect(layout.pageSize).toBe(50);
    });

    it('keeps a width inside what the server takes (80 to 640 px)', () => {
      const layout = captureLayout(state({ widths: { Matter: 72, Hours: 700 } }));
      expect(layout.columns!.map((c) => c.width)).toEqual([
        80,
        640,
        undefined,
        undefined,
        undefined,
      ]);
    });

    it('stores the sort by column name and direction, and the filters of the request as they are', () => {
      const filterJson = JSON.stringify([
        { column: 'Matter', op: 'contains', value: 'acme' },
        { column: 'Hours', op: 'between', value: '1', value2: '9' },
      ]);
      const layout = captureLayout(state({ sort: '-c2', filterJson, pageSize: 100 }));
      expect(layout.sort).toEqual([{ column: 'Open Tasks', descending: true }]);
      expect(layout.filters).toEqual([
        { column: 'Matter', op: 'contains', value: 'acme', value2: undefined },
        { column: 'Hours', op: 'between', value: '1', value2: '9' },
      ]);
      expect(layout.pageSize).toBe(100);
      expect(captureLayout(state({ sort: 'c0' })).sort).toEqual([
        { column: 'Matter', descending: false },
      ]);
    });

    it('ignores a sort id that is not a column', () => {
      expect(captureLayout(state({ sort: 'c99' })).sort).toEqual([]);
    });

    it('names a column by its own name even when it has a comma, and a column of a repeated name twice', () => {
      const odd = resultColumns([
        { name: 'a,b', type: 'text' },
        { name: 'a,b', type: 'text' },
      ]);
      const layout = captureLayout(
        state({ columns: odd, order: ['a,b (2)', 'a,b'], shown: ['a,b'], sort: '-c1' }),
      );
      expect(layout.columns).toEqual([
        { name: 'a,b', hidden: true },
        { name: 'a,b', hidden: false },
      ]);
      expect(layout.sort).toEqual([{ column: 'a,b', descending: true }]);
    });
  });

  describe('resolveLayout', () => {
    it('gives back the order, the hidden columns and the widths of a captured layout', () => {
      const s = state({
        order: ['Hours', 'Matter', 'Open Tasks', 'Due', 'Active'],
        shown: ['Hours', 'Matter', 'Due'],
        widths: { Matter: 240 },
        sort: '-c2',
        filterJson: JSON.stringify([
          { column: 'Matter', op: 'contains', value: 'acme' },
          { column: 'Hours', op: 'between', value: '1', value2: '9' },
          { column: 'Open Tasks', op: 'gte', value: '3' },
          { column: 'Due', op: 'onOrBefore', value: '2026-03-31' },
          { column: 'Active', op: 'eq', value: 'false' },
        ]),
        pageSize: 250,
      });
      const r = resolveLayout(captureLayout(s), columns);
      expect(r.prefs.order).toEqual(['Hours', 'Matter', 'Open Tasks', 'Due', 'Active']);
      expect(r.prefs.visible).toEqual(['Hours', 'Matter', 'Due']);
      expect(r.widths).toEqual({ Matter: 240 });
      expect(r.sort).toBe('-c2');
      expect(r.filters).toEqual({
        c0: 'acme',
        c1: { from: '1', to: '9' },
        c2: { from: '3', to: '' },
        c3: { from: '', to: '2026-03-31' },
        c4: 'false',
      });
      expect(r.pageSize).toBe(250);
      expect(r.skipped).toBe(false);
    });

    it('is the inverse of captureLayout: the same state captures the same layout again', () => {
      const s = state({
        order: ['Due', 'Matter', 'Hours', 'Open Tasks', 'Active'],
        shown: ['Due', 'Matter'],
      });
      const layout = captureLayout(s);
      const r = resolveLayout(layout, columns);
      const again = captureLayout(
        state({
          order: r.prefs.order as string[],
          shown: r.prefs.visible as string[],
          widths: r.widths,
          sort: r.sort,
          pageSize: r.pageSize,
        }),
      );
      expect(layoutKey(again)).toBe(layoutKey(layout));
    });

    it('skips a column the result lacks and says so, also for a sort or a filter on it (spec 6.2)', () => {
      const r = resolveLayout(
        {
          columns: [col('Matter'), col('Gone', false, 100), col('Hours', true)],
          sort: [{ column: 'Gone', descending: false }],
          filters: [{ column: 'Gone', op: 'contains', value: 'x', value2: undefined }],
          pageSize: 50,
        },
        columns,
      );
      expect(r.skipped).toBe(true);
      expect(r.sort).toBeNull();
      expect(r.filters).toEqual({});
      expect(r.widths).toEqual({});
      // Matter and Hours come first in the view's order, the rest follow; Hours stays hidden.
      expect(r.prefs.order).toEqual(['Matter', 'Hours', 'Open Tasks', 'Due', 'Active']);
      expect(r.prefs.visible).toEqual(['Matter', 'Open Tasks', 'Due', 'Active']);
    });

    it('appends a column that is new in the result and not in the view, visible, at the end', () => {
      const r = resolveLayout(
        { columns: [col('Due')], sort: [], filters: [], pageSize: 50 },
        columns,
      );
      expect(r.skipped).toBe(false);
      expect(r.prefs.order).toEqual(['Due', 'Matter', 'Hours', 'Open Tasks', 'Active']);
      expect(r.prefs.visible).toEqual(['Due', 'Matter', 'Hours', 'Open Tasks', 'Active']);
    });

    it('shows every column when a view hides all of them', () => {
      const r = resolveLayout(
        {
          columns: keys.map((name) => col(name, true)),
          sort: [],
          filters: [],
          pageSize: 50,
        },
        columns,
      );
      expect(r.prefs.visible).toEqual(keys);
    });

    it('takes the first sort key only (one sort column) and a page size the pager offers, else 50', () => {
      const r = resolveLayout(
        {
          columns: [],
          sort: [
            { column: 'Hours', descending: true },
            { column: 'Matter', descending: false },
          ],
          filters: [],
          pageSize: 75,
        },
        columns,
      );
      expect(r.sort).toBe('-c1');
      expect(r.pageSize).toBe(50);
    });

    it('drops a filter this screen cannot show (an operator the server takes but the filter row has no control for)', () => {
      const r = resolveLayout(
        {
          columns: [],
          sort: [],
          filters: [
            { column: 'Matter', op: 'equals', value: 'x', value2: undefined },
            { column: 'Hours', op: 'gt', value: '3', value2: undefined },
            { column: 'Active', op: 'eq', value: 'maybe', value2: undefined },
          ],
          pageSize: 50,
        },
        columns,
      );
      expect(r.filters).toEqual({});
      expect(r.skipped).toBe(false);
    });

    it('tells two columns of one name apart by their order', () => {
      const twin = resultColumns([
        { name: 'Total', type: 'integer' },
        { name: 'Total', type: 'integer' },
      ]);
      const r = resolveLayout(
        {
          columns: [col('Total', true), col('Total', false, 150)],
          sort: [],
          filters: [],
          pageSize: 50,
        },
        twin,
      );
      expect(r.prefs.order).toEqual(['Total', 'Total (2)']);
      expect(r.prefs.visible).toEqual(['Total (2)']);
      expect(r.widths).toEqual({ 'Total (2)': 150 });
    });
  });

  it('compares layouts by what they hold, not by how they were built', () => {
    const a = captureLayout(state());
    const b = captureLayout(state({ widths: { Matter: 300 } }));
    expect(layoutKey(a)).toBe(layoutKey(captureLayout(state())));
    expect(layoutKey(a)).not.toBe(layoutKey(b));
    expect(layoutKey({ columns: [], sort: [], filters: [], pageSize: undefined })).toBe(
      layoutKey({ columns: [], sort: [], filters: [], pageSize: 50 }),
    );
  });
});
