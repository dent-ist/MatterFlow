import { TestBed } from '@angular/core/testing';
import { PrioritiesClient, StatusLabelsClient } from '../../api/generated/api-client';
import { FakeMeApi, provideFakeMe, withPermissions } from '../auth/auth-testing';
import { AuthStore } from '../auth/auth.store';
import { Permission } from '../auth/permissions';
import { LookupStore } from './lookup-store';
import { FakePrioritiesClient, FakeStatusLabelsClient, apiError } from './lookups-testing';

describe('LookupStore', () => {
  let priorities: FakePrioritiesClient;
  let statuses: FakeStatusLabelsClient;
  let store: LookupStore;

  beforeEach(() => {
    priorities = new FakePrioritiesClient();
    statuses = new FakeStatusLabelsClient();
    TestBed.configureTestingModule({
      providers: [
        { provide: PrioritiesClient, useValue: priorities },
        { provide: StatusLabelsClient, useValue: statuses },
      ],
    });
    store = TestBed.inject(LookupStore);
  });

  it('shows the seeded status labels before anything loads', () => {
    expect(store.statusLabel('ON_HOLD')).toBe('On Hold');
    expect(store.statusLabel('UNKNOWN')).toBe('UNKNOWN');
    expect(store.statusLabel(null)).toBe('');
  });

  it('loads both lookups once, shared by concurrent callers', async () => {
    await Promise.all([store.ensureLoaded(), store.ensureLoaded()]);
    await store.ensureLoaded();

    expect(priorities.calls).toEqual(['list']);
    expect(statuses.calls).toEqual(['list']);
    expect(store.state()).toBe('ready');
    expect(store.defaultPriority()?.label).toBe('Normal');
    expect(store.priorityRank(2)).toBe(2);
    expect(store.priority(99)).toBeNull();
  });

  it('keeps inactive priorities for display but only offers active ones for pickers', async () => {
    priorities.rows[3] = { ...priorities.rows[3], isActive: false };
    await store.ensureLoaded();

    expect(store.priority(4)?.label).toBe('Low');
    expect(store.activePriorities().map((p) => p.label)).toEqual(['Critical', 'High', 'Normal']);
  });

  it('uses edited status labels', async () => {
    statuses.rows[2] = { ...statuses.rows[2], displayLabel: 'Waiting' };
    await store.ensureLoaded();

    expect(store.statusLabel('ON_HOLD')).toBe('Waiting');
  });

  it('does not retry a failed load for every caller, but reload does', async () => {
    priorities.failNext = apiError(403, 'PERMISSION_DENIED', 'No.');

    await store.ensureLoaded();
    expect(store.state()).toBe('error');
    await store.ensureLoaded();
    expect(priorities.calls).toEqual(['list']);

    await store.reload();
    expect(store.state()).toBe('ready');
  });

  it('follows admin edits pushed back into the store, ordered by sortOrder', () => {
    store.setPriorities([
      { ...priorities.rows[1], sortOrder: 2 },
      { ...priorities.rows[0], sortOrder: 1 },
    ]);

    expect(store.priorities().map((p) => p.label)).toEqual(['Critical', 'High']);
  });

  describe('permission-aware loading (AD-D #523)', () => {
    async function storeFor(...permissions: Permission[]): Promise<LookupStore> {
      TestBed.resetTestingModule();
      priorities = new FakePrioritiesClient();
      statuses = new FakeStatusLabelsClient();
      TestBed.configureTestingModule({
        providers: [
          provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
          { provide: PrioritiesClient, useValue: priorities },
          { provide: StatusLabelsClient, useValue: statuses },
        ],
      });
      await TestBed.inject(AuthStore).ensureLoaded();
      return TestBed.inject(LookupStore);
    }

    it('asks only for the priorities of a Priority.Manage-only person', async () => {
      const own = await storeFor('Priority.Manage');
      await own.ensureLoaded();
      expect(priorities.calls).toEqual(['list']);
      expect(statuses.calls).toEqual([]);
      expect(own.state()).toBe('ready');
    });

    it('asks only for the status labels of a StatusLabel.Manage-only person', async () => {
      const own = await storeFor('StatusLabel.Manage');
      await own.ensureLoaded();
      expect(priorities.calls).toEqual([]);
      expect(statuses.calls).toEqual(['list']);
      expect(own.state()).toBe('ready');
    });

    it('asks for both with Task.View and for neither without a permission', async () => {
      const viewer = await storeFor('Task.View');
      await viewer.ensureLoaded();
      expect(priorities.calls).toEqual(['list']);
      expect(statuses.calls).toEqual(['list']);

      const nobody = await storeFor('Client.View');
      await nobody.ensureLoaded();
      expect(priorities.calls).toEqual([]);
      expect(statuses.calls).toEqual([]);
      expect(nobody.state()).toBe('error');
    });
  });
});
