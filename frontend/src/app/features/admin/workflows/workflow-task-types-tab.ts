import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { WorkflowTaskTypeRef } from '../../../api/generated/api-client';
import { Badge } from '../../../shared/ui/badge';

/**
 * The Task types tab of the Workflow page (WE2, #389): the task types that offer this workflow, from `taskTypes` of `GET /workflows/{id}`
 * (no new request). Each row has the name (a link to the Task Type page with `TaskType.Manage`, plain text without it), a Default marker when
 * this is the type's default workflow and the Active or Inactive state. The tab count is the active ones; inactive types are listed after
 * them and said so. None: "No task type uses this workflow."
 */
@Component({
  selector: 'mf-workflow-task-types-tab',
  imports: [RouterLink, Badge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './workflow-task-types-tab.scss',
  template: `
    <section class="wt" aria-labelledby="wt-heading" data-task-types-tab>
      <div class="wt__head">
        <h2 id="wt-heading" class="wt__title">Task types</h2>
        <p class="wt__help" data-summary-line>{{ summary() }}</p>
      </div>
      @if (rows().length === 0) {
        <p class="wt__empty" data-no-task-types>No task type uses this workflow.</p>
      } @else {
        <ul class="wt__list" aria-label="Task types that use this workflow" data-task-type-list>
          @for (t of rows(); track t.taskTypeId) {
            <li class="wt__row" [attr.data-task-type]="t.taskTypeId">
              @if (canOpen()) {
                <a
                  class="pg-link wt__name"
                  [routerLink]="['/admin/task-types', t.taskTypeId]"
                  [attr.title]="t.name"
                  >{{ t.name }}</a
                >
              } @else {
                <span class="wt__name" [attr.title]="t.name">{{ t.name }}</span>
              }
              <span class="wt__badges">
                @if (t.isDefault) {
                  <mf-badge tone="info" icon="pi-star" data-default>Default workflow</mf-badge>
                }
                @if (t.isActive) {
                  <mf-badge tone="success" icon="pi-check-circle">Active</mf-badge>
                } @else {
                  <mf-badge tone="neutral" icon="pi-minus-circle">Inactive</mf-badge>
                }
              </span>
            </li>
          }
        </ul>
      }
    </section>
  `,
})
export class WorkflowTaskTypesTab {
  readonly taskTypes = input.required<readonly WorkflowTaskTypeRef[]>();
  /** `TaskType.Manage`: the names are links. */
  readonly canOpen = input(false);

  /** Active types first, then inactive ones, each by name. */
  protected readonly rows = computed(() =>
    [...this.taskTypes()].sort(
      (a, b) => Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name),
    ),
  );

  protected readonly summary = computed(() => {
    const all = this.taskTypes();
    if (all.length === 0) return 'Task types offer a workflow on their own Workflows tab.';
    const active = all.filter((t) => t.isActive).length;
    const inactive = all.length - active;
    const plural = (n: number) => `${n} task ${n === 1 ? 'type' : 'types'}`;
    return inactive > 0
      ? `${plural(active)} active use this workflow. ${inactive} inactive ${inactive === 1 ? 'is' : 'are'} listed and not counted.`
      : `${plural(active)} use${active === 1 ? 's' : ''} this workflow.`;
  });
}
