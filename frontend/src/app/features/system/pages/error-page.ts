import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AuthStore } from '../../../core/auth/auth.store';
import { StatePage } from '../../../shared/ui/state-page';

/** Shown outside the shell when /me cannot be loaded at all: the same state-page card as the 403 and the 404 (S10, #607). */
@Component({
  selector: 'mf-error-page',
  imports: [StatePage],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="mf-error">
      <mf-state-page
        icon="pi pi-exclamation-triangle"
        heading="Something went wrong. Try again."
        reason="MatterFlow could not load your account."
      >
        <button mfPrimary type="button" class="mf-btn mf-btn--primary" data-retry (click)="retry()">
          <i class="pi pi-refresh" aria-hidden="true"></i>Retry
        </button>
      </mf-state-page>
    </main>
  `,
  styles: `
    .mf-error {
      max-width: 40rem;
      margin: var(--mf-s5) auto;
      padding: 0 var(--mf-s4);
    }
  `,
})
export class ErrorPage {
  private readonly auth = inject(AuthStore);

  protected async retry(): Promise<void> {
    await this.auth.refresh();
    window.location.assign('/');
  }
}
