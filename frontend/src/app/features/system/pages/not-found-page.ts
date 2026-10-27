import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthStore } from '../../../core/auth/auth.store';
import { BrandingService } from '../../../core/branding/branding.service';
import { landingLink } from '../../../core/auth/guards';
import { StatePage } from '../../../shared/ui/state-page';

/**
 * The 404 page (S10, #607): the shared state-page card with the address that was asked for, "Go to ..." from the landing rule and the global
 * search (the only state page that offers it), with a placeholder short enough not to be cut at 375 px.
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
    >
      @if (asked(); as a) {
        <p class="nf__asked" data-asked>
          You asked for <code class="nf__path" data-asked-path>{{ a }}</code
          >.
        </p>
      }
      <form mfSecondary class="nf__search" role="search" (submit)="search($event, q.value)">
        <input
          #q
          class="mf-control nf__input"
          type="search"
          aria-label="Search clients, matters, tasks, assets"
          [attr.placeholder]="'Search ' + brand.appName()"
          data-not-found-search
        />
        <button type="submit" class="mf-btn">Search</button>
      </form>
    </mf-state-page>
  `,
  styles: `
    .nf__asked {
      margin: 0;
    }
    .nf__path {
      font-family: var(--mf-font-mono);
      overflow-wrap: anywhere;
    }
    /* Wide enough for its placeholder: when the primary button leaves less than this, the search takes the next line. */
    .nf__search {
      display: flex;
      flex: 1 1 auto;
      gap: var(--mf-s2);
      min-width: min(100%, 18rem);
    }
    .nf__input {
      flex: 1 1 auto;
      min-width: 0;
    }
  `,
})
export class NotFoundPage {
  private readonly router = inject(Router);
  private readonly auth = inject(AuthStore);
  protected readonly brand = inject(BrandingService);
  protected readonly link = computed(() => landingLink(this.auth));

  /** The address that was asked for (what the router shows); nothing when /404 was opened directly. */
  protected readonly asked = computed(() => {
    const url = this.router.url;
    return url === '/404' || url === '/' ? '' : url;
  });

  protected search(event: Event, value: string): void {
    event.preventDefault();
    const q = value.trim();
    if (q) void this.router.navigate(['/search'], { queryParams: { q } });
  }
}
