import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { Button } from 'primeng/button';
import { AuthStore } from '../../../core/auth/auth.store';
import { BrandingService } from '../../../core/branding/branding.service';
import { APP_ENV } from '../../../core/config/app-env';
import { defaultLandingPath } from '../../../core/auth/guards';
import { sameIdentity } from '../../../shared/layout/same-identity';
import { MfDatePipe } from '../../../shared/pipes/mf-date.pipe';
import { CopyButton } from '../../../shared/ui/copy-button';
import { TitleIcon } from '../../../shared/ui/page-header';

/** S21 Access Pending: the only screen a user with zero permissions can reach. */
@Component({
  selector: 'mf-access-pending-page',
  imports: [Button, CopyButton, MfDatePipe, TitleIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './access-pending-page.html',
  styleUrl: './access-pending-page.scss',
})
export class AccessPendingPage implements AfterViewInit {
  protected readonly auth = inject(AuthStore);
  protected readonly brand = inject(BrandingService);
  private readonly router = inject(Router);
  protected readonly helpContact = inject(APP_ENV).helpContact;
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');

  /** " (KE\\pend01)" after the name, or nothing when the account only repeats the name; the full stop follows it with no space. */
  protected accountNote(displayName: string, account: string | undefined): string {
    return account && !sameIdentity(account, displayName) ? ` (${account})` : '';
  }
  protected readonly checking = signal(false);
  /** Polite live-region text after "Check again". */
  protected readonly message = signal('');

  ngAfterViewInit(): void {
    this.heading()?.nativeElement.focus();
  }

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
