import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AssetReportResponse, AssetReportsClient } from '../../../api/generated/api-client';
import { ApiError } from '../../../core/http/api-error';
import { QuietRequests } from '../../../core/http/interceptors';
import { NotificationService } from '../../../core/notify/notification.service';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';

/**
 * The person's saved asset reports (personal: nobody else sees them): open, rename and delete. A saved report is only a definition, so
 * opening one runs it again with the viewer's current visibility. Rename and delete are confirmed in the shared dialog; a failure stays in
 * the dialog (the shared confirm rule).
 */
@Component({
  selector: 'mf-saved-reports',
  imports: [ConfirmDialog, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (state() === 'loading') {
      <p class="sr-note" role="status" data-saved-loading>Loading your saved reports.</p>
    } @else if (state() === 'error') {
      <p class="sr-note sr-note--error" role="alert" data-saved-error>
        Your saved reports could not be loaded.
        <button type="button" class="mf-btn" (click)="retry.emit()">Retry</button>
      </p>
    } @else if (reports().length === 0) {
      <p class="sr-note" data-saved-empty>
        Nothing saved yet. Build a report, give it a name and choose Save; it appears here for you
        only.
      </p>
    } @else {
      <ul class="sr-list" data-saved-list>
        @for (r of reports(); track r.assetReportId) {
          <li class="sr-item" [class.sr-item--open]="r.assetReportId === openId()" data-saved-item>
            <div class="sr-main">
              @if (r.isSupported) {
                <button
                  type="button"
                  class="sr-open"
                  [attr.aria-current]="r.assetReportId === openId() ? 'true' : null"
                  data-saved-open
                  (click)="opened.emit(r)"
                >
                  {{ r.name }}
                </button>
              } @else {
                <span class="sr-open sr-open--off">{{ r.name }}</span>
              }
              <span class="sr-when"
                >{{ r.modifiedAtUtc ?? r.createdAtUtc | date: 'd MMM y' }}
                @if (!r.isSupported) {
                  . Saved by a newer version; it cannot be opened here.
                }
              </span>
            </div>
            <div class="sr-actions">
              <button
                type="button"
                class="mf-btn mf-btn--text"
                data-saved-rename
                [attr.aria-label]="'Rename ' + r.name"
                [disabled]="!r.isSupported"
                (click)="askRename(r)"
              >
                Rename
              </button>
              <button
                type="button"
                class="mf-btn mf-btn--text"
                data-saved-delete
                [attr.aria-label]="'Delete ' + r.name"
                (click)="askDelete(r)"
              >
                Delete
              </button>
            </div>
          </li>
        }
      </ul>
    }

    <mf-confirm-dialog
      title="Rename report"
      confirmLabel="Rename"
      [busy]="busy()"
      [error]="error()"
      [(visible)]="renameOpen"
      (confirmed)="rename()"
    >
      <div class="sr-field">
        <label for="sr-rename" class="sr-label">Report name</label>
        <input
          id="sr-rename"
          class="mf-control"
          type="text"
          maxlength="100"
          data-rename-input
          [value]="newName()"
          (input)="newName.set($any($event.target).value)"
          (keydown.enter)="rename()"
        />
      </div>
    </mf-confirm-dialog>

    <mf-confirm-dialog
      title="Delete report"
      confirmLabel="Delete"
      [danger]="true"
      [busy]="busy()"
      [error]="error()"
      [(visible)]="deleteOpen"
      (confirmed)="remove()"
    >
      <p>
        Delete <strong>{{ target()?.name }}</strong
        >? Only the saved settings are removed. Your assets and data are not touched.
      </p>
    </mf-confirm-dialog>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .sr-note {
      margin: 0;
      color: var(--mf-text-muted);
    }
    .sr-note--error {
      color: var(--mf-danger);
    }
    .sr-list {
      display: grid;
      gap: var(--mf-s2);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .sr-item {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--mf-s1) var(--mf-s2);
      padding: var(--mf-s2) var(--mf-s3);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
    }
    .sr-item--open {
      border-color: var(--mf-primary);
      background: var(--mf-selected-bg);
    }
    .sr-main {
      display: grid;
      min-width: 0;
      flex: 1 1 8rem;
    }
    .sr-open {
      min-height: var(--mf-target-min);
      padding: 0;
      border: 0;
      background: none;
      color: var(--mf-link);
      font: inherit;
      font-weight: 600;
      text-align: left;
      overflow-wrap: anywhere;
      cursor: pointer;
    }
    .sr-open--off {
      color: var(--mf-text-muted);
      cursor: default;
    }
    .sr-when {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .sr-actions {
      display: flex;
      gap: var(--mf-s1);
    }
    .sr-label {
      display: block;
      margin-bottom: var(--mf-s1);
      font-weight: 600;
    }
    .sr-field .mf-control {
      width: 100%;
    }
  `,
})
export class SavedReports {
  private readonly api = inject(AssetReportsClient);
  private readonly quiet = inject(QuietRequests);
  private readonly notify = inject(NotificationService);

  readonly reports = input.required<readonly AssetReportResponse[]>();
  readonly openId = input<number | null>(null);
  readonly state = input<'loading' | 'ready' | 'error'>('ready');

  readonly opened = output<AssetReportResponse>();
  readonly renamed = output<AssetReportResponse>();
  readonly deleted = output<number>();
  readonly retry = output<void>();

  protected readonly target = signal<AssetReportResponse | null>(null);
  protected readonly newName = signal('');
  protected readonly renameOpen = signal(false);
  protected readonly deleteOpen = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  protected askRename(report: AssetReportResponse): void {
    this.target.set(report);
    this.newName.set(report.name);
    this.error.set('');
    this.renameOpen.set(true);
  }

  protected askDelete(report: AssetReportResponse): void {
    this.target.set(report);
    this.error.set('');
    this.deleteOpen.set(true);
  }

  protected async rename(): Promise<void> {
    const report = this.target();
    const name = this.newName().trim();
    if (!report?.definition || this.busy()) return;
    if (!name) {
      this.error.set('Enter a name.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const saved = await this.quiet.run(() =>
        firstValueFrom(
          this.api.updateAssetReport(report.assetReportId, {
            name,
            definition: report.definition!,
            rowVersion: report.rowVersion,
          }),
        ),
      );
      this.renameOpen.set(false);
      this.renamed.emit(saved);
      this.notify.success('Report renamed', saved.name);
    } catch (e) {
      this.error.set(failure(e, 'The report could not be renamed.'));
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(): Promise<void> {
    const report = this.target();
    if (!report || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.quiet.run(() => firstValueFrom(this.api.deleteAssetReport(report.assetReportId)));
      this.deleteOpen.set(false);
      this.deleted.emit(report.assetReportId);
      this.notify.success('Report deleted', report.name);
    } catch (e) {
      this.error.set(failure(e, 'The report could not be deleted.'));
    } finally {
      this.busy.set(false);
    }
  }
}

/** The message of a failed request for the dialog that asked for it. */
export function failure(e: unknown, fallback: string): string {
  if (e instanceof ApiError) {
    return e.message || fallback;
  }
  return fallback;
}
