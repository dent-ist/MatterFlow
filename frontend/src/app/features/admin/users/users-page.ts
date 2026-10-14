import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import { AuthStore } from '../../../core/auth/auth.store';
import { ApiError } from '../../../core/http/api-error';
import {
  IdentityAdminApi,
  RoleSummaryDto,
  UserCountsDto,
  UserDetailDto,
  UserStatusFilter,
  UserSummaryDto,
} from '../../../core/identity-admin/identity-admin-api';
import { PendingUsersStore } from '../../../core/identity-admin/pending-users.store';
import { NotificationService } from '../../../core/notify/notification.service';
import { MfDatePipe } from '../../../shared/pipes/mf-date.pipe';
import { PageHeader } from '../../../shared/ui/page-header';

type Tab = Exclude<UserStatusFilter, 'all'>;

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 250;

/** S12 Admin: Users. Tabs Pending / Active / Inactive, search, paging and the user detail panel with role assignment. */
@Component({
  selector: 'mf-users-page',
  imports: [PageHeader, Button, RouterLink, MfDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './users-page.html',
  styleUrl: './users-page.scss',
})
export class UsersPage implements OnInit, OnDestroy {
  private readonly api = inject(IdentityAdminApi);
  private readonly auth = inject(AuthStore);
  private readonly pending = inject(PendingUsersStore);
  private readonly notify = inject(NotificationService);
  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly tabs: { id: Tab; label: string }[] = [
    { id: 'pending', label: 'Pending access' },
    { id: 'active', label: 'Active' },
    { id: 'inactive', label: 'Inactive' },
  ];

  protected readonly canManage = computed(() => this.auth.has('User.Manage'));
  protected readonly canManageRoles = computed(() => this.auth.has('Role.Manage'));

  protected readonly tab = signal<Tab>('pending');
  protected readonly search = signal('');
  protected readonly page = signal(1);
  protected readonly counts = signal<UserCountsDto>({ pending: 0, active: 0, inactive: 0 });
  protected readonly users = signal<UserSummaryDto[]>([]);
  protected readonly total = signal(0);
  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);
  protected readonly roles = signal<RoleSummaryDto[]>([]);

  // Detail panel
  protected readonly selected = signal<UserDetailDto | null>(null);
  protected readonly draftRoleIds = signal<number[]>([]);
  protected readonly draftActive = signal(true);
  protected readonly draftName = signal('');
  protected readonly draftEmail = signal('');
  protected readonly confirmDeactivate = signal(false);
  protected readonly saving = signal(false);
  protected readonly panelError = signal('');

  protected readonly pageCount = computed(() => Math.max(1, Math.ceil(this.total() / PAGE_SIZE)));
  protected readonly dirty = computed(() => {
    const u = this.selected();
    if (!u) return false;
    return (
      !sameIds(this.draftRoleIds(), u.roleIds) ||
      this.draftActive() !== u.isActive ||
      this.draftName().trim() !== u.displayName ||
      (this.draftEmail().trim() || undefined) !== (u.email ?? undefined)
    );
  });

  async ngOnInit(): Promise<void> {
    await Promise.all([this.loadRoles(), this.reload()]);
  }

  ngOnDestroy(): void {
    clearTimeout(this.searchTimer);
  }

  /** Pending users are also counted as active by the API; they are listed under Pending only. */
  protected countFor(tab: Tab): number {
    const counts = this.counts();
    return tab === 'active' ? Math.max(0, counts.active - counts.pending) : counts[tab];
  }

  /** True while the role ticks in the panel differ from the saved ones, so the effective permissions shown are out of date. */
  protected readonly rolesChanged = computed(() => {
    const u = this.selected();
    return !!u && !sameIds(this.draftRoleIds(), u.roleIds);
  });

  protected async selectTab(tab: Tab): Promise<void> {
    this.tab.set(tab);
    this.page.set(1);
    await this.reload();
  }

  protected onSearchInput(value: string): void {
    this.search.set(value);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => void this.applySearch(), SEARCH_DEBOUNCE_MS);
  }

  protected async applySearch(): Promise<void> {
    clearTimeout(this.searchTimer);
    this.page.set(1);
    await this.reload();
  }

  protected async goTo(page: number): Promise<void> {
    this.page.set(Math.min(Math.max(1, page), this.pageCount()));
    await this.reload();
  }

  protected async open(user: UserSummaryDto): Promise<void> {
    this.panelError.set('');
    this.confirmDeactivate.set(false);
    try {
      this.showDetail(await firstValueFrom(this.api.getUser(user.userId)));
    } catch {
      this.panelError.set('We could not load this user. Try again.');
    }
  }

  protected closePanel(): void {
    this.selected.set(null);
    this.panelError.set('');
    this.confirmDeactivate.set(false);
  }

  protected toggleRole(roleId: number, checked: boolean): void {
    const ids = new Set(this.draftRoleIds());
    if (checked) ids.add(roleId);
    else ids.delete(roleId);
    this.draftRoleIds.set([...ids].sort((a, b) => a - b));
  }

  protected setActive(active: boolean): void {
    this.draftActive.set(active);
    this.confirmDeactivate.set(false);
  }

  /** Save; deactivating asks for an inline confirmation first (UX 8.4: work stays assigned until reassigned). */
  protected async save(): Promise<void> {
    const user = this.selected();
    if (!user || !this.dirty()) return;
    if (user.isActive && !this.draftActive() && !this.confirmDeactivate()) {
      this.confirmDeactivate.set(true);
      return;
    }

    this.saving.set(true);
    this.panelError.set('');
    try {
      let current = user;
      const name = this.draftName().trim();
      const email = this.draftEmail().trim() || undefined;
      if (name !== current.displayName || email !== (current.email ?? undefined)) {
        current = await firstValueFrom(
          this.api.updateUserProfile(current.userId, name, email, current.rowVersion),
        );
      }

      if (!sameIds(this.draftRoleIds(), current.roleIds)) {
        current = await firstValueFrom(
          this.api.setUserRoles(current.userId, this.draftRoleIds(), current.rowVersion),
        );
      }

      if (this.draftActive() !== current.isActive) {
        current = await firstValueFrom(
          this.api.setUserActive(current.userId, this.draftActive(), current.rowVersion),
        );
      }

      this.showDetail(current);
      this.notify.success('User saved', current.displayName);
      await this.reload();
    } catch (err) {
      await this.handleSaveError(err, user.userId);
    } finally {
      this.saving.set(false);
      this.confirmDeactivate.set(false);
    }
  }

  protected rolesLabel(user: UserSummaryDto): string {
    return user.roles.length ? user.roles.join(', ') : 'None';
  }

  private async handleSaveError(err: unknown, userId: number): Promise<void> {
    if (!(err instanceof ApiError)) {
      this.panelError.set('Something went wrong. Try again.');
      return;
    }

    if (err.code === 'LAST_ADMIN') {
      this.panelError.set('At least one active System Admin is required.');
    } else if (err.code === 'CONCURRENCY_CONFLICT') {
      this.panelError.set('This user was changed by someone else. The latest values are shown.');
      try {
        this.showDetail(await firstValueFrom(this.api.getUser(userId)));
      } catch {
        /* keep the stale panel; the message tells the admin to retry */
      }
    } else {
      this.panelError.set(err.message);
    }
  }

  private showDetail(user: UserDetailDto): void {
    this.selected.set(user);
    this.draftRoleIds.set([...user.roleIds]);
    this.draftActive.set(user.isActive);
    this.draftName.set(user.displayName);
    this.draftEmail.set(user.email ?? '');
  }

  private async loadRoles(): Promise<void> {
    try {
      this.roles.set(await firstValueFrom(this.api.listRoles()));
    } catch {
      this.roles.set([]);
    }
  }

  private async reload(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(false);
    try {
      const [list, counts] = await Promise.all([
        firstValueFrom(
          this.api.listUsers({
            status: this.tab(),
            search: this.search(),
            page: this.page(),
            pageSize: PAGE_SIZE,
          }),
        ),
        firstValueFrom(this.api.userCounts()),
      ]);
      const items = this.tab() === 'active' ? list.items.filter((u) => !u.isPending) : list.items;
      this.users.set(items);
      this.total.set(list.total - (list.items.length - items.length));
      this.counts.set(counts);
      this.pending.set(counts.pending);
    } catch {
      this.loadError.set(true);
    } finally {
      this.loading.set(false);
    }
  }
}

function sameIds(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join();
}
