import { ASSIGNEE_PX, SUMMARY_GRID_COLUMNS } from '../../features/dashboard/summary/dash-grid';
import { DEFAULT_GRID_PREFS, shownKeys } from '../ui/grid-prefs';
import { WORK_COLUMNS, defaultColumns } from './column-prefs';
import { ASSIGNEE_WITH_LINK_PX } from './column-widths';

/**
 * D-43a (#1230): the default columns of every global task grid fit the visible frame at 1366 (about 1,098 px): the widths of the default columns
 * plus a Title of at least 160 px add up to 1,098 px or less, so there is no sideways scroll and Status is whole. Everything else is one click away in Columns.
 */
const FRAME_1366_PX = 1098;
/** The Summary grid frame at 1366 while the right panel is shown (measured: the table area is 718 px, #1236). */
const SUMMARY_FRAME_PX = 718;
const TITLE_MIN_PX = WORK_COLUMNS.find((c) => c.key === 'title')!.minWidth;

const width = (key: string, assignee: number): number => {
  if (key === 'assignee') return assignee;
  return WORK_COLUMNS.find((c) => c.key === key)!.width;
};
/** The sum of the default columns without the Title (the spring), with the Assignee width of that grid. */
const sum = (keys: readonly string[], assignee: number): number =>
  keys.filter((k) => k !== 'title').reduce((n, k) => n + width(k, assignee), 0);

describe('default task columns fit the 1366 frame (D-43a, #1230)', () => {
  const scopes: [string, number][] = [
    ['taskQueue', 136],
    ['myWork.active', 136],
    ['myWork.dueSoon', 136],
    ['myWork.closed', 136],
    ['myWork.createdByMe', 136],
    ['podWork', ASSIGNEE_WITH_LINK_PX],
    ['podWork.all', ASSIGNEE_WITH_LINK_PX],
  ];

  it.each(scopes)(
    '%s: default widths plus the Title minimum (120 px) are at most 1,098 px',
    (scope, assignee) => {
      const keys = defaultColumns(scope);
      expect(sum(keys, assignee) + TITLE_MIN_PX, `${scope} ${keys.join(',')}`).toBeLessThanOrEqual(
        FRAME_1366_PX,
      );
    },
  );

  it('the Dashboard Summary grid fits the 718 px frame of 1366 with the right panel shown: Type, Title, Priority, Assignee, Due (#1236)', () => {
    const keys = shownKeys(SUMMARY_GRID_COLUMNS, DEFAULT_GRID_PREFS);
    expect(keys).toEqual(['type', 'title', 'priority', 'assignee', 'due']);
    expect(sum(keys, ASSIGNEE_PX) + TITLE_MIN_PX).toBeLessThanOrEqual(SUMMARY_FRAME_PX);
    // The Unassigned card swaps Due for "Unassigned for": the same room.
    const unassigned = keys.map((k) => (k === 'due' ? 'unassignedFor' : k));
    expect(sum(unassigned, ASSIGNEE_PX) + TITLE_MIN_PX).toBeLessThanOrEqual(SUMMARY_FRAME_PX);
  });

  it('Type is the chip and the name at 128 px (min 96, max 260; #1237); the Title minimum is 120 px', () => {
    const type = WORK_COLUMNS.find((c) => c.key === 'type')!;
    expect([type.width, type.minWidth, type.maxWidth]).toEqual([128, 96, 260]);
    expect(TITLE_MIN_PX).toBe(120);
  });

  it.each([
    ['taskQueue', 136, 160],
    ['myWork.active', 136, 160],
    ['podWork', ASSIGNEE_WITH_LINK_PX, 160],
    ['podWork.all', ASSIGNEE_WITH_LINK_PX, 160],
    ['myWork.dueSoon', 136, 160],
  ] as [string, number, number][])(
    '%s: at 1366 the Title keeps at least %i px of the 1,098 px frame (#1237, #1240)',
    (scope, assignee, least) => {
      expect(FRAME_1366_PX - sum(defaultColumns(scope), assignee)).toBeGreaterThanOrEqual(least);
    },
  );

  it('Project, Matter Name and Progress are off by default on every global list; CM Number stays', () => {
    for (const [scope] of scopes) {
      const keys = defaultColumns(scope);
      for (const off of ['project', 'matterName', 'progress'])
        expect(keys, `${scope} ${off}`).not.toContain(off);
      expect(keys, scope).toContain('matter');
    }
    const summary = shownKeys(SUMMARY_GRID_COLUMNS, DEFAULT_GRID_PREFS);
    for (const off of ['project', 'matterName', 'progress', 'ref', 'status'])
      expect(summary).not.toContain(off);
    expect(summary).not.toContain('matter');
  });
});
