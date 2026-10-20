import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { AuthStore } from '../../../core/auth/auth.store';
import { ErrorRequest } from '../../../core/auth/guards';
import { ErrorReference } from '../../../shared/ui/error-reference';
import { StatePage } from '../../../shared/ui/state-page';

/**
 * Shown outside the shell when /me cannot be loaded at all: the same state-page card as the 403 and the 404 (S10, #607), with the Reference
 * and Copy of the failed call (S11, #608; kept in memory, the toast is gone after 8 seconds). Retry reads /me again and, when it works, reloads
 * the page the person was on (not the home page); "Go to home" appears only once Retry has failed too.
 */
@Component({
  selector: 'mf-error-page',
  imports: [StatePage, ErrorReference],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="mf-error">
      <mf-state-page
        icon="pi pi-exclamation-triangle"
        heading="Something went wrong. Try again."
        reason="MatterFlow could not load your account."
      >
        <mf-error-reference />
        @if (retrying()) {
          <p class="mf-error__busy" role="status" data-retrying>Trying again...</p>
        } @else if (failedAgain()) {
          <p class="mf-error__busy" role="status" data-failed-again>It still did not work.</p>
        }
        <button
          mfPrimary
          type="button"
          class="mf-btn mf-btn--primary"
          data-retry
          [attr.aria-busy]="retrying() ? 'true' : null"
          (click)="retry()"
        >
          <i class="pi pi-refresh" aria-hidden="true"></i>Retry
        </button>
        @if (failedAgain()) {
          <a mfSecondary class="mf-btn" href="/" data-go-home>Go to home</a>
        }
      </mf-state-page>
    </main>
  `,
  styles: `
    .mf-error {
      max-width: 40rem;
      margin: var(--mf-s5) auto;
      padding: 0 var(--mf-s4);
    }
    .mf-error__busy {
      margin: var(--mf-s2) 0 0;
      color: var(--mf-text-muted);
    }
  `,
})
export class ErrorPage {
  private readonly auth = inject(AuthStore);
  private readonly request = inject(ErrorRequest);

  protected readonly retrying = signal(false);
  /** Retry was pressed and the account still could not be loaded. */
  protected readonly failedAgain = signal(false);

  protected async retry(): Promise<void> {
    if (this.retrying()) return;
    this.retrying.set(true);
    try {
      await this.auth.refresh();
    } finally {
      this.retrying.set(false);
    }
    if (this.auth.state() === 'error') {
      this.failedAgain.set(true);
      return;
    }
    window.location.assign(this.request.url() ?? '/');
  }
}
