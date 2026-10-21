import { Json } from './api';
import { Persona, Personas } from './personas';
import { Seeder, World, uid } from './seed';
import { TaskApi } from './tasks';
import { FIRM_ZONE, dateInZone } from './time';

/**
 * Pod Work fixtures (#547): the pods, people and tasks the Pod Work UX review used, created through the published API (no SQL, no change
 * to the demo seed) and named as the review names them so screenshots stay comparable. Every Pod Work spec imports this file; none builds
 * its own pods.
 *
 * ```ts
 * const fx = await podWorkFixtures(seed, personas);        // once per worker: the same object for every test of the worker
 * const page = await asUser(fx.lead.username);
 * await page.goto(`/pods/work?podId=${fx.busy.podId}`);
 * ```
 *
 * What exists (all names carry a per-worker token, so parallel workers never collide):
 * - `busy`: "Demo Processing Pod": 23 members (16 without open work, one of them out of office), 4 unassigned, 20 assigned, 4 overdue
 *   (assigned), 6 on hold (assigned) open tasks. `busy.counts` says the numbers.
 * - `empty`: a pod with no members; `longName`: a pod whose name is exactly 76 characters (header clamp tests).
 * - People: `lead` (Pod Lead, member of `busy`), `readonly` (Pod.View + Task.View, no Task.Assign, member of `busy`), `podNoTask`
 *   (Pod.View + Dashboard.View, no Task.View), `director` and `observer` (no pod), `multi` (five pods, one primary), `two` (two pods),
 *   `noPod` (a technician in no pod).
 *
 * Idempotent per worker: a second call returns the same objects and creates nothing. Nothing needs cleaning up: every record is new and
 * uniquely named (the throwaway stack is dropped after the run).
 */
export interface PodRef {
  podId: number;
  name: string;
}

export interface BusyPod extends PodRef {
  members: { userId: number; username: string; displayName: string }[];
  /** The people who hold open work (the lead is the first). */
  withWork: number[];
  counts: { unassigned: number; assigned: number; overdue: number; onHold: number; open: number };
  /** Unassigned task titles, so a test can find "its" rows. */
  unassignedTitles: string[];
  /** Task numbers of the unassigned tasks, in creation order. */
  unassignedNumbers: string[];
  world: World;
}

export interface PodWorkFixtures {
  token: string;
  busy: BusyPod;
  empty: PodRef;
  longName: PodRef;
  lead: Persona;
  readonly: Persona;
  podNoTask: Persona;
  director: Persona;
  observer: Persona;
  multi: Persona & { pods: PodRef[]; primary: PodRef };
  two: Persona & { pods: PodRef[] };
  noPod: Persona;
}

/** A pod name of exactly `length` characters that ends in the token. */
export function podNameOfLength(length: number, token: string): string {
  const base = 'Regional Document Review and Production Support Pod ';
  const name = `${base}${token}`;
  if (name.length >= length) return name.slice(0, length);
  // Padding is one more word (a trailing space would be trimmed by the server).
  return `${name} ${'x'.repeat(length - name.length - 1)}`;
}

const cache = new WeakMap<Seeder, Promise<PodWorkFixtures>>();

/** The fixtures of this worker (built once; see the file comment). `members` is the number of people in the busy pod (default 23). */
export function podWorkFixtures(
  seed: Seeder,
  personas: Personas,
  options: { members?: number } = {},
): Promise<PodWorkFixtures> {
  let built = cache.get(seed);
  if (!built) {
    built = build(seed, personas, options.members ?? 23);
    cache.set(seed, built);
  }
  return built;
}

async function build(
  seed: Seeder,
  personas: Personas,
  memberCount: number,
): Promise<PodWorkFixtures> {
  const token = uid();
  const lead = await personas.create({ label: 'pw-lead', roles: ['Pod Lead'] });
  const readonly = await personas.create({
    label: 'pw-readonly',
    permissions: ['Pod.View', 'Task.View', 'Matter.View', 'Client.View'],
  });
  const podNoTask = await personas.create({
    label: 'pw-podnotask',
    permissions: ['Pod.View', 'Dashboard.View', 'Dashboard.ViewSummary'],
  });
  const director = await personas.named('director', { label: 'pw-director' });
  const observer = await personas.named('readOnlyObserver', { label: 'pw-observer' });
  const noPod = await personas.create({ label: 'pw-nopod', roles: ['Data Technician'] });

  // The busy pod: the lead, the read-only person and (memberCount - 2) technicians; the last one is out of office.
  const others: Persona[] = [];
  for (let i = 0; i < Math.max(0, memberCount - 2); i++) {
    others.push(await personas.create({ label: `pw-m${i}`, roles: ['Data Technician'] }));
  }
  const memberIds = [lead.userId, readonly.userId, ...others.map((o) => o.userId)];
  const created = await seed.pod(`Demo Processing Pod ${token}`, memberIds);
  if (others.length > 0) await seed.outOfOffice(others[others.length - 1].userId);
  const withWork = [lead.userId, ...others.slice(0, 6).map((o) => o.userId)];

  const world = await seed.world();
  const inPod = { assignedPodId: created.podId };
  const unassignedTitles: string[] = [];
  const unassignedNumbers: string[] = [];
  for (let i = 0; i < 4; i++) {
    const title = `PW unassigned ${i + 1} ${token}`;
    const task = await seed.task(world, { title, ...inPod, isAsap: i === 0 });
    unassignedTitles.push(title);
    unassignedNumbers.push(task.taskNumber);
  }
  // 20 assigned tasks spread over the people with work; the first 4 are overdue, the next 6 are put on hold.
  const assigned: Json[] = [];
  for (let i = 0; i < 20; i++) {
    const owner = withWork[i % withWork.length];
    assigned.push(
      await seed.task(world, {
        title: `PW assigned ${i + 1} ${token}`,
        ...inPod,
        assignedUserId: owner,
        dueDate: i < 4 ? dateInZone(FIRM_ZONE, -3 - i) : dateInZone(FIRM_ZONE, 5 + i),
      }),
    );
  }
  for (const task of assigned.slice(4, 10)) {
    const held = await new TaskApi(seed.admin, task.taskId).changeStatus(
      'ON_HOLD',
      'Waiting for the custodian',
    );
    if (held.status >= 300) throw new Error(`on hold -> ${held.status}`);
  }

  const empty = await seed.pod(`Demo Empty Pod ${token}`, []);
  const long = await seed.pod(podNameOfLength(76, token), [lead.userId]);

  // A user in five pods (the second is primary) and one in two pods.
  const multiBase = await personas.create({ label: 'pw-multi', roles: ['Data Technician'] });
  const multiPods: PodRef[] = [];
  for (let i = 0; i < 5; i++) {
    const pod = await seed.pod(`Multi pod ${i + 1} ${token}`, [multiBase.userId]);
    multiPods.push({ podId: pod.podId, name: pod.name });
  }
  await seed.admin.put(`/api/v1/pods/${multiPods[1].podId}/members/${multiBase.userId}`, {
    isPrimary: true,
  });
  const twoBase = await personas.create({ label: 'pw-two', roles: ['Data Technician'] });
  const twoPods: PodRef[] = [];
  for (let i = 0; i < 2; i++) {
    const pod = await seed.pod(`Two pod ${i + 1} ${token}`, [twoBase.userId]);
    twoPods.push({ podId: pod.podId, name: pod.name });
  }

  const members = [lead, readonly, ...others].map((p) => ({
    userId: p.userId,
    username: p.username,
    displayName: p.displayName ?? p.username,
  }));
  return {
    token,
    busy: {
      podId: created.podId,
      name: created.name,
      members,
      withWork,
      counts: { unassigned: 4, assigned: 20, overdue: 4, onHold: 6, open: 24 },
      unassignedTitles,
      unassignedNumbers,
      world,
    },
    empty: { podId: empty.podId, name: empty.name },
    longName: { podId: long.podId, name: long.name },
    lead,
    readonly,
    podNoTask,
    director,
    observer,
    multi: { ...multiBase, pods: multiPods, primary: multiPods[1] },
    two: { ...twoBase, pods: twoPods },
    noPod,
  };
}
