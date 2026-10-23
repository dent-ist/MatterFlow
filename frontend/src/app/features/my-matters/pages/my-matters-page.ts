import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PageHeader } from '../../../shared/ui/page-header';

/**
 * My Matters (epic #667): the Project Manager's home. This is the landing target and the route (#691); the page itself (filters, count
 * strip and panels) follows in #692 and the issues after it.
 */
@Component({
  selector: 'mf-my-matters-page',
  imports: [PageHeader, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-page-header
      heading="My Matters"
      description="The matters you manage as primary or secondary project manager."
    />
    <p data-no-matters>You are not the project manager of any matter yet.</p>
    <a routerLink="/my-work">Go to My Work</a>
  `,
})
export class MyMattersPage {}
