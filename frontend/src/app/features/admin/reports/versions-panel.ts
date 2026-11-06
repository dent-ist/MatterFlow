import { Badge } from '../../../shared/ui/badge';
import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  ReportDefinitionsClient,
  ReportVersionComparisonResponse,
  ReportVersionResponse,
} from '../../../api/generated/api-client';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { NumericDatePipe } from '../../../shared/ui/numeric-date';

/**
 * The version history (spec 6.7, issue #714): every version with its number, author, date and change note; Compare shows the line diff against
 * the version before it (and which parameters were added, removed or changed); Restore copies an old version into a NEW version (history is
 * never rewritten) and tells the author that the restored report must be previewed again before it can be activated. Needs the page to say
 * when a restore is safe (no unsaved edits), because a restore replaces what the editor shows.
 */
@Component({
  selector: 'mf-versions-panel',
  imports: [Badge, NumericDatePipe, ConfirmDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="vp" aria-labelledby="vp-title" data-versions-panel>
      <h2 id="vp-title" class="vp__title">Version History</h2>
      @if (failure(); as f) {
        <p class="vp__error" role="alert">{{ f }}</p>
      }
      @if (blockedReason(); as why) {
        <p class="vp__hint" data-restore-blocked>{{ why }}</p>
      }
      <ol class="vp__list">
        @for (v of versions(); track v.versionId) {
          <li class="vp__item" [attr.data-version]="v.versionNo">
            <div class="vp__head">
              <strong>Version {{ v.versionNo }}</strong>
              @if (v.isCurrent) {
                @if (reportActive()) {
                  <mf-badge tone="success" icon="pi-check-circle" data-current>Active</mf-badge>
                } @else {
                  <mf-badge tone="neutral" icon="pi-minus-circle" data-current>Inactive</mf-badge>
                }
              }
              <span class="vp__meta"
                >{{ v.createdByName || 'Unknown' }}, {{ v.createdAtUtc | mfNum }}</span
              >
            </div>
            @if (v.changeNote) {
              <p class="vp__note">{{ v.changeNote }}</p>
            }
            <div class="vp__actions">
              @if (v.versionNo > 1) {
                <button
                  type="button"
                  class="mf-btn"
                  (click)="compare(v)"
                  [attr.aria-expanded]="comparing()?.toVersionNo === v.versionNo"
                  data-compare
                >
                  Compare with version {{ v.versionNo - 1 }}
                </button>
              }
              @if (!v.isCurrent) {
                <button
                  type="button"
                  class="mf-btn"
                  (click)="askRestore(v)"
                  [disabled]="!!blockedReason() || busy()"
                  data-restore
                >
                  Restore
                </button>
              }
              @if (v.isCurrent && !reportActive()) {
                <button
                  type="button"
                  class="mf-btn mf-btn--text"
                  (click)="askActivate(v)"
                  [disabled]="!canActivate() || busy()"
                  [attr.aria-describedby]="canActivate() ? null : 'vp-activate-why-' + v.versionNo"
                  data-activate
                >
                  Activate
                </button>
                @if (!canActivate() && activateReason()) {
                  <span
                    class="vp__meta"
                    [id]="'vp-activate-why-' + v.versionNo"
                    data-version-activate-reason
                    >{{ activateReason() }}</span
                  >
                }
              }
            </div>
            @if (comparing(); as c) {
              @if (c.toVersionNo === v.versionNo) {
                <div
                  class="vp__diff"
                  role="region"
                  [attr.aria-label]="'Changes in version ' + v.versionNo"
                  data-diff
                >
                  @if (
                    c.parametersAdded.length +
                      c.parametersRemoved.length +
                      c.parametersChanged.length >
                    0
                  ) {
                    <p class="vp__params">
                      Parameters:
                      @if (c.parametersAdded.length) {
                        added {{ c.parametersAdded.join(', ') }}.
                      }
                      @if (c.parametersRemoved.length) {
                        removed {{ c.parametersRemoved.join(', ') }}.
                      }
                      @if (c.parametersChanged.length) {
                        changed {{ c.parametersChanged.join(', ') }}.
                      }
                    </p>
                  }
                  <pre
                    class="vp__lines"
                    tabindex="0"
                  ><code>@for (l of c.sql; track $index) {<span class="vp__line" [class]="'vp__line vp__line--' + l.kind"><span class="vp__sign" aria-hidden="true">{{ l.kind === 'added' ? '+' : l.kind === 'removed' ? '-' : ' ' }}</span><span class="mf-sr-only">{{ l.kind === 'added' ? 'Added: ' : l.kind === 'removed' ? 'Removed: ' : '' }}</span>{{ l.text }}
</span>}</code></pre>
                </div>
              }
            }
          </li>
        }
      </ol>
    </section>

    <mf-confirm-dialog
      title="Activate Version"
      confirmLabel="Activate Version"
      [busy]="busy()"
      [visible]="activating() !== null"
      (visibleChange)="!$event && activating.set(null)"
      (confirmed)="activate()"
    >
      <p data-activate-body>
        Activate version {{ activating()?.versionNo }}? People whose roles have this report can see
        and run it.
      </p>
    </mf-confirm-dialog>

    <mf-confirm-dialog
      title="Restore Version"
      confirmLabel="Restore Version"
      [busy]="busy()"
      [visible]="restoring() !== null"
      (visibleChange)="!$event && restoring.set(null)"
      (confirmed)="restore()"
    >
      <p data-restore-body>
        Version {{ restoring()?.versionNo }} is copied into a new version and the report is
        deactivated until that version has been previewed; the history stays as it is.
      </p>
    </mf-confirm-dialog>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }

    .vp {
      display: grid;
      gap: var(--mf-s3);
    }

    .vp__title {
      margin: 0;
      font-size: var(--mf-fs-lg);
    }

    .vp__list {
      display: grid;
      gap: var(--mf-s3);
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .vp__item {
      display: grid;
      gap: var(--mf-s2);
      min-width: 0;
      padding: var(--mf-s3) var(--mf-s4);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
    }

    .vp__head {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s3);
      align-items: baseline;
    }

    .vp__meta,
    .vp__hint {
      color: var(--mf-text-muted);
    }

    .vp__note,
    .vp__params,
    .vp__hint {
      margin: 0;
    }

    .vp__error {
      margin: 0;
      color: var(--mf-danger);
    }

    .vp__actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s2);
    }

    .vp__lines {
      max-height: 20rem;
      margin: 0;
      overflow: auto;
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius);
      font-family: var(--mf-font-mono);
      font-size: var(--mf-fs-sm);
    }

    .vp__line {
      display: block;
      padding: 0 var(--mf-s3);
      white-space: pre;
    }

    .vp__sign {
      display: inline-block;
      width: 1.5ch;
    }

    .vp__line--added {
      background: var(--mf-success-bg);
    }

    .vp__line--removed {
      background: var(--mf-danger-bg);
    }
  `,
})
export class VersionsPanel {
  private readonly api = inject(ReportDefinitionsClient);

  readonly reportId = input.required<number>();
  /** Changes whenever the report is saved, so the list reloads. */
  readonly refreshKey = input<unknown>(null);
  /** Why Restore is not offered now (the editor holds unsaved edits); empty when it is. */
  readonly blockedReason = input('');
  /** Asked to restore: the page runs the call (it holds the row version) and reports back. */
  readonly restoreRequested = output<number>();
  readonly busy = input(false);
  /** Whether the report is active (its current version is the active one). */
  readonly reportActive = input(false);
  /** The current version passed a preview and nothing is unsaved: Activate can be used. */
  readonly canActivate = input(false);
  /** Why Activate is not available yet (shown beside the disabled button). */
  readonly activateReason = input('');
  /** Asked to activate: the page runs the call. */
  readonly activateRequested = output<number>();

  protected readonly versions = signal<ReportVersionResponse[]>([]);
  protected readonly failure = signal('');
  protected readonly comparing = signal<ReportVersionComparisonResponse | null>(null);
  protected readonly restoring = signal<ReportVersionResponse | null>(null);
  protected readonly activating = signal<ReportVersionResponse | null>(null);

  constructor() {
    effect(() => {
      this.reportId();
      this.refreshKey();
      untracked(() => void this.load());
    });
  }

  protected async load(): Promise<void> {
    this.failure.set('');
    try {
      this.versions.set(await firstValueFrom(this.api.listReportVersions(this.reportId())));
    } catch {
      this.failure.set("Couldn't load the version history.");
    }
  }

  protected async compare(v: ReportVersionResponse): Promise<void> {
    if (this.comparing()?.toVersionNo === v.versionNo) {
      this.comparing.set(null);
      return;
    }
    try {
      this.comparing.set(
        await firstValueFrom(
          this.api.compareReportVersions(this.reportId(), v.versionNo, v.versionNo - 1),
        ),
      );
    } catch {
      this.failure.set("Couldn't compare the versions.");
    }
  }

  protected askRestore(v: ReportVersionResponse): void {
    this.restoring.set(v);
  }

  protected askActivate(v: ReportVersionResponse): void {
    this.activating.set(v);
  }

  protected activate(): void {
    const v = this.activating();
    this.activating.set(null);
    if (v) this.activateRequested.emit(v.versionNo);
  }

  protected restore(): void {
    const v = this.restoring();
    this.restoring.set(null);
    if (v) this.restoreRequested.emit(v.versionNo);
  }
}
