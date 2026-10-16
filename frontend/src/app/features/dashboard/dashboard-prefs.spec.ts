import { TestBed } from '@angular/core/testing';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../core/auth/auth-testing';
import { AuthStore } from '../../core/auth/auth.store';
import { DashboardPrefs } from './dashboard-prefs';

describe('DashboardPrefs (the shared period)', () => {
  const KEY = 'mf.dashboard.v2.7';
  const none = () => null;
  const get = (q: Record<string, string>) => (k: string) => q[k] ?? null;

  async function prefs() {
    TestBed.configureTestingModule({
      providers: [
        provideFakeMe(new FakeMeApi({ ...withPermissions('Dashboard.View'), userId: 7 })),
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    return TestBed.inject(DashboardPrefs);
  }

  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('defaults to 30 days', async () => {
    const p = await prefs();
    p.applyAddress(none);
    expect(p.period()).toEqual({ key: '30d', from: null, to: null });
  });

  it('migrates every old stored value and saves it again in the new vocabulary', async () => {
    for (const [old, now] of [
      ['week', '7d'],
      ['month', 'this-month'],
      ['30d', '30d'],
      ['quarter', '90d'],
    ] as const) {
      localStorage.setItem(KEY, JSON.stringify({ period: old }));
      TestBed.resetTestingModule();
      const p = await prefs();
      p.ensureLoaded();
      expect(p.period().key).toBe(now);
      expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ period: now });
    }
  });

  it('falls back to the default for damaged or unknown stored values', async () => {
    for (const raw of ['not json', '{"period":"fortnight"}', '{"period":"custom"}', 'null']) {
      localStorage.setItem(KEY, raw);
      TestBed.resetTestingModule();
      const p = await prefs();
      p.ensureLoaded();
      expect(p.period().key).toBe('30d');
    }
  });

  it('lets the address win and remembers a preset it names, but not a custom range', async () => {
    localStorage.setItem(KEY, JSON.stringify({ period: '7d' }));
    const p = await prefs();
    p.applyAddress(get({ period: '90d' }));
    expect(p.period().key).toBe('90d');
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ period: '90d' });

    p.applyAddress(get({ period: 'custom', from: '2026-10-01', to: '2026-10-09' }));
    expect(p.period()).toEqual({ key: 'custom', from: '2026-10-01', to: '2026-10-09' });
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ period: '90d' });

    // No period in the address: the remembered one applies again.
    p.applyAddress(none);
    expect(p.period().key).toBe('90d');
  });

  it('remembers an explicit choice and never a custom range', async () => {
    const p = await prefs();
    p.choose({ key: 'last-month', from: null, to: null });
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ period: 'last-month' });
    p.choose({ key: 'custom', from: '2026-10-01', to: '2026-10-09' });
    expect(p.period().key).toBe('custom');
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ period: 'last-month' });
  });

  it('works when storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const p = await prefs();
    p.applyAddress(none);
    expect(p.period().key).toBe('30d');
    p.choose({ key: '7d', from: null, to: null });
    expect(p.period().key).toBe('7d');
  });
});
