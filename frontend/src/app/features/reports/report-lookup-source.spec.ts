import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import {
  ClientsClient,
  MattersClient,
  PodsClient,
  RolesClient,
  TaskTypesClient,
  UsersClient,
} from '../../api/generated/api-client';
import { ReportLookupSource } from './report-lookup-source';

type Mock = ReturnType<typeof vi.fn>;

describe('ReportLookupSource (#719, decision 13)', () => {
  let matters: Record<'listMatters' | 'getMatter', Mock>;
  let clients: Record<'listClients' | 'getClient', Mock>;
  let users: Record<'listUsers' | 'getUser', Mock>;
  let pods: Record<'listPods', Mock>;
  let roles: Record<'listRoles', Mock>;
  let taskTypes: Record<'listTaskTypes', Mock>;
  let source: ReportLookupSource;

  beforeEach(() => {
    matters = {
      listMatters: vi.fn().mockReturnValue(
        of({
          items: [{ matterId: 4, matterRef: '00017-00002', name: 'Merger', clientName: 'Acme' }],
        }),
      ),
      getMatter: vi
        .fn()
        .mockReturnValue(of({ matterRef: '00017-00002', name: 'Merger', clientName: 'Acme' })),
    };
    clients = {
      listClients: vi
        .fn()
        .mockReturnValue(of({ items: [{ clientId: 9, clientNumber: '00017', name: 'Acme' }] })),
      getClient: vi.fn().mockReturnValue(of({ clientNumber: '00017', name: 'Acme' })),
    };
    users = {
      listUsers: vi.fn().mockReturnValue(
        of({
          items: [
            { userId: 2, displayName: 'Ann Lee', pods: [{ name: 'Pod A' }, { name: 'Pod B' }] },
          ],
        }),
      ),
      getUser: vi.fn().mockReturnValue(of({ displayName: 'Ann Lee' })),
    };
    pods = { listPods: vi.fn().mockReturnValue(of({ items: [{ podId: 1, name: 'Pod A' }] })) };
    roles = { listRoles: vi.fn().mockReturnValue(of([{ roleId: 3, name: 'Director' }])) };
    taskTypes = {
      listTaskTypes: vi.fn().mockReturnValue(
        of([
          { id: 8, name: 'Review', isActive: true },
          { id: 9, name: 'Old', isActive: false },
        ]),
      ),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: MattersClient, useValue: matters },
        { provide: ClientsClient, useValue: clients },
        { provide: UsersClient, useValue: users },
        { provide: PodsClient, useValue: pods },
        { provide: RolesClient, useValue: roles },
        { provide: TaskTypesClient, useValue: taskTypes },
      ],
    });
    source = TestBed.inject(ReportLookupSource);
  });

  it('knows which kinds are found by typing and which are shown whole', () => {
    expect(['matter', 'client', 'user'].map((k) => source.isSearched(k))).toEqual([
      true,
      true,
      true,
    ]);
    expect(['pod', 'role', 'taskType', undefined].map((k) => source.isSearched(k))).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  it('searches matters (active ones) and words them as reference and name with the client', async () => {
    const found = await source.search('matter', ' merg ');
    expect(found).toEqual([{ id: 4, label: '00017-00002 Merger', sub: 'Acme' }]);
    const args = matters.listMatters.mock.calls[0];
    expect(args[0]).toBe('merg');
    expect(args[2]).toBe(true);
  });

  it('searches clients and active users and shows a person with the pods', async () => {
    expect(await source.search('client', 'ac')).toEqual([{ id: 9, label: '00017 Acme' }]);
    expect(await source.search('user', 'ann')).toEqual([
      { id: 2, label: 'Ann Lee', sub: 'Pod A, Pod B' },
    ]);
    expect(users.listUsers.mock.calls[0][0]).toBe('active');
  });

  it('lists the short kinds whole: pods, roles and the active task types', async () => {
    expect(await source.list('pod')).toEqual([{ id: 1, label: 'Pod A' }]);
    expect(await source.list('role')).toEqual([{ id: 3, label: 'Director' }]);
    expect(await source.list('taskType')).toEqual([{ id: 8, label: 'Review' }]);
  });

  it('fetches the words of ids from an address or a default, and keeps the id as the words of one it cannot read', async () => {
    expect(await source.labels('client', [9])).toEqual([{ id: 9, label: '00017 Acme' }]);
    clients.getClient.mockReturnValue(throwError(() => new Error('403')));
    expect(await source.labels('client', [9])).toEqual([{ id: 9, label: '#9' }]);
    expect(await source.labels('pod', [1, 5])).toEqual([{ id: 1, label: 'Pod A' }]);
    expect(await source.labels('matter', [])).toEqual([]);
  });

  it('rejects with the HTTP error when the server refuses, so the control can show its own message', async () => {
    clients.listClients.mockReturnValue(throwError(() => new Error('403')));
    await expect(source.search('client', '')).rejects.toThrow('403');
  });
});
