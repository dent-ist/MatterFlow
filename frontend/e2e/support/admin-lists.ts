import { Api } from './api';

/** The three Administration lists (Task Types, Workflows, Workflow Steps) as the e2e specs of the Task Types review see them. */
export type ListKind = 'types' | 'workflows' | 'steps';

export interface ListKindInfo {
  /** The tab's address. */
  list: string;
  /** The name filter's address parameter. */
  filter: string;
  /** The sortable name header. */
  nameSort: string;
  /** The grid's column filter row. */
  row: string;
  /** What the record is called in the empty and error texts. */
  noun: string;
  /** The row's name link. */
  link: string;
}

export const LISTS: Record<ListKind, ListKindInfo> = {
  types: {
    list: '/admin/task-types',
    filter: 'name',
    nameSort: 'name',
    row: '#task-type-filter-row',
    noun: 'task types',
    link: 'a[href^="/admin/task-types/"]',
  },
  workflows: {
    list: '/admin/workflows',
    filter: 'name',
    nameSort: 'name',
    row: '#workflow-filter-row',
    noun: 'workflows',
    link: 'a[href^="/admin/workflows/"]',
  },
  steps: {
    list: '/admin/steps',
    filter: 'title',
    nameSort: 'title',
    row: '#step-filter-row',
    noun: 'steps',
    link: 'a[href^="/admin/steps/"]',
  },
};

export interface SeededRow {
  id: number;
  name: string;
  active: boolean;
}

/**
 * Creates `active` active and `inactive` deactivated records of a kind, all named `<token> <kind> NN` so a name filter on the token finds
 * exactly them (the active ones sort first by name).
 */
export async function seedMix(
  admin: Api,
  kind: ListKind,
  token: string,
  active: number,
  inactive: number,
  options: { eligible?: number[] } = {},
): Promise<SeededRow[]> {
  const rows: SeededRow[] = [];
  for (let i = 0; i < active + inactive; i++) {
    const isActive = i < active;
    const name = `${token} ${kind === 'steps' ? 'Step' : kind === 'workflows' ? 'Flow' : 'Type'} ${String(i).padStart(2, '0')}`;
    if (kind === 'types') {
      const eligible = options.eligible ?? [];
      const created = await admin.post('/api/v1/task-types', {
        name,
        description: null,
        isActive: true,
        eligibleWorkflowIds: eligible,
        defaultWorkflowDefinitionId: eligible[0] ?? null,
      });
      if (!isActive) {
        await admin.put(`/api/v1/task-types/${created.id}`, {
          name,
          description: null,
          iconKey: created.iconKey ?? null,
          isActive: false,
          eligibleWorkflowIds: eligible,
          defaultWorkflowDefinitionId: eligible[0] ?? null,
          rowVersion: created.rowVersion,
        });
      }
      rows.push({ id: created.id, name, active: isActive });
    } else if (kind === 'workflows') {
      const created = await admin.post('/api/v1/workflows', {
        name,
        description: null,
        isOrdered: true,
      });
      const id = created.workflow.workflowDefinitionId;
      if (!isActive) {
        await admin.put(`/api/v1/workflows/${id}`, {
          name,
          description: null,
          isActive: false,
          rowVersion: created.workflow.rowVersion,
        });
      }
      rows.push({ id, name, active: isActive });
    } else {
      const created = await admin.post('/api/v1/step-definitions', {
        title: name,
        description: null,
        instructions: null,
        tags: [],
      });
      if (!isActive) {
        await admin.post(`/api/v1/step-definitions/${created.stepDefinitionId}/deactivate`, {
          rowVersion: created.rowVersion,
        });
      }
      rows.push({ id: created.stepDefinitionId, name, active: isActive });
    }
  }
  return rows;
}
