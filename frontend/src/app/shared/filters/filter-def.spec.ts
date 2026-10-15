import { convertToParamMap } from '@angular/router';
import {
  FilterDef,
  buildChips,
  hasFilterParams,
  isActive,
  parseFilters,
  parseValue,
  printText,
  rangeText,
  selectOptions,
  serializeFilters,
  serializeValue,
  valueText,
} from './filter-def';

const STATUS: FilterDef = {
  key: 'status',
  label: 'Status',
  column: 'status',
  type: 'select',
  default: 'active',
  options: [
    { value: 'active', label: 'Active' },
    { value: 'inactive', label: 'Inactive' },
    { value: 'all', label: 'All' },
  ],
};
const TYPE: FilterDef = {
  key: 'typeId',
  label: 'Type',
  type: 'select',
  allLabel: 'All types',
  options: [{ value: '4', label: 'Document Set' }],
};
const NAME: FilterDef = { key: 'name', label: 'Name', column: 'name', type: 'text' };
const PRIORITY: FilterDef = {
  key: 'priority',
  label: 'Priority',
  type: 'multiSelect',
  options: [
    { value: '1', label: 'Critical' },
    { value: '2', label: 'High' },
  ],
};
const ASSIGNEE: FilterDef = {
  key: 'assignee',
  label: 'Assignee',
  type: 'user',
  options: [{ value: '7', label: 'Ada' }],
  flagOptions: { unassigned: { param: 'unassigned', label: 'Unassigned' } },
};
const DUE: FilterDef = {
  key: 'due',
  label: 'Due',
  type: 'dateRange',
  fromParam: 'dueFrom',
  toParam: 'dueTo',
};
const AGE: FilterDef = { key: 'age', label: 'Age', type: 'numberRange' };
const OVERDUE: FilterDef = {
  key: 'overdue',
  label: 'Overdue',
  type: 'triState',
  options: [
    { value: '', label: 'Any' },
    { value: 'true', label: 'Overdue only' },
    { value: 'false', label: 'Not overdue' },
  ],
};
const map = (o: Record<string, string | string[]>) => convertToParamMap(o);

describe('filter definitions', () => {
  describe('reading the URL', () => {
    it('uses the default when the URL says nothing and the URL value when it does', () => {
      expect(parseValue(STATUS, map({}))).toBe('active');
      expect(parseValue(STATUS, map({ status: 'all' }))).toBe('all');
    });

    it('lets an empty parameter mean "explicitly nothing" against a default', () => {
      expect(parseValue(STATUS, map({ status: '' }))).toBe('');
      const open: FilterDef = { ...PRIORITY, default: ['1'] };
      expect(parseValue(open, map({}))).toEqual(['1']);
      expect(parseValue(open, map({ priority: '' }))).toEqual([]);
    });

    it('trims text, caps its length and applies the normalizer', () => {
      expect(parseValue(NAME, map({ name: '  acme  ' }))).toBe('acme');
      expect(parseValue({ ...NAME, maxLength: 3 }, map({ name: 'abcdef' }))).toBe('abc');
      const ids: FilterDef = { ...NAME, normalize: (v) => (/^\d+$/.test(v) ? v : null) };
      expect(parseValue(ids, map({ name: 'x' }))).toBe('');
    });

    it('reads repeated and comma separated list values once each, and flag options', () => {
      expect(parseValue(PRIORITY, map({ priority: ['1', '2,1'] }))).toEqual(['1', '2']);
      expect(parseValue(ASSIGNEE, map({ assignee: '7', unassigned: 'true' }))).toEqual([
        '7',
        'unassigned',
      ]);
      expect(parseValue(ASSIGNEE, map({ unassigned: 'false' }))).toEqual([]);
    });

    it('reads valid ISO dates and whole numbers only, either side alone', () => {
      expect(parseValue(DUE, map({ dueFrom: '2026-10-01', dueTo: '2026-02-30' }))).toEqual({
        from: '2026-10-01',
        to: '',
      });
      expect(parseValue(DUE, map({ dueFrom: 'soon' }))).toEqual({ from: '', to: '' });
      expect(parseValue(AGE, map({ ageFrom: '3', ageTo: 'x' }))).toEqual({ from: '3', to: '' });
    });

    it('reads a tri-state as true, false or nothing', () => {
      expect(parseValue(OVERDUE, map({ overdue: 'TRUE' }))).toBe('true');
      expect(parseValue(OVERDUE, map({ overdue: 'false' }))).toBe('false');
      expect(parseValue(OVERDUE, map({ overdue: 'maybe' }))).toBe('');
    });
  });

  describe('writing the URL', () => {
    it('omits a default and the empty value, keeps "explicitly nothing" against a default', () => {
      expect(serializeValue(STATUS, 'active')).toEqual({ status: null });
      expect(serializeValue(STATUS, 'all')).toEqual({ status: 'all' });
      expect(serializeValue(STATUS, '')).toEqual({ status: '' });
      expect(serializeValue(NAME, '')).toEqual({ name: null });
    });

    it('writes list values as repeated parameters and flag options as their own flag', () => {
      expect(serializeValue(PRIORITY, ['1', '2'])).toEqual({ priority: ['1', '2'] });
      expect(serializeValue(PRIORITY, [])).toEqual({ priority: null });
      expect(serializeValue(ASSIGNEE, ['7', 'unassigned'])).toEqual({
        assignee: ['7'],
        unassigned: 'true',
      });
      expect(serializeValue(ASSIGNEE, ['unassigned'])).toEqual({
        assignee: null,
        unassigned: 'true',
      });
    });

    it('writes ranges to their two parameters', () => {
      expect(serializeValue(DUE, { from: '2026-10-01', to: '' })).toEqual({
        dueFrom: '2026-10-01',
        dueTo: null,
      });
      expect(serializeValue(AGE, { from: '', to: '' })).toEqual({ ageFrom: null, ageTo: null });
    });

    it('round-trips every filter through the query string', () => {
      const defs = [STATUS, TYPE, NAME, PRIORITY, ASSIGNEE, DUE, AGE, OVERDUE];
      const input = {
        status: 'inactive',
        typeId: '4',
        name: 'bundle',
        priority: ['1', '2'],
        assignee: '7',
        unassigned: 'true',
        dueFrom: '2026-10-01',
        dueTo: '2026-10-16',
        ageFrom: '2',
        overdue: 'true',
      };
      const values = parseFilters(defs, map(input));
      const out = serializeFilters(defs, values);
      const written = Object.fromEntries(Object.entries(out).filter(([, v]) => v !== null));
      const norm = (o: Record<string, unknown>) =>
        Object.fromEntries(Object.entries(o).map(([k, v]) => [k, [v].flat()]));
      expect(norm(written)).toEqual(norm(input));
    });

    it('tells a deep link from a plain link', () => {
      expect(hasFilterParams([STATUS, NAME], map({}))).toBe(false);
      expect(hasFilterParams([STATUS, NAME], map({ page: '2', sort: 'name' }))).toBe(false);
      expect(hasFilterParams([STATUS, NAME], map({ name: 'a' }))).toBe(true);
      expect(hasFilterParams([ASSIGNEE], map({ unassigned: 'true' }))).toBe(true);
    });
  });

  describe('active filters', () => {
    it('does not count a default, counts anything else, including a cleared default', () => {
      expect(isActive(STATUS, 'active')).toBe(false);
      expect(isActive(STATUS, 'all')).toBe(true);
      expect(isActive(STATUS, '')).toBe(true);
      expect(isActive({ ...STATUS, defaultCounts: true }, 'active')).toBe(true);
      expect(isActive(NAME, '')).toBe(false);
      expect(isActive(PRIORITY, ['1'])).toBe(true);
      expect(isActive(DUE, { from: '', to: '' })).toBe(false);
    });
  });

  describe('words', () => {
    it('adds the leading "all" option of a select once', () => {
      expect(selectOptions(TYPE).map((o) => o.label)).toEqual(['All types', 'Document Set']);
      expect(selectOptions(STATUS)).toHaveLength(3);
    });

    it('makes one chip per chosen value, named for the filter, with the value left after removing it', () => {
      const chips = buildChips(PRIORITY, ['1', '2'], false);
      expect(chips.map((c) => c.label)).toEqual(['Priority: Critical', 'Priority: High']);
      expect(chips[0].remaining).toEqual(['2']);
      expect(buildChips(ASSIGNEE, ['7', 'unassigned'], false).map((c) => c.label)).toEqual([
        'Assignee: Ada',
        'Assignee: Unassigned',
      ]);
      expect(buildChips(NAME, 'acme', true)[0]).toMatchObject({
        label: 'Name: acme',
        hiddenColumn: true,
        column: 'name',
      });
      expect(buildChips(STATUS, 'active', false)).toEqual([]);
      expect(buildChips(STATUS, 'all', false)[0]).toMatchObject({
        label: 'Status: All',
        remaining: 'active',
      });
    });

    it('writes ranges the way the rest of the app writes dates', () => {
      expect(rangeText(DUE, { from: '2026-10-01', to: '2026-10-16' })).toBe(
        'Oct 1, 2026 to Oct 16, 2026',
      );
      expect(rangeText(DUE, { from: '2026-10-01', to: '' })).toBe('from Oct 1, 2026');
      expect(rangeText(DUE, { from: '', to: '2026-10-16' })).toBe('until Oct 16, 2026');
      expect(rangeText(AGE, { from: '3', to: '' })).toBe('3 or more');
      expect(valueText(OVERDUE, 'true')).toBe('Overdue only');
    });

    it('prints "Status Active"-style text for the print line', () => {
      expect(printText(STATUS, 'active')).toBe('Status Active');
      expect(printText(PRIORITY, ['1', '2'])).toBe('Priority Critical or High');
      expect(printText(DUE, { from: '2026-10-01', to: '' })).toBe('Due from Oct 1, 2026');
    });
  });
});
