import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { PageHeader } from './page-header';

/** Stand-in screen for feature routes that later tickets implement. Title comes from route data. */
@Component({
  selector: 'mf-placeholder-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeader],
  template: `<mf-page-header [heading]="title" description="This screen is not built yet." />`,
})
export class PlaceholderPage {
  protected readonly title: string = inject(ActivatedRoute).snapshot.data['title'] ?? 'Coming soon';
}
