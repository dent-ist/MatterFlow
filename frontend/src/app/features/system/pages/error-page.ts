import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Button } from 'primeng/button';
import { AuthStore } from '../../../core/auth/auth.store';
import { TitleIcon } from '../../../shared/ui/page-header';

/** Shown outside the shell when /me cannot be loaded at all. */
@Component({
  selector: 'mf-error-page',
  imports: [Button, TitleIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="mf-error">
      <h1><mf-title-icon icon="pi pi-exclamation-triangle" />Something went wrong. Try again.</h1>
      <p-button label="Retry" icon="pi pi-refresh" (onClick)="retry()" />
    </main>
  `,
  styles: `
    .mf-error {
      max-width: 640px;
      margin: var(--mf-s7) auto;
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
