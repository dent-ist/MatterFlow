import { TestBed } from '@angular/core/testing';
import { NEVER, of, throwError } from 'rxjs';
import { DashboardClient } from '../../api/generated/api-client';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../core/auth/auth-testing';
import { AuthStore } from '../../core/auth/auth.store';
import { DashScope, parseScope, scopeFromAddress } from './dash-scope';
import { aMemberChoices, aScopeChoices } from './dash-scope-testing';

const KEY = 'mf.dashboard.scope.v1.7';
const get = (q: Record<string, string>) => (k: string) => q[k] ?? null;

describe('scope values', () => {
  it('accepts all, mine and a positive pod id, in any case', () => {
    expect(parseScope('all')).toBe('all');
    expect(parseScope(' Mine ')).toBe('mine');
    expect(parseScope('12')).toBe('12');
    for (const bad of ['0', '-1', '1.5', 'x', '', '1,2', '12345678901', null, undefined]) {
      expect(parseScope(bad as string | null)).toBeNull();
    }
  });

  it('reads pod, else the old Users parameter', () => {
    expect(scopeFromAddress(get({ pod: '2', upod: '3' }))).toBe('2');
    expect(scopeFromAddress(get({ upod: '3' }))).toBe('3');
    expect(scopeFromAddress(get({}))).toBeNull();
  });
});

describe('DashScope', () => {
  async function scope(choices = aScopeChoices(), userId = 7, fail = false) {
    const getDashboardScopes = vi.fn(() =>
      fail ? throwError(() => new Error('down')) : of(choices),
    );
    TestBed.configureTestingModule({
      providers: [
        provideFakeMe(new FakeMeApi({ ...withPermissions('Dashboard.View'), userId })),
        { provide: DashboardClient, useValue: { getDashboardScopes } },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    const s = TestBed.inject(DashScope);
    s.ensureLoaded();
    return { s, getDashboardScopes };
  }

  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('is not ready before the choices are known', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideFakeMe(new FakeMeApi({ ...withPermissions('Dashboard.View'), userId: 7 })),
        { provide: DashboardClient, useValue: { getDashboardScopes: () => NEVER } },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    const s = TestBed.inject(DashScope);
    s.ensureLoaded();
    expect(s.ready()).toBe(false);
    // Until then nothing is offered but All pods.
    expect(s.scope()).toBe('all');
  });

  it('reads the choices once per user', async () => {
    const { s, getDashboardScopes } = await scope();
    s.ensureLoaded();
    s.ensureLoaded();
    expect(getDashboardScopes).toHaveBeenCalledTimes(1);
  });

  it('defaults to All pods for someone in no pod, whatever their role', async () => {
    const { s } = await scope(aScopeChoices());
    s.applyAddress(get({}));
    expect(s.ready()).toBe(true);
    expect(s.scope()).toBe('all');
    expect(s.defaultScope()).toBe('all');
    expect(s.options().map((o) => o.label)).toEqual(['All pods']);
    expect(s.isAll()).toBe(true);
    expect(s.queueParam()).toBeUndefined();
  });

  it('defaults to My pods for a member of at least one pod, with own pods first', async () => {
    const { s } = await scope(aMemberChoices());
    s.applyAddress(get({}));
    expect(s.scope()).toBe('mine');
    expect(s.label()).toBe('My pods');
    expect(s.options().map((o) => [o.label, o.group])).toEqual([
      ['All pods', 'general'],
      ['My pods', 'general'],
      ['Review Alpha', 'mine'],
      ['Review Beta', 'mine'],
      ['Processing', 'other'],
    ]);
    // "My pods" is the union of the person's pods in the Task Queue filter.
    expect(s.podIds()).toEqual([1, 2]);
    expect(s.queueParam()).toEqual(['1', '2']);
  });

  it('lets the address win over memory and the default, and never changes the memory', async () => {
    localStorage.setItem(KEY, 'all');
    const { s } = await scope(aMemberChoices());
    s.applyAddress(get({}));
    expect(s.scope()).toBe('all');
    s.applyAddress(get({ pod: '3' }));
    expect(s.scope()).toBe('3');
    expect(s.label()).toBe('Processing');
    expect(s.queueParam()).toEqual(['3']);
    expect(localStorage.getItem(KEY)).toBe('all');
    expect(s.rejected()).toBeNull();
  });

  it('remembers the last explicit choice per user; the default is not written', async () => {
    const { s } = await scope(aMemberChoices());
    s.applyAddress(get({}));
    s.choose('2');
    expect(localStorage.getItem(KEY)).toBe('2');
    s.applyAddress(get({}));
    expect(s.scope()).toBe('2');
    expect(s.addressValue('mine')).toBeNull();
    expect(s.addressValue('2')).toBe('2');
    expect(s.addressValue('all')).toBe('all');
  });

  it('falls back to the default for a pod the person may not see, and says so through rejected()', async () => {
    const { s } = await scope(aMemberChoices());
    s.applyAddress(get({ pod: '99' }));
    expect(s.scope()).toBe('mine');
    expect(s.rejected()).toBe('99');
    s.applyAddress(get({ pod: 'nonsense' }));
    expect(s.scope()).toBe('mine');
    expect(s.rejected()).not.toBeNull();
  });

  it('ignores a remembered pod that is no longer offered', async () => {
    localStorage.setItem(KEY, '42');
    const { s } = await scope(aMemberChoices());
    s.applyAddress(get({}));
    expect(s.scope()).toBe('mine');
    expect(s.rejected()).toBeNull();
  });

  it('works without the choices: All pods, any well-formed address value is tried (the server decides)', async () => {
    const { s } = await scope(aScopeChoices(), 7, true);
    s.applyAddress(get({ pod: '5' }));
    expect(s.ready()).toBe(true);
    expect(s.scope()).toBe('5');
    expect(s.rejected()).toBeNull();
    s.applyAddress(get({}));
    expect(s.scope()).toBe('all');
  });

  it('survives unavailable storage', async () => {
    const { s } = await scope(aMemberChoices());
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => s.choose('all')).not.toThrow();
    s.applyAddress(get({}));
    expect(s.scope()).toBe('all');
  });

  it('gives a pod-less "my pods" scope a filter that matches nothing', async () => {
    const { s } = await scope(aScopeChoices({ hasPods: false }));
    s.choose('mine');
    s.applyAddress(get({ pod: 'mine' }));
    // mine is not offered to someone without pods: the default applies.
    expect(s.scope()).toBe('all');
    expect(s.rejected()).toBe('mine');
  });
});
