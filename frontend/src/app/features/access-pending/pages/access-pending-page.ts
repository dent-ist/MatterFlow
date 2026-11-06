import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthStore } from '../../../core/auth/auth.store';
import { BrandingService } from '../../../core/branding/branding.service';
import { APP_ENV } from '../../../core/config/app-env';
import { defaultLandingPath } from '../../../core/auth/guards';
import { sameIdentity } from '../../../shared/layout/same-identity';
import { CopyButton } from '../../../shared/ui/copy-button';
import { NumericDatePipe } from '../../../shared/ui/numeric-date';
import { IntPipe } from '../../../shared/ui/number-format';
import { StatePage } from '../../../shared/ui/state-page';

/**
 * S21 Access Pending: the only screen a user with zero permissions can reach. One `mf-state-page` card (D-53, #1193) in two variants:
 * "Your access is pending" (one sentence, the Windows account with a copy button, one "Check Again" button) and "Your account is disabled".
 */
@Component({
  selector: 'mf-access-pending-page',
  imports: [IntPipe, NumericDatePipe, CopyButton, StatePage],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="mf-pending">
      @if (auth.isDisabled()) {
        <mf-state-page icon="pi pi-lock" heading="Your account is disabled" [reason]="reason()">
          <span data-disabled-next>Contact the administrator to have it enabled again.</span>
          @if (helpContact) {
            <p class="mf-help">Need help? Contact: {{ helpContact }}</p>
          }
        </mf-state-page>
      } @else {
        <mf-state-page icon="pi pi-lock" heading="Your access is pending" [reason]="reason()">
          @if (auth.profile(); as p) {
            @if (p.windowsAccount) {
              <span class="mf-account-line" data-pending-account>
                Windows account <code class="mf-account">{{ p.windowsAccount | mfInt }}</code>
                <mf-copy-button [text]="p.windowsAccount" label="Windows account name" />
              </span>
            }
            @if (p.registeredAtUtc) {
              <p class="mf-help">Registered {{ p.registeredAtUtc | mfNum }}.</p>
            }
          }
          <p class="mf-status" role="status" aria-live="polite">{{ message() }}</p>
          @if (helpContact) {
            <p class="mf-help">Need help? Contact: {{ helpContact }}</p>
          }
          <button
            mfPrimary
            type="button"
            class="mf-btn mf-btn--primary"
            data-check-again
            [disabled]="checking()"
            [attr.aria-busy]="checking() ? 'true' : null"
            (click)="checkAgain()"
          >
            {{ checking() ? 'Checking...' : 'Check Again' }}
          </button>
        </mf-state-page>
      }
    </main>
  `,
  styles: `
    .mf-pending {
      display: block;
      padding: var(--mf-s6) var(--mf-s4) 0;
    }
    .mf-account {
      font-family: var(--mf-font-mono);
    }
    .mf-status {
      min-height: 1.5em;
      margin: 0;
    }
    .mf-help {
      margin: 0;
    }
  `,
})
export class AccessPendingPage {
  protected readonly auth = inject(AuthStore);
  protected readonly brand = inject(BrandingService);
  private readonly router = inject(Router);
  protected readonly helpContact = inject(APP_ENV).helpContact;

  /** " (KE\\pend01)" after the name, or nothing when the account only repeats the name; the full stop follows it with no space. */
  protected accountNote(displayName: string, account: string | undefined): string {
    return account && !sameIdentity(account, displayName) ? ` (${account})` : '';
  }

  /** The one sentence of the card: who is signed in and what happens next. */
  protected readonly reason = computed(() => {
    const p = this.auth.profile();
    const who = p?.displayName
      ? `You're signed in as ${p.displayName}${this.accountNote(p.displayName, p.windowsAccount)}.`
      : '';
    return this.auth.isDisabled()
      ? who
      : `${who} An administrator needs to give you a role before you can use ${this.brand.appName()}.`.trim();
  });
  protected readonly checking = signal(false);
  /** Polite live-region text after "Check Again". */
  protected readonly message = signal('');

  protected async checkAgain(): Promise<void> {
    this.checking.set(true);
    this.message.set('');
    await this.auth.refresh();
    this.checking.set(false);
    if (this.auth.isRestricted()) {
      // The time makes every result a new text, so a screen reader announces each press, not only the first (UAT2-23).
      const time = new Date().toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
      });
      this.message.set(`Still pending. Nothing has changed yet. Checked at ${time}.`);
    } else {
      await this.router.navigateByUrl(defaultLandingPath(this.auth));
    }
  }
}
