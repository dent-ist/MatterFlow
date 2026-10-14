import { Api, Json } from './api';

let counter = 0;

/** Short unique token for names (client names, titles, user names...), unique across workers and runs. */
export function uid(): string {
  counter += 1;
  return `${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 5)}${counter}`;
}

export interface StepSpec {
  /** Reuse an existing step definition, or create one with this title (default "Step <n>"). */
  stepDefinitionId?: number;
  title?: string;
  instructions?: string;
  /** Adds a required text input `result` to the step, so completing it needs a value. */
  requiredInput?: boolean;
  isSkippable?: boolean;
  skipCommentRequired?: boolean;
}

export interface FieldSpec {
  key: string;
  label: string;
  control: string;
  required?: boolean;
  helpText?: string | null;
  showWhen?: Json;
  requiredWhen?: Json;
  options?: { key: string; label: string }[];
}

export interface WorkflowResult {
  workflowDefinitionId: number;
  name: string;
  versionId: number;
  stepTitles: string[];
}

export interface TaskTypeResult {
  id: number;
  name: string;
  workflowIds: number[];
}

/** A client + matter + task type + workflow, the minimum most task tests need. */
export interface World {
  client: Json;
  matter: Json;
  taskType: TaskTypeResult;
  workflow: WorkflowResult;
}

/**
 * Test-support seeding on top of the admin API. Every builder creates its own uniquely named records, so tests never share
 * mutable state and can run in any order and in parallel. The UI is never used for setup.
 */
export class Seeder {
  private roleIds?: Map<string, number>;

  constructor(readonly admin: Api) {}

  // --- numbering -------------------------------------------------------------------------------------------------

  /** A five digit client number nobody uses yet. `short` returns one below 10000, whose padded form starts with 0. */
  async freeClientNumber(short = false): Promise<string> {
    for (let i = 0; i < 50; i++) {
      const n = short
        ? 100 + Math.floor(Math.random() * 9800)
        : 10000 + Math.floor(Math.random() * 89999);
      const padded = String(n).padStart(5, '0');
      const found = await this.admin.get<Json>(`/api/v1/clients?q=${padded}`);
      if (!found.items.some((c: Json) => c.clientNumber === padded)) return padded;
    }
    throw new Error('Could not find a free client number');
  }

  // --- organization ----------------------------------------------------------------------------------------------

  async client(opts: { number?: string; name?: string } = {}): Promise<Json> {
    const clientNumber = opts.number ?? (await this.freeClientNumber());
    return this.admin.post('/api/v1/clients', {
      clientNumber,
      name: opts.name ?? `E2E Client ${uid()}`,
    });
  }

  async matter(
    opts: { client?: Json; number?: string; name?: string; sensitive?: boolean } = {},
  ): Promise<Json> {
    const client = opts.client ?? (await this.client());
    return this.admin.post('/api/v1/matters', {
      clientId: client.clientId,
      matterNumber: opts.number ?? '00001',
      name: opts.name ?? `E2E Matter ${uid()}`,
      isSensitive: opts.sensitive ?? false,
    });
  }

  async project(matter: Json, name?: string): Promise<Json> {
    return this.admin.post('/api/v1/projects', {
      matterId: matter.matterId,
      name: name ?? `E2E Project ${uid()}`,
    });
  }

  // --- people ------------------------------------------------------------------------------------------------------

  private async roleId(name: string): Promise<number> {
    if (!this.roleIds) {
      const roles = await this.admin.get<Json[]>('/api/v1/roles');
      this.roleIds = new Map(roles.map((r) => [r.name, r.roleId]));
    }
    const id = this.roleIds.get(name);
    if (id === undefined) throw new Error(`Unknown role "${name}"`);
    return id;
  }

  /** Creates a custom role with exactly these permission codes. */
  async role(permissionCodes: string[], label = 'E2E role'): Promise<Json> {
    const role = await this.admin.post('/api/v1/roles', {
      name: `${label} ${uid()}`,
      description: null,
      permissionCodes,
    });
    this.roleIds?.set(role.name, role.roleId);
    return role;
  }

  /**
   * Provisions a Dev-auth user the way a first sign-in does, then grants the roles (none leaves the user in Access Pending).
   * Returns the account name to use as `X-Dev-User`.
   */
  async user(roleNames: string[], label = 'user'): Promise<{ username: string; userId: number }> {
    const username = `ke\\e2e-${label}-${uid()}`;
    const other = await Api.as(username);
    try {
      await other.get('/api/v1/me');
    } finally {
      await other.dispose();
    }
    const found = await this.admin.get<Json>(
      `/api/v1/users?status=all&search=${encodeURIComponent(username)}`,
    );
    const summary = found.items.find(
      (u: Json) => u.windowsAccount.toLowerCase() === username.toLowerCase(),
    );
    if (!summary) throw new Error(`User ${username} was not provisioned`);
    if (roleNames.length > 0) await this.grantRoles(summary.userId, roleNames);
    return { username, userId: summary.userId };
  }

  async grantRoles(userId: number, roleNames: string[]): Promise<void> {
    const ids: number[] = [];
    for (const name of roleNames) ids.push(await this.roleId(name));
    const detail = await this.admin.get<Json>(`/api/v1/users/${userId}`);
    await this.admin.put(`/api/v1/users/${userId}/roles`, {
      roleIds: ids,
      rowVersion: detail.rowVersion,
    });
  }

  async pod(name: string | undefined, memberUserIds: number[]): Promise<Json> {
    const pod = await this.admin.post('/api/v1/pods', { name: name ?? `E2E Pod ${uid()}` });
    if (memberUserIds.length > 0) {
      await this.admin.post(`/api/v1/pods/${pod.podId}/members`, { userIds: memberUserIds });
    }
    return pod;
  }

  // --- forms, steps, workflows, task types -----------------------------------------------------------------------

  /** Saves and publishes version 1 of the form of a definition that already exists (task types and steps create theirs). */
  async publishForm(formDefinitionId: number, fields: FieldSpec[]): Promise<Json> {
    const draft = await this.admin.post(`/api/v1/forms/${formDefinitionId}/versions`);
    const saved = await this.admin.put(
      `/api/v1/forms/${formDefinitionId}/versions/${draft.version.formVersionId}`,
      { fields, rowVersion: draft.version.rowVersion },
    );
    return this.admin.post(
      `/api/v1/forms/${formDefinitionId}/versions/${saved.version.formVersionId}/publish?rowVersion=${encodeURIComponent(saved.version.rowVersion)}`,
    );
  }

  async step(spec: StepSpec = {}): Promise<number> {
    if (spec.stepDefinitionId) return spec.stepDefinitionId;
    const created = await this.admin.post('/api/v1/step-definitions', {
      title: spec.title ?? `E2E step ${uid()}`,
      description: null,
      instructions: spec.instructions ?? null,
    });
    if (spec.requiredInput) {
      await this.publishForm(created.formDefinitionId, [
        { key: 'result', label: 'Result', control: 'TEXT', required: true },
      ]);
    }
    return created.stepDefinitionId;
  }

  /** Creates and publishes a workflow (version 1) from step specs. */
  async workflow(
    opts: { name?: string; ordered?: boolean; steps?: StepSpec[]; stepCount?: number } = {},
  ): Promise<WorkflowResult> {
    const name = opts.name ?? `E2E Workflow ${uid()}`;
    const specs: StepSpec[] =
      opts.steps ??
      Array.from({ length: opts.stepCount ?? 3 }, (_, i) => ({ title: `Step ${i + 1}` }));
    const placements: Json[] = [];
    const titles: string[] = [];
    for (const spec of specs) {
      const title = `${spec.title ?? 'Step'} ${uid()}`; // step titles are unique among active steps
      const id = await this.step({ ...spec, title });
      titles.push(title);
      placements.push({
        sourceStepDefinitionId: id,
        isSkippable: spec.isSkippable ?? false,
        skipCommentRequired: spec.skipCommentRequired ?? false,
      });
    }
    const created = await this.admin.post('/api/v1/workflows', {
      name,
      description: null,
      isOrdered: opts.ordered ?? true,
    });
    const version = created.versions[0];
    const saved = await this.admin.put(
      `/api/v1/workflows/${created.workflow.workflowDefinitionId}/versions/${version.workflowVersionId}`,
      { isOrdered: opts.ordered ?? true, steps: placements, rowVersion: version.rowVersion },
    );
    await this.admin.post(
      `/api/v1/workflows/${created.workflow.workflowDefinitionId}/versions/${version.workflowVersionId}/publish`,
      { rowVersion: saved.version.rowVersion },
    );
    return {
      workflowDefinitionId: created.workflow.workflowDefinitionId,
      name,
      versionId: version.workflowVersionId,
      stepTitles: titles,
    };
  }

  async taskType(opts: {
    name?: string;
    workflows: WorkflowResult[];
    defaultIndex?: number;
    fields?: FieldSpec[];
  }): Promise<TaskTypeResult> {
    const name = opts.name ?? `E2E Type ${uid()}`;
    const ids = opts.workflows.map((w) => w.workflowDefinitionId);
    const created = await this.admin.post('/api/v1/task-types', {
      name,
      description: null,
      isActive: true,
      eligibleWorkflowIds: ids,
      defaultWorkflowDefinitionId: ids[opts.defaultIndex ?? 0],
    });
    if (opts.fields && opts.fields.length > 0) {
      await this.publishForm(created.formDefinitionId, opts.fields);
    }
    return { id: created.id, name, workflowIds: ids };
  }

  /** One ordered 3-step workflow wrapped in a task type, with a client and matter: enough to create tasks. */
  async world(
    opts: {
      stepCount?: number;
      ordered?: boolean;
      steps?: StepSpec[];
      sensitive?: boolean;
      fields?: FieldSpec[];
    } = {},
  ): Promise<World> {
    const client = await this.client();
    const matter = await this.matter({ client, sensitive: opts.sensitive });
    const workflow = await this.workflow({
      stepCount: opts.stepCount,
      ordered: opts.ordered,
      steps: opts.steps,
    });
    const taskType = await this.taskType({ workflows: [workflow], fields: opts.fields });
    return { client, matter, taskType, workflow };
  }

  // --- tasks and assets ----------------------------------------------------------------------------------------------

  async task(
    world: Pick<World, 'matter' | 'taskType' | 'workflow'>,
    overrides: Json = {},
    as: Api = this.admin,
  ): Promise<Json> {
    return as.post('/api/v1/tasks', {
      matterId: world.matter.matterId,
      taskTypeId: world.taskType.id,
      workflowDefinitionId: world.workflow.workflowDefinitionId,
      title: `E2E Task ${uid()}`,
      requestorName: 'Rita Requestor',
      ...overrides,
    });
  }

  private assetType?: Promise<number>;

  /** A field-less asset type (the starter ones have required fields), created once per worker. */
  assetTypeId(): Promise<number> {
    this.assetType ??= this.admin
      .post('/api/v1/asset-types', { name: `E2E Asset Type ${uid()}`, description: null })
      .then((t) => t.assetTypeId);
    return this.assetType;
  }

  async asset(matter: Json, displayName?: string): Promise<Json> {
    return this.admin.post('/api/v1/assets', {
      matterId: matter.matterId,
      assetTypeId: await this.assetTypeId(),
      displayName: displayName ?? `E2E Asset ${uid()}`,
    });
  }
}
