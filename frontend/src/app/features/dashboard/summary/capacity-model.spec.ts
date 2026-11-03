import { CapacitySummary } from '../dash-v4-contract';
import { capacityOf, fixturePeople } from '../dash-v4-fixtures';
import {
  STATE_META,
  batteryView,
  formulaText,
  freeWord,
  groupPeople,
  personDetail,
  rateHintText,
} from './capacity-model';

describe('batteryView', () => {
  const people = fixturePeople(12);
  const summary = capacityOf(people, 3);

  it('says Capacity used NN% with the number the API returned', () => {
    const v = batteryView(summary);
    expect(v.mode).toBe('normal');
    expect(v.bigText).toBe(`Capacity used ${summary.usedPercent}%`);
    expect(v.charge).toBe(summary.freePercent);
    expect(v.ariaLabel).toContain(`Capacity used ${summary.usedPercent} percent`);
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
    expect(v.legend.every((l) => l.icon.startsWith('pi-'))).toBe(true);
  });

  it('shows a neutral After hours state, never 100% used, when the API sends usedPercent null', () => {
    const v = batteryView({ ...summary, usedPercent: null, freePercent: 0, canTakeWork: 0 });
    expect(v.mode).toBe('after-hours');
    expect(v.bigText).toBe('After hours');
    expect(v.bigText).not.toContain('100');
    expect(v.word).toBeNull();
  });

  it('shows the empty state for no workers and no rate hint', () => {
    const none: CapacitySummary = capacityOf([], 0);
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

  it('names Healthy, Limited and Low by free capacity', () => {
    expect(freeWord(50)).toBe('Healthy');
    expect(freeWord(49)).toBe('Limited');
    expect(freeWord(25)).toBe('Limited');
    expect(freeWord(24)).toBe('Low');
  });

  it('takes the slots per person into the formula', () => {
    expect(formulaText(3)).toContain('(3 x people who take work)');
    expect(formulaText(4)).toContain('fewer than 4 open tasks');
    expect(formulaText(3)).toContain('On hold tasks do not count.');
  });
});

describe('People list', () => {
  const people = fixturePeople(12);

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
