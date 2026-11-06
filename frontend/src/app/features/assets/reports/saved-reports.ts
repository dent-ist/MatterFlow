import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AssetReportResponse, AssetReportsClient } from '../../../api/generated/api-client';
import { ApiError } from '../../../core/http/api-error';
import { QuietRequests } from '../../../core/http/interceptors';
import { NotificationService } from '../../../core/notify/notification.service';
import { ActionMenu } from '../../../shared/ui/action-menu';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { rowActions } from '../../../shared/ui/row-actions';

/**
 * The person's saved asset reports (personal: nobody else sees them): open, rename and delete, one 44 px row each (the name opens it, one "..." menu has Rename and Delete). A saved report is only a definition, so
 * opening one runs it again with the viewer's current visibility. Rename and delete are confirmed in the shared dialog; a failure stays in
 * the dialog (the shared confirm rule).
 */
@Component({
  selector: 'mf-saved-reports',
  imports: [ConfirmDialog, ActionMenu],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (state() === 'loading') {
      <p class="sr-note" role="status" data-saved-loading>Loading your saved reports.</p>
    } @else if (state() === 'error') {
      <p class="sr-note sr-note--error" role="alert" data-saved-error>
        Couldn't load your saved reports.
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
          <li
            class="sr-item"
            [class.sr-item--open]="r.assetReportId === openId()"
            data-saved-item
            data-row-actions
          >
            @if (r.isSupported) {
              <button
                type="button"
                class="mf-btn mf-btn--text sr-open"
                [attr.aria-current]="r.assetReportId === openId() ? 'true' : null"
                [attr.title]="r.name"
                data-saved-open
                (click)="opened.emit(r)"
              >
                {{ r.name }}
              </button>
            } @else {
              <span class="sr-open sr-open--off" [attr.title]="r.name" data-saved-unsupported>{{
                r.name
              }}</span>
            }
            <mf-action-menu
              [floating]="true"
              [label]="menus().get(r.assetReportId)!.label"
              [items]="menus().get(r.assetReportId)!.items"
            />
          </li>
        }
      </ul>
    }

    <mf-confirm-dialog
      title="Rename Report"
      confirmLabel="Rename Report"
      [busy]="busy()"
      [error]="error()"
      [(visible)]="renameOpen"
      (confirmed)="rename()"
    >
      <div class="sr-field">
        <label for="sr-rename" class="sr-label">Report Name</label>
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
      title="Delete Report"
      confirmLabel="Delete Report"
      [danger]="true"
      [busy]="busy()"
      [error]="error()"
      [(visible)]="deleteOpen"
      (confirmed)="remove()"
    >
      <p>
        <strong>{{ target()?.name }}</strong> is deleted: only the saved settings are removed, your
        assets and data are not touched, and this cannot be undone.
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
    /* One 44 px row per report (D-44g): the name as a text button on the left, one "..." menu at the right. */
    .sr-list {
      display: block;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .sr-item {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      box-sizing: border-box;
      height: var(--mf-grid-row-h, 44px);
      padding-inline: var(--mf-s2) var(--mf-s1);
      border-bottom: 1px solid var(--mf-border-soft);
    }
    .sr-item:hover {
      background: var(--mf-row-hover);
    }
    .sr-item--open,
    .sr-item--open:hover {
      background: var(--mf-selected-bg);
    }
    /* The name is one line with an ellipsis (the whole name is the tooltip). */
    .sr-open {
      display: block;
      flex: 1 1 auto;
      min-width: 0;
      padding-inline: 0;
      line-height: var(--mf-ctl-h);
      overflow: hidden;
      text-align: left;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .sr-item--open .sr-open {
      font-weight: var(--mf-fw-semibold);
    }
    .sr-open--off {
      color: var(--mf-text-muted);
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

  /** The "..." menu of each report (D-44g): Rename and Delete; a report saved by a newer version cannot be renamed here. */
  protected readonly menus = computed(
    () =>
      new Map(
        this.reports().map((r) => {
          const menu = rowActions(
            r.name,
            [
              {
                id: 'rename',
                label: 'Rename',
                icon: 'pi-pencil',
                reason: r.isSupported
                  ? undefined
                  : 'Saved by a newer version; it cannot be renamed here.',
                run: () => this.askRename(r),
              },
              {
                id: 'delete',
                label: 'Delete',
                icon: 'pi-trash',
                danger: true,
                run: () => this.askDelete(r),
              },
            ],
            { can: () => true },
          );
          return [r.assetReportId, { ...menu, label: `More actions for ${r.name}` }] as const;
        }),
      ),
  );
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
      this.error.set(failure(e, "Couldn't rename the report."));
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
      this.error.set(failure(e, "Couldn't delete the report."));
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
