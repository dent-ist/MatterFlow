import {
  WorkflowDetail,
  WorkflowTaskTypeRef,
  WorkflowVersionStatus,
  WorkflowVersionSummary,
} from '../../../api/generated/api-client';
import { OPEN_STATUSES } from '../../../shared/work-queue/queue-filters';
import { WorkStripItem } from '../../../shared/work-queue/work-strip';
import { BadgeTone } from '../../../shared/ui/badge';
import { MfTab } from '../../../shared/ui/tabs';
import { firstAllowedTab } from '../denial';

/** The three tabs of the Workflow page (WE1, #388). Overview is the default and is not written to the address. */
export type WorkflowTab = 'overview' | 'versions' | 'task-types';

export const WORKFLOW_TAB_LABEL: Readonly<Record<WorkflowTab, string>> = {
  overview: 'Overview',
  versions: 'Versions',
  'task-types': 'Task types',
};

/** The tab `?tab=` names; anything else is Overview. */
export function workflowTabOf(raw: string | null | undefined): WorkflowTab {
  return firstAllowedTab<WorkflowTab>(raw, ['overview', 'versions', 'task-types']);
}

/** The task types of the workflow that count: tab counts show active records (decision PM). */
export function activeTaskTypes(d: Pick<WorkflowDetail, 'workflow'>): WorkflowTaskTypeRef[] {
  return d.workflow.taskTypes.filter((t) => t.isActive);
}

/** The tab strip with the live counts: versions are all the history, task types the active ones. */
export function workflowTabs(d: WorkflowDetail | null): MfTab[] {
  return [
    { key: 'overview', label: WORKFLOW_TAB_LABEL.overview },
    { key: 'versions', label: WORKFLOW_TAB_LABEL.versions, count: d ? d.versions.length : '--' },
    {
      key: 'task-types',
      label: WORKFLOW_TAB_LABEL['task-types'],
      count: d ? activeTaskTypes(d).length : '--',
    },
  ];
}

export interface WorkflowBadge {
  label: string;
  tone: BadgeTone;
  icon?: string;
}

/** The state badges next to the Active badge of the header: Published vN (or Not published) and Draft vN in progress. */
export function workflowStateBadges(w: WorkflowDetail['workflow']): WorkflowBadge[] {
  const list: WorkflowBadge[] = [];
  list.push(
    w.publishedVersionNo
      ? { label: `Published v${w.publishedVersionNo}`, tone: 'success', icon: 'pi-check-circle' }
      : { label: 'Not published', tone: 'neutral' },
  );
  if (w.draftVersionNo) {
    list.push({
      label: `Draft v${w.draftVersionNo} in progress`,
      tone: 'warning',
      icon: 'pi-pencil',
    });
  }
  return list;
}

/** The published version of the workflow, if any. */
export function publishedVersionOf(d: WorkflowDetail): WorkflowVersionSummary | undefined {
  return d.versions.find((v) => v.workflowVersionId === d.workflow.publishedVersionId);
}

/**
 * Open tasks running on the published version, as the API counted them; `null` when the API sent none (no `Task.View`) or there is no
 * published version. A number the API did not return is never shown (decision PM).
 */
export function openTasksOnPublished(d: WorkflowDetail): number | null {
  const n = publishedVersionOf(d)?.openTaskCount;
  return typeof n === 'number' ? n : null;
}

/** The open tasks of all versions together (the sum the Versions tab's Tasks column adds up to), or null when any is unknown. */
export function openTasksOnWorkflow(d: WorkflowDetail): number | null {
  let sum = 0;
  for (const v of d.versions) {
    if (v.status === WorkflowVersionStatus.Draft) continue;
    if (typeof v.openTaskCount !== 'number') return null;
    sum += v.openTaskCount;
  }
  return sum;
}

/**
 * The summary strip under the header (WE1): Published, Draft, Steps, Task types and Open tasks on the published version (a link into the Task
 * Queue scoped to the workflow). Open tasks is absent for a viewer without `Task.View` (the API sends no number, so the strip shows none).
 */
export function workflowStripItems(d: WorkflowDetail, canSeeTasks: boolean): WorkStripItem[] {
  const w = d.workflow;
  const published = publishedVersionOf(d);
  const items: WorkStripItem[] = [
    {
      key: 'published',
      label: 'Published',
      count: null,
      value: w.publishedVersionNo ? `v${w.publishedVersionNo}` : 'None',
    },
    {
      key: 'draft',
      label: 'Draft',
      count: null,
      value: w.draftVersionNo ? `v${w.draftVersionNo}` : 'None',
    },
    {
      key: 'steps',
      label: 'Steps',
      count: published?.stepCount ?? w.publishedStepCount ?? null,
      hint: w.publishedVersionNo
        ? `Steps in the published version, v${w.publishedVersionNo}`
        : 'This workflow has no published version',
    },
    {
      key: 'task-types',
      label: 'Task types',
      count: activeTaskTypes(d).length,
      hint: 'Active task types that offer this workflow',
    },
  ];
  const open = openTasksOnPublished(d);
  if (canSeeTasks && open !== null) {
    items.push({
      key: 'open-tasks',
      label: 'Open tasks',
      count: open,
      hint: w.publishedVersionNo
        ? `Open tasks running on the published version, v${w.publishedVersionNo}`
        : 'Open tasks',
      // The Task Queue has no per-version filter: the link is offered only when every open task of the workflow runs on the published version.
      ...(openTasksOnWorkflow(d) === open
        ? {
            link: {
              path: '/tasks',
              queryParams: { workflow: w.workflowDefinitionId, status: [...OPEN_STATUSES] },
            },
          }
        : {}),
    });
  }
  return items;
}

/** The sentence that stands for the creator of a version when the API has no name (old versions). */
export function createdByLabel(v: Pick<WorkflowVersionSummary, 'createdByName'>): string {
  return v.createdByName?.trim() ? v.createdByName : '';
}
