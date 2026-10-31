import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { AuthStore } from '../../../core/auth/auth.store';
import { MmScopeStore } from './mm-scope';

describe('MmScopeStore (UI-11)', () => {
  function setup(query: Record<string, string>) {
    const params = new BehaviorSubject(convertToParamMap(query));
    const navigate = vi.fn().mockResolvedValue(true);
    TestBed.configureTestingModule({
      providers: [
        MmScopeStore,
        { provide: AuthStore, useValue: { has: () => true } },
        { provide: Router, useValue: { navigate } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: params.value }, queryParamMap: params },
        },
      ],
    });
    return { store: TestBed.inject(MmScopeStore), navigate, params };
  }

  it('reads the client, matter, tab, status, show and month from the address', () => {
    const { store } = setup({
      clientId: '3',
      matterId: '9',
      tab: 'calendar',
      status: 'hold',
      show: 'overdue',
      month: '2026-11',
      mview: 'data',
    });
    expect(store.clientId()).toBe(3);
    expect(store.matterId()).toBe(9);
    expect(store.tab()).toBe('calendar');
    expect(store.status()).toBe('hold');
    expect(store.show()).toBe('overdue');
    expect(store.month()).toBe('2026-11');
    expect(store.metricsView()).toBe('data');
  });

  it('falls back to the defaults for missing or unknown values', () => {
    const { store } = setup({ tab: 'nope', status: 'x', show: 'y', month: '2026-13' });
    expect(store.tab()).toBe('overview');
    expect(store.status()).toBe('open');
    expect(store.show()).toBe('everything');
    expect(store.month()).toBeNull();
    expect(store.calShows()).toEqual(['events', 'critical']);
  });

  it('picking a matter sets its client and resets the status and show filters', () => {
    const { store, navigate } = setup({ status: 'hold', show: 'overdue' });
    store.setMatter(9, 3);
    const q = navigate.mock.calls[0][1].queryParams;
    expect(q).toMatchObject({ matterId: 9, clientId: 3, status: null, show: null, page: null });
  });

  it('picking a client that does not own the chosen matter drops the matter', () => {
    const { store, navigate } = setup({ clientId: '3', matterId: '9' });
    store.setClient(4, 3);
    expect(navigate.mock.calls[0][1].queryParams).toMatchObject({ clientId: 4, matterId: null });
    store.setClient(3, 3);
    expect(navigate.mock.calls[1][1].queryParams).toMatchObject({ clientId: 3, matterId: 9 });
  });

  it('Clear removes the client and the matter; a tab change keeps them', () => {
    const { store, navigate } = setup({ clientId: '3', matterId: '9' });
    store.clear();
    expect(navigate.mock.calls[0][1].queryParams).toMatchObject({ clientId: null, matterId: null });
    store.setTab('assets');
    expect(navigate.mock.calls[1][1].queryParams).toMatchObject({ tab: 'assets' });
    expect(navigate.mock.calls[1][1].queryParams.clientId).toBeUndefined();
  });

  it('shows list from the address, in the fixed order', () => {
    const { store } = setup({ shows: 'overdue,events,bogus' });
    expect(store.calShows()).toEqual(['overdue', 'events']);
  });
});
