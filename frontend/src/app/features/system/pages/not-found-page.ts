import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { InputText } from 'primeng/inputtext';
import { AuthStore } from '../../../core/auth/auth.store';
import { landingLink } from '../../../core/auth/guards';
import { TitleIcon } from '../../../shared/ui/page-header';

@Component({
  selector: 'mf-not-found-page',
  imports: [RouterLink, InputText, TitleIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1><mf-title-icon icon="pi pi-compass" />We couldn't find that.</h1>
    <p>The page may have moved, or the link may be wrong.</p>
    <form role="search" (submit)="search($event, q.value)">
      <input
        #q
        pInputText
        type="search"
        aria-label="Search clients, matters, tasks, assets"
        placeholder="Search clients, matters, tasks, assets"
      />
    </form>
    @if (link(); as l) {
      <p>
        <a [routerLink]="l.path" data-back-link>Go to {{ l.name }}</a>
      </p>
    }
  `,
})
export class NotFoundPage {
  private readonly router = inject(Router);
  private readonly auth = inject(AuthStore);
  protected readonly link = computed(() => landingLink(this.auth));

  protected search(event: Event, value: string): void {
    event.preventDefault();
    const q = value.trim();
    if (q) void this.router.navigate(['/search'], { queryParams: { q } });
  }
}
