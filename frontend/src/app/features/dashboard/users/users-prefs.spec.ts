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

  it('starts with the defaults and remembers sort and layout per user', async () => {
    const p = await prefs();
    p.ensureLoaded();
    expect([p.sort(), p.layout()]).toEqual(['load', 'cards']);
    p.remember({ sort: 'name', layout: 'table' });
    expect(JSON.parse(localStorage.getItem('mf.dashboard.users.v1.7')!)).toEqual({
      sort: 'name',
      layout: 'table',
      view: 'workload',
    });

    TestBed.resetTestingModule();
    const again = await prefs();
    again.ensureLoaded();
    expect([again.sort(), again.layout()]).toEqual(['name', 'table']);

    TestBed.resetTestingModule();
    const other = await prefs(8);
    other.ensureLoaded();
    expect(other.sort()).toBe('load');
  });

  it('ignores invalid stored values; a saved mode that no longer exists falls back to the table', async () => {
    localStorage.setItem('mf.dashboard.users.v1.7', JSON.stringify({ sort: 'x', layout: 3 }));
    const p = await prefs();
    p.ensureLoaded();
    expect([p.sort(), p.layout()]).toEqual(['load', 'table']);
  });

  it('ignores the old tile size (density) that was saved before it was removed, without an error', async () => {
    localStorage.setItem(
      'mf.dashboard.users.v1.7',
      JSON.stringify({ sort: 'name', density: 'compact', layout: 'cards', view: 'workload' }),
    );
    const p = await prefs();
    p.ensureLoaded();
    expect([p.sort(), p.layout()]).toEqual(['name', 'cards']);
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
