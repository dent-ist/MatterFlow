import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * One-time notice after the client and matter line under the task titles went away (#198). It names where the information lives now and,
 * on Task Queue and Pod Work for a user who had taken Matter out, offers to bring the column back. Dismissal is remembered by the page.
 */
@Component({
  selector: 'mf-columns-notice',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cn" role="status" data-columns-notice>
      <i class="pi pi-info-circle" aria-hidden="true"></i>
      <p class="cn-text">
        The client and matter line under task titles is gone. Matter now shows the reference and the
        name. Client is in Columns.
      </p>
      @if (offerMatter()) {
        <button type="button" class="mf-btn" data-add-matter (click)="addMatter.emit()">
          Add Matter column
        </button>
      }
      <button type="button" class="mf-btn cn-close" data-dismiss-notice (click)="dismiss.emit()">
        Dismiss
      </button>
    </div>
  `,
  styles: `
    .cn {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2);
      padding: var(--mf-s2) var(--mf-s3);
      margin-bottom: var(--mf-s2);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius, 6px);
      background: var(--mf-surface-alt);
      color: var(--mf-text);
    }
    .cn-text {
      flex: 1 1 16rem;
      margin: 0;
    }
  `,
})
export class ColumnsNotice {
  /** True on Task Queue and Pod Work when the current tab has no Matter column. */
  readonly offerMatter = input(false);
  readonly addMatter = output<void>();
  readonly dismiss = output<void>();
}
