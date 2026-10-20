import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  OnInit,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { PrioritiesClient, PriorityView } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { ApiError } from '../../../core/http/api-error';
import { LookupStore } from '../../../core/lookups/lookup-store';
import { NotificationService } from '../../../core/notify/notification.service';
import { HasUnsavedChanges } from '../../../shared/guards/unsaved-changes.guard';
import { ActionMenu } from '../../../shared/ui/action-menu';
import { AdminCardList, AdminCardSpec, activeCardBadge } from '../../../shared/ui/admin-card-spec';
import { adminListState } from '../../../shared/ui/admin-list-state';
import { ActiveBadge, Badge } from '../../../shared/ui/badge';
import { priorityColors, PriorityBadge } from '../../../shared/ui/priority-badge';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { ScrollArea } from '../../../shared/ui/fixed-page';
import { GridBody } from '../../../shared/ui/grid-body';
import { phoneCards } from '../../../shared/ui/record-card-list';
import { RowLink } from '../../../shared/ui/row-nav';
import { rowActions } from '../../../shared/ui/row-actions';
import { TaskCount } from '../../../shared/ui/task-count';
import { AdminTabCounts } from '../admin-tabs';
import { dialogCopy, refusedDeleteMessage } from '../shared/dialog-copy';
import { PriorityDialog, PriorityDraft, priorityColorName } from './priority-dialog';

export { CONTRAST_MESSAGE, PRIORITY_COLOR_TOKENS } from './priority-dialog';

type LoadState = 'loading' | 'ready' | 'error';

/** The columns of the grid (#605): the optional ones leave at the widths of the grid contract (Color at 900, Order at 768). */
const DROP_COLOR = 900;
const DROP_ORDER = 768;

/**
 * Admin: Priorities (UX S18), the first tab of the Labels page (`LabelsAdminPage` holds the header, tabs and the New priority action).
 * Labels only (users never see numbers). The grid (#605) shows Order, the priority badge with a Default badge, Color, Open tasks, Status
 * and ONE row menu; a pointer drag on a row still reorders (as shipped; no handle, no shortcut). Everything else is in the row menu
 * (#614): Edit (a dialog, #609), Move up and Move down (announced politely, focus stays on the menu button), Set as default (one-line
 * confirm), Deactivate with the impact line or Activate, and Delete only for a priority no open task uses (#618). The default priority
 * is neither deactivated nor deleted and says why in the menu. Existing tasks keep a deactivated priority. Needs `Priority.Manage`.
 */
@Component({
  selector: 'mf-priorities-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    ActionMenu,
    ActiveBadge,
    AdminCardList,
    Badge,
    ConfirmDialog,
    GridBody,
    ScrollArea,
    PriorityBadge,
    PriorityDialog,
    RowLink,
    TaskCount,
  ],
  templateUrl: './priorities-page.html',
  styleUrl: './priorities-page.scss',
})
export class PrioritiesPage implements OnInit, HasUnsavedChanges {
  private readonly api = inject(PrioritiesClient);
  private readonly lookups = inject(LookupStore);
  private readonly notify = inject(NotificationService);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly report = AdminTabCounts.report('priorities');

  /** `?edit=<id>` opens Edit priority, `?edit=new` opens New priority (the name link, the row menu and the New button all go there). */
  readonly edit = input<string | undefined>(undefined);

  protected readonly canManage = computed(() => this.auth.has('Priority.Manage'));
  protected readonly canViewTasks = computed(() => this.auth.has('Task.View'));
  protected readonly phone = phoneCards();

  protected readonly state = signal<LoadState>('loading');
  protected readonly rows = signal<PriorityView[]>([]);
  protected readonly busy = signal(false);
  protected readonly failure = signal('');
  /** Polite live-region text for reorder and save results. */
  protected readonly announcement = signal('');
  protected readonly ls = adminListState({ state: this.state, rows: this.rows });

  protected readonly dropColor = DROP_COLOR;
  protected readonly dropOrder = DROP_ORDER;
  protected readonly columnSpec = computed(() => [
    { cls: 'mf-cell-num', bone: '1.5rem', drop: DROP_ORDER },
    { cls: 'mf-cell-name', bone: '9rem' },
    { cls: 'mf-cell-muted', bone: '6rem', drop: DROP_COLOR },
    ...(this.canViewTasks() ? [{ cls: 'mf-cell-num', bone: '2rem' }] : []),
    { cls: 'mf-cell-badge', bone: '4.5rem' },
    { cls: 'mf-cell-actions', bone: '1.5rem' },
  ]);

  // ---- the dialogs

  /** The priority the Edit dialog is about (null: a new one, or the dialog is closed). */
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
  protected readonly labelError = signal('');
  protected readonly saveError = signal('');

  protected readonly deactivating = signal<PriorityView | null>(null);
  protected readonly deactivateOpen = computed(() => this.deactivating() !== null);
  protected readonly deactivateCopy = computed(() => {
    const p = this.deactivating();
    return dialogCopy.deactivatePriority({ openTasks: p?.openTaskCount ?? null });
  });
  protected readonly makingDefault = signal<PriorityView | null>(null);
  protected readonly defaultCopy = computed(() => {
    const p = this.makingDefault();
    const current = this.rows().find((r) => r.isDefault);
    return dialogCopy.setDefaultPriority({
      name: p?.label ?? null,
      previousName: current && current.id !== p?.id ? current.label : null,
    });
  });
  protected readonly deleting = signal<PriorityView | null>(null);
  protected readonly deleteCopy = computed(() => dialogCopy.deleteUnusedPriority({ openTasks: 0 }));

  private dragIndex: number | null = null;

  /** An open Edit or New dialog holding edits is asked about by the dialog itself; the page has no other unsaved text. */
  hasUnsavedChanges(): boolean {
    return false;
  }

  ngOnInit(): void {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.state.set('loading');
    try {
      this.apply(await firstValueFrom(this.api.listPriorities()));
      this.state.set('ready');
    } catch {
      this.state.set('error');
    }
  }

  // ---- helpers

  protected swatch(color: string): string {
    return priorityColors(color).bg;
  }

  protected colorName(color: string): string {
    return priorityColorName(color);
  }

  private apply(list: PriorityView[]): void {
    this.rows.set(list);
    this.lookups.setPriorities(list);
    // The tab counts ACTIVE priorities (the kit's rule).
    this.report(list.filter((p) => p.isActive).length);
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
        this.failure.set('Someone else changed the priorities. The list was reloaded; try again.');
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

  // ---- New and Edit (the lookup dialog, #609)

  protected closeDialog(): void {
    this.labelError.set('');
    this.saveError.set('');
    if (this.edit() !== undefined) {
      void this.router.navigate([], {
        queryParams: { edit: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    }
  }

  protected onDialogOpen(open: boolean): void {
    if (!open) this.closeDialog();
  }

  protected async saveDialog(draft: PriorityDraft): Promise<void> {
    this.labelError.set('');
    this.saveError.set('');
    const failWith = (e: ApiError) => {
      const duplicate = e.problem?.errors?.['label']?.[0]?.message;
      if (duplicate) this.labelError.set(duplicate);
      else this.saveError.set(e.message);
    };
    const target = this.editing();
    if (target) {
      const updated = await this.run(
        () =>
          firstValueFrom(
            this.api.updatePriority(target.id, {
              label: draft.label,
              color: draft.color,
              isActive: target.isActive,
              rowVersion: target.rowVersion,
            }),
          ),
        failWith,
      );
      if (!updated) return;
      this.apply(this.rows().map((r) => (r.id === updated.id ? updated : r)));
      this.announcement.set(`${updated.label} saved.`);
    } else {
      const created = await this.run(
        () =>
          firstValueFrom(
            this.api.createPriority({ label: draft.label, color: draft.color, isActive: true }),
          ),
        failWith,
      );
      if (!created) return;
      this.apply([...this.rows(), created]);
      this.announcement.set(`Priority ${created.label} added.`);
    }
    this.notify.success('Saved.');
    this.closeDialog();
  }

  // ---- activate, deactivate (#614)

  protected askDeactivate(p: PriorityView): void {
    this.deactivating.set(p);
  }

  protected cancelDeactivate(): void {
    this.deactivating.set(null);
  }

  protected async confirmDeactivate(): Promise<void> {
    const p = this.deactivating();
    if (!p) return;
    this.deactivating.set(null);
    await this.setActive(p, false);
  }

  protected async setActive(p: PriorityView, active: boolean): Promise<void> {
    const updated = await this.run(() =>
      firstValueFrom(
        this.api.updatePriority(p.id, {
          label: p.label,
          color: p.color,
          isActive: active,
          rowVersion: p.rowVersion,
        }),
      ),
    );
    if (!updated) return;
    this.apply(this.rows().map((r) => (r.id === updated.id ? updated : r)));
    this.announcement.set(`${p.label} ${active ? 'activated' : 'deactivated'}.`);
    this.notify.success('Saved.');
    this.focusMenuOf(p.id);
  }

  // ---- default (#614)

  protected askDefault(p: PriorityView): void {
    this.makingDefault.set(p);
  }

  protected cancelDefault(): void {
    this.makingDefault.set(null);
  }

  protected async confirmDefault(): Promise<void> {
    const p = this.makingDefault();
    if (!p) return;
    this.makingDefault.set(null);
    const list = await this.run(
      () => firstValueFrom(this.api.setDefaultPriority(p.id)),
      (e) => this.failure.set(e.message),
    );
    if (list) {
      this.apply(list);
      this.announcement.set(`${p.label} is now the default priority.`);
      this.notify.success('Saved.');
      this.focusMenuOf(p.id);
    }
  }

  // ---- delete (#618): offered only for a priority no open task uses

  protected askDelete(p: PriorityView): void {
    this.deleting.set(p);
  }

  protected cancelDelete(): void {
    this.deleting.set(null);
  }

  protected async confirmDelete(): Promise<void> {
    const p = this.deleting();
    if (!p) return;
    const done = await this.run(
      async () => {
        await firstValueFrom(this.api.deletePriority(p.id));
        return true;
      },
      // A race, or closed tasks that still use it: the server refuses once and the line names the row (the toast is suppressed).
      (e) =>
        this.failure.set(
          e.code === 'IN_USE' ? refusedDeleteMessage('priority', p.label) : e.message,
        ),
    );
    this.deleting.set(null);
    if (done) {
      this.apply(this.rows().filter((r) => r.id !== p.id));
      this.announcement.set(`${p.label} deleted.`);
    }
  }

  // ---- order (#614): Move up / Move down in the menu, the pointer drag as shipped

  protected canMove(index: number, delta: number): boolean {
    const target = index + delta;
    return target >= 0 && target < this.rows().length;
  }

  protected async move(p: PriorityView, delta: number): Promise<void> {
    const index = this.rows().findIndex((r) => r.id === p.id);
    await this.reorder(index, index + delta);
    this.focusMenuOf(p.id);
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
      firstValueFrom(this.api.reorderPriorities({ ids: next.map((r) => r.id) })),
    );
    if (list) {
      this.apply(list);
      this.announcement.set(`${moved.label} moved to position ${to + 1} of ${list.length}.`);
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
    list.forEach((p, i) => {
      const knownCount = typeof p.openTaskCount === 'number' ? p.openTaskCount : null;
      const deletable = !p.isDefault && knownCount === 0;
      map.set(
        p.id,
        rowActions(
          p.label,
          [
            {
              id: 'edit',
              label: 'Edit priority',
              icon: 'pi-pencil',
              permission: 'Priority.Manage',
              run: () =>
                void this.router.navigate([], {
                  queryParams: { edit: p.id },
                  queryParamsHandling: 'merge',
                }),
            },
            {
              id: 'up',
              label: 'Move up',
              icon: 'pi-arrow-up',
              permission: 'Priority.Manage',
              reason: i === 0 ? 'Already the most urgent.' : undefined,
              run: () => void this.move(p, -1),
            },
            {
              id: 'down',
              label: 'Move down',
              icon: 'pi-arrow-down',
              permission: 'Priority.Manage',
              reason: i === list.length - 1 ? 'Already the least urgent.' : undefined,
              run: () => void this.move(p, 1),
            },
            ...(p.isDefault
              ? []
              : [
                  {
                    id: 'default',
                    label: 'Set as default',
                    icon: 'pi-star',
                    permission: 'Priority.Manage',
                    reason: p.isActive ? undefined : 'Activate it first.',
                    run: () => this.askDefault(p),
                  },
                ]),
            p.isActive
              ? {
                  id: 'deactivate',
                  label: 'Deactivate',
                  kind: 'state' as const,
                  permission: 'Priority.Manage',
                  reason: p.isDefault
                    ? "The default priority can't be deactivated. Make another priority the default first."
                    : undefined,
                  run: () => this.askDeactivate(p),
                }
              : {
                  id: 'activate',
                  label: 'Activate',
                  kind: 'state' as const,
                  permission: 'Priority.Manage',
                  run: () => void this.setActive(p, true),
                },
            ...(deletable || p.isDefault
              ? [
                  {
                    id: 'delete',
                    label: 'Delete',
                    danger: true,
                    permission: 'Priority.Manage',
                    reason: p.isDefault
                      ? "The default priority can't be deleted. Make another priority the default first."
                      : undefined,
                    run: () => this.askDelete(p),
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

  /** The phone card of a priority (#605): the same data and the same row menu as the table row. */
  protected readonly cardOf = (p: PriorityView): AdminCardSpec => ({
    title: p.label,
    link: ['/admin/priorities'],
    queryParams: { edit: p.id },
    rowKey: p.id,
    badges: [
      ...(p.isDefault ? [{ text: 'Default', tone: 'neutral' as const, icon: 'pi-star' }] : []),
      activeCardBadge(p.isActive),
    ],
    meta: [
      `Color: ${this.colorName(p.color)}`,
      ...(this.canViewTasks() && typeof p.openTaskCount === 'number'
        ? [
            {
              text: p.openTaskCount === 1 ? '1 open task' : `${p.openTaskCount} open tasks`,
              ...(p.openTaskCount > 0
                ? {
                    link: {
                      commands: ['/tasks'],
                      queryParams: { priority: p.id, status: ['NEW', 'IN_PROGRESS', 'ON_HOLD'] },
                    },
                  }
                : {}),
              attrs: { 'data-card-open-tasks': '' },
            },
          ]
        : []),
    ],
    actions: this.menus().get(p.id) ?? null,
  });
}
