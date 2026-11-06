import { DEFAULT_COLUMNS, WORK_COLUMNS, defaultColumns, normalizeColumns } from './column-prefs';

/**
 * The standard task columns (LC-03, decision AR 5 to 7): one order and one set of names on every task list. The registry order is the order of the
 * tables and of the Columns menus, so this one spec reads it for Task Queue, My Work, Pod Work and (through `STANDARD`) the Matter Tasks tab.
 */
const STANDARD = [
  'Ref',
  'Type',
  'Title',
  'CM Number',
  'Matter Name',
  'Project',
  'Priority',
  'Assignee',
  'Due',
  'Status',
  'Progress',
];

const label = (key: string) => WORK_COLUMNS.find((c) => c.key === key)!.label;
const labels = (scope: string) => defaultColumns(scope).map(label);
/** The standard names in the standard order, with the columns a scoped list leaves out removed. */
const without = (...names: string[]) => STANDARD.filter((n) => !names.includes(n));

describe('standard task columns', () => {
  it('names the columns the same on every list: CM Number, Progress, Type', () => {
    expect(label('matter')).toBe('CM Number');
    expect(label('progress')).toBe('Progress');
    expect(label('steps')).toBe('Progress');
    expect(label('type')).toBe('Type');
    expect(label('typeChip')).toBe('Type');
    expect(WORK_COLUMNS.map((c) => c.label)).not.toContain('Workflow progress');
    expect(WORK_COLUMNS.map((c) => c.label)).not.toContain('Matter Number');
  });

  it('shows the standard order in the Task Queue and Pod Work (global lists)', () => {
    expect(labels('taskQueue')).toEqual(STANDARD);
    // Pod Work: the same order without Matter Name (#1227; it is in the Columns menu).
    expect(labels('podWork')).toEqual(STANDARD.filter((l) => l !== 'Matter Name'));
    expect(labels('podWork.all')).toEqual(STANDARD.filter((l) => l !== 'Matter Name'));
  });

  it('keeps the order on My Work and drops the obvious columns: no Assignee; Closed in place of Due', () => {
    expect(labels('myWork.active')).toEqual(without('Assignee'));
    expect(labels('myWork.dueSoon')).toEqual(without('Assignee'));
    // The Closed tab: Closed takes the place of Due, directly before Status.
    expect(labels('myWork.closed')).toEqual([
      'Ref',
      'Type',
      'Title',
      'CM Number',
      'Matter Name',
      'Closed',
      'Status',
    ]);
    expect(labels('myWork.createdByMe')).toEqual([...without('Progress'), 'Age']);
  });

  it('lists every column the chooser offers in the registry order, so the Columns menu and the table agree', () => {
    const every = WORK_COLUMNS.filter((c) => !c.scopedOnly).map((c) => c.key);
    expect(normalizeColumns([...every].reverse())).toEqual(every);
    const idx = (k: string) => every.indexOf(k);
    expect(idx('ref')).toBeLessThan(idx('type'));
    expect(idx('type')).toBeLessThan(idx('title'));
    expect(idx('title')).toBeLessThan(idx('matter'));
    expect(idx('matter')).toBeLessThan(idx('matterName'));
    expect(idx('project')).toBeLessThan(idx('priority'));
    expect(idx('assignee')).toBeLessThan(idx('due'));
    expect(idx('due')).toBeLessThan(idx('closed'));
    expect(idx('closed')).toBeLessThan(idx('status'));
    expect(idx('status')).toBeLessThan(idx('progress'));
  });

  it('has a default set for no scope that is outside the registry', () => {
    const keys = new Set(WORK_COLUMNS.map((c) => c.key));
    for (const [scope, cols] of Object.entries(DEFAULT_COLUMNS)) {
      for (const k of cols) expect(keys.has(k), `${scope}: ${k}`).toBe(true);
    }
  });
});
