import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

/** Stand-in screen for feature routes that later tickets implement. Title comes from route data. */
@Component({
  selector: 'mf-placeholder-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>{{ title }}</h1>
    <p class="mf-muted">This screen is not built yet.</p>
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
export class PlaceholderPage {
  protected readonly title: string = inject(ActivatedRoute).snapshot.data['title'] ?? 'Coming soon';
}
