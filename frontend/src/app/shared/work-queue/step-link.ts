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

/** "Workflow progress: 2 of 5 done, current step Dedup. Open step." */
export function stepLinkLabel(row: Pick<TaskQueueRow, 'workflow'>): string {
  const w = row.workflow;
  return `Workflow progress: ${w.stepsResolved} of ${w.stepsTotal} done, current step ${w.currentStepName}. Open step.`;
}
