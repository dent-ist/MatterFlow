import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';

import {
  PodDetail,
  PodMemberCandidate,
  PodMemberDto,
  PodsClient,
  PodSummary,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { ApiError } from '../../../core/http/api-error';
import { NotificationService } from '../../../core/notify/notification.service';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import {
  HasUnsavedChanges,
  LeaveConfirmService,
} from '../../../shared/guards/unsaved-changes.guard';
import { SkipTarget } from '../../../shared/layout/skip-target';
import { AdminCardList, AdminCardSpec, activeCardBadge } from '../../../shared/ui/admin-card-spec';
import { adminListState } from '../../../shared/ui/admin-list-state';
import { phoneCards } from '../../../shared/ui/record-card-list';
import { ActiveBadge, Badge } from '../../../shared/ui/badge';
import { AdminTabCounts } from '../admin-tabs';
import { Crumb } from '../../../shared/ui/page-header';
import { RecordHeader, RecordAction } from '../../../shared/ui/record-header';
import { RecordLoadFlow, RecordState } from '../../../shared/ui/record-state';
import { DrillReturn } from '../../../shared/work-queue/drill';
import { RETURN_STATE, RowLink, restoreRowFocus } from '../../../shared/ui/row-nav';
import { AdminShellFilters } from '../task-types/shell-filters';
import { ADMIN_LIST, AdminListLeave, ListReturn } from '../list-return';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { SortHeader } from '../../../shared/ui/data-table';
import { isActiveParam, parseStatus } from '../../../shared/ui/list-helpers';
import { ServerListPage } from '../../../shared/ui/list-query';
import { ScrollArea } from '../../../shared/ui/fixed-page';
import { GridBody } from '../../../shared/ui/grid-body';
import { Pager } from '../../../shared/ui/pager';
import { ColumnFilterRow } from '../../../shared/filters/column-filter-row';
import { statusDef } from '../../../shared/filters/common-defs';
import { FilterDef } from '../../../shared/filters/filter-def';
import { FiltersBar } from '../../../shared/filters/filters-bar';
import { ListFilters } from '../../../shared/filters/list-filters';

const SEARCH_DEBOUNCE_MS = 200;

/** The columns of the grid, in order; the keys the filter definitions point at. */
const COLUMNS = ['name', 'members', 'status'] as const;

/**
 * Admin: Pods (UX S13), the third tab of the Users page (`/admin/pods`). Lists Pods, creates/edits/deactivates them and manages members.
 * Pod Lead is a role, not a Pod flag, so members show their roles as read-only chips and there is no lead control. Actions are hidden
 * without `Pod.Manage` / `Pod.ManageMembers`. The Users page binds the list state (`q`, `status`, `page`, `size`, `sort`) and the open
 * editor (`pod`) from the address, because a nested component does not get the router's input binding itself.
 */
@Component({
  selector: 'mf-pods-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-fill' },
  imports: [
    ScrollArea,
    ConfirmDialog,
    ActiveBadge,
    Badge,
    Button,
    HasPermissionDirective,
    RouterLink,
    Pager,
    SortHeader,
    GridBody,
    FiltersBar,
    ColumnFilterRow,
    AdminCardList,
    RecordHeader,
    RecordState,
    RowLink,
  ],
  templateUrl: './pods-page.html',
  styleUrl: './pods-page.scss',
})
export class PodsPage extends ServerListPage<PodSummary> implements OnDestroy, HasUnsavedChanges {
  protected override readonly emptyOffersClear = true;
  private readonly api = inject(PodsClient);
  private readonly notify = inject(NotificationService);
  /** The page's tab counts, when the Pods list sits in the Users page: a saved pod (new, renamed, deactivated) changes `Pods (n)`. */
  private readonly tabCounts = inject(AdminTabCounts, { optional: true });

  /** Query parameter `pod`: a pod id or `new`, so a reload or a shared link returns to the same editor. */
  readonly pod = input<string | undefined>(undefined);
  private readonly leaveConfirm = inject(LeaveConfirmService);
  protected readonly auth = inject(AuthStore);

  // ---- list (URL state: name, status, page, size, sort)
  protected readonly defaultSort = 'name';
  protected readonly columns = COLUMNS;
  private readonly scroll = viewChild<ElementRef<HTMLElement>>('scroll');
  private watched: HTMLElement | undefined;

  /** Inline column filters: Name (`name`, the name only) and Status (`status`, Active by default). The old `q` is no longer read. */
  protected readonly filters: ListFilters = new ListFilters({
    screen: 'pods',
    noun: 'pods',
    openByDefault: true,
    sheetBelow: 640,
    defs: computed((): FilterDef[] => [
      { key: 'name', label: 'Name', column: 'name', type: 'text' },
      statusDef(),
    ]),
  });

  protected readonly phone = phoneCards();

  // ---- record page (#451): the editor is a record page with the record header, the crumb and Back
  protected readonly leave = inject(AdminListLeave);
  protected readonly listId = ADMIN_LIST.pods.id;
  /** Where Back and the crumb go: the exact list view the person left (page, size, filters, sort), else the plain list. */
  private readonly drill = inject(DrillReturn);
  private editedBefore = false;
  private readonly backSig = signal(new ListReturn(ADMIN_LIST.pods, this.router));
  private get back(): ListReturn {
    return this.backSig();
  }
  /** The load of the pod in the address: 404, 403 and failures show `mf-record-state` (quiet requests, no toast). */
  protected readonly flow = new RecordLoadFlow('pod');
  /** Loading, error, empty and no-match as the kit derives them, with "n inactive hidden - Show all" for the default Active status. */
  protected readonly ls = adminListState({
    state: this.state,
    rows: this.rows,
    filters: this.filters,
    hidden: this.hiddenCount,
  });
  protected readonly columnSpec = [
    { cls: 'mf-cell-name', bone: '14rem' },
    { cls: 'mf-cell-num', bone: '2rem' },
    { cls: 'mf-cell-badge', bone: '4.5rem' },
  ];

  /** A pod as a phone card: the name opens its editor (`?pod=`), like the name link of the table. */
  protected readonly cardOf = (pod: PodSummary): AdminCardSpec => ({
    title: pod.name,
    link: ['/admin/pods'],
    queryParams: { pod: pod.podId },
    rowKey: pod.podId,
    state: this.leave.state(),
    subtitle: pod.description,
    badges: [activeCardBadge(pod.isActive)],
    meta: [`${pod.memberCount} ${pod.memberCount === 1 ? 'member' : 'members'}`],
  });

  // ---- editor
  protected readonly editorOpen = signal(false);
  /** `Administration > Users > Pods > name`: the Users step is a link only for a person who may open the Users page. */
  protected readonly parents = computed<Crumb[]>(() => [
    { label: 'Administration' },
    this.auth.hasAny(['User.View', 'User.Manage'])
      ? { label: 'Users', link: '/admin/users' }
      : { label: 'Users' },
    this.back.crumb('Pods'),
  ]);
  protected readonly headerBack = computed(() => ({
    label: 'Pods',
    link: this.backSig().tree,
    state: { ...RETURN_STATE },
  }));
  protected readonly headerName = computed(() =>
    this.detail() ? this.detail()!.pod.name : 'New pod',
  );
  /** Deactivate / Activate in the overflow of the header (needs Pod.Manage, like the Active box of the form). */
  protected readonly headerActions = computed<RecordAction[]>(() => {
    const pod = this.detail()?.pod;
    if (!pod || !this.auth.has('Pod.Manage')) return [];
    return pod.isActive
      ? [
          {
            id: 'deactivate',
            label: 'Deactivate pod',
            icon: 'pi-ban',
            role: 'state',
            run: () => this.changeStatus(false),
          },
        ]
      : [
          {
            id: 'activate',
            label: 'Activate pod',
            icon: 'pi-check-circle',
            role: 'state',
            run: () => this.changeStatus(true),
          },
        ];
  });
  protected readonly detail = signal<PodDetail | null>(null);
  protected readonly name = signal('');
  protected readonly description = signal('');
  protected readonly isActive = signal(true);
  protected readonly nameError = signal('');
  protected readonly failure = signal('');
  protected readonly busy = signal(false);
  protected readonly confirmDeactivate = signal(false);
  protected readonly deactivateOpen = signal(false);
  protected readonly announce = signal('');

  // ---- members
  protected readonly candidateQuery = signal('');
  protected readonly candidates = signal<PodMemberCandidate[]>([]);
  protected readonly selected = signal<number[]>([]);

  protected readonly isNew = computed(() => this.detail() === null);
  protected readonly members = computed(() => this.detail()?.members ?? []);
  protected readonly availableCandidates = computed(() => {
    const present = new Set(this.members().map((m) => m.userId));
    return this.candidates().filter((c) => !present.has(c.userId));
  });
  protected readonly dirty = computed(() => {
    if (!this.editorOpen()) return false;
    const pod = this.detail()?.pod;
    return (
      this.name() !== (pod?.name ?? '') ||
      this.description() !== (pod?.description ?? '') ||
      this.isActive() !== (pod?.isActive ?? true)
    );
  });
  protected readonly deactivating = computed(
    () => !this.isNew() && !!this.detail()?.pod.isActive && !this.isActive(),
  );

  private candidateTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    super();
    // The Filters button and the one Clear filters are in the page header while the list is on screen (not while the editor is open).
    const shell = inject(AdminShellFilters, { optional: true });
    const entry = { filters: this.filters, controls: 'pods-filter-row' };
    effect(() => {
      const listOpen = !this.editorOpen();
      untracked(() => shell?.current.set(listOpen ? entry : null));
    });
    inject(DestroyRef).onDestroy(() => {
      if (shell?.current() === entry) shell.current.set(null);
    });
    // "Skip to table" (#450): the first Tab stop of the list; it lands on the name of the first pod.
    const host = inject<ElementRef<HTMLElement>>(ElementRef);
    const offSkip = inject(SkipTarget).register({
      label: 'Skip to table',
      element: host.nativeElement,
      focus: () => {
        const root = host.nativeElement;
        const target =
          root.querySelector<HTMLElement>('tbody tr[data-pod] a, li.rc a[href]') ??
          root.querySelector<HTMLElement>(
            ':is(td, div, p)[data-empty], :is(td, div, p)[data-error], :is(td, div, p)[data-forbidden]',
          ) ??
          root.querySelector<HTMLElement>('.mf-table-wrap');
        if (!target) return;
        if (!target.matches('a, button, [tabindex]')) target.setAttribute('tabindex', '-1');
        target.focus();
      },
    });
    inject(DestroyRef).onDestroy(offSkip);
    // Back from a pod puts focus on the name link of the row that was left.
    restoreRowFocus(this.listId, () => this.state() === 'ready');
    // A name link (or a card) of the list puts the pod in the address: the editor follows the address.
    effect(() => {
      const pod = this.pod();
      untracked(() => {
        // The list the person left is in the state of the history entry the editor was opened with: read it when the editor is asked for.
        if (pod && !this.editorOpen())
          this.backSig.set(new ListReturn(ADMIN_LIST.pods, this.router));
        if (pod && !this.editorOpen()) void this.openFromUrl();
        else if (!pod && this.editorOpen()) this.followAddressClose();
        else if (!pod && this.flow.state() !== 'ready') this.flow.state.set('ready');
        if (!pod && this.editedBefore && !this.editorOpen()) {
          this.editedBefore = false;
          this.focusLeftRow();
        }
      });
    });
    // The controls move into the sheet while the grid scrolls sideways (the grid is not on screen while the editor is open).
    effect(() => {
      const area = this.scroll()?.nativeElement;
      if (!area || area === this.watched) return;
      this.watched = area;
      untracked(() => this.filters.watchOverflow(area));
    });
  }

  protected override listFilters() {
    return this.filters;
  }

  /** Back from the editor to the list of this same page: focus goes to the name link of the pod that was left, once the list is drawn. */
  private focusLeftRow(): void {
    const key = this.drill.takeRow(this.listId);
    if (key === null) return;
    let tries = 0;
    const find = (): void => {
      const link = document.querySelector<HTMLElement>(
        `a[data-row-list="${this.listId}"][data-row-key="${key}"]`,
      );
      if (link) link.focus({ preventScroll: true });
      else if (++tries < 40) setTimeout(find, 25);
    };
    find();
  }

  private async openFromUrl(): Promise<void> {
    const pod = this.pod();
    if (!pod || this.editorOpen()) return;
    if (pod === 'new') {
      // The create address needs Pod.Manage (the denial rule of the admin pages, #416, #453): the shared 403 state, not an editor that cannot save.
      if (!this.auth.has('Pod.Manage')) this.flow.state.set('forbidden');
      else this.openEditor(null, '', '', true);
      return;
    }
    const id = Number(pod);
    if (!Number.isInteger(id) || id < 1) {
      this.flow.state.set('notFound');
      return;
    }
    await this.flow.run(
      () => firstValueFrom(this.api.getPod(id)),
      (detail) =>
        this.openEditor(detail, detail.pod.name, detail.pod.description ?? '', detail.pod.isActive),
    );
  }

  /** Retry of the "couldn't load this pod" state. */
  protected retryOpen(): void {
    void this.openFromUrl();
  }

  /** Back (or a link to the bare list) took `?pod=` out of the address while the editor is open: the list returns, unless edits are unsaved. */
  private followAddressClose(): void {
    if (this.dirty()) {
      const current = this.detail();
      this.syncUrl(current ? String(current.pod.podId) : 'new');
      return;
    }
    this.editorOpen.set(false);
    this.detail.set(null);
  }

  private syncUrl(pod: string | null): void {
    void this.router
      .navigate([], { queryParams: { pod }, queryParamsHandling: 'merge', replaceUrl: true })
      .catch(() => undefined);
  }

  ngOnDestroy(): void {
    clearTimeout(this.candidateTimer);
  }

  hasUnsavedChanges(): boolean {
    return this.dirty();
  }

  // ---- list actions

  protected override fetch() {
    return firstValueFrom(
      this.api.listPods(
        undefined,
        this.filters.text('name') || undefined,
        isActiveParam(parseStatus(this.filters.text('status'))),
        this.pageNumber(),
        this.pageSize(),
        this.sort() || undefined,
      ),
    );
  }

  /** The inactive pods the default Active status hides, under the same Name filter (one row, no API change). */
  protected override fetchHidden() {
    if (parseStatus(this.filters.text('status')) !== 'active') return null;
    return firstValueFrom(
      this.api.listPods(undefined, this.filters.text('name') || undefined, false, 1, 1),
    );
  }

  // ---- editor actions

  protected async newPod(): Promise<void> {
    if (!(await this.leaveEditor())) return;
    this.openEditor(null, '', '', true);
  }

  protected async edit(summary: PodSummary): Promise<void> {
    if (!(await this.leaveEditor())) return;
    try {
      const detail = await firstValueFrom(this.api.getPod(summary.podId));
      this.openEditor(detail, detail.pod.name, detail.pod.description ?? '', detail.pod.isActive);
    } catch {
      // the HTTP layer already toasted the failure
    }
  }

  /** Back, the crumb's Pods step and Cancel: the list as the person left it (filters, page, sort), with focus on the row. */
  protected async close(): Promise<void> {
    if (!(await this.leaveEditor())) return;
    this.editorOpen.set(false);
    this.detail.set(null);
    void this.router.navigateByUrl(this.back.tree, { state: { ...RETURN_STATE } });
  }

  /** The header's Deactivate / Activate: the form's own Save, with the question first for a deactivation. */
  private changeStatus(active: boolean): void {
    this.isActive.set(active);
    this.confirmDeactivate.set(false);
    void this.save();
  }

  protected onName(event: Event): void {
    this.name.set((event.target as HTMLInputElement).value);
    this.nameError.set('');
  }

  protected onDescription(event: Event): void {
    this.description.set((event.target as HTMLTextAreaElement).value);
  }

  protected onActive(event: Event): void {
    this.isActive.set((event.target as HTMLInputElement).checked);
    this.confirmDeactivate.set(false);
  }

  protected confirmDeactivation(): void {
    this.deactivateOpen.set(false);
    this.confirmDeactivate.set(true);
    void this.save();
  }

  protected async save(): Promise<void> {
    const name = this.name().trim();
    if (!name) {
      this.nameError.set('Enter a pod name.');
      return;
    }
    if (this.deactivating() && !this.confirmDeactivate()) {
      this.deactivateOpen.set(true);
      return;
    }

    this.busy.set(true);
    this.failure.set('');
    const description = this.description().trim() || undefined;
    try {
      const current = this.detail();
      const saved = current
        ? await firstValueFrom(
            this.api.updatePod(current.pod.podId, {
              name,
              description,
              isActive: this.isActive(),
              rowVersion: current.pod.rowVersion,
            }),
          )
        : await firstValueFrom(this.api.createPod({ name, description }));
      this.openEditor(saved, saved.pod.name, saved.pod.description ?? '', saved.pod.isActive);
      this.notify.success(current ? 'Pod saved' : 'Pod created');
      void this.load();
      void this.tabCounts?.refresh('pods');
    } catch (error) {
      this.showSaveError(error, name);
    } finally {
      this.busy.set(false);
      this.confirmDeactivate.set(false);
    }
  }

  protected async reload(): Promise<void> {
    const current = this.detail();
    if (!current) return;
    const detail = await firstValueFrom(this.api.getPod(current.pod.podId));
    this.openEditor(detail, detail.pod.name, detail.pod.description ?? '', detail.pod.isActive);
    void this.load();
  }

  // ---- member actions

  protected onCandidateQuery(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.candidateQuery.set(value);
    clearTimeout(this.candidateTimer);
    this.candidateTimer = setTimeout(() => void this.findCandidates(), SEARCH_DEBOUNCE_MS);
  }

  protected toggleSelected(userId: number, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.selected.update((ids) =>
      checked ? [...ids.filter((id) => id !== userId), userId] : ids.filter((id) => id !== userId),
    );
  }

  protected async addSelected(): Promise<void> {
    const current = this.detail();
    const userIds = this.selected();
    if (!current || userIds.length === 0) return;
    await this.memberCall(
      () => firstValueFrom(this.api.addPodMembers(current.pod.podId, { userIds })),
      `${userIds.length === 1 ? 'Member' : 'Members'} added.`,
    );
    this.selected.set([]);
    this.candidates.set([]);
    this.candidateQuery.set('');
  }

  protected async removeMember(member: PodMemberDto): Promise<void> {
    const current = this.detail();
    if (!current) return;
    await this.memberCall(async () => {
      await firstValueFrom(this.api.removePodMember(current.pod.podId, member.userId));
      return firstValueFrom(this.api.getPod(current.pod.podId));
    }, `${member.displayName} removed.`);
  }

  protected async togglePrimary(member: PodMemberDto): Promise<void> {
    const current = this.detail();
    if (!current) return;
    await this.memberCall(
      () =>
        firstValueFrom(
          this.api.setPrimaryPod(current.pod.podId, member.userId, {
            isPrimary: !member.isPrimary,
          }),
        ),
      member.isPrimary
        ? `${member.displayName} has no primary pod here.`
        : `${current.pod.name} is now ${member.displayName}'s primary pod.`,
    );
  }

  // ---- internals

  private async findCandidates(): Promise<void> {
    const query = this.candidateQuery().trim();
    if (query.length < 2) {
      this.candidates.set([]);
      return;
    }
    try {
      this.candidates.set(await firstValueFrom(this.api.findPodMemberCandidates(query)));
    } catch {
      this.candidates.set([]);
    }
  }

  private async memberCall(call: () => Promise<PodDetail>, message: string): Promise<void> {
    this.busy.set(true);
    try {
      const detail = await call();
      // Member changes never touch the unsaved name/description edits.
      this.detail.set(detail);
      this.announce.set(message);
      void this.load();
    } catch {
      // the HTTP layer already toasted the failure
    } finally {
      this.busy.set(false);
    }
  }

  private openEditor(
    detail: PodDetail | null,
    name: string,
    description: string,
    isActive: boolean,
  ): void {
    this.detail.set(detail);
    this.name.set(name);
    this.description.set(description);
    this.isActive.set(isActive);
    this.nameError.set('');
    this.failure.set('');
    this.confirmDeactivate.set(false);
    this.candidates.set([]);
    this.candidateQuery.set('');
    this.selected.set([]);
    this.announce.set('');
    const fromList = !this.editorOpen();
    this.editorOpen.set(true);
    this.editedBefore = true;
    // The list (and the link that was pressed) is gone: focus goes to the heading of the record page, like the other record pages.
    if (fromList) {
      let tries = 0;
      const focusHeading = (): void => {
        const h = document.querySelector<HTMLElement>('[data-editor] [data-page-title]');
        if (h) {
          h.setAttribute('tabindex', '-1');
          h.focus({ preventScroll: true });
        } else if (++tries < 40) setTimeout(focusHeading, 25);
      };
      focusHeading();
    }
    this.syncUrl(detail ? String(detail.pod.podId) : 'new');
  }

  private async leaveEditor(): Promise<boolean> {
    return !this.dirty() || (await this.leaveConfirm.ask());
  }

  private showSaveError(error: unknown, name: string): void {
    if (error instanceof ApiError) {
      if (error.code === 'DUPLICATE_NAME') {
        this.nameError.set(`A pod named '${name}' already exists.`);
        return;
      }
      if (error.code === 'CONCURRENCY_CONFLICT') {
        this.failure.set('Someone else changed this pod. Reload it to see their changes.');
        return;
      }
      const fieldErrors = error.problem?.errors?.['name'];
      if (fieldErrors?.length) {
        this.nameError.set(fieldErrors[0].message);
        return;
      }
    }
    this.failure.set('The pod could not be saved. Try again.');
  }
}
