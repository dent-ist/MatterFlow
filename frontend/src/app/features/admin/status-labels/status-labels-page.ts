import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { StatusLabelView, StatusLabelsClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { ApiError } from '../../../core/http/api-error';
import { DEFAULT_STATUS_LABELS, LookupStore, StatusCode } from '../../../core/lookups/lookup-store';
import { NotificationService } from '../../../core/notify/notification.service';
import { HasUnsavedChanges } from '../../../shared/guards/unsaved-changes.guard';
import { ActionMenu } from '../../../shared/ui/action-menu';
import { AdminCardList, AdminCardSpec } from '../../../shared/ui/admin-card-spec';
import { adminListState } from '../../../shared/ui/admin-list-state';
import { ScrollArea } from '../../../shared/ui/fixed-page';
import { GridBody } from '../../../shared/ui/grid-body';
import { LookupDialog } from '../../../shared/ui/lookup-dialog';
import { phoneCards } from '../../../shared/ui/record-card-list';
import { rowActions } from '../../../shared/ui/row-actions';
import { RowLink, RowStop } from '../../../shared/ui/row-nav';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { TextField } from '../../../shared/ui/text-field';
import { AdminTabCounts } from '../admin-tabs';
import { dialogCopy } from '../shared/dialog-copy';
import { ADMIN_FIELD_LIMITS } from '../shared/field-limits';

type LoadState = 'loading' | 'ready' | 'error';

/** The Task Queue address of the tasks in one status (#622): every task of the status, open or closed. */
const tasksQuery = (code: string) => ({ status: code });

/**
 * Admin: Status labels (UX S18), the second tab of the Labels page. Five fixed rows (#622): the name is the badge with the display label
 * (the internal code is its tooltip; a renamed status also says what it was), Tasks counts every task in the status and links to the Task
 * Queue, and the row menu has Rename. Rename is the lookup dialog (#564) with a live badge, the code and the sentence that says where the
 * name shows; below 640 px the rows are cards. Statuses can be neither added nor removed. Needs `StatusLabel.Manage`.
 */
@Component({
  selector: 'mf-status-labels-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    ActionMenu,
    AdminCardList,
    GridBody,
    ScrollArea,
    LookupDialog,
    RowLink,
    RowStop,
    StatusBadge,
    TextField,
  ],
  templateUrl: './status-labels-page.html',
  styleUrl: './status-labels-page.scss',
})
export class StatusLabelsPage implements OnInit, HasUnsavedChanges {
  private readonly api = inject(StatusLabelsClient);
  private readonly lookups = inject(LookupStore);
  private readonly notify = inject(NotificationService);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly report = AdminTabCounts.report('status-labels');

  /** `?edit=<code>` opens the Rename dialog of that status (the name link, the row menu and a deep link go there). */
  readonly edit = input<string | undefined>(undefined);

  protected readonly canManage = computed(() => this.auth.has('StatusLabel.Manage'));
  protected readonly canViewTasks = computed(() => this.auth.has('Task.View'));
  protected readonly phone = phoneCards();

  protected readonly state = signal<LoadState>('loading');
  protected readonly rows = signal<StatusLabelView[]>([]);
  protected readonly busy = signal(false);
  protected readonly failure = signal('');
  protected readonly announcement = signal('');
  protected readonly ls = adminListState({ state: this.state, rows: this.rows });

  protected readonly columnSpec = computed(() => [
    { cls: 'mf-cell-name', bone: '10rem' },
    ...(this.canViewTasks() ? [{ cls: 'mf-cell-num', bone: '2rem' }] : []),
    { cls: 'mf-cell-actions', bone: '1.5rem' },
  ]);

  protected readonly limits = ADMIN_FIELD_LIMITS;
  /** The status whose name is being changed in the lookup dialog (#564), or null. */
  protected readonly editingCode = computed(() => {
    const code = this.edit();
    return this.canManage() && this.rows().some((r) => r.code === code) ? (code ?? null) : null;
  });
  protected readonly draft = signal('');
  /** The validation messages of the dialog's summary, the message under the field, and a server failure. */
  protected readonly summary = signal<readonly string[]>([]);
  protected readonly fieldError = signal('');
  protected readonly saveError = signal('');
  protected readonly renameCopy = computed(() =>
    dialogCopy.renameStatusLabel({ code: this.editingCode() ?? undefined }),
  );

  constructor() {
    // Each time the dialog opens for a status, the draft starts from its current name.
    effect(() => {
      const code = this.editingCode();
      untracked(() => {
        this.clearErrors();
        this.draft.set(this.rows().find((r) => r.code === code)?.displayLabel ?? '');
      });
    });
  }

  /** The person changed the name in the open dialog. */
  protected isDirty(): boolean {
    const row = this.rows().find((r) => r.code === this.editingCode());
    return !!row && this.draft().trim() !== row.displayLabel;
  }

  /** The dialog asks about unsaved edits itself when it closes; leaving the page with it open and edited is unsaved work too. */
  hasUnsavedChanges(): boolean {
    return this.editingCode() !== null && this.isDirty();
  }

  ngOnInit(): void {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.state.set('loading');
    try {
      this.apply(await firstValueFrom(this.api.listStatusLabels()));
      this.state.set('ready');
    } catch {
      this.state.set('error');
    }
  }

  private apply(list: StatusLabelView[]): void {
    this.rows.set(list);
    this.lookups.setStatusLabels(list);
    this.report(list.length);
  }

  /** What a status was called before anyone renamed it ("On Hold"), or null while it still has that name. */
  protected wasName(row: StatusLabelView): string | null {
    const original = DEFAULT_STATUS_LABELS[row.code as StatusCode];
    return original && original !== row.displayLabel ? original : null;
  }

  protected hasCount(row: StatusLabelView): boolean {
    return typeof row.taskCount === 'number';
  }

  protected tasksQuery = tasksQuery;

  protected countSentence(row: StatusLabelView): string {
    const n = row.taskCount ?? 0;
    return `${n} ${n === 1 ? 'task' : 'tasks'} with the status ${row.displayLabel}`;
  }

  protected closeDialog(): void {
    this.clearErrors();
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

  private clearErrors(): void {
    this.summary.set([]);
    this.fieldError.set('');
    this.saveError.set('');
  }

  protected async commit(): Promise<void> {
    const row = this.rows().find((r) => r.code === this.editingCode());
    if (!row) return;
    const label = this.draft().trim();
    this.clearErrors();
    if (!label) {
      this.fieldError.set('Enter a label.');
      this.summary.set(['Enter a label.']);
      return;
    }
    if (label === row.displayLabel) {
      this.closeDialog();
      return;
    }

    this.busy.set(true);
    this.failure.set('');
    try {
      const updated = await firstValueFrom(
        this.api.updateStatusLabel(row.code, { displayLabel: label, rowVersion: row.rowVersion }),
      );
      this.apply(this.rows().map((r) => (r.code === updated.code ? updated : r)));
      this.announcement.set(`${row.code} now reads ${updated.displayLabel}.`);
      this.notify.success('Saved.');
      this.closeDialog();
    } catch (e) {
      const error = e instanceof ApiError ? e : null;
      if (error?.code === 'CONCURRENCY_CONFLICT') {
        this.failure.set('Someone else changed the labels. The list was reloaded; try again.');
        this.closeDialog();
        await this.load();
      } else {
        const message =
          error?.problem?.errors?.['displayLabel']?.[0]?.message ??
          error?.message ??
          'Couldn’t save. Try again.';
        if (error?.problem?.errors?.['displayLabel']) {
          this.fieldError.set(message);
          this.summary.set([message]);
        } else this.saveError.set(message);
      }
    } finally {
      this.busy.set(false);
    }
  }

  // ---- the row menu and the phone cards

  protected readonly menus = computed(() => {
    const map = new Map<string, ReturnType<typeof rowActions>>();
    for (const row of this.rows()) {
      map.set(
        row.code,
        rowActions(
          row.displayLabel,
          [
            {
              id: 'rename',
              label: 'Rename',
              icon: 'pi-pencil',
              permission: 'StatusLabel.Manage',
              run: () =>
                void this.router.navigate([], {
                  queryParams: { edit: row.code },
                  queryParamsHandling: 'merge',
                }),
            },
          ],
          { can: (permission) => this.auth.has(permission) },
        ),
      );
    }
    return map;
  });

  /** The phone card of a status (#622): the same data and the same row menu as the table row. */
  protected readonly cardOf = (row: StatusLabelView): AdminCardSpec => ({
    title: row.displayLabel,
    link: ['/admin/status-labels'],
    queryParams: { edit: row.code },
    rowKey: row.code,
    meta: [
      this.wasName(row) ? `Was ${this.wasName(row)}` : '',
      ...(this.canViewTasks() && this.hasCount(row)
        ? [
            {
              text: (row.taskCount ?? 0) === 1 ? '1 task' : `${row.taskCount} tasks`,
              ...((row.taskCount ?? 0) > 0
                ? { link: { commands: ['/tasks'], queryParams: tasksQuery(row.code) } }
                : {}),
              attrs: { 'data-card-tasks': '' },
            },
          ]
        : []),
    ],
    actions: this.menus().get(row.code) ?? null,
  });
}
