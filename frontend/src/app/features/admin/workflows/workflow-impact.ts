import { firstValueFrom } from 'rxjs';
import { TaskTypeView, TaskTypesClient } from '../../../api/generated/api-client';
import { WorkflowLookup, WorkflowOption } from '../../../core/lookups/workflow-lookup';

/**
 * The active task types for which `workflowId` is the only published workflow they have (decision PM of #400: "Not usable" is derived,
 * it is not a stored state). `taskTypes` are the types that offer the workflow (`GET /task-types?workflowId=`), `workflows` every workflow with
 * its published version, so another eligible workflow counts only when it is active and published. A retirement leaves these types without
 * a workflow; the first publication of this workflow gives them one.
 */
export function onlyWorkflowOf(
  workflowId: number,
  taskTypes: readonly Pick<TaskTypeView, 'name' | 'isActive' | 'eligibleWorkflowIds'>[],
  workflows: readonly WorkflowOption[],
): string[] {
  const ready = new Set(
    workflows.filter((w) => w.isActive !== false && !!w.publishedVersionNo).map((w) => w.id),
  );
  return taskTypes
    .filter(
      (t) => t.isActive && !t.eligibleWorkflowIds.some((id) => id !== workflowId && ready.has(id)),
    )
    .map((t) => t.name)
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Reads what `onlyWorkflowOf` needs (the task types of the workflow and every workflow with its published version; two requests) and
 * answers with the names, or null when a request fails. The caller asks only with `Task.View`, which the task type endpoints need.
 */
export async function dependentTaskTypes(
  taskTypes: TaskTypesClient,
  lookup: WorkflowLookup,
  workflowId: number,
): Promise<string[] | null> {
  try {
    const [types, workflows] = await Promise.all([
      firstValueFrom(taskTypes.listTaskTypes(workflowId)),
      firstValueFrom(lookup.list()),
    ]);
    return onlyWorkflowOf(workflowId, types, workflows);
  } catch {
    return null;
  }
}
