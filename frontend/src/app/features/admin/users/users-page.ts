import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import { AuthStore } from '../../../core/auth/auth.store';
import { ApiError } from '../../../core/http/api-error';
import {
  IdentityAdminApi,
  PodChoice,
  RoleSummaryDto,
  UserCountsDto,
  UserDetailDto,
  UserPodDto,
  UserStatusFilter,
  UserSummaryDto,
} from '../../../core/identity-admin/identity-admin-api';
import { PendingUsersStore } from '../../../core/identity-admin/pending-users.store';
import { NotificationService } from '../../../core/notify/notification.service';
import { UndoService } from '../../../core/notify/undo.service';
import { MfDatePipe } from '../../../shared/pipes/mf-date.pipe';
import { AvailabilityChip } from '../../../shared/availability/availability-chip';
import { AvailabilityDialog } from '../../../shared/availability/availability-dialog';
import { Badge } from '../../../shared/ui/badge';
import { ListState } from '../../../shared/ui/data-table';
import { ScrollArea } from '../../../shared/ui/fixed-page';
import { parsePage } from '../../../shared/ui/list-helpers';
import { Pager } from '../../../shared/ui/pager';
import { PodsChange, UserPodsCell } from './user-pods-cell';
import { podsText } from './user-pods-draft';
import { SearchBox } from '../../../shared/ui/search-box';

type Tab = Exclude<UserStatusFilter, 'all'>;
type StatusOption = UserStatusFilter;

const STATUS_VALUES: readonly StatusOption[] = ['pending', 'active', 'inactive', 'all'];

const PAGE_SIZE = 25;

/** The availability filter (UX: next to the status filter). Off hours is a soft state; "Available" means available right now. */
type AvailabilityFilter = 'all' | 'AVAILABLE' | 'OUT_OF_OFFICE' | 'OFF_HOURS';
const AVAILABILITY_VALUES: readonly AvailabilityFilter[] = [
  'all',
  'AVAILABLE',
  'OUT_OF_OFFICE',
  'OFF_HOURS',
];
const AVAILABILITY_OPTIONS: { value: AvailabilityFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'AVAILABLE', label: 'Available' },
  { value: 'OUT_OF_OFFICE', label: 'Out of office' },
  { value: 'OFF_HOURS', label: 'Off hours' },
];
/** The API lists at most this many users per request. */
const FETCH_SIZE = 100;
/** The availability filter reads the whole status list (at most this many users) and filters it here. */
const FILTER_LIMIT = 1000;

/**
 * S12 Admin: Users tab of the Users page. A status filter (Pending access / Active / Inactive / All) next to the search box, paging and
 * the user detail panel with role assignment. Status, search and page live in the address (`status`, `q`, `page`); without `status`
 * the list opens on Pending access when someone is waiting and on Active otherwise.
 */
@Component({
  selector: 'mf-users-page',
  imports: [
    Button,
    MfDatePipe,
    ScrollArea,
    SearchBox,
    ListState,
    Pager,
    Badge,
    AvailabilityChip,
    AvailabilityDialog,
    UserPodsCell,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-fill' },
  templateUrl: './users-page.html',
  styleUrls: ['./users-page.scss', '../../../shared/ui/page.scss'],
})
export class UsersPage implements OnInit {
  private readonly api = inject(IdentityAdminApi);
  private readonly auth = inject(AuthStore);
  private readonly pending = inject(PendingUsersStore);
  private readonly notify = inject(NotificationService);
  private readonly undo = inject(UndoService);

  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly query = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  /** Pending access when someone is waiting, else Active; applies only while the address has no `status`. */
  private readonly defaultTab = signal<Tab>('active');
  private readonly ready = signal(false);

  /** Status filter options; the pending count is part of its label so the cue stays visible while another status is shown. */
  protected readonly statusOptions = computed<{ value: StatusOption; label: string }[]>(() => [
    { value: 'pending', label: `Pending access (${this.counts().pending})` },
    { value: 'active', label: 'Active' },
    { value: 'inactive', label: 'Inactive' },
    { value: 'all', label: 'All' },
  ]);

  protected readonly availabilityOptions = AVAILABILITY_OPTIONS;
  protected readonly availabilityFilter = computed<AvailabilityFilter>(() => {
    const value = this.query().get('availability') as AvailabilityFilter | null;
    return value && AVAILABILITY_VALUES.includes(value) ? value : 'all';
  });
  /** Person whose availability is being edited in the dialog (needs User.Manage). */
  protected readonly availabilityEdit = signal<UserSummaryDto | null>(null);
  protected readonly availabilityDialogOpen = signal(false);

  protected readonly canManage = computed(() => this.auth.has('User.Manage'));
  protected readonly canManageRoles = computed(() => this.auth.has('Role.Manage'));
  /** Pod assignment in the grid needs Pod.ManageMembers (the endpoint's permission; Pod.Manage alone edits pods, not who is in them). */
  protected readonly canEditPods = computed(() => this.auth.has('Pod.ManageMembers'));

  // Pods column: the active pods to offer (loaded the first time an editor opens) and the people whose save is running.
  protected readonly podChoices = signal<PodChoice[] | null>(null);
  protected readonly podChoicesFailed = signal(false);
  protected readonly podsBusy = signal<ReadonlySet<number>>(new Set());

  protected readonly tab = computed<StatusOption>(() => {
    const value = this.query().get('status') as StatusOption | null;
    return value && STATUS_VALUES.includes(value) ? value : this.defaultTab();
  });
  protected readonly search = computed(() => this.query().get('q')?.trim() ?? '');
  protected readonly page = computed(() => parsePage(this.query().get('page') ?? undefined));
  protected readonly counts = signal<UserCountsDto>({ pending: 0, active: 0, inactive: 0 });
  protected readonly users = signal<UserSummaryDto[]>([]);
  protected readonly total = signal(0);
  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);
  protected readonly roles = signal<RoleSummaryDto[]>([]);

  // Detail panel
  protected readonly selected = signal<UserDetailDto | null>(null);
  /** Availability of the person in the detail panel, from the list row. */
  protected readonly selectedAvailability = computed(
    () => this.users().find((u) => u.userId === this.selected()?.userId)?.availability ?? null,
  );
  protected readonly draftRoleIds = signal<number[]>([]);
  protected readonly draftActive = signal(true);
  protected readonly draftName = signal('');
  protected readonly draftEmail = signal('');
  protected readonly confirmDeactivate = signal(false);
  protected readonly saving = signal(false);
  protected readonly panelError = signal('');

  protected readonly pageSize = PAGE_SIZE;
  protected readonly listState = computed<'loading' | 'ready' | 'error'>(() =>
    this.loadError() ? 'error' : this.loading() && this.users().length === 0 ? 'loading' : 'ready',
  );
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

  constructor() {
    // Any change of status, search or page in the address reloads the list.
    effect(() => {
      if (!this.ready()) return;
      this.tab();
      this.search();
      this.page();
      this.availabilityFilter();
      untracked(() => void this.reload());
    });
  }

  async ngOnInit(): Promise<void> {
    void this.loadRoles();
    try {
      const counts = await firstValueFrom(this.api.userCounts());
      this.counts.set(counts);
      this.pending.set(counts.pending);
      this.defaultTab.set(counts.pending > 0 ? 'pending' : 'active');
    } catch {
      /* the list load below reports the failure */
    }
    this.ready.set(true);
  }

  /** True while the role ticks in the panel differ from the saved ones, so the effective permissions shown are out of date. */
  protected readonly rolesChanged = computed(() => {
    const u = this.selected();
    return !!u && !sameIds(this.draftRoleIds(), u.roleIds);
  });

  private navigate(params: Record<string, string | number | null>): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: params,
      queryParamsHandling: 'merge',
    });
  }

  protected setStatus(value: string): void {
    this.navigate({ status: value, page: null });
  }

  protected setAvailabilityFilter(value: string): void {
    this.navigate({ availability: value === 'all' ? null : value, page: null });
  }

  protected clearFilters(): void {
    this.navigate({ q: null, availability: null, page: null });
  }

  protected editAvailability(user: UserSummaryDto): void {
    this.availabilityEdit.set(user);
    this.availabilityDialogOpen.set(true);
  }

  /** The shared search box searches live after a pause and at once on Enter (UXR-11). */
  protected onSearch(value: string): void {
    if (value === this.search()) return;
    this.navigate({ q: value || null, page: null });
  }

  protected goTo(page: number): void {
    const next = Math.min(Math.max(1, page), this.pageCount());
    this.navigate({ page: next === 1 ? null : next });
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

  // ---- Pods column (inline assignment)

  /** Loads the pods to offer once, the first time any editor opens. */
  protected async loadPodChoices(): Promise<void> {
    if (this.podChoices() !== null) return;
    this.podChoicesFailed.set(false);
    try {
      this.podChoices.set(await firstValueFrom(this.api.listActivePods()));
    } catch {
      this.podChoicesFailed.set(true);
    }
  }

  /**
   * Applies one change of pods for one person: one request for the whole change. The chips show the result at once; a failure puts the
   * old chips back, a 409 (someone else changed the person's pods) refreshes the list. Success offers one Undo that restores the
   * previous pods in one request as well.
   */
  protected async applyPods(user: UserSummaryDto, change: PodsChange): Promise<void> {
    const before = user.pods;
    const choices = this.podChoices() ?? [];
    const optimistic: UserPodDto[] = change.podIds
      .map((id) => {
        const known = before.find((p) => p.podId === id);
        const name = known?.name ?? choices.find((c) => c.podId === id)?.name ?? '';
        return {
          podId: id,
          name,
          isActive: known?.isActive ?? true,
          isPrimary: id === change.primaryPodId,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    this.setPodsBusy(user.userId, true);
    this.patchPods(user.userId, optimistic);
    try {
      const saved = await firstValueFrom(
        this.api.setUserPods(user.userId, {
          podIds: change.podIds,
          primaryPodId: change.primaryPodId,
          expectedPodIds: before.map((p) => p.podId),
          expectedPrimaryPodId: before.find((p) => p.isPrimary)?.podId,
        }),
      );
      this.patchPods(user.userId, saved);
      this.undo.offer(this.podsMessage(user.displayName, saved), () =>
        this.undoPods(user, before, saved),
      );
    } catch (error) {
      this.patchPods(user.userId, before);
      if (error instanceof ApiError && error.code === 'CONCURRENCY_CONFLICT') {
        this.notify.error(
          `The pods of ${user.displayName} were changed by someone else. The list was refreshed.`,
        );
        void this.reload();
      } else if (!(error instanceof ApiError) || error.hasFieldErrors) {
        // The HTTP layer already toasts other API failures.
        this.notify.error(
          error instanceof ApiError ? error.message : "We couldn't save the pods. Try again.",
        );
      }
    } finally {
      this.setPodsBusy(user.userId, false);
    }
  }

  /** Undo: puts the previous pods back in one request, unless someone changed them since (then nothing is overwritten). */
  private async undoPods(
    user: UserSummaryDto,
    previous: readonly UserPodDto[],
    applied: readonly UserPodDto[],
  ): Promise<void> {
    try {
      const restored = await firstValueFrom(
        this.api.setUserPods(user.userId, {
          podIds: previous.map((p) => p.podId),
          primaryPodId: previous.find((p) => p.isPrimary)?.podId,
          expectedPodIds: applied.map((p) => p.podId),
          expectedPrimaryPodId: applied.find((p) => p.isPrimary)?.podId,
        }),
      );
      this.patchPods(user.userId, restored);
      this.notify.success(`Pods of ${user.displayName} restored.`);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'CONCURRENCY_CONFLICT') {
        this.notify.info(`Not undone: the pods of ${user.displayName} were changed since.`);
        void this.reload();
      } else if (!(error instanceof ApiError) || error.hasFieldErrors) {
        this.notify.error(
          error instanceof ApiError ? error.message : "We couldn't undo that change. Try again.",
        );
      } else {
        // The HTTP layer toasts the failure; add what it means for the Undo.
        this.notify.error(`Couldn't undo the pod change of ${user.displayName}.`);
      }
    }
  }

  private podsMessage(name: string, pods: readonly UserPodDto[]): string {
    return pods.length === 0
      ? `${name} is in no pod now.`
      : `Pods of ${name} set to ${podsText(pods)}.`;
  }

  private patchPods(userId: number, pods: readonly UserPodDto[]): void {
    this.users.update((list) =>
      list.map((u) => (u.userId === userId ? { ...u, pods: [...pods] } : u)),
    );
  }

  private setPodsBusy(userId: number, busy: boolean): void {
    this.podsBusy.update((set) => {
      const next = new Set(set);
      if (busy) next.add(userId);
      else next.delete(userId);
      return next;
    });
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

  private fetchPage() {
    return firstValueFrom(
      this.api.listUsers({
        status: this.tab(),
        search: this.search(),
        page: this.page(),
        pageSize: PAGE_SIZE,
      }),
    );
  }

  /** Every user of the status and search (the API has no availability filter), for the availability filter. */
  private async fetchAll() {
    const first = await firstValueFrom(
      this.api.listUsers({
        status: this.tab(),
        search: this.search(),
        page: 1,
        pageSize: FETCH_SIZE,
      }),
    );
    const items = [...first.items];
    for (let page = 2; items.length < Math.min(first.total, FILTER_LIMIT); page++) {
      const next = await firstValueFrom(
        this.api.listUsers({
          status: this.tab(),
          search: this.search(),
          page,
          pageSize: FETCH_SIZE,
        }),
      );
      if (next.items.length === 0) break;
      items.push(...next.items);
    }
    return { ...first, items };
  }

  protected async reload(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(false);
    try {
      const availability = this.availabilityFilter();
      const [list, counts] = await Promise.all([
        availability === 'all' ? this.fetchPage() : this.fetchAll(),
        firstValueFrom(this.api.userCounts()),
      ]);
      // Pending users are also counted as active by the API; they are listed under Pending access only.
      let items = this.tab() === 'active' ? list.items.filter((u) => !u.isPending) : list.items;
      let total = list.total - (list.items.length - items.length);
      if (availability !== 'all') {
        items = items.filter((u) => (u.availability?.state ?? 'AVAILABLE') === availability);
        total = items.length;
        items = items.slice((this.page() - 1) * PAGE_SIZE, this.page() * PAGE_SIZE);
      }
      this.users.set(items);
      this.total.set(total);
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
