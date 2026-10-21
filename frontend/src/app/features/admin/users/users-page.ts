import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
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
import { Location } from '@angular/common';
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
  UserPodDto,
  UserSortKey,
  UserStatusFilter,
  UserSummaryDto,
} from '../../../core/identity-admin/identity-admin-api';
import { PendingUsersStore } from '../../../core/identity-admin/pending-users.store';
import { SkipTarget } from '../../../shared/layout/skip-target';
import { NotificationService } from '../../../core/notify/notification.service';
import { UndoService } from '../../../core/notify/undo.service';
import { MfDatePipe } from '../../../shared/pipes/mf-date.pipe';
import { AvailabilityChip } from '../../../shared/availability/availability-chip';
import { AvailabilityDialog } from '../../../shared/availability/availability-dialog';
import { ActionMenu } from '../../../shared/ui/action-menu';
import { AdminCardList, AdminCardSpec } from '../../../shared/ui/admin-card-spec';
import { phoneCards } from '../../../shared/ui/record-card-list';
import { availabilityDisplay } from '../../../core/availability/availability';
import { USER_TIME_ZONE } from '../../../core/time/clock';
import { WIDE_COLUMN_DROP, columnDropOrder } from '../../../shared/ui/admin-card-spec';
import { AdminColumn, adminListState } from '../../../shared/ui/admin-list-state';
import { rowActions } from '../../../shared/ui/row-actions';
import { Badge } from '../../../shared/ui/badge';
import { ScrollArea } from '../../../shared/ui/fixed-page';
import { GridBody } from '../../../shared/ui/grid-body';
import { parsePage } from '../../../shared/ui/list-helpers';
import { PAGE_SIZES, parsePageSize } from '../../../shared/ui/list-query';
import { SortHeader } from '../../../shared/ui/data-table';
import { parseSortExpression } from '../../../shared/ui/record-sort';
import { PhoneSort, SortChoice, SortOption } from '../../../shared/work-queue/phone-sort';
import { Pager } from '../../../shared/ui/pager';
import { ColumnFilterRow } from '../../../shared/filters/column-filter-row';
import { FilterDef } from '../../../shared/filters/filter-def';
import { FiltersBar } from '../../../shared/filters/filters-bar';
import { ListFilters } from '../../../shared/filters/list-filters';
import { WorkStrip, WorkStripItem } from '../../../shared/work-queue/work-strip';
import { StripDef, stripActiveKey, stripPick } from '../../../shared/ui/strip-items';
import { AdminTabCounts } from '../admin-tabs';
import { AdminShellFilters } from '../task-types/shell-filters';
import { impactLine } from '../shared/dialog-copy';
import { PodsChange, UserPodsCell } from './user-pods-cell';
import { UserDrawer, UserDrawerIntent } from './user-drawer';
import { availabilityShown } from './user-availability';
import { podsText } from './user-pods-draft';

type Tab = Exclude<UserStatusFilter, 'all'>;
type StatusOption = UserStatusFilter;

const STATUS_VALUES: readonly StatusOption[] = ['pending', 'active', 'inactive', 'all'];

/** The columns the server can sort by (#436); anything else in the address is ignored. */
const SORT_FIELDS: readonly UserSortKey[] = ['name', 'firstSeen', 'lastSeen'];

/** The columns of the grid, in order; the keys the filter definitions point at. */
const COLUMNS = ['name', 'roles', 'pods', 'availability', 'lastSeen', 'status', 'actions'] as const;

/**
 * The status choices above the grid (#429): one of them is always pressed, and it is the `status` parameter of the address. Pending
 * access is tinted while somebody is waiting. The counts come from the counts endpoint (whole list, no filter applies).
 */
const SEGMENT_DEFS: readonly StripDef<never>[] = [
  {
    key: 'pending',
    label: 'Pending access',
    hint: 'People who signed in and have no role yet',
    params: { status: 'pending' },
  },
  { key: 'active', label: 'Active', hint: 'People with access', params: { status: 'active' } },
  {
    key: 'inactive',
    label: 'Inactive',
    hint: 'People who can no longer sign in',
    params: { status: 'inactive' },
  },
  { key: 'all', label: 'All', hint: 'Everyone', params: { status: 'all' } },
];

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
    MfDatePipe,
    UserDrawer,
    ScrollArea,
    Pager,
    Badge,
    AvailabilityChip,
    AvailabilityDialog,
    UserPodsCell,
    GridBody,
    FiltersBar,
    ColumnFilterRow,
    WorkStrip,
    ActionMenu,
    AdminCardList,
    SortHeader,
    PhoneSort,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'mf-fill',
    '(window:resize)': 'onResize()',
  },
  templateUrl: './users-page.html',
  styleUrls: ['./users-page.scss', '../../../shared/ui/page.scss'],
})
export class UsersPage implements OnInit {
  private readonly api = inject(IdentityAdminApi);
  private readonly auth = inject(AuthStore);
  private readonly pending = inject(PendingUsersStore);
  private readonly notify = inject(NotificationService);
  private readonly undo = inject(UndoService);
  private readonly location = inject(Location);
  /** Hands the number of people who can sign in to the `Users (n)` tab of the shell (#430). */
  private readonly reportCount = AdminTabCounts.report('users');

  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly scroll = viewChild<ElementRef<HTMLElement>>('scroll');
  /** Pending access when someone is waiting, else Active; applies only while the address has no `status`. */
  private readonly defaultTab = signal<Tab>('active');
  private readonly ready = signal(false);
  /** True once the counts endpoint has answered at least once (the segments show `--` until then). */
  private readonly countsKnown = signal(false);

  /**
   * The optional columns leave in the kit's order as the window narrows (the Pods first, then Roles): below 1280 and 1100 px. The filter
   * row follows, and a filter on a column that is not shown stays as a chip and in "Other filters".
   */
  /** Below 640 px the list is cards (#445), not a table. */
  protected readonly phone = phoneCards();
  private readonly zone = inject(USER_TIME_ZONE);
  /**
   * Last seen is the first to go, below 1440 px: with a long out-of-office chip, a pending person's Grant access and the other columns at their
   * widest the 1366 px grid has no room for a seventh column. The sort stays in the address, and on a phone in the Filters sheet.
   */
  protected readonly drop = { ...columnDropOrder(['pods', 'roles']), lastSeen: WIDE_COLUMN_DROP };
  protected readonly columnSpec: AdminColumn[] = [
    { cls: 'mf-cell-name', bone: '14rem' },
    { cls: 'mf-cell-muted', bone: '7rem', drop: this.drop.roles },
    { cls: 'us-pods', bone: '8rem', drop: this.drop.pods },
    { cls: 'mf-cell-badge', bone: '6rem' },
    { cls: 'mf-cell-date', bone: '4rem', drop: this.drop.lastSeen },
    { cls: 'mf-cell-badge', bone: '5rem' },
    { cls: 'mf-cell-actions', bone: '1.5rem' },
  ];
  /** The window width, for the columns that leave (the same rule as the grid stylesheet: the window, not the box). */
  private readonly viewport = signal(typeof window === 'undefined' ? 1920 : window.innerWidth);
  /** The sort of the address as `name`, `-lastSeen` (empty: the queue order, waiting people first); a field the server does not know is ignored. */
  protected readonly sortExpr = computed(() => {
    const parsed = parseSortExpression(this.filters.params().get('sort'));
    return parsed && SORT_FIELDS.includes(parsed.field as UserSortKey)
      ? (parsed.dir === 'desc' ? '-' : '') + parsed.field
      : '';
  });
  protected readonly sortField = computed(
    () => parseSortExpression(this.sortExpr())?.field ?? null,
  );
  protected readonly sortDir = computed(() => parseSortExpression(this.sortExpr())?.dir ?? null);
  /** The Last seen column shows while the list has a person who signed in (or it is the sort): the API returns null when nothing is stored (#437). */
  protected readonly lastSeenShown = computed(
    () => this.users().some((u) => !!u.lastLoginAtUtc) || this.sortField() === 'lastSeen',
  );
  protected readonly visibleColumns = computed<readonly string[]>(() => {
    const width = this.viewport();
    return COLUMNS.filter(
      (c) =>
        !(c === 'pods' && width < this.drop.pods) &&
        !(c === 'roles' && width < this.drop.roles) &&
        !(c === 'lastSeen' && (width < this.drop.lastSeen || !this.lastSeenShown())),
    );
  });
  /** One array per load of the roles: the Roles control keeps what the person ticked while the list reloads under it. */
  private readonly roleOptions = computed(() =>
    this.roles().map((r) => ({ value: String(r.roleId), label: r.name })),
  );

  /** What the list depends on, as text: the column filters and the status segment of the address. */
  private readonly filterKey = computed(() =>
    JSON.stringify([this.filters.queryParams(), this.tab()]),
  );

  /** One definition per filter: the row, the sheet, the chips, the count, the URL and the API arguments all come from it. */
  protected readonly filters: ListFilters = new ListFilters({
    screen: 'users',
    noun: 'users',
    openByDefault: true,
    sheetBelow: 640,
    visibleColumns: this.visibleColumns,
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

  /** The pressed status segment: the `status` of the address, else the default rule (Pending access when somebody waits, else Active). */
  protected readonly tab = computed<StatusOption>(() => {
    const value = this.filters.params().get('status') as StatusOption | null;
    return value && STATUS_VALUES.includes(value) ? value : this.defaultTab();
  });

  /** The segments with their counts (`--` until the counts are known); the counts are the rows of each segment. */
  protected readonly segments = computed<WorkStripItem[]>(() => {
    const c = this.countsKnown() ? this.counts() : null;
    const count = (key: string): number | null =>
      !c ? null : key === 'all' ? c.pending + c.active + c.inactive : c[key as 'pending'];
    return SEGMENT_DEFS.map((d) => ({
      key: d.key,
      label: d.label,
      count: count(d.key),
      hint: d.hint,
      ...(d.key === 'pending' ? { tinted: true } : {}),
    }));
  });
  protected readonly segmentActive = computed(() => stripActiveKey(SEGMENT_DEFS, () => this.tab()));
  protected readonly page = computed(() =>
    parsePage(this.filters.params().get('page') ?? undefined),
  );
  protected readonly counts = signal<UserCountsDto>({ pending: 0, active: 0, inactive: 0 });
  protected readonly users = signal<UserSummaryDto[]>([]);
  protected readonly total = signal(0);
  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);
  protected readonly roles = signal<RoleSummaryDto[]>([]);

  // The user drawer: the person in the address (`?user=<id>`), so Back closes it and Back from "View their tasks" reopens it.
  protected readonly userId = computed(() => {
    const id = Number(this.filters.params().get('user'));
    return Number.isInteger(id) && id > 0 ? id : null;
  });
  /** The row of the person in the drawer (availability and pods are read from it). */
  protected readonly selectedRow = computed(
    () => this.users().find((u) => u.userId === this.userId()) ?? null,
  );
  /** What the row menu asked for ("Deactivate" opens the drawer with the question on screen); cleared when the drawer closes. */
  protected readonly intent = signal<UserDrawerIntent>(null);
  private readonly drawer = viewChild(UserDrawer);

  protected readonly pageSize = computed(() => parsePageSize(this.filters.params().get('size')));
  protected readonly pageSizes = PAGE_SIZES;
  protected readonly sortOptions: readonly SortOption[] = [
    { value: 'name', label: 'Name' },
    { value: 'lastSeen', label: 'Last seen' },
    { value: 'firstSeen', label: 'First seen' },
  ];
  protected readonly listState = computed<'loading' | 'ready' | 'error'>(() =>
    this.loadError() ? 'error' : this.loading() && this.users().length === 0 ? 'loading' : 'ready',
  );
  /** Loading, error, empty and no-match, as the kit derives them: the skeleton has the real columns. */
  protected readonly ls = adminListState({
    state: this.listState,
    rows: this.users,
    filters: this.filters,
  });
  protected readonly pageCount = computed(() =>
    Math.max(1, Math.ceil(this.total() / this.pageSize())),
  );
  constructor() {
    // The Filters button and the one Clear filters sit in the page header (the shell of Users, Roles and Pods).
    AdminShellFilters.register({ filters: this.filters, controls: 'user-filter-row' });
    // "Skip to table" (#452): the page's first Tab stop; it lands on the name of the first row (the filter row and the segments are skipped).
    const offSkip = inject(SkipTarget).register({
      label: 'Skip to table',
      element: this.host.nativeElement,
      focus: () => this.focusFirstRow(),
    });
    inject(DestroyRef).onDestroy(offSkip);
    // Any change of a filter or of the page in the address reloads the list.
    effect(() => {
      if (!this.ready()) return;
      this.filterKey();
      this.page();
      this.pageSize();
      this.sortExpr();
      untracked(() => void this.reload());
    });
    // The controls move into the sheet while the grid scrolls sideways.
    afterNextRender(
      () => {
        const area = this.scroll()?.nativeElement;
        this.filters.watchOverflow(area);
      },
      { injector: this.injector },
    );
  }

  async ngOnInit(): Promise<void> {
    void this.loadRoles();
    try {
      const counts = await firstValueFrom(this.api.userCounts());
      this.counts.set(counts);
      this.countsKnown.set(true);
      this.pending.set(counts.pending);
      this.defaultTab.set(counts.pending > 0 ? 'pending' : 'active');
      // The default rule is visible and stable: it is written into the address (no new history entry) so a reload or a link keeps it.
      // Only on the Users tab itself: a link to a tab the person may not use is being redirected, and must not be written over.
      const onTab = this.route.snapshot.paramMap.get('tab');
      if (!this.filters.params().get('status') && (!onTab || onTab === 'users')) {
        this.navigate({ status: this.defaultTab() }, true);
      }
    } catch {
      /* the list load below reports the failure */
    }
    this.ready.set(true);
  }

  private navigate(params: Record<string, string | number | null>, replace = false): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: params,
      queryParamsHandling: 'merge',
      ...(replace ? { replaceUrl: true } : {}),
    });
  }

  /** A segment was chosen: the status goes into the address (a history entry, so Back returns to the earlier segment) and the page restarts at 1. */
  protected pickSegment(key: string): void {
    const to = stripPick(SEGMENT_DEFS, key, this.segmentActive(), { mode: 'segments' });
    if (to) this.navigate({ ...to.params, page: null });
  }

  protected clearFilters(): void {
    this.filters.clear(['q']);
  }

  /** "Edit availability" in the drawer: the same dialog as the row menu, for the person in the drawer. */
  protected editAvailabilityOf(): void {
    const row = this.selectedRow();
    if (row) this.editAvailability(row);
  }

  protected editAvailability(user: UserSummaryDto): void {
    this.availabilityEdit.set(user);
    this.availabilityDialogOpen.set(true);
  }

  /** A header was pressed: the new `sort` goes into the address (a history entry) and the list restarts at page 1. */
  protected setSort(sort: string): void {
    this.navigate({ sort: sort || null, page: null });
  }

  /** The phone's Sort by select: the same `sort` values as the headers. */
  protected pickSort(choice: SortChoice | null): void {
    this.navigate({
      sort: choice ? (choice.dir === 'desc' ? '-' : '') + choice.field : null,
      page: null,
    });
  }

  protected setPageSize(size: number): void {
    this.navigate({ size: size === PAGE_SIZES[0] ? null : size, page: null });
  }

  protected goTo(page: number): void {
    const next = Math.min(Math.max(1, page), this.pageCount());
    this.navigate({ page: next === 1 ? null : next });
  }

  /**
   * Opens the drawer for a person: `?user=<id>` goes into the address (a history entry, so Back closes it). Focus is put on the control that
   * opened it first (the name, Grant access or the row menu's button), so the drawer's focus handling returns to it.
   */
  protected open(user: UserSummaryDto, intent: UserDrawerIntent = null): void {
    this.rememberOpener(user.userId);
    this.openerEl?.focus({ preventScroll: true });
    this.intent.set(intent);
    this.pushedUser = true;
    this.navigate({ user: user.userId });
  }

  /** The control that opened the drawer (the name, Grant access or the row menu's button). */
  private openerEl: HTMLElement | null = null;

  /** True when this page added the history entry of the open drawer: closing then steps back, so Back and Forward stay honest. */
  private pushedUser = false;

  /** Remembers where focus was (a control of the row or card, or the row menu's button after a menu item); else the row's own menu button or name. */
  private rememberOpener(userId: number): void {
    const active = document.activeElement;
    const inList = active instanceof HTMLElement && this.host.nativeElement.contains(active);
    this.openerEl = inList
      ? active
      : (this.rowOf(userId)?.querySelector<HTMLElement>(
          'button[data-overflow], button[data-open]',
        ) ?? null);
  }

  private rowOf(userId: number): HTMLElement | null {
    return (
      this.scroll()?.nativeElement.querySelector<HTMLElement>(`tr[data-user="${userId}"]`) ?? null
    );
  }

  /** The person's account beside the name, for the accessible names of the row's controls ("Open Alex Abbott (kej01)"). */
  protected nameWithAccount(user: UserSummaryDto): string {
    return user.windowsAccount ? `${user.displayName} (${user.windowsAccount})` : user.displayName;
  }

  /** What the Availability cell shows for this person (#434): the chip only for Out of office and Off hours, nothing for Pending or Inactive. */
  protected availabilityOf(user: UserSummaryDto) {
    return availabilityShown(user);
  }

  protected accountLine(user: UserSummaryDto): string {
    const account = user.windowsAccount ?? '';
    return user.isSeededAdmin ? `${account} · Seeded` : account;
  }

  /** The row's overflow menu (kit): Open for everyone, Edit availability and Activate / Deactivate with User.Manage. Pending rows have Grant access instead. */
  protected menuFor(user: UserSummaryDto) {
    return rowActions(
      this.nameWithAccount(user),
      [
        { id: 'open', label: 'Open', icon: 'pi-user', run: () => this.open(user) },
        {
          id: 'availability',
          label: 'Edit availability',
          icon: 'pi-calendar',
          permission: 'User.Manage',
          run: () => this.editAvailability(user),
        },
        user.isActive
          ? {
              id: 'deactivate',
              label: 'Deactivate',
              kind: 'state' as const,
              permission: 'User.Manage',
              run: () => this.open(user, 'deactivate'),
            }
          : {
              id: 'activate',
              label: 'Activate',
              kind: 'state' as const,
              permission: 'User.Manage',
              run: () => this.open(user, 'activate'),
            },
      ],
      { can: (p) => this.auth.has(p) },
    );
  }

  /**
   * A person as a phone card (#445): the name (a button: the panel has no address), the account under it, the status badge top right (none for
   * Active), "Data Technician - 2 pods - Out of office until Oct 25", and the one primary action (Grant access) or the same row menu as the table.
   */
  protected readonly cardOf = (user: UserSummaryDto): AdminCardSpec => {
    const waiting = user.isPending && this.canManage();
    const pods = user.pods.length;
    return {
      title: user.displayName,
      activate: () => this.open(user),
      rowKey: user.userId,
      subtitle: this.accountLine(user),
      badges: user.isPending
        ? [{ text: 'Pending access', tone: 'warning', icon: 'pi-user-plus' }]
        : user.isActive
          ? []
          : [{ text: 'Inactive', tone: 'neutral' }],
      meta: [
        {
          text: [
            this.rolesLabel(user),
            pods === 0 ? 'No pod' : `${pods} ${pods === 1 ? 'pod' : 'pods'}`,
            // Only what informs: Out of office (with its date) and Off hours; nothing for a person who takes no work (#434).
            availabilityShown(user) === 'chip'
              ? availabilityDisplay(user.availability, this.zone).label
              : '',
          ]
            .filter(Boolean)
            .join(' · '),
          attrs: { 'data-card-summary': '' },
        },
      ],
      primary: waiting
        ? {
            label: 'Grant access',
            ariaLabel: `Grant access to ${this.nameWithAccount(user)}`,
            run: () => this.open(user),
          }
        : undefined,
      actions: waiting ? null : this.menuFor(user),
    };
  };

  /** The first stop of the list: the name of the first row, else the empty, error or no-access message, else the list itself. */
  private focusFirstRow(): void {
    const root = this.host.nativeElement;
    const target =
      root.querySelector<HTMLElement>(
        'tbody tr[data-user] button[data-open], li.rc button[data-card-name]',
      ) ??
      root.querySelector<HTMLElement>(
        ':is(td, div, p)[data-empty], :is(td, div, p)[data-error], :is(td, div, p)[data-forbidden]',
      ) ??
      root.querySelector<HTMLElement>('.mf-table-wrap');
    if (!target) return;
    if (!target.matches('a, button, [tabindex]')) target.setAttribute('tabindex', '-1');
    target.focus();
  }

  protected onResize(): void {
    this.viewport.set(window.innerWidth);
  }

  /** The drawer asked to close (X, Esc, Cancel, the mask), after its unsaved-changes question: the person leaves the address. */
  protected closeDrawer(): void {
    this.intent.set(null);
    // Dialogs hand focus back to whatever had it when they opened (the Leave question: a box inside the drawer, now gone): once they are all
    // gone, focus goes to the control that opened the drawer, or its row.
    const opener = this.openerEl;
    const id = this.userId();
    this.afterDialogGone(() => {
      if (opener?.isConnected) opener.focus();
      else if (id !== null) this.focusRowOf(id);
    });
    if (this.pushedUser) {
      // This page pushed the entry for the drawer: step back over it, so there is no second entry for the same list.
      this.pushedUser = false;
      this.location.back();
      // Nothing to step back to (the history was cut, a test double): the address is rewritten instead.
      setTimeout(() => {
        if (this.userId() !== null && !this.intent()) this.navigate({ user: null }, true);
      }, 200);
    } else {
      this.navigate({ user: null }, true);
    }
  }

  /** The drawer saved something about a person: the list and the segment counts follow; a first grant of access also closes the drawer. */
  protected async onChanged(change: { userId: number; granted: boolean }): Promise<void> {
    if (!change.granted) {
      await this.reload();
      return;
    }
    // The person leaves the Pending segment: focus goes to the next row of the list, not to the one that is going away.
    const rows = this.users();
    const at = rows.findIndex((u) => u.userId === change.userId);
    const nextId = (rows[at + 1] ?? rows[at - 1])?.userId ?? null;
    this.closeDrawer();
    await this.reload();
    if (this.users().some((u) => u.userId === change.userId)) return; // still listed (All, Active): the opener keeps focus
    this.afterDialogGone(() => this.focusRowOf(nextId));
  }

  /** The drawer's pods block: loads the pods to offer, like the grid cell. */
  protected onDrawerPods(change: PodsChange): void {
    const row = this.selectedRow();
    if (row) void this.applyPods(row, change);
  }

  /** Runs `fn` once no dialog mask is on the page (the drawer's leave animation and the focus restore are over). */
  private afterDialogGone(fn: () => void): void {
    const done = (): void => {
      watcher.disconnect();
      clearTimeout(giveUp);
      setTimeout(fn, 50);
    };
    const watcher = new MutationObserver(() => {
      if (!document.querySelector('.p-dialog-mask')) done();
    });
    const giveUp = setTimeout(done, 1500);
    watcher.observe(document.body, { childList: true, subtree: true });
    if (!document.querySelector('.p-dialog-mask')) done();
  }

  /** Focus on the name of a person's row (else of the first row, else the list itself). */
  private focusRowOf(userId: number | null): void {
    const host = this.scroll()?.nativeElement;
    const target =
      (userId !== null
        ? host?.querySelector<HTMLElement>(`tr[data-user="${userId}"] button[data-open]`)
        : null) ?? host?.querySelector<HTMLElement>('tr[data-user] button[data-open]');
    (target ?? host)?.focus();
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
        pageSize: this.pageSize(),
        sort: (parseSortExpression(this.sortExpr())?.field as UserSortKey | undefined) ?? undefined,
        dir: parseSortExpression(this.sortExpr())?.dir,
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
      this.users.set(list.items);
      this.total.set(list.total);
      // Only a real change: the Status labels carry the pending count and a new object would rebuild the filter controls.
      const known = this.counts();
      if (
        known.pending !== counts.pending ||
        known.active !== counts.active ||
        known.inactive !== counts.inactive
      ) {
        this.counts.set(counts);
      }
      this.countsKnown.set(true);
      this.reportCount(counts.pending + counts.active);
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
