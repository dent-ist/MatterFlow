import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import { ApiError } from '../../../core/http/api-error';
import {
  IdentityAdminApi,
  PermissionGroupDto,
  RoleDetailDto,
  RoleSummaryDto,
} from '../../../core/identity-admin/identity-admin-api';
import { NotificationService } from '../../../core/notify/notification.service';
import { CharCounter } from '../../../shared/ui/char-counter';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { Tabs } from '../../../shared/ui/tabs';
import { ScrollArea } from '../../../shared/ui/fixed-page';
import { phoneCards } from '../../../shared/ui/record-card-list';
import { AdminTabCounts } from '../admin-tabs';
import { RoleReportsTab } from '../reports/role-reports-tab';
import { HasUnsavedChanges } from '../../../shared/guards/unsaved-changes.guard';

/** The permission that every other permission of the same group needs (Assign requires View), if the catalog has one. */
export function prerequisiteOf(code: string, all: ReadonlySet<string>): string | undefined {
  const [group, action] = code.split('.');
  const view = `${group}.View`;
  return action !== 'View' && all.has(view) ? view : undefined;
}

/** The most characters a role description may have (the API's limit). */
export const ROLE_DESCRIPTION_MAX = 500;

/** One permission that differs from the saved role: ticked since (`added`) or unticked since (`removed`). */
export interface RoleChange {
  code: string;
  kind: 'added' | 'removed';
}

/**
 * What the draft changed in the permissions of a saved role, in catalog order: the added ones first, then the removed ones. A new role (no
 * saved set) and the locked System Admin role have no changes to show.
 */
export function roleChanges(
  saved: ReadonlySet<string> | null,
  draft: ReadonlySet<string>,
  catalogOrder: readonly string[],
): RoleChange[] {
  if (!saved) return [];
  return [
    ...catalogOrder
      .filter((c) => draft.has(c) && !saved.has(c))
      .map((code) => ({ code, kind: 'added' as const })),
    ...catalogOrder
      .filter((c) => saved.has(c) && !draft.has(c))
      .map((code) => ({ code, kind: 'removed' as const })),
  ];
}

/** S12 Admin: Roles and permissions. List with member counts, editor with the grouped permission matrix. */
@Component({
  selector: 'mf-roles-page',
  imports: [Button, CharCounter, ConfirmDialog, RoleReportsTab, ScrollArea, Tabs],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-fill' },
  templateUrl: './roles-page.html',
  styleUrl: './roles-page.scss',
})
export class RolesPage implements OnInit, HasUnsavedChanges {
  private readonly api = inject(IdentityAdminApi);
  private readonly notify = inject(NotificationService);
  private readonly reportCount = AdminTabCounts.report('roles');

  /**
   * True for a person who holds `Report.Assign`: a saved role then has a second tab, Reports (which reports the role may run). The host page
   * passes it, so this page does not read the permissions itself. The Reports tab loads its reports when it is opened.
   */
  readonly canAssignReports = input(false);
  protected readonly roleTab = signal<'permissions' | 'reports'>('permissions');
  protected readonly roleTabs = [
    { key: 'permissions', label: 'Permissions' },
    { key: 'reports', label: 'Reports' },
  ];
  protected readonly showRoleTabs = computed(() => this.canAssignReports() && !!this.selected());

  /** Below 640 px the list has no header row: the word "permissions" is then on the row itself. */
  protected readonly phone = phoneCards();
  protected readonly roles = signal<RoleSummaryDto[]>([]);
  protected readonly catalog = signal<PermissionGroupDto[]>([]);
  protected readonly loadError = signal(false);

  /** The role in the editor; `null` while creating a new one. */
  protected readonly selected = signal<RoleDetailDto | null>(null);
  protected readonly editing = signal(false);
  protected readonly draftName = signal('');
  protected readonly draftDescription = signal('');
  protected readonly draftCodes = signal<ReadonlySet<string>>(new Set());
  protected readonly filter = signal('');
  protected readonly note = signal('');
  protected readonly error = signal('');
  protected readonly nameError = signal('');
  protected readonly saving = signal(false);
  protected readonly confirmingDelete = signal(false);

  protected readonly locked = computed(() => this.selected()?.isSystemAdmin ?? false);
  protected readonly descriptionMax = ROLE_DESCRIPTION_MAX;
  /** Permissions that differ from the saved role (empty while creating a new role or looking at the locked one). */
  protected readonly changes = computed<RoleChange[]>(() => {
    const saved = this.selected();
    if (!saved || this.locked()) return [];
    return roleChanges(new Set(saved.permissionCodes), this.draftCodes(), [...this.allCodes()]);
  });
  protected readonly allCodes = computed(
    () => new Set(this.catalog().flatMap((g) => g.permissions.map((p) => p.code))),
  );
  protected readonly totalPermissions = computed(() => this.allCodes().size);
  /** Permissions ticked in the editor (the whole catalog for the locked System Admin role). */
  protected readonly draftCount = computed(() =>
    this.locked() ? this.totalPermissions() : this.draftCodes().size,
  );
  protected readonly visibleGroups = computed(() => {
    const needle = this.filter().trim().toLowerCase();
    return this.catalog()
      .map((g) => ({
        ...g,
        permissions: g.permissions.filter(
          (p) =>
            !needle ||
            p.code.toLowerCase().includes(needle) ||
            p.description.toLowerCase().includes(needle),
        ),
      }))
      .filter((g) => g.permissions.length > 0);
  });
  /** What the editor held when it was opened or last saved; the editor is dirty when the draft differs. */
  private readonly baseline = signal('');
  private readonly draftKey = computed(() =>
    JSON.stringify([
      this.draftName().trim(),
      this.draftDescription().trim(),
      [...this.draftCodes()].sort(),
    ]),
  );
  protected readonly dirty = computed(
    () => this.editing() && !this.locked() && this.draftKey() !== this.baseline(),
  );
  protected readonly canDelete = computed(() => {
    const r = this.selected();
    return !!r && !r.isSystemAdmin;
  });

  /** Keeps the list and the `Roles (n)` tab of the shell in step. */
  private setRoles(roles: RoleSummaryDto[]): void {
    this.roles.set(roles);
    this.reportCount(roles.length);
  }

  hasUnsavedChanges(): boolean {
    return this.dirty();
  }

  async ngOnInit(): Promise<void> {
    try {
      const [roles, catalog] = await Promise.all([
        firstValueFrom(this.api.listRoles()),
        firstValueFrom(this.api.listPermissions()),
      ]);
      this.setRoles(roles);
      this.catalog.set(catalog);
    } catch {
      this.loadError.set(true);
    }
  }

  protected startNew(): void {
    this.roleTab.set('permissions');
    this.selected.set(null);
    this.editing.set(true);
    this.draftName.set('');
    this.draftDescription.set('');
    this.draftCodes.set(new Set());
    this.baseline.set(this.draftKey());
    this.resetMessages();
  }

  /** Closes the editor without saving. */
  protected cancel(): void {
    this.editing.set(false);
    this.selected.set(null);
    this.resetMessages();
  }

  protected async edit(role: RoleSummaryDto): Promise<void> {
    this.resetMessages();
    if (this.selected()?.roleId !== role.roleId) this.roleTab.set('permissions');
    try {
      const detail = await firstValueFrom(this.api.getRole(role.roleId));
      this.selected.set(detail);
      this.editing.set(true);
      this.draftName.set(detail.name);
      this.draftDescription.set(detail.description ?? '');
      this.draftCodes.set(new Set(detail.permissionCodes));
      this.baseline.set(this.draftKey());
    } catch {
      this.error.set('We could not load this role. Try again.');
    }
  }

  /** "Task 6/9": ticked and total permissions of one group, over the whole catalog (the search filter does not change them). */
  protected groupTotal(group: string): number {
    return this.catalog().find((g) => g.group === group)?.permissions.length ?? 0;
  }

  protected groupCount(group: string): number {
    if (this.locked()) return this.groupTotal(group);
    const codes = this.catalog().find((g) => g.group === group)?.permissions ?? [];
    const draft = this.draftCodes();
    return codes.filter((p) => draft.has(p.code)).length;
  }

  protected isChecked(code: string): boolean {
    return this.draftCodes().has(code);
  }

  protected toggle(code: string, checked: boolean): void {
    if (this.locked()) return;
    const codes = new Set(this.draftCodes());
    const notes: string[] = [];
    if (checked) {
      codes.add(code);
      const need = prerequisiteOf(code, this.allCodes());
      if (need && !codes.has(need)) {
        codes.add(need);
        notes.push(`${need} was also selected because ${code} needs it.`);
      }
    } else {
      codes.delete(code);
      if (code.endsWith('.View')) {
        const group = code.split('.')[0];
        // Catalog order, so the note reads the same however the boxes were ticked.
        const cleared = [...this.allCodes()].filter(
          (c) => codes.has(c) && c.startsWith(group + '.'),
        );
        for (const other of cleared) codes.delete(other);
        if (cleared.length === 1) {
          notes.push(`${cleared[0]} was also cleared because it needs ${code}.`);
        } else if (cleared.length > 1) {
          notes.push(`${cleared.join(', ')} were also cleared because they need ${code}.`);
        }
      }
    }

    this.draftCodes.set(codes);
    this.note.set(notes.join(' '));
  }

  /** "Select all" / "Clear" of one group: every permission of the group (the whole catalog group, not only what the search shows). */
  protected selectGroup(group: string, on: boolean): void {
    if (this.locked()) return;
    const permissions = this.catalog().find((g) => g.group === group)?.permissions ?? [];
    const codes = new Set(this.draftCodes());
    for (const p of permissions) {
      if (on) codes.add(p.code);
      else codes.delete(p.code);
    }
    this.draftCodes.set(codes);
    this.note.set(
      on
        ? `All ${permissions.length} ${group} permissions selected.`
        : `${group} permissions cleared.`,
    );
  }

  /** The undo of one chip of the Changed row: an added permission is unticked, a removed one ticked again (with the rules of ticking). */
  protected undoChange(change: RoleChange): void {
    this.toggle(change.code, change.kind === 'removed');
    // The chip goes away with its change: focus goes to the permission it was about (else the count line), never to nowhere.
    setTimeout(() => {
      const box = document.querySelector<HTMLElement>(`[data-perm="${change.code}"]`);
      const next = box ?? document.querySelector<HTMLElement>('[data-editor-count]');
      if (next && !next.matches('input, button')) next.setAttribute('tabindex', '-1');
      next?.focus();
    });
  }

  /** "Copy from role": replaces the draft permissions with another role's. */
  protected async copyFrom(roleId: string): Promise<void> {
    if (!roleId || this.locked()) return;
    try {
      const source = await firstValueFrom(this.api.getRole(Number(roleId)));
      this.draftCodes.set(new Set(source.permissionCodes));
      this.note.set(`Permissions copied from ${source.name}. Save to apply.`);
    } catch {
      this.error.set('We could not copy from that role.');
    }
  }

  protected async save(): Promise<void> {
    const name = this.draftName().trim();
    this.nameError.set(name ? '' : 'Enter a name.');
    if (!name) queueMicrotask(() => document.getElementById('role-name')?.focus());
    if (!name || this.locked()) return;

    this.saving.set(true);
    this.error.set('');
    const request = {
      name,
      description: this.draftDescription().trim() || undefined,
      permissionCodes: [...this.draftCodes()].sort(),
    };
    try {
      const current = this.selected();
      const saved = current
        ? await firstValueFrom(
            this.api.updateRole(current.roleId, { ...request, rowVersion: current.rowVersion }),
          )
        : await firstValueFrom(this.api.createRole(request));
      this.selected.set(saved);
      this.draftCodes.set(new Set(saved.permissionCodes));
      this.baseline.set(this.draftKey());
      this.setRoles(await firstValueFrom(this.api.listRoles()));
      this.notify.success('Role saved', "Changes apply on each user's next request.");
    } catch (err) {
      this.handleError(err);
    } finally {
      this.saving.set(false);
      // The Save button is disabled while it runs, which takes focus away from it: give it back once it can take it.
      setTimeout(() => {
        const active = document.activeElement;
        if (!active || active === document.body) {
          document.querySelector<HTMLElement>('[data-save] button')?.focus();
        }
      });
    }
  }

  protected async remove(): Promise<void> {
    const role = this.selected();
    this.confirmingDelete.set(false);
    if (!role || role.isSystemAdmin) return;
    this.error.set('');
    try {
      await firstValueFrom(this.api.deleteRole(role.roleId));
      this.setRoles(await firstValueFrom(this.api.listRoles()));
      this.selected.set(null);
      this.editing.set(false);
      this.notify.success('Role deleted', role.name);
    } catch (err) {
      this.handleError(err);
    }
  }

  private handleError(err: unknown): void {
    if (!(err instanceof ApiError)) {
      this.error.set('Something went wrong. Try again.');
    } else if (err.code === 'DUPLICATE_NAME') {
      this.nameError.set('A role with this name already exists.');
    } else if (err.code === 'ROLE_IN_USE') {
      const count =
        this.roles().find((r) => r.roleId === this.selected()?.roleId)?.memberCount ?? 0;
      this.error.set(
        count > 0
          ? `${count === 1 ? '1 user has' : `${count} users have`} this role. Remove them from it before deleting.`
          : 'People still have this role. Remove them from it before deleting.',
      );
    } else if (err.code === 'CONCURRENCY_CONFLICT') {
      this.error.set('This role was changed by someone else. Reopen it to see the latest values.');
    } else {
      this.error.set(err.message);
    }
  }

  private resetMessages(): void {
    this.note.set('');
    this.error.set('');
    this.nameError.set('');
    this.filter.set('');
  }
}
