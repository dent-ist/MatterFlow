import { Params } from '@angular/router';
import { TaskQueueRow } from '../../api/generated/api-client';

/** The query string that opens a Task on its Workflow section with one step expanded and focused (`?tab=workflow&step=<id>`). */
export function stepQueryParams(stepInstanceId: number): Params {
  return { tab: 'workflow', step: stepInstanceId };
}

/** True when the row's current step can be a link: an open task whose workflow names an unresolved step (Closed tasks show plain text). */
export function hasStepLink(row: Pick<TaskQueueRow, 'status' | 'workflow'>): boolean {
  return (
    row.status !== 'COMPLETED' &&
    row.status !== 'CANCELLED' &&
    row.workflow.currentStepId != null &&
    !!row.workflow.currentStepName
  );
}

/** "2 of 5 steps done. Current step: Dedup. Open step." (the visible text is only "2 of 5") */
export function stepLinkLabel(row: Pick<TaskQueueRow, 'workflow'>): string {
  const w = row.workflow;
  return `${w.stepsResolved} of ${w.stepsTotal} steps done. Current step: ${w.currentStepName}. Open step.`;
}
