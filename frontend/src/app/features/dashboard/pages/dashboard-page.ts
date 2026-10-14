import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AuthStore } from '../../../core/auth/auth.store';

/** Empty Dashboard placeholder (S01 is built in a later ticket). */
@Component({
  selector: 'mf-dashboard-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Dashboard</h1>
    <p class="mf-muted">Welcome, {{ auth.displayName() }}. Your dashboard will appear here.</p>
  `,
  styles: `
    h1 {
      margin: 0 0 var(--mf-s2);
      font-size: var(--mf-fs-h1);
    }
    .mf-muted {
      color: var(--mf-text-muted);
    }
  `,
})
export class DashboardPage {
  protected readonly auth = inject(AuthStore);
}
