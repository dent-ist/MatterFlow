import {
  FormFieldModel,
  FormVersionStatus,
  FormVersionSummary,
  StepDefinitionDetail,
  StepUsage,
  WorkflowVersionStatus,
} from '../../../api/generated/api-client';
import { WorkStripItem } from '../../../shared/work-queue/work-strip';
import { firstAllowedTab } from '../denial';

/** The three tabs of the Step page; `details` is the default and is not written to the address. */
export type StepTab = 'details' | 'inputs' | 'used-by';

export const STEP_TAB_LABEL: Readonly<Record<StepTab, string>> = {
  details: 'Details',
  inputs: 'Inputs',
  'used-by': 'Used by',
};

/** Why the Inputs and Used by tabs cannot be opened on a step that is not saved yet. */
export const STEP_TAB_REASON = 'Save the step first';

/** The tab `?tab=` names; anything else, and the tabs of an unsaved step, is Details. */
export function stepTabOf(raw: string | null | undefined, isNew: boolean): StepTab {
  return firstAllowedTab<StepTab>(raw, isNew ? ['details'] : ['details', 'inputs', 'used-by']);
}

/** The muted sentence at the top of Used by (SE2): shown in full only when the step is used. */
export const USED_BY_NOTE =
  "Editing this step doesn't change workflows that are already published. Workflows pick up changes only when you publish a new workflow version.";

/** The inputs sentence of a step whose inputs are still a draft. */
export const DRAFT_INPUTS_NOTE = 'Publish them before this step can be published in a workflow.';

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export interface UsedVersion {
  versionId: number;
  versionNo: number;
  status: 'Draft' | 'Published' | 'Retired';
  /** The link text: `Standard Processing v2`. */
  label: string;
}

export interface UsedWorkflow {
  workflowId: number;
  name: string;
  /** False for a deactivated workflow; null when it is not known (the workflow list could not be read). */
  active: boolean | null;
  versions: UsedVersion[];
}

const STATUS: Record<WorkflowVersionStatus, UsedVersion['status']> = {
  [WorkflowVersionStatus.Draft]: 'Draft',
  [WorkflowVersionStatus.Published]: 'Published',
  [WorkflowVersionStatus.Retired]: 'Retired',
};

/** Every version that contains the step, grouped by workflow in the order the API sent them (workflow name, newest version first). */
export function usedByWorkflows(
  usage: readonly StepUsage[],
  active: ReadonlyMap<number, boolean> | null,
): UsedWorkflow[] {
  const groups = new Map<number, UsedWorkflow>();
  for (const u of usage) {
    let g = groups.get(u.workflowDefinitionId);
    if (!g) {
      g = {
        workflowId: u.workflowDefinitionId,
        name: u.workflowName,
        active: active?.get(u.workflowDefinitionId) ?? null,
        versions: [],
      };
      groups.set(u.workflowDefinitionId, g);
    }
    g.versions.push({
      versionId: u.workflowVersionId,
      versionNo: u.versionNo,
      status: STATUS[u.status] ?? 'Draft',
      label: `${u.workflowName} v${u.versionNo}`,
    });
  }
  return [...groups.values()];
}

/** The number on the Used by tab and in the strip: workflows that use the step. A workflow known to be deactivated is not counted. */
export function usedWorkflowCount(groups: readonly UsedWorkflow[]): number {
  return groups.filter((g) => g.active !== false).length;
}

/** Workflow drafts and published versions that contain the step: the numbers of the Deactivate dialog (the API sent them with the step). */
export function usageCounts(usage: readonly StepUsage[]): { drafts: number; published: number } {
  return {
    drafts: usage.filter((u) => u.status === WorkflowVersionStatus.Draft).length,
    published: usage.filter((u) => u.status === WorkflowVersionStatus.Published).length,
  };
}

/** What the Inputs tab and the strip say about the step's inputs. */
export interface InputsFacts {
  state: 'none' | 'draft' | 'published' | 'both';
  /** Version numbers and field counts, known once the versions of the form were read. */
  published: { versionNo: number; fieldCount: number } | null;
  draft: { versionNo: number; fieldCount: number } | null;
}

/**
 * Published / Draft state of the inputs. The detail says whether a version is published (`publishedFormVersionId`) and how many fields the
 * open draft has (`draftFormFieldCount`; a draft without fields is the same as no inputs); the versions of the form, when they could be read,
 * add the version numbers and the published field count.
 */
export function inputsFacts(
  step: Pick<StepDefinitionDetail, 'publishedFormVersionId' | 'draftFormFieldCount'>,
  versions: readonly FormVersionSummary[] | null,
): InputsFacts {
  const hasPublished =
    step.publishedFormVersionId !== undefined && step.publishedFormVersionId !== null;
  const hasDraft = step.draftFormFieldCount > 0;
  const pub = versions?.find((v) => v.status === FormVersionStatus.Published) ?? null;
  const draft = versions?.find((v) => v.status === FormVersionStatus.Draft) ?? null;
  return {
    state: hasPublished ? (hasDraft ? 'both' : 'published') : hasDraft ? 'draft' : 'none',
    published:
      hasPublished && pub ? { versionNo: pub.versionNo, fieldCount: pub.fieldCount } : null,
    draft: hasDraft
      ? { versionNo: draft?.versionNo ?? 0, fieldCount: step.draftFormFieldCount }
      : null,
  };
}

/** The Inputs value of the strip: `None`, `3 inputs`, `Draft, 2 inputs`, or only the state when the count is not known. */
export function inputsStripValue(f: InputsFacts): string {
  const n = (c: number): string => plural(c, 'input', 'inputs');
  switch (f.state) {
    case 'none':
      return 'None';
    case 'draft':
      return `Draft, ${n(f.draft!.fieldCount)}`;
    case 'published':
    case 'both': {
      const base = f.published ? n(f.published.fieldCount) : 'Published';
      return f.state === 'both' ? `${base}, newer draft` : base;
    }
  }
}

/**
 * The summary strip under the header (SE5): Status, Used in n workflows, Inputs and Tags. The workflow count is `null` while it is unknown.
 */
export function stepStripItems(
  step: StepDefinitionDetail,
  used: number | null,
  facts: InputsFacts,
): WorkStripItem[] {
  const status = step.isActive ? 'Active' : 'Inactive';
  const inputs = inputsStripValue(facts);
  const tags = step.tags.length > 0 ? step.tags.join(', ') : 'None';
  return [
    { key: 'status', label: 'Status', count: null, value: status, hint: status },
    used === 0
      ? {
          key: 'used',
          label: 'Used in workflows',
          count: null,
          value: 'Not used',
          hint: 'No workflow uses this step',
        }
      : {
          key: 'used',
          label: 'Used in workflows',
          count: used,
          hint:
            used === null
              ? 'Workflows that use this step'
              : `Used in ${plural(used, 'workflow', 'workflows')}`,
        },
    { key: 'inputs', label: 'Inputs', count: null, value: inputs, hint: `Inputs: ${inputs}` },
    { key: 'tags', label: 'Tags', count: null, value: tags, hint: `Tags: ${tags}` },
  ];
}

export interface InputRow {
  key: string;
  label: string;
  required: boolean;
  control: string;
}

/** The rows of the read-only field list, in form order. */
export function inputRows(fields: readonly FormFieldModel[]): InputRow[] {
  return fields.map((f) => ({
    key: f.key,
    label: f.label,
    control: f.control,
    required: f.required === true,
  }));
}
