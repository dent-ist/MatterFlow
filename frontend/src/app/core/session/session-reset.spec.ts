import { TestBed } from '@angular/core/testing';
import { LookupStore } from '../lookups/lookup-store';
import { SessionReset } from './session-reset';
import { FakeMeApi, provideFakeMe, withPermissions } from '../auth/auth-testing';
import { AuthStore } from '../auth/auth.store';
import { MeProfile } from '../auth/me.models';

describe('SessionReset (sensitive-matter checklist 1 and 7: caches are emptied when the person changes)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('runs every registered function, even when one throws, and a removed one no more', () => {
    TestBed.configureTestingModule({});
    const reset = TestBed.inject(SessionReset);
    const first = vi.fn(() => {
      throw new Error('boom');
    });
    const second = vi.fn();
    const removed = vi.fn();
    reset.register(first);
    reset.register(second);
    reset.register(removed)();
    reset.run();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(removed).not.toHaveBeenCalled();
  });

  it('is run by the auth store when a different person is behind the page, and not when the same person refreshes', async () => {
    const api = new FakeMeApi(withPermissions('Matter.View'));
    TestBed.configureTestingModule({ providers: [provideFakeMe(api)] });
    const auth = TestBed.inject(AuthStore);
    const cleared = vi.fn();
    TestBed.inject(SessionReset).register(cleared);

    await auth.ensureLoaded();
    expect(cleared).not.toHaveBeenCalled(); // the first load is not a change
    await auth.refresh();
    expect(cleared).not.toHaveBeenCalled(); // the same person

    const profile = api.current as MeProfile;
    api.current = { ...profile, userId: profile.userId + 1 };
    await auth.refresh();
    expect(cleared).toHaveBeenCalledTimes(1);
  });

  it("empties the lookup store, which would otherwise keep the earlier person's lists", async () => {
    TestBed.configureTestingModule({});
    const store = TestBed.inject(LookupStore);
    store.setPriorities([
      {
        id: 1,
        label: 'High',
        color: 'red',
        sortOrder: 1,
        isActive: true,
        isDefault: true,
      } as never,
    ]);
    expect(store.priorities()).toHaveLength(1);
    TestBed.inject(SessionReset).run();
    expect(store.priorities()).toHaveLength(0);
    expect(store.state()).toBe('idle');
  });
});
