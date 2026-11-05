import { DashboardCapacity } from '../../../api/generated/api-client';
import { capacityOf, somePeople } from './dash-testing';
import {
  STATE_META,
  batteryView,
  formulaText,
  freeWord,
  levelOf,
  groupPeople,
  personDetail,
  rateHintText,
} from './capacity-model';

describe('batteryView', () => {
  const people = somePeople(12);
  const summary = capacityOf(people, 3);

  it('says the REMAINING capacity: the API freePercent is the charge and the number, named Remaining capacity', () => {
    const v = batteryView(summary);
    expect(v.mode).toBe('normal');
    expect(v.bigText).toBe(`${summary.freePercent}%`);
    expect(v.charge).toBe(summary.freePercent);
    expect(v.tooltip).toBe(`Remaining capacity ${summary.freePercent}%`);
    expect(v.ariaLabel).toContain(`Remaining capacity ${summary.freePercent} percent`);
    expect(v.ariaLabel).not.toContain('used');
  });

  it('steps the colour level at 50, 40, 30, 20 and 10 percent', () => {
    expect([100, 50, 49, 40, 39, 30, 29, 20, 19, 10, 9, 0].map(levelOf)).toEqual([
      0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5,
    ]);
  });

  it('says the unassigned waiting and the free slots in one line, and hides the waiting part when the caller may not see it', () => {
    const v = batteryView(capacityOf(people, 3, { unassignedWaiting: 9 }));
    expect(v.waiting).toBe(9);
    expect(v.summaryLine).toBe(`9 unassigned waiting, ${summary.freeSlots} free slots`);
    expect(v.freeText).toBe(`${summary.freeSlots} free slots`);
    const hidden = batteryView(summary);
    expect(hidden.waiting).toBeNull();
    expect(hidden.summaryLine).toBe(`${summary.freeSlots} free slots`);
    expect(batteryView({ ...summary, freeSlots: 1 }).freeText).toBe('1 free slot');
  });

  it('counts people outside work hours (decision AV): 10 of 12 are counted, so the off hours person adds free slots', () => {
    expect(summary.presentWorkers).toBe(10);
    expect(summary.totalSlots).toBe(30);
    const off = capacityOf(people, 3, { countOffHours: false });
    expect(off.presentWorkers).toBe(9);
    expect(summary.freeSlots).toBe(off.freeSlots + 3);
  });

  it('shows N tasks over capacity only above zero, with the singular for one', () => {
    const o = summary.overCapacityTasks;
    expect(batteryView(summary).overText).toBe(
      o ? `${o} ${o === 1 ? 'task' : 'tasks'} over capacity` : null,
    );
    expect(batteryView({ ...summary, overCapacityTasks: 0 }).overText).toBeNull();
    expect(batteryView({ ...summary, overCapacityTasks: 4 }).overText).toBe(
      '4 tasks over capacity',
    );
    expect(batteryView({ ...summary, overCapacityTasks: 1 }).overText).toBe('1 task over capacity');
  });

  it('has a legend of all six states whose counts add up to the workers', () => {
    const v = batteryView(summary);
    expect(v.legend.map((l) => l.label)).toEqual([
      'Available',
      'Occupied',
      'Busy',
      'Overloaded',
      'Out of Office',
      'Off Hours',
    ]);
    // The state name never changes; with the setting on the explanation is the tooltip (#1151).
    expect(v.legend.at(-1)!.hint).toBe('Outside work hours, still counted');
    expect(batteryView(capacityOf(people, 3, { countOffHours: false })).legend.at(-1)!.hint).toBe(
      null,
    );
    expect(v.legend.reduce((n, l) => n + l.count, 0)).toBe(12);
    expect(v.legend.map((l) => l.count)).toEqual([3, 3, 2, 1, 2, 1]);
    expect(v.legend.every((l) => l.icon.startsWith('pi-'))).toBe(true);
  });

  it('shows no After hours in normal use: everybody outside work hours still counts and the battery shows a percentage', () => {
    const evening = somePeople(6).map((p) => ({ ...p, state: 'OFF_HOURS' as const, load: 1 }));
    const v = batteryView(capacityOf(evening, 0));
    expect(v.mode).toBe('normal');
    expect(v.bigText).toBe('67%');
    expect(v.legend.at(-1)!.count).toBe(6);
  });

  it('says Holiday, neutral, when the server says nobody counts because of a holiday', () => {
    const v = batteryView({
      ...summary,
      state: 'HOLIDAY',
      usedPercent: undefined,
      freePercent: undefined,
    });
    expect(v.mode).toBe('holiday');
    expect(v.bigText).toBe('Holiday');
  });

  it('shows a neutral After hours state, never 100% used, only when the setting is off and nobody is at work', () => {
    const evening = somePeople(6).map((p) => ({ ...p, state: 'OFF_HOURS' as const }));
    const raw = capacityOf(evening, 0, { countOffHours: false });
    expect(raw.state).toBe('AFTER_HOURS');
    const v = batteryView(raw);
    expect(v.mode).toBe('after-hours');
    expect(v.bigText).toBe('After hours');
    expect(v.level).toBeNull();
    expect(v.bigText).not.toContain('100');
    expect(v.word).toBeNull();
  });

  it('says Everyone is out of office, neutral, when nobody is present and nobody is off hours', () => {
    const v = batteryView(
      capacityOf(
        somePeople(12).filter((p) => p.state === 'OUT_OF_OFFICE'),
        0,
      ),
    );
    expect(v.mode).toBe('all-out');
    expect(v.bigText).toBe('Everyone out');
    expect(v.tooltip).toBe('Everyone is out of office');
  });

  it('shows the empty state for no workers and no rate hint', () => {
    const none: DashboardCapacity = capacityOf([], 0);
    const v = batteryView({ ...none, assignedLastHour: 4 });
    expect(v.mode).toBe('empty');
    expect(v.summaryLine).toBe('No one in this scope takes work yet.');
    expect(v.rateHint).toBeNull();
  });

  it('words the rate hint, and drops it when the field is absent', () => {
    expect(rateHintText(3)).toBe('3 assigned in the last hour');
    expect(rateHintText(0)).toBe('0 assigned in the last hour');
    expect(rateHintText(undefined)).toBeNull();
    expect(rateHintText(null)).toBeNull();
    expect(batteryView({ ...summary, assignedLastHour: undefined }).rateHint).toBeNull();
  });

  it('names Healthy, Watch, Low and Critical by remaining capacity', () => {
    expect(freeWord(50)).toBe('Healthy');
    expect(freeWord(49)).toBe('Watch');
    expect(freeWord(30)).toBe('Watch');
    expect(freeWord(29)).toBe('Low');
    expect(freeWord(10)).toBe('Low');
    expect(freeWord(9)).toBe('Critical');
  });

  it('takes the slots per person into the formula', () => {
    expect(formulaText(3)).toContain('(3 x people who are at work)');
    expect(formulaText(3)).toContain('outside their work hours are counted');
    expect(formulaText(3, false)).toContain('After hours');
    expect(formulaText(4)).toContain('fewer than 4 open tasks');
    expect(formulaText(3)).toContain('On hold tasks do not count.');
  });
});

describe('People list', () => {
  const people = somePeople(12);

  it('groups by state in legend order and sorts names inside a group', () => {
    const groups = groupPeople(people, '');
    expect(groups.map((g) => g.state)).toEqual([
      'AVAILABLE',
      'OCCUPIED',
      'BUSY',
      'OVERLOADED',
      'OUT_OF_OFFICE',
      'OFF_HOURS',
    ]);
    for (const g of groups) {
      const names = g.people.map((p) => p.displayName);
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    }
    expect(groups.reduce((n, g) => n + g.people.length, 0)).toBe(12);
  });

  it('filters by name or state word and drops empty groups', () => {
    const byName = groupPeople(people, 'priya');
    expect(byName.flatMap((g) => g.people.map((p) => p.displayName))).toEqual(['Priya Nair']);
    const byState = groupPeople(people, 'out of office');
    expect(byState).toHaveLength(1);
    expect(byState[0].state).toBe('OUT_OF_OFFICE');
    expect(groupPeople(people, 'nobody by this name')).toEqual([]);
  });

  it('describes a person with the state word and the load', () => {
    expect(personDetail({ ...people[2], state: 'BUSY', load: 2 })).toBe('Busy, 2 open');
    expect(
      personDetail({ ...people[0], state: 'OUT_OF_OFFICE', load: 1, outUntil: '2026-11-06' }),
    ).toBe('Out of Office until 11/06');
    expect(STATE_META.OFF_HOURS.label).toBe('Off Hours');
  });
});
