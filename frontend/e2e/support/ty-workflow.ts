import { Api } from './api';
import { Seeder, World, WorkflowResult, uid } from './seed';

export interface Setup {
  world: World;
  workflow: WorkflowResult;
  /** Open tasks on v1 and on v2 as created. */
  openV1: number;
  openV2: number;
  token: string;
}

/**
 * A workflow with three versions: v1 retired (3 open tasks), v2 published (2 open tasks, one completed is not created), v3 a draft;
 * `types` extra task types use it (the first is the default of the world's type).
 */
export async function build(
  seed: Seeder,
  admin: Api,
  opts: { types?: number; longName?: boolean } = {},
): Promise<Setup> {
  const token = uid();
  const name = opts.longName
    ? `Quarterly regulatory filing review and escalation workflow for multi jurisdiction clients ${token} ${'long '.repeat(12)}`.slice(
        0,
        150,
      )
    : `Billing request ${token}`;
  const client = await seed.client();
  const matter = await seed.matter({ client });
  const workflow = await seed.workflow({ name, stepCount: 3 });
  const taskType = await seed.taskType({ name: `Billing type ${token}`, workflows: [workflow] });
  const world: World = { client, matter, taskType, workflow };
  for (let i = 0; i < 3; i++) await seed.task(world);
  await seed.publishNextVersion(workflow, workflow.stepIds);
  for (let i = 0; i < 2; i++) await seed.task(world);
  await admin.post(`/api/v1/workflows/${workflow.workflowDefinitionId}/versions`, {});
  for (let i = 0; i < (opts.types ?? 0); i++) {
    await seed.taskType({
      name: `Task type with a rather long name number ${i + 1} of the family ${token}`,
      workflows: [workflow],
      defaultIndex: 0,
    });
  }
  return { world, workflow, openV1: 3, openV2: 2, token };
}

export interface VersionIds {
  v1: number;
  v2: number;
  v3: number;
}

/** The version ids of a workflow built by `build` (v1 retired, v2 published, v3 draft). */
export async function versionIds(admin: Api, s: Setup): Promise<VersionIds> {
  const detail = await admin.get<{ versions: { versionNo: number; workflowVersionId: number }[] }>(
    `/api/v1/workflows/${s.workflow.workflowDefinitionId}`,
  );
  const id = (n: number) => detail.versions.find((v) => v.versionNo === n)!.workflowVersionId;
  return { v1: id(1), v2: id(2), v3: id(3) };
}
