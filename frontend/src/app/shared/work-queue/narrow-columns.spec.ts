import { WORK_COLUMNS } from './column-prefs';
import { NARROW_DROP_ORDER, TITLE_MIN_BOX_PX, narrowDrops } from './narrow-columns';
import { pxToRem } from './column-widths';

const defs = (...keys: string[]) => WORK_COLUMNS.filter((c) => keys.includes(c.key));
const ALL = WORK_COLUMNS.map((c) => c.key);

describe('narrow-box rule (#201)', () => {
  it('drops nothing in an unmeasured box and when the Title keeps 200 px', () => {
    expect(narrowDrops(defs(...ALL), 0, 14).size).toBe(0);
    // Ref 112 + Matter Number 144 + Priority 112 + Assignee 136 + Due 136 + Status 140 = 780; +200 = 980.
    const queue = defs('ref', 'title', 'matter', 'priority', 'assignee', 'due', 'status');
    expect(narrowDrops(queue, 980, 14).size).toBe(0);
    // The default set fits a 1098 px box with a Title of at least 300 px.
    expect(1098 - 780).toBeGreaterThanOrEqual(300);
  });

  it('drops in the defined order, one column at a time, only as far as needed', () => {
    const wide = defs(
      'ref',
      'title',
      'matter',
      'priority',
      'due',
      'status',
      'updated',
      'created',
      'age',
      'pod',
    );
    const fixed = 112 + 144 + 112 + 136 + 140;
    const full = fixed + 120 + 104 + 64 + 140 + TITLE_MIN_BOX_PX;
    expect([...narrowDrops(wide, full, 14)]).toEqual([]);
    expect([...narrowDrops(wide, full - 1, 14)]).toEqual(['updated']);
    expect([...narrowDrops(wide, full - 120 - 1, 14)]).toEqual(['updated', 'created']);
    expect([...narrowDrops(wide, 300, 14)]).toEqual(['updated', 'created', 'age', 'pod']);
  });

  it('never drops Priority, Due, Status, Assignee, Matter, Ref, Title or Closed', () => {
    const dropped = narrowDrops(defs(...ALL), 100, 14);
    for (const k of ['priority', 'due', 'status', 'assignee', 'matter', 'ref', 'title', 'closed'])
      expect(dropped.has(k)).toBe(false);
    expect([...dropped]).toEqual([...NARROW_DROP_ORDER]);
  });

  it('drops Matter Name first (#348) and never Matter Number', () => {
    const set = defs(
      'ref',
      'title',
      'matter',
      'matterName',
      'client',
      'priority',
      'assignee',
      'due',
      'status',
    );
    // 780 + 160 + 140 = 1080 px of columns: Matter Name goes first, then Client; Matter Number stays.
    expect([...narrowDrops(set, 1300, 14)]).toEqual([]);
    expect([...narrowDrops(set, 1250, 14)]).toEqual(['matterName']);
    expect([...narrowDrops(set, 1100, 14)]).toEqual(['matterName', 'client']);
    expect(NARROW_DROP_ORDER[1]).toBe('matterName');
    // A column the person added (Age) keeps its room at 1366: Matter Name alone goes.
    const withAge = defs(
      'ref',
      'title',
      'matter',
      'matterName',
      'progress',
      'priority',
      'due',
      'status',
      'age',
    );
    expect([...narrowDrops(withAge, 1098, 14)]).toEqual(['matterName']);
    // The Task Queue default with Matter Name needs a 1140 px box: a 1366 px window (1098) drops it, a 1440 px window (1172) keeps it.
    const dflt = defs(
      'ref',
      'title',
      'matter',
      'matterName',
      'priority',
      'assignee',
      'due',
      'status',
    );
    expect([...narrowDrops(dflt, 1098, 14)]).toEqual(['matterName']);
    expect([...narrowDrops(dflt, 1172, 14)]).toEqual([]);
    expect(narrowDrops(defs(...ALL), 100, 14).has('matter')).toBe(false);
  });

  it('drops a user-added Client and Task type first when the Title would go below 200 px', () => {
    const set = defs(
      'ref',
      'title',
      'matter',
      'client',
      'type',
      'priority',
      'assignee',
      'due',
      'status',
    );
    // 780 + 140 + 140 = 1060 px of columns: Task type goes first, then Client, and only as far as the Title needs.
    expect([...narrowDrops(set, 1200, 14)]).toEqual(['type']);
    expect([...narrowDrops(set, 1100, 14)]).toEqual(['type', 'client']);
  });

  it('follows the real root size and the widths the user chose', () => {
    const set = defs('ref', 'title', 'due', 'status', 'pod');
    // 112 + 136 + 140 + 140 = 528 px at 14 px; at a 18 px root the same rem columns are 679 px.
    expect(narrowDrops(set, 728, 14).size).toBe(0);
    expect(narrowDrops(set, 728, 18).has('pod')).toBe(true);
    expect(narrowDrops(set, 728, 14, { pod: pxToRem(280) }).has('pod')).toBe(true);
  });
});
