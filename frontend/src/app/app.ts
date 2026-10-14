import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'mf-root',
  imports: [RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="mf-app-header">
      <h1>MatterFlow</h1>
    </header>
    <main class="mf-app-main">
      <router-outlet />
    </main>
  `,
  styles: `
    .mf-app-header {
      background: var(--mf-surface);
      border-bottom: 1px solid var(--mf-border);
      padding: 0.75rem 1.5rem;
    }
    .mf-app-header h1 {
      margin: 0;
      font-size: var(--mf-fs-h2);
    }
    .mf-app-main {
      padding: 1.5rem;
    }
  `,
})
export class App {}
