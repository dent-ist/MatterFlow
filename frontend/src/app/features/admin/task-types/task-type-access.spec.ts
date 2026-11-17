import {
  AccessModel,
  OPEN_ACCESS,
  accessCellOf,
  allViewRolesInactive,
  confirmOf,
  inactiveChosen,
  isLinked,
  isRestricted,
  linkedReason,
  mergeRoles,
  needsConfirm,
  normalised,
  sameAccess,
  summaryOf,
  viewIds,
} from './task-type-access';
import type { TaskTypeAccessPreview, TaskTypeAccessRole } from './task-types-api';

const roles: TaskTypeAccessRole[] = [
  { roleId: 1, name: 'Attorney', isActive: true },
  { roleId: 2, name: 'Partner', isActive: true },
  { roleId: 3, name: 'Vendor Liaison', isActive: false },
];

const none: TaskTypeAccessPreview = {
  isRestricted: true,
  becomesOpenToEveryone: false,
  openTasksBecomingHidden: 0,
  peopleLosingView: 0,
  openTasksAssignedToPeopleLosingView: 0,
  peopleLosingEdit: 0,
  callerLosesView: false,
};
const preview = (over: Partial<TaskTypeAccessPreview>): TaskTypeAccessPreview => ({
  ...none,
  ...over,
});

describe('task type access rules (#1402)', () => {
  it('adds the roles of Can Edit and Can Be Assigned to Can View, each once, in id order', () => {
    const m: AccessModel = { canView: [2], canEdit: [1, 2], canAssign: [3] };
    expect(viewIds(m)).toEqual([1, 2, 3]);
    expect(normalised(m)).toEqual({ canView: [1, 2, 3], canEdit: [1, 2], canAssign: [3] });
    expect(isLinked(m, 2)).toBe(true);
    expect(isLinked({ canView: [2], canEdit: [], canAssign: [] }, 2)).toBe(false);
    expect(linkedReason(m, 2, 'Partner')).toBe(
      'Partner is in Can Edit, so it can also view. Remove it from Can Edit first.',
    );
    expect(linkedReason(m, 3, 'Vendor Liaison')).toContain('Can Be Assigned');
  });

  it('is open with three empty lists and restricted when any role can view, even only through Can Edit', () => {
    expect(isRestricted(OPEN_ACCESS)).toBe(false);
    expect(isRestricted({ canView: [], canEdit: [1], canAssign: [] })).toBe(true);
    expect(
      sameAccess(
        { canView: [], canEdit: [1], canAssign: [] },
        { canView: [1], canEdit: [1], canAssign: [] },
      ),
    ).toBe(true);
    expect(sameAccess(OPEN_ACCESS, { canView: [1], canEdit: [], canAssign: [] })).toBe(false);
  });

  it('words the live summary', () => {
    expect(summaryOf(OPEN_ACCESS)).toBe('Open to everyone.');
    expect(summaryOf({ canView: [1, 2, 4], canEdit: [1, 2], canAssign: [1, 2] })).toBe(
      'Restricted: 3 roles can view, 2 can edit, 2 can be assigned.',
    );
    expect(summaryOf({ canView: [1], canEdit: [], canAssign: [] })).toBe(
      'Restricted: 1 role can view, all viewers can edit, all viewers can be assigned.',
    );
  });

  it('finds inactive roles in the lists', () => {
    const m: AccessModel = { canView: [1, 3], canEdit: [], canAssign: [] };
    expect(inactiveChosen(m, roles)).toEqual(['Vendor Liaison']);
    expect(allViewRolesInactive(m, roles)).toBe(false);
    expect(allViewRolesInactive({ canView: [3], canEdit: [], canAssign: [] }, roles)).toBe(true);
    expect(allViewRolesInactive(OPEN_ACCESS, roles)).toBe(false);
  });

  it('merges the roles to choose from with the active flag of the roles already in the lists', () => {
    const merged = mergeRoles(
      [
        { roleId: 1, name: 'Attorney', isActive: true, memberCount: 3 },
        { roleId: 3, name: 'Vendor Liaison', isActive: true, memberCount: 1 },
      ],
      [
        { roleId: 3, name: 'Vendor Liaison', isActive: false },
        { roleId: 9, name: 'Archived Role', isActive: false },
      ],
    );
    expect(merged.map((r) => [r.name, r.isActive, r.memberCount])).toEqual([
      ['Archived Role', false, undefined],
      ['Attorney', true, 3],
      ['Vendor Liaison', false, 1],
    ]);
  });

  describe('the Access column', () => {
    const byId = new Map(roles.map((r) => [r.roleId, r]));
    it('is plain for an open type', () => {
      const c = accessCellOf(
        { isRestricted: false, canView: [], canEdit: [], canAssign: [] },
        byId,
        true,
        'X',
      );
      expect(c.restricted).toBe(false);
      expect(accessCellOf(undefined, byId, true, 'X').restricted).toBe(false);
    });
    it('counts the roles that can view and lists the three lists in the tooltip', () => {
      const c = accessCellOf(
        { isRestricted: true, canView: [1, 2], canEdit: [1], canAssign: [] },
        byId,
        true,
        'Privilege Review',
      );
      expect(c).toMatchObject({ restricted: true, count: 2, allInactive: false });
      expect(c.tip).toBe(
        'Can View: Attorney, Partner\nCan Edit: Attorney\nCan Be Assigned: no extra limit',
      );
      expect(c.label).toContain('Privilege Review');
    });
    it('turns amber when every View role is inactive and says so', () => {
      const c = accessCellOf(
        { isRestricted: true, canView: [3], canEdit: [], canAssign: [] },
        byId,
        true,
        'X',
      );
      expect(c.allInactive).toBe(true);
      expect(c.tip).toContain(
        'All Can View roles are inactive, so only System Admin can see this task type.',
      );
    });
    it('adds "not enforced yet" while the switch is off, and nothing while it is unknown', () => {
      const lists = { isRestricted: true, canView: [1], canEdit: [], canAssign: [] };
      expect(accessCellOf(lists, byId, false, 'X').tip).toContain('Saved, but not enforced yet.');
      expect(accessCellOf(lists, byId, null, 'X').tip).not.toContain('not enforced');
    });
  });

  describe('when to confirm', () => {
    it('only when people lose view or edit, the type opens up, or the caller loses access', () => {
      expect(needsConfirm(none)).toBe(false);
      expect(needsConfirm(preview({ peopleLosingView: 1 }))).toBe(true);
      expect(needsConfirm(preview({ peopleLosingEdit: 1 }))).toBe(true);
      expect(needsConfirm(preview({ becomesOpenToEveryone: true }))).toBe(true);
      expect(needsConfirm(preview({ callerLosesView: true }))).toBe(true);
    });
  });

  describe('the words of the confirmation', () => {
    it('says how many people lose the type and how many open tasks go with it', () => {
      const c = confirmOf(
        preview({
          peopleLosingView: 61,
          openTasksBecomingHidden: 14,
          openTasksAssignedToPeopleLosingView: 3,
        }),
        true,
        'Privilege Review',
        14,
      );
      expect(c.lead).toBe('This will hide the task type from 61 people.');
      expect(c.lines.map((l) => l.text)).toEqual([
        '14 open tasks of this type will no longer appear for them in lists, counts, search or notifications.',
        '3 of those tasks are assigned to them and stay assigned. Reassign them first if the work must continue.',
      ]);
      expect(c.closing).toBe('You can change the access again at any time.');
      expect(c.danger).toBe(false);
    });

    it('says the type becomes open to everyone, with its open tasks', () => {
      const c = confirmOf(preview({ becomesOpenToEveryone: true }), true, 'Privilege Review', 14);
      expect(c.lead).toBe('This makes the task type open to everyone.');
      expect(c.lines[0].text).toBe(
        'Everyone who can use tasks will be able to see and use Privilege Review and its 14 open tasks. The roles you removed are no longer needed.',
      );
    });

    it('adds the people who can still view but no longer edit as a line, or as the lead when it is the only thing; those who also lose view are not counted twice', () => {
      const both = confirmOf(
        preview({ peopleLosingView: 2, openTasksBecomingHidden: 1, peopleLosingEdit: 17 }),
        true,
        'X',
        1,
      );
      expect(both.lines.map((l) => l.text)).toContain(
        '15 more people can still view it but no longer change it.',
      );
      const only = confirmOf(preview({ peopleLosingEdit: 1 }), true, 'X', 1);
      expect(only.lead).toBe('1 person can still view it but no longer change it.');
      // Everyone who loses edit also loses view: nothing to add.
      const none = confirmOf(
        preview({ peopleLosingView: 5, openTasksBecomingHidden: 1, peopleLosingEdit: 5 }),
        true,
        'X',
        1,
      );
      expect(none.lines.map((l) => l.icon)).not.toContain('pi-pencil');
    });

    it('turns red and drops the closing sentence when the caller loses access', () => {
      const c = confirmOf(
        preview({ peopleLosingView: 3, openTasksBecomingHidden: 2, callerLosesView: true }),
        true,
        'Privilege Review',
        2,
      );
      expect(c.danger).toBe(true);
      expect(c.closing).toBe('');
      const you = c.lines.find((l) => l.strong)!;
      expect(you.text).toBe(
        'You will lose access yourself. You hold none of the chosen roles, so you will no longer see Privilege Review. Only a System Admin can change it back.',
      );
      // When it is the only thing, it is the lead.
      expect(
        confirmOf(preview({ callerLosesView: true }), true, 'Privilege Review', 2).lead,
      ).toContain('You will lose access yourself.');
    });

    it('says nobody loses access today while the switch is off, and is never red', () => {
      const c = confirmOf(
        preview({ peopleLosingView: 61, openTasksBecomingHidden: 14, callerLosesView: true }),
        false,
        'Privilege Review',
        14,
      );
      expect(c.lead).toBe(
        'These rules are saved but not enforced yet, so nobody loses access today.',
      );
      expect(c.lines[0].text).toBe(
        'When Task Type Access is switched on, this will hide Privilege Review from 61 people (14 open tasks).',
      );
      expect(
        c.lines[1].text.startsWith(
          'When Task Type Access is switched on, you will lose access yourself.',
        ),
      ).toBe(true);
      expect(c.danger).toBe(false);
    });
  });
});
