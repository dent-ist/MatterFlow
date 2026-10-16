import { Api, Json } from './api';
import { Seeder, TaskTypeResult, uid } from './seed';
import { TaskApi } from './tasks';
import { dateInZone, FIRM_ZONE } from './time';

export interface Person {
  key: string;
  username: string;
  userId: number;
  displayName: string;
  /** Open tasks per priority (critical, high, normal, low). */
  loads: [number, number, number, number];
}

export interface WorkloadSeed {
  /** Unique token in every display name and task title: `?uq=<tag>` shows only these people. */
  tag: string;
  priorities: Json[];
  people: Record<string, Person>;
  podA: Json;
  podB: Json;
  unassignedTitles: string[];
  world: Awaited<ReturnType<Seeder['world']>>;
}

export interface Plan {
  key: string;
  loads: [number, number, number, number];
  pod: 'A' | 'B';
  ooo?: { note: string; untilDays?: number };
  offHours?: boolean;
}

/** Twelve people with different loads: an idle one, light, normal and heavy ones, one out of office with tasks, one out of office and idle, one off hours. */
export const PLAN: Plan[] = [
  { key: 'idle', loads: [0, 0, 0, 0], pod: 'A' },
  { key: 'light', loads: [0, 0, 0, 2], pod: 'A' },
  { key: 'lightNormal', loads: [0, 0, 2, 1], pod: 'A' },
  { key: 'critical', loads: [1, 2, 2, 0], pod: 'A' },
  { key: 'high', loads: [0, 3, 2, 2], pod: 'A' },
  { key: 'heavy', loads: [0, 2, 5, 5], pod: 'A' },
  { key: 'heavyCritical', loads: [3, 3, 3, 3], pod: 'B' },
  { key: 'ooo', loads: [0, 2, 0, 0], pod: 'B', ooo: { note: 'Annual leave', untilDays: 6 } },
  { key: 'oooIdle', loads: [0, 0, 0, 0], pod: 'B', ooo: { note: 'Parental leave' } },
  { key: 'offHours', loads: [0, 0, 1, 0], pod: 'B', offHours: true },
  { key: 'low', loads: [0, 0, 0, 4], pod: 'B' },
  { key: 'idleB', loads: [0, 0, 0, 0], pod: 'B' },
];

const DEFAULT_PLAN = PLAN;

/**
 * A department of `n` people for the screenshots and the size checks: the mix of a real firm (about a fifth idle, most light or normal, a few
 * heavy, some out of office or off hours), in two pods. Keys are `p0`, `p1`, ...
 */
export function crowdPlan(n: number): Plan[] {
  const mix: Omit<Plan, 'key' | 'pod'>[] = [
    { loads: [0, 0, 0, 0] },
    { loads: [0, 0, 0, 2] },
    { loads: [0, 0, 1, 1] },
    { loads: [0, 1, 2, 2] },
    { loads: [0, 2, 3, 1] },
    { loads: [1, 2, 2, 0] },
    { loads: [0, 3, 2, 2] },
    { loads: [0, 0, 4, 3] },
    { loads: [0, 0, 0, 0] },
    { loads: [0, 0, 0, 4] },
    { loads: [2, 1, 1, 1] },
    { loads: [0, 2, 0, 0], ooo: { note: 'Annual leave', untilDays: 6 } },
    { loads: [0, 1, 0, 1] },
    { loads: [0, 0, 1, 0], offHours: true },
    { loads: [0, 2, 5, 5] },
    { loads: [0, 0, 0, 0] },
    { loads: [0, 0, 3, 3] },
    { loads: [0, 0, 0, 0], ooo: { note: 'Parental leave' } },
    { loads: [0, 0, 2, 0] },
    { loads: [3, 3, 2, 2] },
  ];
  return Array.from({ length: n }, (_, i) => ({
    key: `p${i}`,
    pod: i % 2 === 0 ? 'A' : 'B',
    ...mix[i % mix.length],
  }));
}

async function inBatches(n: number, width: number, job: (i: number) => Promise<unknown>) {
  for (let start = 0; start < n; start += width) {
    await Promise.all(Array.from({ length: Math.min(width, n - start) }, (_, k) => job(start + k)));
  }
}

/**
 * Seeds the Users tab (issue #73): the twelve people of `PLAN` (display names carry a unique tag, so `uq=<tag>` scopes the tab to them in the
 * shared database), their open tasks by priority (with some overdue, due soon and on hold) and four unassigned tasks to assign.
 */
export async function seedWorkload(
  admin: Api,
  seed: Seeder,
  options: { plan?: Plan[]; width?: number } = {},
): Promise<WorkloadSeed> {
  const plans = options.plan ?? DEFAULT_PLAN;
  const width = options.width ?? 3;
  const tag = uid();
  const world = await seed.world({ stepCount: 3 });
  const page = await admin.get<Json>('/api/v1/priorities');
  const priorities: Json[] = (Array.isArray(page) ? page : page.items)
    .filter((p: Json) => p.isActive)
    .sort((a: Json, b: Json) => a.sortOrder - b.sortOrder);

  const people: Record<string, Person> = {};
  await inBatches(plans.length, width, async (i) => {
    const plan = plans[i];
    const u = await seed.user(['Data Technician'], `wl${tag}${i}`);
    const me = await Api.as(u.username);
    try {
      const profile = await me.get<Json>('/api/v1/me');
      people[plan.key] = {
        key: plan.key,
        ...u,
        displayName: profile.displayName,
        loads: plan.loads,
      };
    } finally {
      await me.dispose();
    }
  });

  const inPod = (pod: 'A' | 'B') =>
    plans.filter((p) => p.pod === pod).map((p) => people[p.key].userId);
  const podA = await seed.pod(`Workload A ${tag}`, inPod('A'));
  const podB = await seed.pod(`Workload B ${tag}`, inPod('B'));

  await inBatches(plans.length, width, async (i) => {
    const plan = plans[i];
    const person = people[plan.key];
    if (plan.ooo) {
      await seed.outOfOffice(person.userId, {
        note: plan.ooo.note,
        ...(plan.ooo.untilDays ? { until: dateInZone(FIRM_ZONE, plan.ooo.untilDays) } : {}),
      });
    } else if (plan.offHours) {
      await seed.availability(person.userId, { workHours: [] });
    } else {
      // Everyone else works around the clock, so "Available" does not depend on the time the suite runs.
      await seed.availability(person.userId, {
        workHours: [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({
          dayOfWeek,
          start: '00:00',
          end: '23:59',
        })),
      });
    }
  });

  const client = world.client;
  const matter = world.matter;
  const jobs: { person: Person; priority: Json; pod: Json; n: number }[] = [];
  for (const plan of plans) {
    plan.loads.forEach((count, p) => {
      for (let n = 0; n < count; n++) {
        jobs.push({
          person: people[plan.key],
          priority: priorities[p],
          pod: plan.pod === 'A' ? podA : podB,
          n,
        });
      }
    });
  }
  const held = new Set<number>();
  await inBatches(jobs.length, width + 1, async (i) => {
    const j = jobs[i];
    const dueDay = i % 7 === 0 ? -3 : i % 7 === 1 ? 1 : i % 7 === 2 ? 12 : null; // overdue, soon, later, ASAP
    const created = await seed.task(
      { ...world, matter },
      {
        title: `Workload ${tag} ${j.person.key} ${String(i + 1).padStart(2, '0')}`,
        priorityId: j.priority.id,
        assignedUserId: j.person.userId,
        assignedPodId: j.pod.podId,
        ...(dueDay === null ? {} : { dueDate: dateInZone(FIRM_ZONE, dueDay) }),
      },
    );
    if (i % 9 === 4) {
      const api = new TaskApi(admin, created.taskId);
      const res = await api.changeStatus('ON_HOLD', 'Waiting for the custodian');
      if (res.status >= 300) throw new Error(`hold -> ${res.status} ${JSON.stringify(res.body)}`);
      held.add(created.taskId);
    }
  });

  const unassignedTitles: string[] = [];
  for (let n = 0; n < 4; n++) {
    const title = `Unassigned ${tag} ${n + 1}`;
    unassignedTitles.push(title);
    await seed.task({ ...world, matter }, { title, priorityId: priorities[n].id });
  }
  void client;
  return { tag, priorities, people, podA, podB, unassignedTitles, world };
}

export interface CoverageSeed {
  tag: string;
  typeNames: { production: string; review: string };
  typeIds: { production: number; review: number };
  people: { a: Person; b: Person; c: Person };
}

/**
 * Seeds the Coverage view: two task types and three people. A completed 3 Production and 1 Review (and cancelled one more, which never counts),
 * B 1 Production, C 2 Production. So Production was handled by three people, Review by one, and B and C have a zero for Review.
 */
export async function seedCoverage(admin: Api, seed: Seeder): Promise<CoverageSeed> {
  const tag = uid();
  const client = await seed.client();
  const matter = await seed.matter({ client });
  const workflow = await seed.workflow({ stepCount: 2 });
  const production = await seed.taskType({ name: `Cov ${tag} Production`, workflows: [workflow] });
  const review = await seed.taskType({ name: `Cov ${tag} Review`, workflows: [workflow] });
  const make = async (i: number): Promise<Person> => {
    const u = await seed.user(['Data Technician'], `zcov${tag}${i}`);
    const me = await Api.as(u.username);
    try {
      const profile = await me.get<Json>('/api/v1/me');
      return { key: `cov${i}`, ...u, displayName: profile.displayName, loads: [0, 0, 0, 0] };
    } finally {
      await me.dispose();
    }
  };
  const [a, b, c] = [await make(1), await make(2), await make(3)];
  const complete = async (type: TaskTypeResult, who: Person, cancel = false) => {
    const created = await seed.task(
      { matter, taskType: type, workflow },
      { assignedUserId: who.userId, title: `Coverage ${tag} ${who.key} ${type.id}` },
    );
    const api = new TaskApi(admin, created.taskId);
    if (!cancel) await api.completeSteps(1, 2);
    const res = cancel ? await api.cancel('Not needed') : await api.complete();
    if (res.status >= 300) throw new Error(`close -> ${res.status} ${JSON.stringify(res.body)}`);
  };
  for (let n = 0; n < 3; n++) await complete(production, a);
  await complete(review, a);
  await complete(production, a, true);
  await complete(production, b);
  for (let n = 0; n < 2; n++) await complete(production, c);
  return {
    tag,
    typeNames: { production: `Cov ${tag} Production`, review: `Cov ${tag} Review` },
    typeIds: { production: production.id, review: review.id },
    people: { a, b, c },
  };
}
