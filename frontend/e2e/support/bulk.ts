import { Api, Json } from './api';
import { Seeder, uid, World } from './seed';
import { dateInZone } from './time';

export interface BulkOptions {
  tasks?: number;
  clients?: number;
  matters?: number;
  projects?: number;
  assets?: number;
  /** Workflows with their task types (3 steps each), so the Workflows, Workflow Steps and Task Types lists scroll. */
  workflows?: number;
  users?: number;
}

export interface Bulk {
  world: World;
  /** Unique token in every bulk title (`Bulk task <tag>-01 ...`): search for it to see only these tasks. */
  tag: string;
  podId: number;
  clientIds: number[];
  /** The client that owns every bulk matter (its Matters grid is long). */
  mainClient: Json;
  mainMatter: Json;
  /** A project of the main matter that holds a long task list. */
  mainProject: Json;
  taskNumbers: string[];
}

/** Runs `n` async jobs `width` at a time, in order of index. */
async function inBatches(n: number, width: number, job: (i: number) => Promise<unknown>) {
  for (let start = 0; start < n; start += width) {
    await Promise.all(Array.from({ length: Math.min(width, n - start) }, (_, k) => job(start + k)));
  }
}

/**
 * Enough records to make every grid scroll: by default 64 tasks (assigned to the signed-in admin, in one pod), 30 clients, one client
 * with 40 matters, 30 projects and 60 assets, plus the audit rows all of that leaves behind. The admin is taken out of the pod again once the
 * tasks are assigned (see below). Used by the fixed-header e2e tests and by the
 * screenshot run (`fixed-header-screens.spec.ts`).
 */
export async function seedBulk(admin: Api, seed: Seeder, opts: BulkOptions = {}): Promise<Bulk> {
  const tasks = opts.tasks ?? 64;
  const clients = opts.clients ?? 30;
  const matters = opts.matters ?? 40;
  const projects = opts.projects ?? 30;
  const assets = opts.assets ?? 60;
  const workflows = opts.workflows ?? 14;
  const users = opts.users ?? 25;
  const tag = uid();

  const me = await admin.get<Json>('/api/v1/me');
  const world = await seed.world();
  const mainClient = world.client;
  const matterRows: Json[] = [world.matter];
  await inBatches(matters - 1, 4, async (i) => {
    matterRows.push(
      await seed.matter({
        client: mainClient,
        number: String(100 + i).padStart(5, '0'),
        name: `Bulk matter ${tag}-${i + 1}`,
      }),
    );
  });

  const clientIds: number[] = [mainClient.clientId];
  await inBatches(clients - 1, 4, async (i) => {
    const c = await seed.client({ name: `Bulk client ${tag}-${i + 1}` });
    clientIds.push(c.clientId);
    await seed.matter({ client: c, name: `Bulk first matter ${tag}-${i + 1}` });
  });

  await inBatches(projects, 4, async (i) => {
    await seed.project(matterRows[i % matterRows.length], `Bulk project ${tag}-${i + 1}`);
  });

  await inBatches(assets, 4, async (i) => {
    await seed.asset(matterRows[i % matterRows.length], `Bulk asset ${tag}-${i + 1}`);
  });

  await inBatches(workflows, 2, async () => {
    const workflow = await seed.workflow({ stepCount: 3 });
    await seed.taskType({ workflows: [workflow] });
  });
  await inBatches(users, 4, () => seed.user(['Data Technician'], 'bulk'));

  const mainProject = await seed.project(world.matter, `Bulk main project ${tag}`);
  const pod = await seed.pod(`Bulk pod ${tag}`, [me.userId]);
  const mainMatter = world.matter;
  const taskNumbers: string[] = [];
  await inBatches(tasks, 4, async (i) => {
    const day = (i % 9) - 3; // overdue, today and later
    const created = await seed.task(
      // Half of the tasks sit in one matter, so that matter's Tasks grid is long as well.
      {
        ...world,
        matter: i % 2 === 0 ? world.matter : matterRows[i % Math.min(matterRows.length, 8)],
      },
      {
        ...(i % 4 === 0 ? { projectId: mainProject.projectId } : {}),
        title: `Bulk task ${tag}-${String(i + 1).padStart(2, '0')} review batch`,
        assignedUserId: me.userId,
        assignedPodId: pod.podId,
        // No due date is ASAP.
        ...(i % 7 === 0 ? {} : { dueDate: dateInZone('America/New_York', day) }),
      },
    );
    taskNumbers.push(created.taskNumber);
  });
  // The admin had to be a member to be given tasks in the pod. Leaving them in it would change the whole run: a member of a pod opens the
  // Dashboard on "My pods" instead of "All pods", so every later spec that reads the Dashboard as the admin would see only this pod.
  await admin.delete(`/api/v1/pods/${pod.podId}/members/${me.userId}`);
  return {
    world,
    tag,
    podId: pod.podId,
    clientIds,
    mainClient,
    mainMatter,
    mainProject,
    taskNumbers,
  };
}
