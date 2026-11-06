import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthStore } from '../../../core/auth/auth.store';
import { landingLink } from '../../../core/auth/guards';
import { StatePage } from '../../../shared/ui/state-page';

/**
 * The 404 page (S10, #607, #1193): the shared state-page card with the address that was asked for and "Go to ..." from the landing rule
 * (one button; the top bar has the search).
 */
@Component({
  selector: 'mf-not-found-page',
  imports: [StatePage],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-state-page
      icon="pi pi-compass"
      heading="We couldn't find that."
      reason="The page may have moved, or the link may be wrong."
      [primary]="link()"
      [address]="asked()"
    />
  `,
})
export class NotFoundPage {
  private readonly router = inject(Router);
  private readonly auth = inject(AuthStore);
  protected readonly link = computed(() => landingLink(this.auth));

  /** The address that was asked for (what the router shows); nothing when /404 was opened directly. */
  protected readonly asked = computed(() => {
    const url = this.router.url;
    return url === '/404' || url === '/' ? '' : url;
  });
}
