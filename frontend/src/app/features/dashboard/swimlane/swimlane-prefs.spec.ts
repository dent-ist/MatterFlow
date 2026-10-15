import { TestBed } from '@angular/core/testing';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../../core/auth/auth-testing';
import { AuthStore } from '../../../core/auth/auth.store';
import { SwimlanePrefs } from './swimlane-prefs';

describe('SwimlanePrefs', () => {
  async function prefs(userId = 7) {
    TestBed.configureTestingModule({
      providers: [
        provideFakeMe(
          new FakeMeApi({ ...withPermissions('Dashboard.View', 'Dashboard.ViewSwimlane'), userId }),
        ),
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    return TestBed.inject(SwimlanePrefs);
  }

  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('starts with the defaults and remembers grouping, sort, window and density per user', async () => {
    const p = await prefs();
    expect(p.remembered()).toMatchObject({ groupBy: 'none', sort: 'priority', days: 7 });
    expect(p.density()).toBe('comfortable');
    p.remember({ groupBy: 'clientMatter', sort: 'due', days: 30 });
    p.remember({ density: 'compact' });
    expect(JSON.parse(localStorage.getItem('mf.dashboard.swimlane.v1.7')!)).toEqual({
      groupBy: 'clientMatter',
      sort: 'due',
      days: 30,
      density: 'compact',
    });

    TestBed.resetTestingModule();
    const again = await prefs();
    expect(again.remembered()).toMatchObject({ groupBy: 'clientMatter', sort: 'due', days: 30 });
    expect(again.density()).toBe('compact');

    TestBed.resetTestingModule();
    const other = await prefs(8);
    expect(other.remembered().groupBy).toBe('none');
  });

  it('does not remember the data filters', async () => {
    const p = await prefs();
    p.remember({ groupBy: 'priority' });
    expect(
      Object.keys(JSON.parse(localStorage.getItem('mf.dashboard.swimlane.v1.7')!)).sort(),
    ).toEqual(['days', 'density', 'groupBy', 'sort']);
  });

  it('ignores stored values it does not know', async () => {
    localStorage.setItem(
      'mf.dashboard.swimlane.v1.7',
      JSON.stringify({ groupBy: 'x', sort: 'y', days: 3, density: 'huge' }),
    );
    const p = await prefs();
    expect(p.remembered()).toMatchObject({ groupBy: 'none', sort: 'priority', days: 7 });
    expect(p.density()).toBe('comfortable');
  });

  it('works when storage throws (private window, site data blocked)', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const p = await prefs();
    expect(p.remembered().groupBy).toBe('none');
    expect(() => p.remember({ groupBy: 'assignee', density: 'compact' })).not.toThrow();
    expect(p.density()).toBe('compact');
  });
});
