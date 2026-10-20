import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Badge, workflowStatusTone } from '../../../shared/ui/badge';
import { USED_BY_NOTE, UsedWorkflow } from './step-record';

/**
 * The Used by tab of the Step page (SE1, SE2, #404): every workflow version that contains the step, one 44 px line each, the line is a link
 * to the version page with its status badge (the page needs `Workflow.Manage`, like the Step page). The one muted sentence about published
 * workflows sits above the list and only when the step is used; an unused step says "Not used".
 */
@Component({
  selector: 'mf-step-used-by-tab',
  imports: [RouterLink, Badge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './step-tabs.scss',
  template: `
    <section class="st" aria-labelledby="st-used-h" data-used-tab>
      <h2 id="st-used-h" class="st__h">Used by</h2>
      @if (workflows().length === 0) {
        <p class="st__muted" data-not-used>Not used. No workflow contains this step yet.</p>
      } @else {
        <p class="st__muted st__note" data-used-note>{{ note }}</p>
        <ul class="ub" aria-labelledby="st-used-h" data-used-list>
          @for (w of workflows(); track w.workflowId) {
            @for (v of w.versions; track v.versionId) {
              <li class="ub__row" [attr.data-used-version]="v.versionId">
                <a
                  class="ub__link"
                  data-used-link
                  [routerLink]="['/admin/workflows', w.workflowId, 'versions', v.versionId]"
                  [attr.title]="v.label"
                  >{{ v.label }}</a
                >
                <span class="ub__badges">
                  <mf-badge [tone]="tone(v.status)" data-used-status>{{ v.status }}</mf-badge>
                  @if (w.active === false) {
                    <mf-badge data-used-inactive>Workflow inactive</mf-badge>
                  }
                </span>
              </li>
            }
          }
        </ul>
      }
    </section>
  `,
})
export class StepUsedByTab {
  readonly workflows = input.required<readonly UsedWorkflow[]>();
  protected readonly note = USED_BY_NOTE;
  protected readonly tone = workflowStatusTone;
}
