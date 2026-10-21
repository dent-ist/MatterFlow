import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  OnInit,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AssetLinkRoleView, AssetLinkRolesClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { ApiError } from '../../../core/http/api-error';
import { NotificationService } from '../../../core/notify/notification.service';
import { HasUnsavedChanges } from '../../../shared/guards/unsaved-changes.guard';
import { ActionMenu } from '../../../shared/ui/action-menu';
import { AdminCardList, AdminCardSpec, activeCardBadge } from '../../../shared/ui/admin-card-spec';
import { adminListState } from '../../../shared/ui/admin-list-state';
import { ActiveBadge } from '../../../shared/ui/badge';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { ScrollArea } from '../../../shared/ui/fixed-page';
import { GridBody } from '../../../shared/ui/grid-body';
import { LookupDialog } from '../../../shared/ui/lookup-dialog';
import { phoneCards } from '../../../shared/ui/record-card-list';
import { rowActions } from '../../../shared/ui/row-actions';
import { RowLink } from '../../../shared/ui/row-nav';
import { TextField } from '../../../shared/ui/text-field';
import { AdminTabCounts } from '../admin-tabs';
import { dialogCopy, refusedDeleteMessage } from '../shared/dialog-copy';
import { ADMIN_FIELD_LIMITS } from '../shared/field-limits';

type LoadState = 'loading' | 'ready' | 'error';

/** The Order column leaves below this window width (the kit's column-drop rule). */
const DROP_ORDER = 768;

/** The address of the dialogs of this tab: `?tab=link-roles&edit=<id>` or `edit=new` (the name link, the row menu and the New button go there). */
const TAB = 'link-roles';

/**
 * Admin: Link Roles (UX S17, #640 to #642), the second tab of the Asset Types page and built exactly like its first one: the grid contract
 * (44 px rows, Order, Name, Links, Status, one overflow menu), phone cards below 640 px and the lookup dialog (#564) for New link role and Rename
 * (one field, a counter of 50). The roles an Asset can have on a Task (Source, Destination, Subject, Result, ...). The header (name, crumb, tabs
 * with their counts, the New link role action and the one-line description) belongs to `AssetAdminPage`.
 *
 * Links counts the task-asset links that use the role (`linkCount`; no number for a person without Task.View and Asset.View). The menu has Rename,
 * Move up, Move down, Deactivate or Activate, and Delete only for a role no link uses (a role with links says "14 links keep this role" in the
 * Deactivate question). A role whose count is unknown cannot be deleted from here. The pointer drag of a row stays as it shipped. Needs `AssetType.Manage`.
 */
@Component({
  selector: 'mf-asset-link-roles-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ActionMenu,
    ActiveBadge,
    AdminCardList,
    ConfirmDialog,
    GridBody,
    LookupDialog,
    RouterLink,
    RowLink,
    ScrollArea,
    TextField,
  ],
  host: { class: 'mf-fill' },
  templateUrl: './asset-link-roles-page.html',
  styleUrl: './asset-link-roles-page.scss',
})
export class AssetLinkRolesPage implements OnInit, HasUnsavedChanges {
  private readonly api = inject(AssetLinkRolesClient);
  private readonly notify = inject(NotificationService);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly report = AdminTabCounts.report('link-roles');

  /** `?edit=<id>` opens Rename link role, `?edit=new` opens New link role. */
  readonly edit = input<string | undefined>(undefined);

  protected readonly canManage = computed(() => this.auth.has('AssetType.Manage'));
  /** The Links column is there for a person who may see tasks and assets (the API sends no number to anyone else). */
  protected readonly linksShown = computed(
    () => this.auth.has('Task.View') && this.auth.has('Asset.View'),
  );
  protected readonly phone = phoneCards();
  protected readonly limits = ADMIN_FIELD_LIMITS;
  protected readonly dropOrder = DROP_ORDER;

  protected readonly state = signal<LoadState>('loading');
  protected readonly rows = signal<AssetLinkRoleView[]>([]);
  protected readonly busy = signal(false);
  protected readonly failure = signal('');
  protected readonly announcement = signal('');
  protected readonly ls = adminListState({ state: this.state, rows: this.rows });

  protected readonly columnSpec = computed(() => [
    { cls: 'mf-cell-num', bone: '1.5rem', drop: DROP_ORDER },
    { cls: 'mf-cell-name', bone: '10rem' },
    ...(this.linksShown() ? [{ cls: 'mf-cell-num', bone: '2rem' }] : []),
    { cls: 'mf-cell-badge', bone: '4.5rem' },
    { cls: 'mf-cell-actions', bone: '1.5rem' },
  ]);

  // ---- the New / Rename dialog (#564)

  /** The role the dialog renames (null: a new one, or the dialog is closed). */
  protected readonly editing = computed(() => {
    const id = this.edit();
    return id && id !== 'new' ? (this.rows().find((r) => String(r.id) === id) ?? null) : null;
  });
  protected readonly dialogOpen = computed(
    () =>
      this.canManage() &&
      this.state() === 'ready' &&
      (this.edit() === 'new' || this.editing() !== null),
  );
  protected readonly draft = signal('');
  protected readonly summary = signal<readonly string[]>([]);
  protected readonly fieldError = signal('');
  protected readonly saveError = signal('');

  protected readonly deactivating = signal<AssetLinkRoleView | null>(null);
  protected readonly deactivateCopy = computed(() =>
    dialogCopy.deactivateLinkRole({ links: this.deactivating()?.linkCount ?? null }),
  );
  protected readonly deleting = signal<AssetLinkRoleView | null>(null);
  protected readonly deleteCopy = computed(() => dialogCopy.deleteUnusedLinkRole({ links: 0 }));

  private dragIndex: number | null = null;
  /** True while the dialog is being closed by the page: the address change that closes it must not ask about the text it is closing. */
  private closing = false;

  constructor() {
    // Each time the dialog opens, the draft starts from the role (or empty).
    effect(() => {
      if (!this.dialogOpen()) return;
      const role = this.editing();
      untracked(() => {
        this.clearErrors();
        this.draft.set(role?.name ?? '');
      });
    });
  }

  /** The person typed in the open dialog (a new name, or a change to the name). */
  protected isDirty(): boolean {
    const role = this.editing();
    const text = this.draft().trim();
    return role ? text !== role.name : text !== '';
  }

  /** The dialog asks about unsaved text itself when it closes; leaving the page with it open and edited is unsaved work too (UXR-39). */
  hasUnsavedChanges(): boolean {
    return !this.closing && this.dialogOpen() && this.isDirty();
  }

  ngOnInit(): void {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.state.set('loading');
    try {
      this.apply(await firstValueFrom(this.api.listAssetLinkRoles()));
      this.state.set('ready');
    } catch {
      this.state.set('error');
    }
  }

  private apply(list: AssetLinkRoleView[]): void {
    this.rows.set(list);
    // The tab counts ACTIVE roles (the kit's rule).
    this.report(list.filter((r) => r.isActive).length);
  }

  private async run<T>(
    work: () => Promise<T>,
    fail?: (e: ApiError) => void,
  ): Promise<T | undefined> {
    this.busy.set(true);
    this.failure.set('');
    try {
      return await work();
    } catch (e) {
      const error = e instanceof ApiError ? e : null;
      if (error?.code === 'CONCURRENCY_CONFLICT') {
        this.failure.set(
          'Someone else changed the asset link roles. The list was reloaded; try again.',
        );
        await this.load();
      } else if (fail && error) {
        fail(error);
      } else {
        this.failure.set(error?.message ?? 'Couldn’t save. Try again.');
      }
      return undefined;
    } finally {
      this.busy.set(false);
    }
  }

  private fieldMessage(e: ApiError, field: string): string {
    return e.problem?.errors?.[field]?.[0]?.message ?? e.message;
  }

  // ---- New and Rename

  private clearErrors(): void {
    this.summary.set([]);
    this.fieldError.set('');
    this.saveError.set('');
  }

  protected closeDialog(): void {
    this.clearErrors();
    if (this.edit() !== undefined && !this.closing) {
      // The Asset Types route re-runs its guards on a query change: the close itself is not "leaving with unsaved text" (the dialog asked
      // already). The dialog reports its closing twice (visibility and cancel): the first one navigates, the second finds it under way.
      this.closing = true;
      void this.router
        .navigate([], {
          queryParams: { tab: TAB, edit: null },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        })
        .finally(() => setTimeout(() => (this.closing = false)));
    }
  }

  protected onDialogOpen(open: boolean): void {
    if (!open) this.closeDialog();
  }

  protected async commit(): Promise<void> {
    const name = this.draft().trim();
    this.clearErrors();
    if (!name) {
      this.fieldError.set('Enter a name.');
      this.summary.set(['Enter a name.']);
      return;
    }
    const failWith = (e: ApiError) => {
      const message = e.problem?.errors?.['name']?.[0]?.message;
      if (message) {
        this.fieldError.set(message);
        this.summary.set([message]);
      } else {
        this.saveError.set(e.message);
      }
    };
    const target = this.editing();
    if (target) {
      if (name === target.name) {
        this.closeDialog();
        return;
      }
      const updated = await this.run(
        () =>
          firstValueFrom(
            this.api.updateAssetLinkRole(target.id, {
              name,
              isActive: target.isActive,
              rowVersion: target.rowVersion,
            }),
          ),
        failWith,
      );
      if (!updated) return;
      this.apply(this.rows().map((r) => (r.id === updated.id ? updated : r)));
      this.announcement.set(`${updated.name} saved.`);
    } else {
      const created = await this.run(
        () => firstValueFrom(this.api.createAssetLinkRole({ name, isActive: true })),
        failWith,
      );
      if (!created) return;
      this.apply([...this.rows(), created]);
      this.announcement.set(`Asset link role ${created.name} added.`);
    }
    this.notify.success('Saved.');
    this.closeDialog();
  }

  // ---- activate, deactivate

  protected askDeactivate(r: AssetLinkRoleView): void {
    this.deactivating.set(r);
  }

  protected cancelDeactivate(): void {
    this.deactivating.set(null);
  }

  protected async confirmDeactivate(): Promise<void> {
    const r = this.deactivating();
    if (!r) return;
    this.deactivating.set(null);
    await this.setActive(r, false);
  }

  protected async setActive(r: AssetLinkRoleView, active: boolean): Promise<void> {
    const updated = await this.run(() =>
      firstValueFrom(
        this.api.updateAssetLinkRole(r.id, {
          name: r.name,
          isActive: active,
          rowVersion: r.rowVersion,
        }),
      ),
    );
    if (!updated) return;
    this.apply(this.rows().map((x) => (x.id === updated.id ? updated : x)));
    this.announcement.set(`${r.name} ${active ? 'activated' : 'deactivated'}.`);
    this.notify.success('Saved.');
    this.focusMenuOf(r.id);
  }

  // ---- delete (#641): offered only for a role no link uses

  protected askDelete(r: AssetLinkRoleView): void {
    this.deleting.set(r);
  }

  protected cancelDelete(): void {
    this.deleting.set(null);
  }

  protected async confirmDelete(): Promise<void> {
    const r = this.deleting();
    if (!r) return;
    const done = await this.run(
      async () => {
        await firstValueFrom(this.api.deleteAssetLinkRole(r.id));
        return true;
      },
      // A race: a link was made since the page loaded. The server refuses once and the line names the row (the toast is suppressed).
      (e) =>
        this.failure.set(
          e.code === 'IN_USE' ? refusedDeleteMessage('linkRole', r.name) : e.message,
        ),
    );
    this.deleting.set(null);
    if (done) {
      this.apply(this.rows().filter((x) => x.id !== r.id));
      this.announcement.set(`${r.name} deleted.`);
    }
  }

  // ---- order: Move up / Move down in the menu, the pointer drag as shipped

  protected async move(r: AssetLinkRoleView, delta: number): Promise<void> {
    const index = this.rows().findIndex((x) => x.id === r.id);
    await this.reorder(index, index + delta);
    this.focusMenuOf(r.id);
  }

  protected onDragStart(index: number, event: DragEvent): void {
    this.dragIndex = index;
    event.dataTransfer?.setData('text/plain', String(index));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  protected onDragOver(event: DragEvent): void {
    if (this.dragIndex !== null) event.preventDefault();
  }

  protected async onDrop(index: number, event: DragEvent): Promise<void> {
    event.preventDefault();
    const from = this.dragIndex;
    this.dragIndex = null;
    if (from !== null) await this.reorder(from, index);
  }

  private async reorder(from: number, to: number): Promise<void> {
    const before = this.rows();
    if (from === to || to < 0 || to >= before.length || this.busy() || !this.canManage()) return;
    const next = [...before];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    this.rows.set(next); // optimistic; the server answer (or a reload) replaces it
    const list = await this.run(() =>
      firstValueFrom(this.api.reorderAssetLinkRoles({ ids: next.map((r) => r.id) })),
    );
    if (list) {
      this.apply(list);
      this.announcement.set(`${moved.name} moved to position ${to + 1} of ${list.length}.`);
    } else {
      this.rows.set(before);
    }
  }

  /** The row's menu button gets focus back after a change that re-renders the row (a moved row is a new element). */
  private focusMenuOf(id: number): void {
    afterNextRender(
      () => {
        const host = document.querySelector<HTMLElement>(`[data-actions-of="${id}"]`);
        host?.querySelector<HTMLElement>('button[data-overflow]')?.focus();
      },
      { injector: this.injector },
    );
  }

  // ---- links

  protected hasCount(r: AssetLinkRoleView): boolean {
    return typeof r.linkCount === 'number';
  }

  protected linkSentence(r: AssetLinkRoleView): string {
    const n = r.linkCount ?? 0;
    return `${n} ${n === 1 ? 'link uses' : 'links use'} ${r.name}`;
  }

  // ---- the row menu and the phone cards

  protected readonly menus = computed(() => {
    const map = new Map<number, ReturnType<typeof rowActions>>();
    const list = this.rows();
    list.forEach((r, i) => {
      // Delete only when the page KNOWS no link uses the role; an unknown count offers Deactivate only.
      const deletable = r.linkCount === 0;
      map.set(
        r.id,
        rowActions(
          r.name,
          [
            {
              id: 'rename',
              label: 'Rename',
              icon: 'pi-pencil',
              permission: 'AssetType.Manage',
              run: () =>
                void this.router.navigate([], {
                  queryParams: { tab: TAB, edit: r.id },
                  queryParamsHandling: 'merge',
                }),
            },
            {
              id: 'up',
              label: 'Move up',
              icon: 'pi-arrow-up',
              permission: 'AssetType.Manage',
              reason: i === 0 ? 'Already first.' : undefined,
              run: () => void this.move(r, -1),
            },
            {
              id: 'down',
              label: 'Move down',
              icon: 'pi-arrow-down',
              permission: 'AssetType.Manage',
              reason: i === list.length - 1 ? 'Already last.' : undefined,
              run: () => void this.move(r, 1),
            },
            r.isActive
              ? {
                  id: 'deactivate',
                  label: 'Deactivate',
                  kind: 'state' as const,
                  permission: 'AssetType.Manage',
                  run: () => this.askDeactivate(r),
                }
              : {
                  id: 'activate',
                  label: 'Activate',
                  kind: 'state' as const,
                  permission: 'AssetType.Manage',
                  run: () => void this.setActive(r, true),
                },
            ...(deletable
              ? [
                  {
                    id: 'delete',
                    label: 'Delete',
                    danger: true,
                    permission: 'AssetType.Manage',
                    run: () => this.askDelete(r),
                  },
                ]
              : []),
          ],
          { can: (permission) => this.auth.has(permission) },
        ),
      );
    });
    return map;
  });

  /** The phone card of a role (#640): the same data and the same row menu as the table row. */
  protected readonly cardOf = (r: AssetLinkRoleView): AdminCardSpec => ({
    title: r.name,
    link: ['/admin/asset-types'],
    queryParams: { tab: TAB, edit: r.id },
    rowKey: r.id,
    badges: [activeCardBadge(r.isActive)],
    meta: this.linksShown() && typeof r.linkCount === 'number' ? [this.linkSentence(r)] : [],
    actions: this.menus().get(r.id) ?? null,
  });
}
