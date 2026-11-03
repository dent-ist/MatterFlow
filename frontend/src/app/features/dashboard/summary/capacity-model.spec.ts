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

  it('reads 8 of 12 can take work now with four people out or off', () => {
    const v = batteryView(summary);
    expect(v.summaryLine).toBe('8 of 12 can take work now');
  });

  it('has a legend of all six states whose counts add up to the workers', () => {
    const v = batteryView(summary);
    expect(v.legend.map((l) => l.label)).toEqual([
      'Available',
      'Occupied',
      'Busy',
      'Overloaded',
      'Out of office',
      'Off hours',
    ]);
    expect(v.legend.reduce((n, l) => n + l.count, 0)).toBe(12);
    expect(v.legend.map((l) => l.count)).toEqual([3, 3, 2, 1, 2, 1]);
    expect(v.legend.every((l) => l.icon.startsWith('pi-'))).toBe(true);
  });

  it('shows a neutral After hours state, never 100% used, when the API sends usedPercent null', () => {
    const v = batteryView({
      ...summary,
      state: 'AFTER_HOURS',
      usedPercent: undefined,
      freePercent: undefined,
      canTakeWork: 0,
    });
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
    expect(formulaText(3)).toContain('(3 x people who are at work now)');
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
    ).toBe('Out of office until 11/06');
    expect(STATE_META.OFF_HOURS.label).toBe('Off hours');
  });
});
