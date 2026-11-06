import { Location } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject } from '@angular/core';
import { AuthStore } from '../../../core/auth/auth.store';
import { ForbiddenRequest, landingLink } from '../../../core/auth/guards';
import { StatePage } from '../../../shared/ui/state-page';

/**
 * The 403 page. A permission guard sends the person here and records the address they asked for (`ForbiddenRequest`); the page puts that
 * address back in the address bar (replacing the `/403` entry), so a reload retries it (for example after an administrator grants a role),
 * Back goes where the person came from, and the address can be quoted: "Asked for /admin/users" with a copy button. Opened directly
 * (`/403`), it has no address to show.
 */
@Component({
  selector: 'mf-forbidden-page',
  imports: [StatePage],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-state-page
      icon="pi pi-ban"
      heading="You don't have access."
      reason="Ask an administrator if you think you should have access."
      [primary]="link()"
      [address]="asked() ?? ''"
      [addressCopy]="href()"
    />
  `,
})
export class ForbiddenPage {
  private readonly auth = inject(AuthStore);
  private readonly request = inject(ForbiddenRequest);
  private readonly location = inject(Location);

  /** The address the guard turned away, or none when the page was opened directly. */
  protected readonly asked = computed(() => this.address);
  private readonly address = this.request.url();

  /** The full address (with the origin) that Copy link puts on the clipboard. */
  protected readonly href = computed(() =>
    this.address ? new URL(this.address, window.location.origin).href : '',
  );

  /** The first page this person can open (the landing rule), or none: never "my work" for someone who has no My Work. */
  protected readonly link = computed(() => landingLink(this.auth));

  constructor() {
    if (this.address) {
      // The guard redirected to /403 (one history entry); show the address that was asked for instead, keeping the router's own state.
      this.location.replaceState(this.address, '', this.location.getState());
    }
    inject(DestroyRef).onDestroy(() => this.request.url.set(null));
  }
}
