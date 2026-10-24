import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { firstValueFrom, of } from 'rxjs';
import { ReportAssignmentClient } from '../../../api/generated/api-client';
import { IdentityAdminApi } from '../../../core/identity-admin/identity-admin-api';
import { InMemoryIdentityAdminApi } from '../../../core/identity-admin/in-memory-identity-admin-api';
import { RolesPage, prerequisiteOf, roleChanges } from './roles-page';

describe('prerequisiteOf', () => {
  const catalog = new Set(['Task.View', 'Task.Assign', 'Audit.View', 'Role.Manage']);

  it('requires View of the same group for other actions', () => {
    expect(prerequisiteOf('Task.Assign', catalog)).toBe('Task.View');
  });

  it('has no prerequisite for View itself or for groups without a View', () => {
    expect(prerequisiteOf('Task.View', catalog)).toBeUndefined();
    expect(prerequisiteOf('Role.Manage', catalog)).toBeUndefined();
  });
});

describe('roleChanges (#448)', () => {
  const order = ['Task.View', 'Task.Edit', 'Asset.View', 'Asset.Edit'];

  it('lists the added permissions, then the removed ones, each in catalog order', () => {
    const saved = new Set(['Task.View', 'Task.Edit']);
    const draft = new Set(['Task.View', 'Asset.Edit', 'Asset.View']);
    expect(roleChanges(saved, draft, order)).toEqual([
      { code: 'Asset.View', kind: 'added' },
      { code: 'Asset.Edit', kind: 'added' },
      { code: 'Task.Edit', kind: 'removed' },
    ]);
  });

  it('has nothing for an unchanged role and for a new role (no saved set)', () => {
    expect(roleChanges(new Set(['Task.View']), new Set(['Task.View']), order)).toEqual([]);
    expect(roleChanges(null, new Set(['Task.View']), order)).toEqual([]);
  });
});

describe('RolesPage', () => {
  let fixture: ComponentFixture<RolesPage>;
  let api: InMemoryIdentityAdminApi;
  const el = (): HTMLElement => fixture.nativeElement;
  const q = <T extends HTMLElement = HTMLElement>(sel: string): T => el().querySelector<T>(sel)!;

  async function settle(): Promise<void> {
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r));
      fixture.detectChanges();
    }
    await fixture.whenStable();
  }

  const button = (label: string): HTMLButtonElement | undefined =>
    Array.from(el().querySelectorAll<HTMLButtonElement>('p-button button')).find(
      (b) => b.textContent!.trim() === label,
    );

  async function press(label: string): Promise<void> {
    button(label)!.click();
    await settle();
  }

  const check = async (code: string, checked: boolean): Promise<void> => {
    const box = q<HTMLInputElement>(`[data-perm="${code}"]`);
    box.checked = checked;
    box.dispatchEvent(new Event('change'));
    await settle();
  };

  const type = async (sel: string, value: string): Promise<void> => {
    const input = q<HTMLInputElement>(sel);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await settle();
  };

  /** The permission filter applies as you type. */
  const search = async (value: string): Promise<void> => {
    const input = q<HTMLInputElement>('#role-permission-search');
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await settle();
  };

  const assignment = {
    getReportsOfRole: vi.fn(),
    setReportsOfRole: vi.fn(),
  };

  beforeEach(async () => {
    assignment.getReportsOfRole.mockReset().mockReturnValue(
      of([
        {
          reportId: 1,
          name: 'Overdue tasks',
          categoryId: 1,
          categoryName: 'Task follow-up',
          categorySortOrder: 1,
          sortOrder: 1,
          description: 'Tasks past due',
          isActive: true,
          assigned: true,
        },
        {
          reportId: 2,
          name: 'Open tasks by client',
          categoryId: 2,
          categoryName: 'Finance',
          categorySortOrder: 2,
          sortOrder: 1,
          isActive: false,
          assigned: false,
        },
      ]),
    );
    assignment.setReportsOfRole.mockReset();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        InMemoryIdentityAdminApi,
        { provide: IdentityAdminApi, useExisting: InMemoryIdentityAdminApi },
        { provide: ReportAssignmentClient, useValue: assignment },
      ],
    });
    api = TestBed.inject(InMemoryIdentityAdminApi);
    fixture = TestBed.createComponent(RolesPage);
    await settle();
  });

  it('lists the roles with member counts and marks System Admin as locked', async () => {
    const names = Array.from(el().querySelectorAll('.mf-role .mf-name')).map((n) => n.textContent);
    expect(names[0]).toBe('System Admin');
    expect(names).toContain('Data Scientist');
    expect(q('[data-role="1"]').textContent).toContain('Built-in, locked');
    expect(q('[data-role="5"]').textContent).toContain('1 member');
  });

  it('shows members and "12 of 50" permissions on every role, equal to the editor (#447)', async () => {
    const total = (await firstValueFrom(api.listPermissions())).flatMap(
      (g) => g.permissions,
    ).length;
    for (const r of api.roles) {
      const row = q(`[data-role="${r.roleId}"]`);
      const shown = row.querySelector('[data-perm-count]')!.textContent!.replace(/\s+/g, ' ');
      const count = r.isSystemAdmin ? total : r.permissionCodes.length;
      expect(shown).toContain(`${count} of ${total}`);
    }
    q('[data-role="5"]').click();
    await settle();
    const n = api.roles.find((r) => r.roleId === 5)!.permissionCodes.length;
    expect(q('[data-editor-count]').textContent!.replace(/\s+/g, ' ')).toContain(
      `${n} of ${total} permissions selected`,
    );
    expect(el().querySelectorAll('[data-perm]:checked').length).toBe(n);
  });

  it('counts each group as selected/total and follows the checkboxes (#447)', async () => {
    await press('New role');
    const group = (name: string) =>
      q(`[data-group="${name}"] [data-group-count]`).textContent!.replace(/\s+/g, ' ').trim();
    const taskTotal = (await firstValueFrom(api.listPermissions())).find((g) => g.group === 'Task')!
      .permissions.length;
    expect(group('Task')).toBe(`0/${taskTotal} selected`);
    await check('Task.Assign', true); // also selects Task.View
    expect(group('Task')).toBe(`2/${taskTotal} selected`);
    expect(q('[data-editor-count]').textContent).toContain('2 of');
  });

  it('warns that Matter.ViewSensitive lets holders see ALL sensitive matters, and only on that permission (epic #788)', async () => {
    await press('New role');
    const warnings = el().querySelectorAll('[data-perm-warning]');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].getAttribute('data-for')).toBe('Matter.ViewSensitive');
    expect(warnings[0].textContent).toContain('see ALL sensitive matters');
    // The warning sits inside the permission's own label, so a screen reader reads it with the checkbox.
    expect(
      warnings[0].closest('label')?.querySelector('[data-perm="Matter.ViewSensitive"]'),
    ).not.toBeNull();
  });

  it('keeps the full role name as a tooltip for the two-line clamp (#447)', async () => {
    const name = q('[data-role="5"] .mf-name');
    expect(name.getAttribute('title')).toBe(name.textContent!.trim());
  });

  it('opens System Admin read-only with no save or delete', async () => {
    q('[data-role="1"]').click();
    await settle();

    expect(q('[data-locked]').textContent).toContain('cannot be edited or deleted');
    expect(q<HTMLInputElement>('[data-name]').disabled).toBe(true);
    expect(button('Save')).toBeUndefined();
    expect(button('Delete role')).toBeUndefined();
  });

  it('creates a role from the grouped catalog and auto-selects the View prerequisite', async () => {
    await press('New role');
    await type('[data-name]', 'Auditor');
    await check('Task.Assign', true);

    expect(q<HTMLInputElement>('[data-perm="Task.View"]').checked).toBe(true);
    expect(q('[data-note]').textContent).toContain('Task.View was also selected');

    await press('Create role');
    const created = api.roles.find((r) => r.name === 'Auditor')!;
    expect(created.permissionCodes.sort()).toEqual(['Task.Assign', 'Task.View']);
    expect(
      Array.from(el().querySelectorAll('.mf-role .mf-name')).map((n) => n.textContent),
    ).toContain('Auditor');
  });

  it('clearing View clears the dependent permissions of the group', async () => {
    q('[data-role="5"]').click(); // Data Technician: has Task.View and Task.Complete
    await settle();
    await check('Task.View', false);

    expect(q<HTMLInputElement>('[data-perm="Task.Complete"]').checked).toBe(false);
    expect(q('[data-note]').textContent).toContain('Task.Complete was also cleared');
  });

  it('selecting a Dashboard tab permission selects Dashboard.View; clearing View clears every tab with one short note', async () => {
    await press('New role');
    await check('Dashboard.ViewSwimlane', true);
    expect(q<HTMLInputElement>('[data-perm="Dashboard.View"]').checked).toBe(true);
    expect(q('[data-note]').textContent).toContain(
      'Dashboard.View was also selected because Dashboard.ViewSwimlane needs it.',
    );

    await check('Dashboard.ViewSummary', true);
    await check('Dashboard.ViewUsers', true);
    await check('Dashboard.View', false);

    for (const tab of ['Summary', 'Swimlane', 'Users', 'Breakdowns', 'Trends']) {
      expect(q<HTMLInputElement>(`[data-perm="Dashboard.View${tab}"]`).checked).toBe(false);
    }
    expect(q('[data-note]').textContent).toBe(
      'Dashboard.ViewSummary, Dashboard.ViewSwimlane, Dashboard.ViewUsers were also cleared because they need Dashboard.View.',
    );
  });

  it('keeps the Dashboard dependency rule independent of other groups', async () => {
    await press('New role');
    await check('Task.View', true);
    await check('Dashboard.ViewTrends', true);
    await check('Dashboard.View', false);
    expect(q<HTMLInputElement>('[data-perm="Task.View"]').checked).toBe(true);
    expect(q<HTMLInputElement>('[data-perm="Dashboard.ViewTrends"]').checked).toBe(false);
  });

  it('lines the form fields up in one column: same left edge and width for name, description, search and copy', async () => {
    await press('New role');
    const fields = ['[data-name]', '[data-description]', '#role-permission-search', '[data-copy]'];
    for (const sel of fields) expect(q(sel).classList.contains('mf-control')).toBe(true);
    // Every control sits in an .mf-fld whose label is a shared .mf-label above it.
    for (const sel of fields) {
      const wrap = q(sel).closest('.mf-fld')!;
      expect(wrap.querySelector('label.mf-label')).not.toBeNull();
    }
  });

  describe('group select all / none (#448)', () => {
    const groupBox = (group: string, which: 'all' | 'none'): HTMLButtonElement =>
      q<HTMLButtonElement>(`[data-group="${group}"] [data-select-${which}]`);
    const ticked = (group: string): number =>
      el().querySelectorAll(`[data-group="${group}"] input[type="checkbox"]:checked`).length;
    const total = (group: string): number =>
      el().querySelectorAll(`[data-group="${group}"] input[type="checkbox"]`).length;

    it('Select all ticks every permission of one group and Select none clears them, as buttons with the group in their name', async () => {
      await press('New role');
      expect(groupBox('Task', 'all').getAttribute('aria-label')).toBe(
        'Select all Task permissions',
      );
      expect(groupBox('Task', 'none').getAttribute('aria-label')).toBe(
        'Clear all Task permissions',
      );
      groupBox('Task', 'all').click();
      await settle();
      expect(ticked('Task')).toBe(total('Task'));
      expect(ticked('Asset')).toBe(0);
      expect(q('[data-note]').textContent).toContain('All');
      expect(q('[data-editor-count]').textContent).toContain(`${total('Task')} of`);
      groupBox('Task', 'none').click();
      await settle();
      expect(ticked('Task')).toBe(0);
    });

    it('selects the whole group even while the search shows only some of it', async () => {
      await press('New role');
      await search('Task.Create');
      groupBox('Task', 'all').click();
      await settle();
      await search('');
      expect(ticked('Task')).toBe(total('Task'));
    });

    it('has no group buttons on the locked System Admin role', async () => {
      q<HTMLButtonElement>('[data-role="1"]').click();
      await settle();
      expect(el().querySelector('[data-select-all]')).toBeNull();
    });
  });

  describe('the Changed (n) row (#448)', () => {
    const chips = (): string[] =>
      Array.from(el().querySelectorAll('[data-change]')).map((c) => c.getAttribute('aria-label')!);

    it('lists what the draft changed with one undo per chip, and clears after Save', async () => {
      q<HTMLButtonElement>('[data-role="6"]').click(); // Data Scientist
      await settle();
      expect(el().querySelector('[data-changes]')).toBeNull();
      await check('Task.Create', true);
      await check('Asset.View', true);
      expect(q('#role-changes-h').textContent!.trim()).toBe('Changed (2)');
      // Catalog order: the Task group comes before the Asset group.
      expect(chips()).toEqual(['Undo: added Task.Create', 'Undo: added Asset.View']);

      // Undo one chip: the box is unticked again and the row shrinks.
      (
        el().querySelector('[data-change][aria-label="Undo: added Task.Create"]') as HTMLElement
      ).click();
      await settle();
      expect(q<HTMLInputElement>('[data-perm="Task.Create"]').checked).toBe(false);
      expect(q('#role-changes-h').textContent!.trim()).toBe('Changed (1)');

      await press('Save changes');
      expect(el().querySelector('[data-changes]')).toBeNull();
    });

    it('shows a removed permission as a chip and puts it back with its undo', async () => {
      q<HTMLButtonElement>('[data-role="6"]').click();
      await settle();
      await check('Task.View', false);
      const removed = Array.from(el().querySelectorAll('[data-change-kind="removed"]'));
      expect(removed.length).toBeGreaterThan(0);
      expect(removed[0].getAttribute('aria-label')).toContain('Undo: removed Task.View');
      (
        el().querySelector('[data-change][aria-label="Undo: removed Task.View"]') as HTMLElement
      ).click();
      await settle();
      expect(q<HTMLInputElement>('[data-perm="Task.View"]').checked).toBe(true);
    });

    it('is not shown for a new role or for System Admin', async () => {
      await press('New role');
      await check('Task.View', true);
      expect(el().querySelector('[data-changes]')).toBeNull();
    });
  });

  describe('the description (#449)', () => {
    it('is a two-row text area with the character counter and the API limit', async () => {
      await press('New role');
      const box = q<HTMLTextAreaElement>('[data-description]');
      expect(box.tagName).toBe('TEXTAREA');
      expect(box.rows).toBe(2);
      expect(box.maxLength).toBe(500);
      expect(box.getAttribute('aria-describedby')).toBe('role-description-count');
      await type('[data-description]', 'x'.repeat(500));
      expect(box.value.length).toBe(500);
      expect(q('#role-description-count').textContent).toContain('500 / 500');
      expect(q('[data-char-count-live]').textContent).toContain('500 of 500 characters');
    });

    it('keeps the unsaved-changes guard: editing the description makes the role dirty', async () => {
      q<HTMLButtonElement>('[data-role="6"]').click();
      await settle();
      expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);
      await type('[data-description]', 'A new description');
      expect(fixture.componentInstance.hasUnsavedChanges()).toBe(true);
    });
  });

  it('filters permissions and copies from another role', async () => {
    await press('New role');
    await search('pod.');
    const groups = Array.from(el().querySelectorAll('[data-group]')).map((g) =>
      g.getAttribute('data-group'),
    );
    expect(groups).toEqual(['Pod']);

    await search('');
    const select = q<HTMLSelectElement>('[data-copy]');
    select.value = '6'; // Data Scientist
    select.dispatchEvent(new Event('change'));
    await settle();
    expect(q<HTMLInputElement>('[data-perm="Task.View"]').checked).toBe(true);
    expect(q('[data-note]').textContent).toContain('copied from Data Scientist');
  });

  it('requires a name and reports a duplicate name on the field', async () => {
    await press('New role');
    await press('Create role');
    expect(q('[data-name-error]').textContent).toContain('Enter a name.');
    expect(q('#role-name').getAttribute('aria-invalid')).toBe('true');
    expect(q('#role-name').getAttribute('aria-describedby')).toBe('role-name-error');

    await type('[data-name]', 'Pod Lead');
    await press('Create role');
    expect(q('[data-name-error]').textContent).toContain('already exists');
  });

  it('marks the name required, offers Cancel after the primary button and tracks unsaved edits', async () => {
    await press('New role');
    expect(q('label[for="role-name"]').textContent).toContain('(required)');
    const labels = Array.from(el().querySelectorAll('.mf-actions p-button')).map((b) =>
      b.textContent!.trim(),
    );
    expect(labels.slice(0, 2)).toEqual(['Create role', 'Cancel']);

    const page = fixture.componentInstance;
    expect(page.hasUnsavedChanges()).toBe(false);
    await type('[data-name]', 'Draft');
    expect(page.hasUnsavedChanges()).toBe(true);
    await press('Cancel');
    expect(el().querySelector('[data-editor]')).toBeNull();
    expect(page.hasUnsavedChanges()).toBe(false);
  });

  async function confirmDelete(): Promise<void> {
    await press('Delete role'); // opens the confirmation
    const confirm = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>('.p-dialog button'),
    ).find((b) => b.textContent!.trim() === 'Delete role')!;
    confirm.click();
    await settle();
  }

  it('asks for confirmation, blocks deleting a role in use and deletes an unused one', async () => {
    q('[data-role="5"]').click(); // Data Technician has a member
    await settle();
    await press('Delete role');
    expect(api.roles.some((r) => r.roleId === 5)).toBe(true);
    expect(document.body.querySelector('.p-dialog')?.textContent).toContain('Delete role?');
    await confirmDelete();
    expect(q('[data-error]').textContent).toMatch(
      /has this role\. Remove them from it before deleting/,
    );
    expect(api.roles.some((r) => r.roleId === 5)).toBe(true);

    q('[data-role="4"]').click(); // Pod Lead has no members
    await settle();
    await confirmDelete();
    expect(api.roles.some((r) => r.roleId === 4)).toBe(false);
  });

  describe('the Reports tab of a role (#717)', () => {
    async function openRole(canAssign: boolean): Promise<void> {
      fixture.componentRef.setInput('canAssignReports', canAssign);
      await settle();
      q<HTMLButtonElement>('[data-role="5"]').click();
      await settle();
    }

    it('is not offered without Report.Assign: the role editor is the permissions editor alone', async () => {
      await openRole(false);
      expect(el().querySelector('[role=tablist]')).toBeNull();
      expect(q('[data-name]')).not.toBeNull();
    });

    it('gives the selected tab a panel to point at: the tab controls an existing tabpanel on both tabs', async () => {
      await openRole(true);
      const tabs = () => Array.from(el().querySelectorAll<HTMLElement>('[role=tab]'));
      for (const index of [0, 1, 0]) {
        tabs()[index].click();
        await settle();
        const selected = tabs()[index];
        const panel = el().querySelector(`#${selected.getAttribute('aria-controls')}`);
        expect(panel).not.toBeNull();
        expect(panel!.getAttribute('role')).toBe('tabpanel');
        expect(panel!.getAttribute('aria-labelledby')).toBe(selected.id);
      }
    });

    it('is a second tab of a saved role, loads its reports only when opened, and saves the checked set', async () => {
      await openRole(true);
      expect(
        Array.from(el().querySelectorAll('[role=tab]')).map((t) => t.textContent!.trim()),
      ).toEqual(['Permissions', 'Reports']);
      expect(assignment.getReportsOfRole).not.toHaveBeenCalled();

      (Array.from(el().querySelectorAll('[role=tab]'))[1] as HTMLElement).click();
      await settle();
      expect(assignment.getReportsOfRole).toHaveBeenCalledWith(5);
      expect(el().querySelector('[data-name]')).toBeNull();
      expect(q('[data-item="2"] [data-flag]').textContent).toBe('Inactive');
      expect(q('[data-checklist-count]').textContent).toContain('1 of 2 reports assigned');

      assignment.setReportsOfRole.mockReturnValue(
        of({
          added: [{ id: 2, name: 'Open tasks by client' }],
          removed: [],
          assignedCount: 2,
          ownerName: 'Data Scientist',
        }),
      );
      const box = q<HTMLInputElement>('[data-item="2"] input');
      box.click();
      await settle();
      q<HTMLButtonElement>('[data-checklist-save]').click();
      await settle();
      expect(assignment.setReportsOfRole).toHaveBeenCalledWith(5, { reportIds: [1, 2] });
    });

    it('goes back to Permissions when another role is opened', async () => {
      await openRole(true);
      (Array.from(el().querySelectorAll('[role=tab]'))[1] as HTMLElement).click();
      await settle();
      q<HTMLButtonElement>('[data-role="1"]').click();
      await settle();
      expect(q('[data-locked]')).not.toBeNull();
    });
  });
});
