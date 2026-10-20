import { Location } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthStore } from '../../../core/auth/auth.store';
import { ForbiddenRequest, landingLink } from '../../../core/auth/guards';
import { CopyButton } from '../../../shared/ui/copy-button';
import { TitleIcon } from '../../../shared/ui/page-header';

/**
 * The 403 page. A permission guard sends the person here and records the address they asked for (`ForbiddenRequest`); the page puts that
 * address back in the address bar (replacing the `/403` entry), so a reload retries it (for example after an administrator grants a role),
 * Back goes where the person came from, and the address can be quoted: "You asked for /admin/users." with Copy link. Opened directly
 * (`/403`), it has no address to show.
 */
@Component({
  selector: 'mf-forbidden-page',
  imports: [RouterLink, TitleIcon, CopyButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1><mf-title-icon icon="pi pi-ban" />You don't have permission to view this.</h1>
    <p>Ask an administrator if you think you should have access.</p>
    @if (asked(); as a) {
      <p class="fb__asked" data-asked>
        You asked for <code class="fb__path" data-asked-path>{{ a }}</code
        >.
        <mf-copy-button
          [text]="href()"
          label="link"
          [showText]="true"
          caption="Copy link"
          doneCaption="Link copied"
        />
      </p>
    }
    @if (link(); as l) {
      <p>
        <a [routerLink]="l.path" data-back-link>Go to {{ l.name }}</a>
      </p>
    }
  `,
  styles: `
    .fb__path {
      font-family: var(--mf-font-mono);
      overflow-wrap: anywhere;
    }
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
