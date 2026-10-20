import {
  ChangeDetectionStrategy,
  DestroyRef,
  Component,
  ElementRef,
  Injector,
  OnInit,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
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
import { LeaveConfirmService } from '../../../shared/guards/unsaved-changes.guard';
import { NotificationService } from '../../../core/notify/notification.service';
import { UndoService } from '../../../core/notify/undo.service';
import { MfDatePipe } from '../../../shared/pipes/mf-date.pipe';
import { AvailabilityChip } from '../../../shared/availability/availability-chip';
import { AvailabilityDialog } from '../../../shared/availability/availability-dialog';
import { Badge } from '../../../shared/ui/badge';
import { ScrollArea } from '../../../shared/ui/fixed-page';
import { ScrollRegion } from '../../../shared/ui/scroll-region';
import { GridBody } from '../../../shared/ui/grid-body';
import { parsePage } from '../../../shared/ui/list-helpers';
import { Pager } from '../../../shared/ui/pager';
import { ColumnFilterRow } from '../../../shared/filters/column-filter-row';
import { FilterDef } from '../../../shared/filters/filter-def';
import { FiltersBar } from '../../../shared/filters/filters-bar';
import { ListFilters } from '../../../shared/filters/list-filters';
import { impactLine } from '../shared/dialog-copy';
import { PodsChange, UserPodsCell } from './user-pods-cell';
import { podsText } from './user-pods-draft';

type Tab = Exclude<UserStatusFilter, 'all'>;
type StatusOption = UserStatusFilter;

const STATUS_VALUES: readonly StatusOption[] = ['pending', 'active', 'inactive', 'all'];

const PAGE_SIZE = 25;

/** The columns of the grid, in order; the keys the filter definitions point at. */
const COLUMNS = [
  'name',
  'account',
  'registered',
  'email',
  'roles',
  'pods',
  'availability',
  'status',
  'actions',
] as const;

/** The availability filter. Off hours is a soft state; "Available" means available right now. The server works the state out. */
const AVAILABILITY_OPTIONS = [
  { value: 'AVAILABLE', label: 'Available' },
  { value: 'OUT_OF_OFFICE', label: 'Out of office' },
  { value: 'OFF_HOURS', label: 'Off hours' },
] as const;

/**
 * S12 Admin: Users tab of the Users page. Inline column filters (Name, Windows account, First seen, Email, Roles, Availability, Status),
 * paging and the user detail panel with role assignment. Everything lives in the address (`name`, `account`, `registeredFrom`,
 * `registeredTo`, `email`, `roleId`, `availability`, `status`, `page`) and is worked out by the server; without `status` the list
 * opens on Pending access when someone is waiting and on Active otherwise (shown in the Status cell, not counted as a filter).
 */
@Component({
  selector: 'mf-users-page',
  imports: [
    Button,
    RouterLink,
    ScrollRegion,
    MfDatePipe,
    ScrollArea,
    Pager,
    Badge,
    AvailabilityChip,
    AvailabilityDialog,
    UserPodsCell,
    GridBody,
    FiltersBar,
    ColumnFilterRow,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-fill', '(keydown.escape)': 'onPanelEscape($event)' },
  templateUrl: './users-page.html',
  styleUrls: ['./users-page.scss', '../../../shared/ui/page.scss'],
})
export class UsersPage implements OnInit {
  private readonly api = inject(IdentityAdminApi);
  private readonly auth = inject(AuthStore);
  private readonly pending = inject(PendingUsersStore);
  private readonly notify = inject(NotificationService);
  private readonly undo = inject(UndoService);
  private readonly leave = inject(LeaveConfirmService);

  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly injector = inject(Injector);
  private readonly scroll = viewChild<ElementRef<HTMLElement>>('scroll');
  private readonly destroyRef = inject(DestroyRef);
  private readonly panelHeading = viewChild<ElementRef<HTMLElement>>('panelHeading');
  private readonly confirmBox = viewChild<ElementRef<HTMLElement>>('confirmBox');
  /** Set when focus should move to the panel heading / the deactivation question as soon as that element is on the page. */
  private readonly wantHeadingFocus = signal(false);
  private readonly wantConfirmFocus = signal(false);
  /** True while the list is wider than its box (drives the "Scroll sideways" hint). */
  protected readonly overflowing = signal(false);
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

  protected readonly columns = COLUMNS;
  /** One array per load of the roles: the Roles control keeps what the person ticked while the list reloads under it. */
  private readonly roleOptions = computed(() =>
    this.roles().map((r) => ({ value: String(r.roleId), label: r.name })),
  );

  /**
   * What the list depends on, as text: the definitions carry the status labels with the pending count, which every reload refreshes, so
   * the values themselves must not trigger the next reload.
   */
  private readonly filterKey = computed(() => JSON.stringify(this.filters.queryParams()));

  /** One definition per filter: the row, the sheet, the chips, the count, the URL and the API arguments all come from it. */
  protected readonly filters: ListFilters = new ListFilters({
    screen: 'users',
    noun: 'users',
    defs: computed((): FilterDef[] => [
      { key: 'name', label: 'Name', column: 'name', type: 'text' },
      { key: 'account', label: 'Windows account', column: 'account', type: 'text' },
      {
        key: 'registered',
        label: 'First seen',
        column: 'registered',
        type: 'dateRange',
        presets: ['today', 'last7', 'last30', 'thisMonth'],
      },
      { key: 'email', label: 'Email', column: 'email', type: 'text' },
      {
        key: 'roleId',
        label: 'Roles',
        column: 'roles',
        type: 'multiSelect',
        emptyLabel: 'Any role',
        options: this.roleOptions(),
        normalize: (v) => (/^[1-9]\d{0,9}$/.test(v) ? v : null),
      },
      {
        key: 'availability',
        label: 'Availability',
        column: 'availability',
        type: 'select',
        allLabel: 'Any',
        options: AVAILABILITY_OPTIONS,
        normalize: (v) => (AVAILABILITY_OPTIONS.some((o) => o.value === v) ? v : null),
      },
      {
        key: 'status',
        label: 'Status',
        column: 'status',
        type: 'select',
        default: this.defaultTab(),
        options: this.statusOptions(),
        normalize: (v) => (STATUS_VALUES.includes(v as StatusOption) ? v : null),
      },
    ]),
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
    const value = this.filters.text('status') as StatusOption;
    return STATUS_VALUES.includes(value) ? value : this.defaultTab();
  });
  protected readonly page = computed(() =>
    parsePage(this.filters.params().get('page') ?? undefined),
  );
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
  /** Open tasks of the person in the panel; null when the API did not return a number (no Task.View), so nothing is shown or linked. */
  protected readonly openTasks = computed<number | null>(
    () => this.selected()?.openTaskCount ?? null,
  );
  /** The consequence sentence of the deactivation question: "This user has 7 open tasks. ..." (shared wording with the other admin dialogs). */
  protected readonly deactivateText = computed(
    () => impactLine('deactivateUser', { openTasks: this.openTasks() }).text,
  );
  /** True while the saved user is active and the draft says Inactive: the primary button then reads "Deactivate user" (BUG-3). */
  protected readonly deactivating = computed(() => {
    const u = this.selected();
    return !!u && u.isActive && !this.draftActive();
  });
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
    effect(() => {
      const heading = this.panelHeading();
      if (heading && this.wantHeadingFocus()) {
        untracked(() => this.wantHeadingFocus.set(false));
        heading.nativeElement.focus();
      }
    });
    effect(() => {
      const box = this.confirmBox();
      if (box && this.wantConfirmFocus()) {
        untracked(() => this.wantConfirmFocus.set(false));
        box.nativeElement.scrollIntoView?.({ block: 'nearest' });
        box.nativeElement.focus();
      }
    });
    // Any change of a filter or of the page in the address reloads the list.
    effect(() => {
      if (!this.ready()) return;
      this.filterKey();
      this.page();
      untracked(() => void this.reload());
    });
    // The controls move into the sheet while the grid scrolls sideways.
    afterNextRender(
      () => {
        const area = this.scroll()?.nativeElement;
        this.filters.watchOverflow(area);
        this.watchScrollHint(area);
      },
      { injector: this.injector },
    );
  }

  /**
   * "Scroll sideways" hint (review round 5, UXR5-02): below about 1100 px the list is wider than its box, and the Availability and Status
   * columns sit past the edge with nothing to say so. Shown only while the list actually overflows.
   */
  private watchScrollHint(area: HTMLElement | undefined): void {
    if (!area || typeof ResizeObserver === 'undefined') return;
    const measure = () => this.overflowing.set(area.scrollWidth > area.clientWidth + 1);
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    const table = area.querySelector('table');
    if (table) observer.observe(table);
    this.destroyRef.onDestroy(() => observer.disconnect());
    measure();
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
    this.filters.set('status', value);
  }

  protected clearFilters(): void {
    this.filters.clear(['q']);
  }

  protected editAvailability(user: UserSummaryDto): void {
    this.availabilityEdit.set(user);
    this.availabilityDialogOpen.set(true);
  }

  protected goTo(page: number): void {
    const next = Math.min(Math.max(1, page), this.pageCount());
    this.navigate({ page: next === 1 ? null : next });
  }

  protected async open(user: UserSummaryDto): Promise<void> {
    this.panelError.set('');
    this.confirmDeactivate.set(false);
    this.openerUserId = user.userId;
    try {
      this.showDetail(await firstValueFrom(this.api.getUser(user.userId)));
      // BUG-2: the panel sits after the grid in the page, so focus goes to its heading (a keyboard user would otherwise Tab past every row).
      this.wantHeadingFocus.set(true);
    } catch {
      this.panelError.set('We could not load this user. Try again.');
    }
  }

  /** The person whose row button opened the panel; focus goes back to that row when the panel closes (BUG-2). */
  private openerUserId: number | null = null;

  /** The Task Queue address behind "View their tasks": that person's open tasks (the same statuses the count uses). */
  protected openTasksQuery(userId: number): Record<string, string | string[]> {
    return { assignee: String(userId), status: ['NEW', 'IN_PROGRESS', 'ON_HOLD'] };
  }

  /** Close and Esc: asks first when there are unsaved edits (the same question as leaving the Roles tab), then returns focus to the row. */
  protected async requestClose(): Promise<void> {
    const opener = this.openerUserId;
    const asked = this.dirty();
    if (asked && !(await this.leave.ask())) return;
    this.closePanel();
    // The question's dialog hands focus to the control that had it (the name box, now gone) once it has left the page: row again after that.
    if (asked && opener !== null) this.focusRowAfterDialog(opener);
  }

  protected closePanel(): void {
    const opener = this.openerUserId;
    // Focus goes back first: the row is already on the page, the panel (and the focus inside it) goes away after.
    if (opener !== null) this.focusRow(opener);
    this.selected.set(null);
    this.panelError.set('');
    this.confirmDeactivate.set(false);
    this.wantHeadingFocus.set(false);
    this.wantConfirmFocus.set(false);
    this.openerUserId = null;
  }

  /** Esc inside the panel closes it (standard dialog behaviour, not an application shortcut). The availability dialog and popovers own their own Esc. */
  protected onPanelEscape(event: Event): void {
    if (event.defaultPrevented || this.saving() || !this.selected()) return;
    // Only an Esc pressed inside the panel closes it; the grid's popovers and the availability dialog keep their own.
    const target = event.target;
    if (!(target instanceof Element) || !target.closest('[data-panel]')) return;
    event.preventDefault();
    event.stopPropagation();
    void this.requestClose();
  }

  private focusRowAfterDialog(userId: number): void {
    const done = (): void => {
      watcher.disconnect();
      clearTimeout(giveUp);
      setTimeout(() => this.focusRow(userId), 50);
    };
    const watcher = new MutationObserver(() => {
      if (!document.querySelector('.p-dialog-mask')) done();
    });
    const giveUp = setTimeout(done, 1500);
    watcher.observe(document.body, { childList: true, subtree: true });
    if (!document.querySelector('.p-dialog-mask')) done();
  }

  /** Puts focus on the row control that opened the panel; when the row is gone (the status filter dropped it) on the list itself. */
  private focusRow(userId: number): void {
    const host = this.scroll()?.nativeElement;
    const button = host?.querySelector<HTMLElement>(
      `tr[data-user="${userId}"] .mf-row-actions button`,
    );
    (button ?? host)?.focus();
  }

  protected toggleRole(roleId: number, checked: boolean): void {
    const ids = new Set(this.draftRoleIds());
    if (checked) ids.add(roleId);
    else ids.delete(roleId);
    this.draftRoleIds.set([...ids].sort((a, b) => a - b));
  }

  /**
   * Chooses Active or Inactive. Choosing Inactive for an active person shows the consequence at once, scrolls it into view and moves focus
   * to it (BUG-3): the button then reads "Deactivate user"; choosing Active again takes both back.
   */
  protected setActive(active: boolean): void {
    this.draftActive.set(active);
    const asking = !active && !!this.selected()?.isActive;
    this.confirmDeactivate.set(asking);
    this.wantConfirmFocus.set(asking);
  }

  /** Save; deactivating is confirmed in the panel first (UX 8.4: work stays assigned until reassigned), so the button then deactivates. */
  protected async save(): Promise<void> {
    const user = this.selected();
    if (!user || !this.dirty()) return;
    if (user.isActive && !this.draftActive() && !this.confirmDeactivate()) {
      this.setActive(false);
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
      // After a refused deactivation (last System Admin, a conflict) the question stays where it is; after a save the user is inactive and it goes.
      this.confirmDeactivate.set(this.deactivating());
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
    const f = this.filters;
    return firstValueFrom(
      this.api.listUsers({
        status: this.tab(),
        name: f.text('name'),
        account: f.text('account'),
        email: f.text('email'),
        roleIds: f.list('roleId').map(Number),
        availability: f.text('availability') || undefined,
        registeredFrom: this.registered().from || undefined,
        registeredTo: this.registered().to || undefined,
        page: this.page(),
        pageSize: PAGE_SIZE,
      }),
    );
  }

  private registered(): { from: string; to: string } {
    const v = this.filters.value('registered');
    return typeof v === 'object' && 'from' in v ? v : { from: '', to: '' };
  }

  protected async reload(): Promise<void> {
    const id = ++this.requestId;
    this.loading.set(true);
    this.loadError.set(false);
    try {
      const [list, counts] = await Promise.all([
        this.fetchPage(),
        firstValueFrom(this.api.userCounts()),
      ]);
      if (id !== this.requestId) return;
      // Pending users are also counted as active by the API; they are listed under Pending access only.
      const items = this.tab() === 'active' ? list.items.filter((u) => !u.isPending) : list.items;
      this.users.set(items);
      this.total.set(list.total - (list.items.length - items.length));
      // Only a real change: the Status labels carry the pending count and a new object would rebuild the filter controls.
      const known = this.counts();
      if (
        known.pending !== counts.pending ||
        known.active !== counts.active ||
        known.inactive !== counts.inactive
      ) {
        this.counts.set(counts);
      }
      this.pending.set(counts.pending);
      this.filters.reportResults(this.total());
    } catch {
      if (id === this.requestId) this.loadError.set(true);
    } finally {
      if (id === this.requestId) this.loading.set(false);
    }
  }

  private requestId = 0;
}

function sameIds(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join();
}
