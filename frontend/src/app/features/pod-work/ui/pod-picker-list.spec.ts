import { PodChoice } from '../../../api/generated/api-client';
import { groupPods, memberCountText, podFacts } from './pod-picker-list';

const pod = (over: Partial<PodChoice>): PodChoice => ({
  podId: 1,
  name: 'Pod',
  isMember: false,
  isPrimary: false,
  memberCount: 3,
  openCount: 9,
  unassignedCount: 2,
  overdueCount: 0,
  ...over,
});

describe('the pod list (#558)', () => {
  it('counts members with the right noun', () => {
    expect(memberCountText(1)).toBe('1 member');
    expect(memberCountText(0)).toBe('0 members');
    expect(memberCountText(23)).toBe('23 members');
  });

  it('says members and unassigned always, overdue only above zero', () => {
    expect(podFacts(pod({}))).toBe('3 members · 2 unassigned');
    expect(podFacts(pod({ overdueCount: 4, unassignedCount: 0, memberCount: 1 }))).toBe(
      '1 member · 0 unassigned · 4 overdue',
    );
  });

  it('groups Your pods before Other pods, alphabetical inside, never by load, and leaves an empty group out', () => {
    const groups = groupPods([
      pod({ podId: 1, name: 'Zulu', isMember: true, openCount: 1 }),
      pod({ podId: 2, name: 'Alpha', isMember: false, openCount: 99 }),
      pod({ podId: 3, name: 'Bravo', isMember: true, openCount: 50 }),
      pod({ podId: 4, name: 'Charlie', isMember: false, openCount: 0 }),
    ]);
    expect(groups.map((g) => [g.label, g.pods.map((p) => p.name)])).toEqual([
      ['Your pods', ['Bravo', 'Zulu']],
      ['Other pods', ['Alpha', 'Charlie']],
    ]);
    expect(groupPods([pod({ isMember: false })]).map((g) => g.label)).toEqual(['Other pods']);
    expect(groupPods([])).toEqual([]);
  });
});
