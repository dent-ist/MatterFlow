import { TestBed } from '@angular/core/testing';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../../core/auth/auth-testing';
import { AuthStore } from '../../../core/auth/auth.store';
import { UsersPrefs } from './users-prefs';

describe('UsersPrefs', () => {
  async function prefs(userId = 7) {
    TestBed.configureTestingModule({
      providers: [
        provideFakeMe(
          new FakeMeApi({ ...withPermissions('Dashboard.View', 'Dashboard.ViewUsers'), userId }),
        ),
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    return TestBed.inject(UsersPrefs);
  }

  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('starts with the defaults and remembers sort, density and layout per user', async () => {
    const p = await prefs();
    p.ensureLoaded();
    expect([p.sort(), p.density(), p.layout()]).toEqual(['load', 'comfortable', 'cards']);
    p.remember({ sort: 'name', layout: 'table' });
    p.remember({ density: 'compact' });
    expect(JSON.parse(localStorage.getItem('mf.dashboard.users.v1.7')!)).toEqual({
      sort: 'name',
      density: 'compact',
      layout: 'table',
      view: 'workload',
    });

    TestBed.resetTestingModule();
    const again = await prefs();
    again.ensureLoaded();
    expect([again.sort(), again.density(), again.layout()]).toEqual(['name', 'compact', 'table']);

    TestBed.resetTestingModule();
    const other = await prefs(8);
    other.ensureLoaded();
    expect(other.sort()).toBe('load');
  });

  it('ignores invalid stored values', async () => {
    localStorage.setItem('mf.dashboard.users.v1.7', JSON.stringify({ sort: 'x', layout: 3 }));
    const p = await prefs();
    p.ensureLoaded();
    expect([p.sort(), p.density(), p.layout()]).toEqual(['load', 'comfortable', 'cards']);
  });

  it('works when storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const p = await prefs();
    p.ensureLoaded();
    expect(() => p.remember({ sort: 'open' })).not.toThrow();
    expect(p.sort()).toBe('open');
  });
});
