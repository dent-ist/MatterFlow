import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Connectivity } from '../../core/http/connectivity';

/**
 * The slim banner under the header (S13, #611; one banner slot, the sign-in banner joins it in #612): "You're offline. Pages you have open still
 * work; changes can't be saved." with a Retry button while the server cannot be reached, then "Back online." for a few seconds once it can.
 * The always-present wrapper is the polite live region (it is announced when its text appears); focus is never moved to the banner.
 */
@Component({
  selector: 'mf-connection-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cb" role="status" aria-live="polite" data-connection-status>
      @if (connectivity.offline()) {
        <div class="cb__bar cb__bar--offline" data-offline-banner>
          <i class="pi pi-wifi" aria-hidden="true"></i>
          <span class="cb__text"
            >You're offline. Pages you have open still work; changes can't be saved.</span
          >
          <button
            type="button"
            class="mf-btn cb__retry"
            data-offline-retry
            [attr.aria-busy]="connectivity.checking() ? 'true' : null"
            (click)="retry()"
          >
            Retry
          </button>
        </div>
      } @else if (connectivity.backOnline()) {
        <div class="cb__bar cb__bar--back" data-back-online>
          <i class="pi pi-check-circle" aria-hidden="true"></i>
          <span class="cb__text">Back online.</span>
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .cb__bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2) var(--mf-s3);
      box-sizing: border-box;
      max-width: 100%;
      padding: var(--mf-s2) var(--mf-s5);
      border-bottom: 1px solid var(--mf-border);
      font-size: var(--mf-fs-sm);
    }
    .cb__bar--offline {
      background: var(--mf-warning-bg);
      color: var(--mf-warning);
    }
    .cb__bar--back {
      background: var(--mf-success-bg);
      color: var(--mf-success);
    }
    .cb__text {
      flex: 1 1 14rem;
      min-width: 0;
    }
    .cb__retry {
      flex: none;
    }
    @media (max-width: 639.98px) {
      .cb__bar {
        padding-inline: var(--mf-s3);
      }
    }
  `,
})
export class ConnectionBanner {
  protected readonly connectivity = inject(Connectivity);

  protected retry(): void {
    void this.connectivity.check();
  }
}
