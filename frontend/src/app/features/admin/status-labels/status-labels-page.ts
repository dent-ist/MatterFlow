import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { StatusLabelView, StatusLabelsClient } from '../../../api/generated/api-client';
import { ApiError } from '../../../core/http/api-error';
import { LookupStore } from '../../../core/lookups/lookup-store';
import { NotificationService } from '../../../core/notify/notification.service';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { ListState } from '../../../shared/ui/data-table';
import { HasUnsavedChanges } from '../../../shared/guards/unsaved-changes.guard';
import { FixedPage, ScrollArea } from '../../../shared/ui/fixed-page';
import { PageHeader } from '../../../shared/ui/page-header';
import { LookupDialog } from '../../../shared/ui/lookup-dialog';
import { TextField } from '../../../shared/ui/text-field';
import { dialogCopy } from '../shared/dialog-copy';
import { ADMIN_FIELD_LIMITS } from '../shared/field-limits';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Admin: Status labels (UX S18). Five fixed rows: the internal code is shown read-only, only the display label is editable, and
 * statuses can be neither added nor removed. Needs `StatusLabel.Manage`.
 */
@Component({
  selector: 'mf-status-labels-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FixedPage,
    ScrollArea,
    PageHeader,
    ListState,
    RouterLink,
    LookupDialog,
    TextField,
    HasPermissionDirective,
    StatusBadge,
  ],
  templateUrl: './status-labels-page.html',
  styleUrl: '../admin-lookup.scss',
})
export class StatusLabelsPage implements OnInit, HasUnsavedChanges {
  private readonly api = inject(StatusLabelsClient);
  private readonly lookups = inject(LookupStore);
  private readonly notify = inject(NotificationService);

  protected readonly state = signal<LoadState>('loading');
  protected readonly rows = signal<StatusLabelView[]>([]);
  protected readonly busy = signal(false);
  protected readonly failure = signal('');
  protected readonly announcement = signal('');

  protected readonly limits = ADMIN_FIELD_LIMITS;
  /** The status whose name is being changed in the lookup dialog (#564), or null. */
  protected readonly editingCode = signal<string | null>(null);
  protected readonly draft = signal('');
  /** The validation messages of the dialog's summary, the message under the field, and a server failure. */
  protected readonly summary = signal<readonly string[]>([]);
  protected readonly fieldError = signal('');
  protected readonly saveError = signal('');
  protected readonly renameCopy = computed(() =>
    dialogCopy.renameStatusLabel({ code: this.editingCode() ?? undefined }),
  );

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
  }

  protected startEdit(row: StatusLabelView): void {
    this.editingCode.set(row.code);
    this.draft.set(row.displayLabel);
    this.clearErrors();
  }

  protected cancelEdit(): void {
    this.editingCode.set(null);
    this.clearErrors();
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
      this.cancelEdit();
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
      this.cancelEdit();
    } catch (e) {
      const error = e instanceof ApiError ? e : null;
      if (error?.code === 'CONCURRENCY_CONFLICT') {
        this.failure.set('Someone else changed the labels. The list was reloaded; try again.');
        this.cancelEdit();
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
}
