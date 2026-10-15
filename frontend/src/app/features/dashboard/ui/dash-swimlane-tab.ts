import { ChangeDetectionStrategy, Component } from '@angular/core';

/** Dashboard > Swimlane tab. Skeleton registered early (#72); the board replaces this body. */
@Component({
  selector: 'mf-dash-swimlane-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<p data-swimlane-loading>Loading the swimlane board.</p>`,
})
export class DashSwimlaneTab {}
