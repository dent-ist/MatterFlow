import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
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
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';

/** The permission that every other permission of the same group needs (Assign requires View), if the catalog has one. */
export function prerequisiteOf(code: string, all: ReadonlySet<string>): string | undefined {
  const [group, action] = code.split('.');
  const view = `${group}.View`;
  return action !== 'View' && all.has(view) ? view : undefined;
}

/** S12 Admin: Roles and permissions. List with member counts, editor with the grouped permission matrix. */
@Component({
  selector: 'mf-roles-page',
  imports: [Button, RouterLink, ConfirmDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './roles-page.html',
  styleUrl: './roles-page.scss',
})
export class RolesPage implements OnInit {
  private readonly api = inject(IdentityAdminApi);
  private readonly notify = inject(NotificationService);

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
  protected readonly allCodes = computed(
    () => new Set(this.catalog().flatMap((g) => g.permissions.map((p) => p.code))),
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
  protected readonly canDelete = computed(() => {
    const r = this.selected();
    return !!r && !r.isSystemAdmin;
  });

  async ngOnInit(): Promise<void> {
    try {
      const [roles, catalog] = await Promise.all([
        firstValueFrom(this.api.listRoles()),
        firstValueFrom(this.api.listPermissions()),
      ]);
      this.roles.set(roles);
      this.catalog.set(catalog);
    } catch {
      this.loadError.set(true);
    }
  }

  protected startNew(): void {
    this.selected.set(null);
    this.editing.set(true);
    this.draftName.set('');
    this.draftDescription.set('');
    this.draftCodes.set(new Set());
    this.resetMessages();
  }

  protected async edit(role: RoleSummaryDto): Promise<void> {
    this.resetMessages();
    try {
      const detail = await firstValueFrom(this.api.getRole(role.roleId));
      this.selected.set(detail);
      this.editing.set(true);
      this.draftName.set(detail.name);
      this.draftDescription.set(detail.description ?? '');
      this.draftCodes.set(new Set(detail.permissionCodes));
    } catch {
      this.error.set('We could not load this role. Try again.');
    }
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
        for (const other of [...codes].filter((c) => c.startsWith(group + '.'))) {
          codes.delete(other);
          notes.push(`${other} was also cleared because it needs ${code}.`);
        }
      }
    }

    this.draftCodes.set(codes);
    this.note.set(notes.join(' '));
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
    this.nameError.set(name ? '' : 'Name is required.');
    if (!name || this.locked()) return;

    this.saving.set(true);
    this.error.set('');
    const request = {
      name,
      description: this.draftDescription().trim() || undefined,
      permissionCodes: [...this.draftCodes()].sort(),
      rowVersion: this.selected()?.rowVersion,
    };
    try {
      const current = this.selected();
      const saved = current
        ? await firstValueFrom(this.api.updateRole(current.roleId, request))
        : await firstValueFrom(this.api.createRole(request));
      this.selected.set(saved);
      this.draftCodes.set(new Set(saved.permissionCodes));
      this.roles.set(await firstValueFrom(this.api.listRoles()));
      this.notify.success('Role saved', "Changes apply on each user's next request.");
    } catch (err) {
      this.handleError(err);
    } finally {
      this.saving.set(false);
    }
  }

  protected async remove(): Promise<void> {
    const role = this.selected();
    this.confirmingDelete.set(false);
    if (!role || role.isSystemAdmin) return;
    this.error.set('');
    try {
      await firstValueFrom(this.api.deleteRole(role.roleId));
      this.roles.set(await firstValueFrom(this.api.listRoles()));
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
