import { convertToParamMap } from '@angular/router';
import { WorkloadUser } from '../../../api/generated/api-client';
import { assignHint } from './users-assign';
import { backOnText, bandOf } from './users-card';
import {
  DEFAULT_FILTERS,
  apiAvailability,
  cardState,
  cardSummary,
  countsOf,
  filterCount,
  filterUsers,
  filtersFromParams,
  filtersToParams,
  hasFilterParams,
  loadLevelOf,
  podsOf,
  segmentsOf,
  sortUsers,
  thresholdText,
  toneOf,
  unassignedQueueParams,
  userQueueParams,
} from './users-model';
import { LEGEND, aBoard, aUser, outOfOffice } from './users-testing';

describe('users model', () => {
  const ann = aUser(1, 'Ann Lee', [1, 2, 0, 0], { overdue: 2 });
  const bob = aUser(2, 'Bob Ray', [0, 0, 5, 1]);
  const cy = aUser(3, 'Cy Tan');
  const dee = aUser(4, 'Dee Fox', [0, 1, 0, 0], { availability: outOfOffice });
  const eve = aUser(5, 'Eve Kim', [0, 0, 0, 2], {
    availability: { state: 'OFF_HOURS', outUntil: undefined, note: undefined },
  });
  const all = [dee, bob, ann, eve, cy];
  const names = (list: WorkloadUser[]) => list.map((u) => u.displayName);

  describe('state and colour', () => {
    it('out of office wins, then nothing open is free, else busy', () => {
      expect(cardState(dee)).toBe('ooo');
      expect(cardState(cy)).toBe('free');
      expect(cardState(ann)).toBe('busy');
      expect(cardState(eve)).toBe('busy');
    });

    it('colours the card by the highest priority of the open tasks (token or hex), never by a count', () => {
      expect(toneOf(ann)).toBe('critical');
      expect(toneOf(bob)).toBe('normal');
      expect(toneOf(cy)).toBe('free');
      expect(toneOf(dee)).toBe('ooo');
      const custom = aUser(9, 'Zed', [0, 1, 0, 0], {
        topPriority: { priorityId: 2, label: 'Urgent', color: '#7A1FA2', rank: 2, count: 1 },
      });
      expect(toneOf(custom)).toBe('#7A1FA2');
    });

    it('the band label (tooltip words) keeps the priority label after a rename', () => {
      expect(bandOf(ann).label).toBe('Highest priority: Critical');
      const renamed = aUser(9, 'Zed', [0, 1, 0, 0], {
        topPriority: { priorityId: 2, label: 'Rush', color: 'high', rank: 2, count: 1 },
      });
      expect(bandOf(renamed).label).toBe('Highest priority: Rush');
      expect(bandOf(cy).label).toBe('No open tasks');
      expect(bandOf(dee).label).toBe('Out of office');
    });

    it('reads the load level and falls back to Free for an unknown one', () => {
      expect(loadLevelOf(ann)).toBe('LIGHT');
      expect(loadLevelOf(aUser(1, 'X', [9, 0, 0, 0]))).toBe('HEAVY');
      expect(loadLevelOf({ loadLevel: 'weird' })).toBe('IDLE');
    });
  });

  describe('counts and the load bar', () => {
    it('lists a count per legend priority in rank order, zeros included', () => {
      expect(countsOf(ann, LEGEND).map((c) => [c.priority.label, c.count])).toEqual([
        ['Critical', 1],
        ['High', 2],
        ['Normal', 0],
        ['Low', 0],
      ]);
    });

    it('splits the bar by priority in rank order against the Normal ceiling', () => {
      const segs = segmentsOf(bob, LEGEND, { lightMax: 3, normalMax: 8 });
      expect(segs.map((s) => [s.label, s.count, s.percent])).toEqual([
        ['Normal', 5, 62.5],
        ['Low', 1, 12.5],
      ]);
      // More tasks than the ceiling: the bar is full and shares add up to 100.
      const heavy = aUser(7, 'Heavy One', [6, 6, 0, 0]);
      const total = segmentsOf(heavy, LEGEND, { lightMax: 3, normalMax: 8 }).reduce(
        (n, s) => n + s.percent,
        0,
      );
      expect(total).toBeCloseTo(100);
      expect(segmentsOf(cy, LEGEND, null)).toEqual([]);
    });

    it('explains the thresholds from the configuration', () => {
      expect(thresholdText({ lightMax: 2, normalMax: 5 })).toEqual([
        'Idle: no open tasks.',
        'Light: 1 to 2 open tasks.',
        'Normal: 3 to 5 open tasks.',
        'Heavy: more than 5 open tasks.',
      ]);
      expect(thresholdText(null)[3]).toBe('Heavy: more than 8 open tasks.');
    });
  });

  describe('sorting', () => {
    it('availability and load: available, then off hours, then out of office; lighter first; then name', () => {
      expect(names(sortUsers(all, 'load'))).toEqual([
        'Cy Tan',
        'Ann Lee',
        'Bob Ray',
        'Eve Kim',
        'Dee Fox',
      ]);
    });

    it('by name, by highest priority (nobody-open last) and by open tasks', () => {
      expect(names(sortUsers(all, 'name'))).toEqual([
        'Ann Lee',
        'Bob Ray',
        'Cy Tan',
        'Dee Fox',
        'Eve Kim',
      ]);
      expect(names(sortUsers(all, 'priority'))).toEqual([
        'Ann Lee',
        'Dee Fox',
        'Bob Ray',
        'Eve Kim',
        'Cy Tan',
      ]);
      expect(names(sortUsers(all, 'open'))).toEqual([
        'Bob Ray',
        'Ann Lee',
        'Eve Kim',
        'Dee Fox',
        'Cy Tan',
      ]);
    });

    it('does not change the list it is given', () => {
      const copy = [...all];
      sortUsers(all, 'name');
      expect(all).toEqual(copy);
    });
  });

  describe('filters and the address', () => {
    it('reads valid parameters and ignores the rest', () => {
      const f = filtersFromParams(convertToParamMap({ upod: '3', uavail: 'out', uq: ' ann ' }));
      expect(f).toEqual({ ...DEFAULT_FILTERS, pod: 3, availability: 'out', q: 'ann' });
      expect(filtersFromParams(convertToParamMap({ upod: 'x', uavail: 'nope' }))).toEqual(
        DEFAULT_FILTERS,
      );
      expect(
        filtersFromParams(
          convertToParamMap({ uload: 'heavy,bogus,idle', uprio: '2', uavail: 'off' }),
        ),
      ).toEqual({ ...DEFAULT_FILTERS, load: ['idle', 'heavy'], priority: 2, availability: 'off' });
      expect(hasFilterParams(convertToParamMap({ uq: 'a' }))).toBe(true);
      expect(hasFilterParams(convertToParamMap({ uload: 'idle' }))).toBe(true);
      expect(hasFilterParams(convertToParamMap({ tab: 'users' }))).toBe(false);
    });

    it('writes only what is set (null removes a parameter) and counts the filters', () => {
      expect(filtersToParams(DEFAULT_FILTERS)).toEqual({
        upod: null,
        uavail: null,
        uq: null,
        uload: null,
        uprio: null,
      });
      const f = {
        pod: 2,
        availability: 'available' as const,
        q: 'x',
        load: ['idle' as const, 'heavy' as const],
        priority: 1,
      };
      expect(filtersToParams(f)).toEqual({
        upod: '2',
        uavail: 'available',
        uq: 'x',
        uload: 'idle,heavy',
        uprio: '1',
      });
      expect(filterCount(f)).toBe(5);
      expect(filterCount(DEFAULT_FILTERS)).toBe(0);
    });

    it('applies load, priority and off hours on the page; off hours is read from the API as all', () => {
      const f = (patch: Partial<typeof DEFAULT_FILTERS>) => ({ ...DEFAULT_FILTERS, ...patch });
      expect(names(filterUsers(all, f({ load: ['idle'] })))).toEqual(['Cy Tan']);
      expect(names(filterUsers(all, f({ load: ['light', 'heavy'] })))).toEqual([
        'Dee Fox',
        'Ann Lee',
        'Eve Kim',
      ]);
      // priority: the highest open priority is the person's tone (Critical = 1, High = 2, Normal = 3)
      expect(names(filterUsers(all, f({ priority: 1 })))).toEqual(['Ann Lee']);
      expect(names(filterUsers(all, f({ priority: 3 })))).toEqual(['Bob Ray']);
      expect(names(filterUsers(all, f({ availability: 'off' })))).toEqual(['Eve Kim']);
      expect(apiAvailability(f({ availability: 'off' }))).toBe('all');
      expect(apiAvailability(f({ availability: 'out' }))).toBe('out');
      expect(filterUsers(all, DEFAULT_FILTERS)).toHaveLength(all.length);
    });

    it('collects the pods seen on the board', () => {
      const pods = podsOf(
        aBoard([
          ann,
          aUser(8, 'Pat Poe', [0, 0, 0, 0], {
            pods: [{ podId: 4, name: 'Pod D', isPrimary: false }],
          }),
        ]),
      );
      expect([...pods]).toEqual([
        [1, 'Pod A'],
        [4, 'Pod D'],
      ]);
    });
  });

  describe('text and links', () => {
    it('summarises a card in one sentence for assistive technology', () => {
      expect(cardSummary(ann, 'Available')).toBe(
        'Ann Lee. 3 open tasks, highest priority Critical, 2 overdue, light load',
      );
      expect(cardSummary(cy, 'Available')).toBe('Cy Tan. No open tasks');
      expect(cardSummary(dee, 'Out of office until Oct 20')).toBe(
        'Dee Fox. Out of office until Oct 20. Annual leave. 1 open task, highest priority High, light load',
      );
      expect(
        cardSummary(
          aUser(7, 'Gus Roe', [0, 0, 0, 0], { availability: outOfOffice }),
          'Out of office until Oct 20',
        ),
      ).toBe('Gus Roe. Out of office until Oct 20. Annual leave. No open tasks');
      expect(
        cardSummary(aUser(8, 'Hal Moe', [0, 0, 1, 0], { dueSoon: 1, onHold: 2 }), 'Available'),
      ).toBe('Hal Moe. 1 open task, highest priority Normal, 1 due soon, 2 on hold, light load');
      expect(cardSummary(eve, 'Off hours')).toContain('Eve Kim. Off hours. 2 open tasks');
    });

    it('says when someone is back: the day of the last absence plus one, in the viewer zone', () => {
      const now = new Date('2026-10-15T12:00:00Z');
      expect(backOnText('2026-10-21T00:00:00Z', 'UTC', now)).toBe('Back on Oct 21');
      expect(backOnText(undefined, 'UTC', now)).toBeNull();
      expect(backOnText('2027-01-02T00:00:00Z', 'UTC', now)).toBe('Back on Jan 2, 2027');
    });

    it('links to the Task Queue filtered by person and by unassigned', () => {
      expect(userQueueParams(7)).toEqual({
        status: ['NEW', 'IN_PROGRESS', 'ON_HOLD'],
        assignee: ['7'],
        sort: 'priority',
        dir: 'asc',
      });
      expect(unassignedQueueParams()).toEqual({
        status: ['NEW', 'IN_PROGRESS', 'ON_HOLD'],
        unassigned: 'true',
        sort: 'priorityAge',
        dir: 'asc',
      });
    });

    it('hints when the person is out of office or heavy, and not otherwise', () => {
      const now = new Date('2026-10-15T12:00:00Z');
      expect(assignHint(dee, null, 'UTC', now)).toContain(
        'not available (out of office until Oct 20)',
      );
      expect(assignHint(dee, null, 'UTC', now)).toContain('You can still assign work.');
      const heavy = aUser(6, 'Hal Moe', [5, 5, 0, 0]);
      expect(assignHint(heavy, { lightMax: 3, normalMax: 8 }, 'UTC', now)).toContain(
        'heavy load (10 open tasks, more than 8)',
      );
      expect(assignHint(ann, null, 'UTC', now)).toBeNull();
      expect(assignHint(cy, null, 'UTC', now)).toBeNull();
    });
  });
});
