import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import {
  OnHoldReasonsClient,
  TaskTypesClient,
  UsersClient,
  WorkflowsClient,
} from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { QueueChoices, mergeOptions } from './queue-choices';

describe('QueueChoices', () => {
  const types = { listTaskTypes: vi.fn() };
  const users = { listUsers: vi.fn() };
  const workflows = { listWorkflows: vi.fn() };
  const reasons = { listOnHoldReasons: vi.fn() };
  let permissions: string[];

  function create() {
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthStore, useValue: { has: (p: string) => permissions.includes(p) } },
        { provide: TaskTypesClient, useValue: types },
        { provide: UsersClient, useValue: users },
        { provide: WorkflowsClient, useValue: workflows },
        { provide: OnHoldReasonsClient, useValue: reasons },
      ],
    });
    return TestBed.inject(QueueChoices);
  }
  const flush = () => new Promise((r) => setTimeout(r));

  beforeEach(() => {
    reasons.listOnHoldReasons
      .mockReset()
      .mockReturnValue(of([{ id: 3, name: 'Waiting for client data', isActive: true }]));
    types.listTaskTypes.mockReset().mockReturnValue(
      of([
        { id: 2, name: 'Review', isActive: true },
        { id: 1, name: 'Archive', isActive: false },
      ]),
    );
    users.listUsers.mockReset().mockReturnValue(
      of({
        items: [
          { userId: 9, displayName: 'Tariq Malik', isActive: true, isPending: false },
          { userId: 4, displayName: 'Alex Gone', isActive: false, isPending: false },
          { userId: 3, displayName: 'Waiting Person', isActive: true, isPending: true },
        ],
        total: 3,
      }),
    );
    workflows.listWorkflows
      .mockReset()
      .mockReturnValue(
        of({ items: [{ workflowDefinitionId: 3, name: 'Ordered', isActive: true }], total: 1 }),
      );
  });

  it('asks for nothing it may not have, so nobody gets a 403', async () => {
    permissions = [];
    const choices = create();
    choices.ensure();
    await flush();
    expect(types.listTaskTypes).not.toHaveBeenCalled();
    expect(users.listUsers).not.toHaveBeenCalled();
    expect(workflows.listWorkflows).not.toHaveBeenCalled();
    expect(reasons.listOnHoldReasons).not.toHaveBeenCalled();
    expect(choices.people()).toEqual([]);
  });

  it('reads each list once, sorted by name, marks inactive ones and leaves out people waiting for access', async () => {
    permissions = ['Task.View', 'User.View', 'Workflow.Manage'];
    const choices = create();
    choices.ensure();
    choices.ensure();
    await flush();

    expect(types.listTaskTypes).toHaveBeenCalledTimes(1);
    expect(choices.types()).toEqual([
      { value: '1', label: 'Archive', hint: '(inactive)' },
      { value: '2', label: 'Review' },
    ]);
    expect(choices.people()).toEqual([
      { value: '4', label: 'Alex Gone', hint: '(inactive)' },
      { value: '9', label: 'Tariq Malik' },
    ]);
    expect(choices.workflows()).toEqual([{ value: '3', label: 'Ordered' }]);
    expect(choices.onHoldReasons()).toEqual([{ value: '3', label: 'Waiting for client data' }]);
  });

  it('works without the lists when a request fails', async () => {
    permissions = ['Task.View', 'User.View'];
    types.listTaskTypes.mockReturnValue(throwError(() => new Error('boom')));
    users.listUsers.mockReturnValue(throwError(() => new Error('boom')));
    const choices = create();
    choices.ensure();
    await flush();
    expect(choices.types()).toEqual([]);
    expect(choices.people()).toEqual([]);
  });

  it('adds what is on screen to the lists, once', () => {
    const base = [{ value: '9', label: 'Tariq Malik' }];
    expect(mergeOptions(base, [])).toBe(base);
    expect(mergeOptions(base, [{ value: '9', label: 'Tariq Malik' }])).toBe(base);
    expect(mergeOptions(base, [{ value: '2', label: 'Pat Partner' }]).map((o) => o.label)).toEqual([
      'Pat Partner',
      'Tariq Malik',
    ]);
  });
});
