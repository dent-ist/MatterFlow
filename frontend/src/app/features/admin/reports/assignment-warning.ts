import { ChangeDetectionStrategy, Component } from '@angular/core';

/** The sentence every screen that assigns reports shows (issue #808, option A; the same line is in runbook section 11.4a). */
export const ASSIGNMENT_WARNING =
  'Reports show all matters, including sensitive ones. Assign a report only to roles you trust with every matter.';

/**
 * The one information banner of the screens that assign reports to roles: the report editor's Roles tab, a role's Reports tab and the Assignments
 * matrix (issue #808). A report runs as the read-only report login, which the sensitive-matter rule does not filter (option A), so who may run a
 * report is the only control. The shared `.pg-banner` in its information form, with its icon (D-53a); it has no action and no dismiss, because the
 * rule does not go away.
 */
@Component({
  selector: 'mf-report-assignment-warning',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pg-banner pg-banner--info" role="note" data-assignment-warning>
      <i class="pi pi-info-circle" aria-hidden="true"></i>
      <span>{{ text }}</span>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
  `,
})
export class ReportAssignmentWarning {
  protected readonly text = ASSIGNMENT_WARNING;
}
