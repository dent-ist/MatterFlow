import { PermissionGroupDto } from '../../../core/identity-admin/identity-admin-api';
import { permissionsOfRoles, summarizePermissions } from './user-access';

const CATALOG: PermissionGroupDto[] = [
  {
    group: 'Task',
    permissions: [
      { code: 'Task.View', description: '' },
      { code: 'Task.Create', description: '' },
      { code: 'Task.Edit', description: '' },
    ],
  },
  { group: 'Asset', permissions: [{ code: 'Asset.View', description: '' }] },
  { group: 'User', permissions: [{ code: 'User.View', description: '' }] },
];

describe('summarizePermissions (#439)', () => {
  it('groups the codes as the Roles tab does, in catalog order, with the number held', () => {
    expect(summarizePermissions(['User.View', 'Task.Edit', 'Task.View'], CATALOG)).toEqual([
      { group: 'Task', count: 2, codes: ['Task.View', 'Task.Edit'] },
      { group: 'User', count: 1, codes: ['User.View'] },
    ]);
  });

  it('leaves out groups with nothing and gives an empty list for no permission', () => {
    expect(summarizePermissions([], CATALOG)).toEqual([]);
  });

  it('keeps a code the catalog does not know in an Other group, so no count is lost', () => {
    const groups = summarizePermissions(['Task.View', 'Future.Thing'], CATALOG);
    expect(groups.map((g) => [g.group, g.count])).toEqual([
      ['Task', 1],
      ['Other', 1],
    ]);
    expect(groups.reduce((n, g) => n + g.count, 0)).toBe(2);
  });
});

describe('permissionsOfRoles', () => {
  const byRole = new Map<number, string[]>([
    [1, ['Task.View', 'Task.Edit']],
    [2, ['Task.View', 'Asset.View']],
  ]);

  it('is the union of the ticked roles', () => {
    expect([...permissionsOfRoles([1, 2], byRole)].sort()).toEqual([
      'Asset.View',
      'Task.Edit',
      'Task.View',
    ]);
  });

  it('is empty for no role and ignores a role whose permissions are not loaded', () => {
    expect(permissionsOfRoles([], byRole).size).toBe(0);
    expect([...permissionsOfRoles([3], byRole)]).toEqual([]);
  });
});
