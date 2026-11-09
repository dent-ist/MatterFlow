import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  forwardRef,
} from '@angular/core';
import { LIST_BODY } from '../lists/list-body';
import { RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { Observable, firstValueFrom } from 'rxjs';
import {
  CurrentStatesClient,
  MatterListItemView,
  MatterTypesClient,
  TeamTitlesClient,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { ApiError } from '../../../core/http/api-error';
import { NotificationService } from '../../../core/notify/notification.service';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { ActionMenu } from '../../../shared/ui/action-menu';
import { adminListState } from '../../../shared/ui/admin-list-state';
import { ActiveBadge } from '../../../shared/ui/badge';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { ScrollArea } from '../../../shared/ui/fixed-page';
import { GridBody } from '../../../shared/ui/grid-body';
import { IntPipe } from '../../../shared/ui/number-format';
import { LocalPaging } from '../../../shared/ui/local-paging';
import { LookupDialog } from '../../../shared/ui/lookup-dialog';
import { Pager } from '../../../shared/ui/pager';
import { RowActionSpec, rowActions } from '../../../shared/ui/row-actions';
import { TextField } from '../../../shared/ui/text-field';
import { Tip } from '../../../shared/ui/tip';
import { AdminTabCounts } from '../admin-tabs';
import { ADMIN_FIELD_LIMITS } from '../shared/field-limits';

type LoadState = 'loading' | 'ready' | 'error';

/** The three lists this tab edits (the address segment of each on the Lists page). */
export type MatterListKind = 'matter-types' | 'current-states' | 'team-titles';

/** Everything that differs between the three lists: the words (UI spec 7.2 to 7.4 and the glossary) and the API calls. */
export interface MatterListText {
  /** Dialog titles and the Name column heading: "Matter Type", "Current State", "Title". */
  readonly heading: string;
  readonly newDialogTitle: string;
  readonly newButton: string;
  readonly addButton: string;
  /** Toast subject: "Matter type", "Current state", "Team title". */
  readonly toast: string;
  /** The word in a duplicate message: "matter type", "current state", "team title". */
  readonly dupNoun: string;
  /** The plural noun of the table: "matter types". */
  readonly plural: string;
  /** "type", "state", "title": "This permanently removes the type." */
  readonly thing: string;
  /** The heading of the In Use column. */
  readonly inUseHeading: string;
  /** What carries the item: one and many ("matter", "team member"). */
  readonly holder: readonly [string, string];
  /** The query parameter of the Matters list filter the count links to; none for team titles (plain number). */
  readonly filterParam: string | null;
  readonly limit: number;
}

export const MATTER_LIST_TEXTS: Readonly<Record<MatterListKind, MatterListText>> = {
  'matter-types': {
    heading: 'Matter Type',
    newDialogTitle: 'New Matter Type',
    newButton: 'New Matter Type',
    addButton: 'Add Matter Type',
    toast: 'Matter type',
    dupNoun: 'matter type',
    plural: 'matter types',
    thing: 'type',
    inUseHeading: 'Matters',
    holder: ['matter', 'matters'],
    filterParam: 'matterTypeId',
    limit: ADMIN_FIELD_LIMITS.matterTypeName,
  },
  'current-states': {
    heading: 'Current State',
    newDialogTitle: 'New Current State',
    newButton: 'New State',
    addButton: 'Add State',
    toast: 'Current state',
    dupNoun: 'current state',
    plural: 'current states',
    thing: 'state',
    inUseHeading: 'Matters',
    holder: ['matter', 'matters'],
    filterParam: 'currentStateId',
    limit: ADMIN_FIELD_LIMITS.currentStateName,
  },
  'team-titles': {
    heading: 'Title',
    newDialogTitle: 'New Title',
    newButton: 'New Title',
    addButton: 'Add Title',
    toast: 'Team title',
    dupNoun: 'team title',
    plural: 'team titles',
    thing: 'title',
    inUseHeading: 'Team Members',
    holder: ['team member', 'team members'],
    filterParam: null,
    limit: ADMIN_FIELD_LIMITS.teamTitleName,
  },
};

/** The body of the Deactivate confirm (UI spec 7.3). */
export function deactivateBody(text: MatterListText, inUse: number): string {
  const [one, many] = text.holder;
  const lead =
    inUse === 0
      ? `No ${many} use this ${text.thing}.`
      : inUse === 1
        ? `1 ${one} keeps this ${text.thing}.`
        : `${inUse} ${many} keep this ${text.thing}.`;
  return `${lead} It won't be offered for new or changed ${many}. You can activate it again.`;
}

/** The duplicate-name message (UI spec 7.3); an inactive duplicate says so. */
export function duplicateMessage(text: MatterListText, name: string, inactive: boolean): string {
  const base = `A ${text.dupNoun} named '${name}' already exists.`;
  return inactive ? `${base} It is inactive; activate it instead.` : base;
}

interface ListApi {
  list: () => Observable<MatterListItemView[]>;
  create: (body: { name: string; isActive: boolean }) => Observable<MatterListItemView>;
  update: (
    id: number,
    body: { name: string; isActive: boolean; rowVersion: string },
  ) => Observable<MatterListItemView>;
  remove: (id: number) => Observable<void>;
  reorder: (body: { ids: number[] }) => Observable<MatterListItemView[]>;
}

/**
 * One of the three Matter lists of Administration > Lists (epic #1298, #1314): a reorder list built like On-Hold Reasons (the admin kit table: Order with the grip, Name, In Use, Status and
 * the row menu with Rename, Move Up, Move Down, Deactivate or Activate and Delete). An item that is in use is deactivated, never deleted: Delete is offered only when In Use is
 * 0 (the API checks again: 409 `IN_USE`). Needs `MatterList.Manage`; the editor header (`mf-list-editor`) owns the primary New button and opens the New dialog through `openNew()`.
 */
@Component({
  selector: 'mf-matter-list-tab',
  providers: [{ provide: LIST_BODY, useExisting: forwardRef(() => MatterListTab) }],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    Button,
    HasPermissionDirective,
    ActionMenu,
    ActiveBadge,
    ConfirmDialog,
    GridBody,
    IntPipe,
    LookupDialog,
    Pager,
    RouterLink,
    ScrollArea,
    TextField,
    Tip,
  ],
  host: { class: 'mf-fill', style: 'display: block' },
  templateUrl: './matter-list-tab.html',
})
export class MatterListTab {
  readonly kind = input.required<MatterListKind>();

  protected readonly paging = new LocalPaging();
  private readonly typesApi = inject(MatterTypesClient);
  private readonly statesApi = inject(CurrentStatesClient);
  private readonly titlesApi = inject(TeamTitlesClient);
  private readonly notify = inject(NotificationService);
  private readonly auth = inject(AuthStore);
  private readonly injector = inject(Injector);
  private readonly counts = inject(AdminTabCounts, { optional: true });

  protected readonly text = computed(() => MATTER_LIST_TEXTS[this.kind()]);
  private readonly api = computed<ListApi>(() => {
    switch (this.kind()) {
      case 'matter-types':
        return {
          list: () => this.typesApi.listMatterTypes(),
          create: (b) => this.typesApi.createMatterType(b),
          update: (id, b) => this.typesApi.updateMatterType(id, b),
          remove: (id) => this.typesApi.deleteMatterType(id),
          reorder: (b) => this.typesApi.reorderMatterTypes(b),
        };
      case 'current-states':
        return {
          list: () => this.statesApi.listCurrentStates(),
          create: (b) => this.statesApi.createCurrentState(b),
          update: (id, b) => this.statesApi.updateCurrentState(id, b),
          remove: (id) => this.statesApi.deleteCurrentState(id),
          reorder: (b) => this.statesApi.reorderCurrentStates(b),
        };
      default:
        return {
          list: () => this.titlesApi.listTeamTitles(),
          create: (b) => this.titlesApi.createTeamTitle(b),
          update: (id, b) => this.titlesApi.updateTeamTitle(id, b),
          remove: (id) => this.titlesApi.deleteTeamTitle(id),
          reorder: (b) => this.titlesApi.reorderTeamTitles(b),
        };
    }
  });

  protected readonly canManage = computed(() => this.auth.has('MatterList.Manage'));
  protected readonly columnSpec = [
    { cls: 'mf-cell-order', bone: '2.5rem' },
    { cls: 'mf-cell-name', bone: '10rem' },
    { cls: 'mf-cell-num', bone: '2rem' },
    { cls: 'mf-cell-badge', bone: '4.5rem' },
    { cls: 'mf-cell-actions', bone: '1.5rem' },
  ];

  protected readonly state = signal<LoadState>('loading');
  protected readonly rows = signal<MatterListItemView[]>([]);
  protected readonly busy = signal(false);
  protected readonly failure = signal('');
  protected readonly announcement = signal('');
  protected readonly ls = adminListState({ state: this.state, rows: this.rows });

  // ---- the New / Rename dialog
  /** The item the dialog renames; `'new'` is the New dialog; null is closed. */
  private readonly dialog = signal<MatterListItemView | 'new' | null>(null);
  protected readonly dialogOpen = computed(() => this.canManage() && this.dialog() !== null);
  protected readonly editing = computed(() => {
    const d = this.dialog();
    return d === null || d === 'new' ? null : d;
  });
  protected readonly draft = signal('');
  protected readonly summary = signal<readonly string[]>([]);
  protected readonly fieldError = signal('');
  protected readonly saveError = signal('');
  protected readonly deactivating = signal<MatterListItemView | null>(null);
  protected readonly deleting = signal<MatterListItemView | null>(null);
  protected readonly deactivateText = computed(() => {
    const r = this.deactivating();
    return r ? deactivateBody(this.text(), r.inUseCount) : '';
  });

  private dragIndex: number | null = null;

  constructor() {
    // A tab is one component for the three lists: a different kind starts again.
    effect(() => {
      this.kind();
      untracked(() => {
        this.dialog.set(null);
        this.paging.goTo(1);
        void this.load();
      });
    });
    // Each time the dialog opens the draft starts from the item (or empty).
    effect(() => {
      if (!this.dialogOpen()) return;
      const item = this.editing();
      untracked(() => {
        this.clearErrors();
        this.draft.set(item?.name ?? '');
      });
    });
  }

  protected inUseParams(param: string, id: number): Record<string, number> {
    return { [param]: id };
  }

  protected isDirty(): boolean {
    const item = this.editing();
    const text = this.draft().trim();
    return item ? text !== item.name : text !== '';
  }

  /** Leaving the page with an edited dialog open is unsaved work too (UXR-39). */
  hasUnsavedChanges(): boolean {
    return this.dialogOpen() && this.isDirty();
  }

  /** The page header's primary button. */
  openNew(): void {
    if (this.state() === 'ready') this.dialog.set('new');
  }

  protected openRename(r: MatterListItemView): void {
    this.dialog.set(r);
  }

  protected closeDialog(): void {
    this.clearErrors();
    this.dialog.set(null);
  }

  private clearErrors(): void {
    this.summary.set([]);
    this.fieldError.set('');
    this.saveError.set('');
  }

  protected async load(): Promise<void> {
    this.state.set('loading');
    const kind = this.kind();
    try {
      const list = await firstValueFrom(this.api().list());
      if (kind !== this.kind()) return;
      this.apply(list);
      this.state.set('ready');
    } catch {
      if (kind === this.kind()) this.state.set('error');
    }
  }

  private apply(list: MatterListItemView[]): void {
    this.rows.set(list);
    // The tab counts ACTIVE items (the kit's rule).
    this.counts?.set(this.kind(), list.filter((r) => r.isActive).length);
  }

  private async run<T>(
    work: () => Promise<T>,
    fail?: (e: ApiError) => boolean,
  ): Promise<T | undefined> {
    this.busy.set(true);
    this.failure.set('');
    try {
      return await work();
    } catch (e) {
      const error = e instanceof ApiError ? e : null;
      if (error?.code === 'CONCURRENCY_CONFLICT') {
        this.failure.set(
          `Someone else changed the ${this.text().plural}. The list was reloaded; try again.`,
        );
        await this.load();
      } else if (error?.code === 'IN_USE') {
        this.failure.set(`This ${this.text().thing} is in use now. Deactivate it instead.`);
        await this.load();
      } else if (!(fail && error && fail(error))) {
        this.failure.set(error?.message ?? 'Couldn’t save. Try again.');
      }
      return undefined;
    } finally {
      this.busy.set(false);
    }
  }

  // ---- New and Rename

  protected async commit(): Promise<void> {
    const name = this.draft().trim();
    this.clearErrors();
    if (!name) return this.showName('Enter a name.');
    const target = this.editing();
    const clash = this.rows().find(
      (r) => r.id !== target?.id && r.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (clash) return this.showName(duplicateMessage(this.text(), name, !clash.isActive));
    const failWith = (e: ApiError): boolean => {
      if (e.code === 'DUPLICATE_NAME') {
        this.showName(duplicateMessage(this.text(), name, false));
        return true;
      }
      const message = e.problem?.errors?.['name']?.[0]?.message;
      if (message) {
        this.showName(message);
        return true;
      }
      this.saveError.set(e.message);
      return true;
    };
    const subject = this.text().toast;
    if (target) {
      if (name === target.name) {
        this.closeDialog();
        return;
      }
      const updated = await this.run(
        () =>
          firstValueFrom(
            this.api().update(target.id, {
              name,
              isActive: target.isActive,
              rowVersion: target.rowVersion,
            }),
          ),
        failWith,
      );
      if (!updated) return;
      this.apply(this.rows().map((r) => (r.id === updated.id ? updated : r)));
      this.notify.success(`${subject} renamed`, updated.name);
    } else {
      const created = await this.run(
        () => firstValueFrom(this.api().create({ name, isActive: true })),
        failWith,
      );
      if (!created) return;
      this.apply([...this.rows(), created]);
      this.notify.success(`${subject} added`, created.name);
    }
    this.closeDialog();
  }

  private showName(message: string): void {
    this.fieldError.set(message);
    this.summary.set([message]);
  }

  // ---- activate, deactivate, delete

  protected async confirmDeactivate(): Promise<void> {
    const r = this.deactivating();
    this.deactivating.set(null);
    if (r) await this.setActive(r, false);
  }

  protected async setActive(r: MatterListItemView, active: boolean): Promise<void> {
    const updated = await this.run(() =>
      firstValueFrom(
        this.api().update(r.id, { name: r.name, isActive: active, rowVersion: r.rowVersion }),
      ),
    );
    if (!updated) return;
    this.apply(this.rows().map((x) => (x.id === updated.id ? updated : x)));
    this.announcement.set(`${r.name} ${active ? 'activated' : 'deactivated'}.`);
    this.notify.success(`${this.text().toast} ${active ? 'activated' : 'deactivated'}`, r.name);
    this.focusMenuOf(r.id);
  }

  protected async confirmDelete(): Promise<void> {
    const r = this.deleting();
    this.deleting.set(null);
    if (!r) return;
    const done = await this.run(async () => {
      await firstValueFrom(this.api().remove(r.id));
      return true;
    });
    if (!done) return;
    this.apply(this.rows().filter((x) => x.id !== r.id));
    this.announcement.set(`${r.name} deleted.`);
    this.notify.success(`${this.text().toast} deleted`, r.name);
  }

  // ---- order: Move Up / Move Down in the menu, the pointer drag

  protected async move(r: MatterListItemView, delta: number): Promise<void> {
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
    this.rows.set(next); // optimistic; the server answer (or the old order) replaces it
    const list = await this.run(() =>
      firstValueFrom(this.api().reorder({ ids: next.map((r) => r.id) })),
    );
    if (list) {
      this.apply(list);
      // A polite live message, no toast: the person sees the row move.
      this.announcement.set(`Moved ${moved.name} to position ${to + 1}.`);
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

  // ---- the row menu

  protected readonly menus = computed(() => {
    const map = new Map<number, ReturnType<typeof rowActions>>();
    const list = this.rows();
    list.forEach((r, i) => {
      const specs: RowActionSpec[] = [
        {
          id: 'rename',
          label: 'Rename',
          icon: 'pi-pencil',
          permission: 'MatterList.Manage',
          run: () => this.openRename(r),
        },
        {
          id: 'up',
          label: 'Move Up',
          icon: 'pi-arrow-up',
          permission: 'MatterList.Manage',
          reason: i === 0 ? 'Already first.' : undefined,
          run: () => void this.move(r, -1),
        },
        {
          id: 'down',
          label: 'Move Down',
          icon: 'pi-arrow-down',
          permission: 'MatterList.Manage',
          reason: i === list.length - 1 ? 'Already last.' : undefined,
          run: () => void this.move(r, 1),
        },
        r.isActive
          ? {
              id: 'deactivate',
              label: 'Deactivate',
              kind: 'state',
              permission: 'MatterList.Manage',
              run: () => this.deactivating.set(r),
            }
          : {
              id: 'activate',
              label: 'Activate',
              kind: 'state',
              permission: 'MatterList.Manage',
              run: () => void this.setActive(r, true),
            },
      ];
      // An item that is in use is deactivated, never deleted: Delete is for a typo or a test entry (In Use 0).
      if (r.inUseCount === 0) {
        specs.push({
          id: 'delete',
          label: 'Delete',
          icon: 'pi-trash',
          kind: 'danger',
          permission: 'MatterList.Manage',
          run: () => this.deleting.set(r),
        });
      }
      map.set(r.id, rowActions(r.name, specs, { can: (permission) => this.auth.has(permission) }));
    });
    return map;
  });
}
