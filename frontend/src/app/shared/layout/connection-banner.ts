import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Connectivity } from '../../core/http/connectivity';

/**
 * The slim banner under the header (S13, #611 and S14, #612; one banner slot, priority sign-in then offline): "You're offline. Pages you have open still
 * work; changes can't be saved." with a Retry button while the server cannot be reached, then "Back online." for a few seconds once it can.
 * A 401 from the API shows "We couldn't verify your sign-in." with a Reload page button instead (and no toast); it wins over offline.
 * The always-present wrapper is the polite live region (it is announced when its text appears); focus is never moved to the banner.
 */
@Component({
  selector: 'mf-connection-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cb" role="status" aria-live="polite" data-connection-status>
      @if (connectivity.signInFailed()) {
        <div class="pg-banner pg-banner--full pg-banner--danger" data-signin-banner>
          <i class="pi pi-lock" aria-hidden="true"></i>
          <span>We couldn't verify your sign-in.</span>
          <button type="button" class="mf-btn" data-signin-reload (click)="reload()">
            Reload Page
          </button>
        </div>
      } @else if (connectivity.offline()) {
        <div class="pg-banner pg-banner--full" data-offline-banner>
          <i class="pi pi-wifi" aria-hidden="true"></i>
          <span>You're offline. Pages you have open still work; changes can't be saved.</span>
          <button
            type="button"
            class="mf-btn"
            data-offline-retry
            [attr.aria-busy]="connectivity.checking() ? 'true' : null"
            (click)="retry()"
          >
            Retry
          </button>
        </div>
      } @else if (connectivity.backOnline()) {
        <div class="pg-banner pg-banner--full pg-banner--success" data-back-online>
          <i class="pi pi-check-circle" aria-hidden="true"></i>
          <span>Back online.</span>
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
  `,
})
export class ConnectionBanner {
  protected readonly connectivity = inject(Connectivity);

  protected retry(): void {
    void this.connectivity.check();
  }

  protected reload(): void {
    window.location.reload();
  }
}
