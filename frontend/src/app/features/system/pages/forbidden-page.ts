import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthStore } from '../../../core/auth/auth.store';
import { landingLink } from '../../../core/auth/guards';
import { TitleIcon } from '../../../shared/ui/page-header';

@Component({
  selector: 'mf-forbidden-page',
  imports: [RouterLink, TitleIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1><mf-title-icon icon="pi pi-ban" />You don't have permission to view this.</h1>
    <p>Ask an administrator if you think you should have access.</p>
    @if (link(); as l) {
      <p>
        <a [routerLink]="l.path" data-back-link>Go to {{ l.name }}</a>
      </p>
    }
  `,
})
export class ForbiddenPage {
  private readonly auth = inject(AuthStore);
  /** The first page this person can open (the landing rule), or none: never "my work" for someone who has no My Work. */
  protected readonly link = computed(() => landingLink(this.auth));
}
