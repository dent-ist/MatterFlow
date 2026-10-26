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
import { OnHoldReasonView, OnHoldReasonsClient } from '../../../api/generated/api-client';
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
import { ADMIN_FIELD_LIMITS } from '../shared/field-limits';

type LoadState = 'loading' | 'ready' | 'error';

/** The Order column leaves below this window width (the kit's column-drop rule). */
const DROP_ORDER = 768;

/** The address of the dialogs of this tab: `?edit=<id>` or `edit=new` (the name link, the row menu and the New button go there). */

/**
 * Admin: On-hold reasons (PM v2, #876), the third tab of the Labels page, built like Link Roles: the grid contract (44 px rows, Order, Name,
 * Status, one overflow menu), phone cards below 640 px and the lookup dialog for New reason and Rename. The reasons a person picks when a task
 * is put On Hold (Waiting for client data, ...). The menu has Rename, Move up, Move down and Deactivate or Activate; a reason is never deleted
 * (a used one is deactivated, so a task on hold and the history keep its name). Needs `OnHoldReason.Manage`. The header belongs to `LabelsAdminPage`.
 */
@Component({
  selector: 'mf-on-hold-reasons-page',
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
  templateUrl: './on-hold-reasons-page.html',
  styleUrl: './on-hold-reasons-page.scss',
})
export class OnHoldReasonsPage implements OnInit, HasUnsavedChanges {
  private readonly api = inject(OnHoldReasonsClient);
  private readonly notify = inject(NotificationService);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly report = AdminTabCounts.report('on-hold-reasons');

  /** `?edit=<id>` opens Rename reason, `?edit=new` opens New reason. */
  readonly edit = input<string | undefined>(undefined);

  protected readonly canManage = computed(() => this.auth.has('OnHoldReason.Manage'));
  protected readonly phone = phoneCards();
  protected readonly limits = ADMIN_FIELD_LIMITS;
  protected readonly dropOrder = DROP_ORDER;

  protected readonly state = signal<LoadState>('loading');
  protected readonly rows = signal<OnHoldReasonView[]>([]);
  protected readonly busy = signal(false);
  protected readonly failure = signal('');
  protected readonly announcement = signal('');
  protected readonly ls = adminListState({ state: this.state, rows: this.rows });

  protected readonly columnSpec = computed(() => [
    { cls: 'mf-cell-num', bone: '1.5rem', drop: DROP_ORDER },
    { cls: 'mf-cell-name', bone: '10rem' },
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

  protected readonly deactivating = signal<OnHoldReasonView | null>(null);
  protected readonly deactivateCopy = computed(() => ({
    title: 'Deactivate reason?',
    body: "It won't be offered when a task is put on hold. Tasks already on hold with it, and the history, keep showing it. You can activate it again.",
    confirm: 'Deactivate reason',
    cancel: 'Keep active',
    danger: true,
  }));

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
      this.apply(await firstValueFrom(this.api.listOnHoldReasons()));
      this.state.set('ready');
    } catch {
      this.state.set('error');
    }
  }

  private apply(list: OnHoldReasonView[]): void {
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
          'Someone else changed the on-hold reasons. The list was reloaded; try again.',
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
      // The Labels route re-runs its guards on a query change: the close itself is not "leaving with unsaved text" (the dialog asked
      // already). The dialog reports its closing twice (visibility and cancel): the first one navigates, the second finds it under way.
      this.closing = true;
      void this.router
        .navigate([], {
          queryParams: { edit: null },
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
            this.api.updateOnHoldReason(target.id, {
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
        () => firstValueFrom(this.api.createOnHoldReason({ name, isActive: true })),
        failWith,
      );
      if (!created) return;
      this.apply([...this.rows(), created]);
      this.announcement.set(`On-hold reason ${created.name} added.`);
    }
    this.notify.success('Saved.');
    this.closeDialog();
  }

  // ---- activate, deactivate

  protected askDeactivate(r: OnHoldReasonView): void {
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

  protected async setActive(r: OnHoldReasonView, active: boolean): Promise<void> {
    const updated = await this.run(() =>
      firstValueFrom(
        this.api.updateOnHoldReason(r.id, {
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

  // ---- order: Move up / Move down in the menu, the pointer drag as shipped

  protected async move(r: OnHoldReasonView, delta: number): Promise<void> {
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
      firstValueFrom(this.api.reorderOnHoldReasons({ ids: next.map((r) => r.id) })),
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

  // ---- the row menu and the phone cards

  protected readonly menus = computed(() => {
    const map = new Map<number, ReturnType<typeof rowActions>>();
    const list = this.rows();
    list.forEach((r, i) => {
      map.set(
        r.id,
        rowActions(
          r.name,
          [
            {
              id: 'rename',
              label: 'Rename',
              icon: 'pi-pencil',
              permission: 'OnHoldReason.Manage',
              run: () =>
                void this.router.navigate([], {
                  queryParams: { edit: r.id },
                  queryParamsHandling: 'merge',
                }),
            },
            {
              id: 'up',
              label: 'Move up',
              icon: 'pi-arrow-up',
              permission: 'OnHoldReason.Manage',
              reason: i === 0 ? 'Already first.' : undefined,
              run: () => void this.move(r, -1),
            },
            {
              id: 'down',
              label: 'Move down',
              icon: 'pi-arrow-down',
              permission: 'OnHoldReason.Manage',
              reason: i === list.length - 1 ? 'Already last.' : undefined,
              run: () => void this.move(r, 1),
            },
            r.isActive
              ? {
                  id: 'deactivate',
                  label: 'Deactivate',
                  kind: 'state' as const,
                  permission: 'OnHoldReason.Manage',
                  run: () => this.askDeactivate(r),
                }
              : {
                  id: 'activate',
                  label: 'Activate',
                  kind: 'state' as const,
                  permission: 'OnHoldReason.Manage',
                  run: () => void this.setActive(r, true),
                },
          ],
          { can: (permission) => this.auth.has(permission) },
        ),
      );
    });
    return map;
  });

  /** The phone card of a role (#640): the same data and the same row menu as the table row. */
  protected readonly cardOf = (r: OnHoldReasonView): AdminCardSpec => ({
    title: r.name,
    link: ['/admin/on-hold-reasons'],
    queryParams: { edit: r.id },
    rowKey: r.id,
    badges: [activeCardBadge(r.isActive)],
    meta: [],
    actions: this.menus().get(r.id) ?? null,
  });
}
