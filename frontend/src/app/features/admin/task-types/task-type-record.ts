import { FormVersionStatus } from '../../../api/generated/api-client';
import { WorkflowOption } from '../../../core/lookups/workflow-lookup';
import { OPEN_STATUSES } from '../../../shared/work-queue/queue-filters';
import { WorkStripItem } from '../../../shared/work-queue/work-strip';
import { firstAllowedTab } from '../denial';
import { TaskTypeView } from './task-types-api';

/** The three tabs of the Task Type page; `overview` is the default and is not written to the address. */
export type TaskTypeTab = 'overview' | 'workflows' | 'form';

export const TASK_TYPE_TAB_LABEL: Readonly<Record<TaskTypeTab, string>> = {
  overview: 'Overview',
  workflows: 'Workflows',
  form: 'Request form',
};

/** Why the Request form tab cannot be opened on a type that is not saved yet (TE9, the "disabled with a reason" case). */
export const FORM_TAB_REASON = 'Save the task type first';

/** The tab `?tab=` names; anything else, and the Request form tab of an unsaved type, is Overview. */
export function tabOf(raw: string | null | undefined, isNew: boolean): TaskTypeTab {
  return firstAllowedTab<TaskTypeTab>(
    raw,
    isNew ? ['overview', 'workflows'] : ['overview', 'workflows', 'form'],
  );
}

/** The header badge: Inactive and Not usable are neutral (derived states, never red), Active is green. Nothing for an unsaved type. */
export function statusBadgeOf(t: Pick<TaskTypeView, 'isActive' | 'isUsable'>): {
  label: string;
  tone: 'neutral' | 'success';
  icon: string;
} {
  if (!t.isActive) return { label: 'Inactive', tone: 'neutral', icon: 'pi-minus-circle' };
  if (!t.isUsable) return { label: 'Not usable', tone: 'neutral', icon: 'pi-info-circle' };
  return { label: 'Active', tone: 'success', icon: 'pi-check-circle' };
}

/** Whether the workflow counts as one of the type's records: a deactivated workflow does not (tab counts show active records). */
export function isActiveWorkflow(w: WorkflowOption | undefined): boolean {
  return w === undefined || w.isActive !== false;
}

/** The number on the Workflows tab: eligible workflows that are active; an id the lookup does not know counts (it is only unknown, not inactive). */
export function activeWorkflowCount(
  eligible: readonly number[],
  workflows: readonly WorkflowOption[],
): number {
  const byId = new Map(workflows.map((w) => [w.id, w]));
  return eligible.filter((id) => isActiveWorkflow(byId.get(id))).length;
}

/** The short form state of the strip and the header: `Published v1`, `Draft v2`, `Retired`, `No form`. */
export function formStateOf(t: TaskTypeView): string {
  switch (t.formStatus) {
    case FormVersionStatus.Published:
      return `Published v${t.publishedFormVersionNo}`;
    case FormVersionStatus.Draft:
      return `Draft v${t.draftFormVersionNo}`;
    case FormVersionStatus.Retired:
      return 'Retired';
    default:
      return 'No form';
  }
}

/** The name of the default workflow, or `None`; an id the lookup does not know reads `Workflow n`. */
export function defaultWorkflowName(
  t: Pick<TaskTypeView, 'defaultWorkflowDefinitionId'>,
  workflows: readonly WorkflowOption[],
): string {
  const id = t.defaultWorkflowDefinitionId;
  if (id === undefined || id === null) return 'None';
  return workflows.find((w) => w.id === id)?.name ?? `Workflow ${id}`;
}

/**
 * The summary strip under the header (TE1): Form, Workflows, Default workflow, Open tasks (a link into the Task Queue scoped to the type)
 * and Status. Open tasks is absent for a viewer without `Task.View` (the API sends `null`, so the strip shows no made-up number).
 */
export function taskTypeStripItems(
  t: TaskTypeView,
  workflows: readonly WorkflowOption[],
): WorkStripItem[] {
  const status = statusBadgeOf(t).label;
  const def = defaultWorkflowName(t, workflows);
  const items: WorkStripItem[] = [
    { key: 'form', label: 'Form', count: null, value: formStateOf(t), hint: 'Request form' },
    {
      key: 'workflows',
      label: 'Workflows',
      count: activeWorkflowCount(t.eligibleWorkflowIds, workflows),
      hint: 'Active workflows people can choose for this type',
    },
    {
      key: 'default',
      label: 'Default workflow',
      count: null,
      value: def,
      hint: `Default workflow: ${def}`,
    },
  ];
  if (t.openTaskCount !== undefined && t.openTaskCount !== null) {
    items.push({
      key: 'open',
      label: 'Open tasks',
      count: t.openTaskCount,
      hint: 'Open tasks of this type in the Task Queue',
      link: { path: '/tasks', queryParams: { type: String(t.id), status: [...OPEN_STATUSES] } },
    });
  }
  items.push({ key: 'status', label: 'Status', count: null, value: status, hint: status });
  return items;
}

/** What fixes one reason of the status note: a route, or an action of the page. */
export type NoteFix = 'activate' | 'form' | 'workflows';

export interface NoteReason {
  code: string;
  /** The sentence, ending in a full stop. */
  text: string;
  /** The words of the fix link, for example `Open the form`. */
  fixLabel: string;
  fix: NoteFix;
}

/**
 * The reasons a type cannot be used for new tasks, in the order the API lists them, each with the words of its fix (TE3). Empty for a
 * usable type, so the note is absent. A code the page does not know is shown as it is, without a fix.
 */
export function noteReasonsOf(t: Pick<TaskTypeView, 'isUsable' | 'usabilityIssues'>): NoteReason[] {
  if (t.isUsable) return [];
  return t.usabilityIssues.map((code): NoteReason => {
    switch (code) {
      case 'INACTIVE':
        return {
          code,
          text: 'The task type is inactive.',
          fixLabel: 'Activate it',
          fix: 'activate',
        };
      case 'FORM_NOT_PUBLISHED':
        return {
          code,
          text: "The request form isn't published.",
          fixLabel: 'Open the form',
          fix: 'form',
        };
      case 'NO_ELIGIBLE_WORKFLOW':
        return {
          code,
          text: 'No eligible published workflow.',
          fixLabel: 'Add one',
          fix: 'workflows',
        };
      default:
        return { code, text: code, fixLabel: '', fix: 'workflows' };
    }
  });
}

/** The words for the Request form tab (TE4): what is published, what is in progress, or that there is no form yet. */
export interface FormTabFacts {
  published: { versionNo: number; fields: number | null; at: string | null } | null;
  draftVersionNo: number | null;
  retired: boolean;
}

export function formTabFacts(
  t: TaskTypeView,
  versions:
    | readonly { status: string; versionNo: number; fieldCount?: number; publishedAtUtc?: string }[]
    | null,
): FormTabFacts {
  const pub = versions?.find((v) => v.status === 'PUBLISHED') ?? null;
  return {
    published:
      t.formStatus === FormVersionStatus.Published || t.publishedFormVersionNo
        ? {
            versionNo: t.publishedFormVersionNo ?? pub?.versionNo ?? 0,
            fields: pub?.fieldCount ?? null,
            at: pub?.publishedAtUtc ?? null,
          }
        : null,
    draftVersionNo: t.draftFormVersionNo ?? null,
    retired: t.formStatus === FormVersionStatus.Retired,
  };
}
