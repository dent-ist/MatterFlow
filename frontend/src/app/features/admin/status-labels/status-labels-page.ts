import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import { StatusLabelView, StatusLabelsClient } from '../../../api/generated/api-client';
import { ApiError } from '../../../core/http/api-error';
import { LookupStore } from '../../../core/lookups/lookup-store';
import { NotificationService } from '../../../core/notify/notification.service';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { ListState } from '../../../shared/ui/data-table';
import { HasUnsavedChanges } from '../../../shared/guards/unsaved-changes.guard';
import { PageHeader } from '../../../shared/ui/page-header';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Admin: Status labels (UX S18). Five fixed rows: the internal code is shown read-only, only the display label is editable, and
 * statuses can be neither added nor removed. Needs `StatusLabel.Manage`.
 */
@Component({
  selector: 'mf-status-labels-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    PageHeader,
    ListState,
    FormsModule,
    RouterLink,
    Button,
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

  protected readonly editingCode = signal<string | null>(null);
  protected readonly draft = signal('');
  protected readonly editError = signal('');

  /** A rename in progress is unsaved work. */
  hasUnsavedChanges(): boolean {
    return this.editingCode() !== null;
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
    this.editError.set('');
  }

  protected cancelEdit(): void {
    this.editingCode.set(null);
    this.editError.set('');
  }

  protected async commit(row: StatusLabelView): Promise<void> {
    const label = this.draft().trim();
    if (!label) {
      this.editError.set('Enter a label.');
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
        this.editError.set(
          error?.problem?.errors?.['displayLabel']?.[0]?.message ??
            error?.message ??
            'Couldn’t save. Try again.',
        );
      }
    } finally {
      this.busy.set(false);
    }
  }
}
