import { Api, Json } from './api';
import { Seeder, uid } from './seed';
import { TaskApi } from './tasks';
import { dateInZone, FIRM_ZONE } from './time';

export interface BoardSeedOptions {
  /** Open and closed tasks to create (default 160). */
  tasks?: number;
  clients?: number;
  /** Matters per client. */
  matters?: number;
  users?: number;
}

export interface BoardSeed {
  /** Unique token in every title (`Board <tag> 001 ...`): `?q=<tag>` shows only these tasks. */
  tag: string;
  world: Awaited<ReturnType<Seeder['world']>>;
  priorities: Json[];
  users: { username: string; userId: number; displayName: string }[];
  /** The user who is out of office (assigned some of the tasks). */
  outOfOfficeUser: { username: string; userId: number; displayName: string };
  clients: { client: Json; matters: Json[] }[];
  podId: number;
  taskIds: number[];
}

async function inBatches(n: number, width: number, job: (i: number) => Promise<unknown>) {
  for (let start = 0; start < n; start += width) {
    await Promise.all(Array.from({ length: Math.min(width, n - start) }, (_, k) => job(start + k)));
  }
}

/**
 * Seeds a board with 150+ tasks across clients, matters, priorities, statuses (New, In Progress, On Hold, Completed, Cancelled) and
 * assignees (one of them out of office, some tasks unassigned) for the Swimlane tests and screenshots. Statuses follow the task index:
 * 0-4 New (about 45 percent), then In Progress, On Hold, Completed and Cancelled.
 */
export async function seedBoard(
  admin: Api,
  seed: Seeder,
  opts: BoardSeedOptions = {},
): Promise<BoardSeed> {
  const tasks = opts.tasks ?? 160;
  const clientCount = opts.clients ?? 4;
  const matterCount = opts.matters ?? 3;
  const userCount = opts.users ?? 5;
  const tag = uid();

  const world = await seed.world({ stepCount: 4 });
  const prioritiesPage = await admin.get<Json>('/api/v1/priorities');
  const priorities: Json[] = (Array.isArray(prioritiesPage) ? prioritiesPage : prioritiesPage.items)
    .filter((p: Json) => p.isActive)
    .sort((a: Json, b: Json) => a.sortOrder - b.sortOrder);

  const users: BoardSeed['users'] = [];
  await inBatches(userCount, 3, async (i) => {
    const u = await seed.user(['Data Technician'], `lane${i}`);
    const me = await Api.as(u.username);
    try {
      const profile = await me.get<Json>('/api/v1/me');
      users[i] = { ...u, displayName: profile.displayName };
    } finally {
      await me.dispose();
    }
  });
  const outOfOfficeUser = users[0];
  await seed.outOfOffice(outOfOfficeUser.userId, { note: 'On leave' });

  const pod = await seed.pod(
    `Board pod ${tag}`,
    users.map((u) => u.userId),
  );

  const clients: BoardSeed['clients'] = [];
  for (let c = 0; c < clientCount; c++) {
    const client = await seed.client({
      name: `Board client ${tag}-${String.fromCharCode(65 + c)}`,
    });
    const matters: Json[] = [];
    for (let m = 0; m < matterCount; m++) {
      matters.push(
        await seed.matter({
          client,
          number: String(m + 1).padStart(5, '0'),
          name: `Board matter ${tag}-${c + 1}.${m + 1}`,
        }),
      );
    }
    clients.push({ client, matters });
  }

  const taskIds: number[] = new Array(tasks);
  await inBatches(tasks, 4, async (i) => {
    const c = clients[i % clients.length];
    const matter = c.matters[Math.floor(i / clients.length) % c.matters.length];
    const priority = priorities[i % priorities.length];
    // A New task has nobody assigned (assigning starts it), so the New lane is the unassigned slots.
    const assignee = i % 20 < 8 ? null : users[i % users.length];
    const dueDay = i % 6 === 0 ? null : (i % 11) - 4; // overdue, today, later; null = ASAP
    const created = await seed.task(
      { ...world, matter },
      {
        title: `Board ${tag} ${String(i + 1).padStart(3, '0')} ${['review', 'produce', 'index', 'export'][i % 4]} batch`,
        priorityId: priority.id,
        ...(assignee ? { assignedUserId: assignee.userId, assignedPodId: pod.podId } : {}),
        ...(dueDay === null ? {} : { dueDate: dateInZone(FIRM_ZONE, dueDay) }),
      },
    );
    taskIds[i] = created.taskId;
    const api = new TaskApi(admin, created.taskId);
    const slot = i % 20;
    if (slot < 14) return; // slots 0-7 stay New (nobody assigned), 8-13 are In Progress (assigned)
    if (slot < 17) {
      const held = await api.changeStatus('ON_HOLD', 'Waiting for the custodian');
      if (held.status >= 300)
        throw new Error(`hold -> ${held.status} ${JSON.stringify(held.body)}`);
    } else if (slot < 19) {
      await api.completeSteps(1, 2, 3, 4);
      const done = await api.complete();
      if (done.status >= 300)
        throw new Error(`complete -> ${done.status} ${JSON.stringify(done.body)}`);
    } else {
      const gone = await api.cancel('No longer needed');
      if (gone.status >= 300)
        throw new Error(`cancel -> ${gone.status} ${JSON.stringify(gone.body)}`);
    }
  });

  return { tag, world, priorities, users, outOfOfficeUser, clients, podId: pod.podId, taskIds };
}
