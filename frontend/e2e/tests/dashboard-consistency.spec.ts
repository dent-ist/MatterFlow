import { Api, Json } from '../support/api';
import { expect, test } from '../support/fixtures';
import { TaskApi } from '../support/tasks';
import { Seeder, uid } from '../support/seed';
import { dateInZone, FIRM_ZONE } from '../support/time';

/**
 * Dashboard consistency audit (final QA pass of the Dashboard UX epic): the same seeded data read through every Dashboard endpoint under one
 * page scope and period must give numbers that agree with each other and with the Task Queue behind the drill-through links. API level (the
 * UI renders these numbers; the per-tab specs check the rendering).
 *
 * The database is shared, so the scenario owns a Pod P with a Pod Lead (member), two technicians (members) and a Director (no member of any
 * Pod) and reads everything with `podScope=<P>`; nobody else's tasks are in scope. Tasks in P:
 *
 *   u_over   NEW, unassigned, overdue            t1_soon  IN_PROGRESS (an assigned task starts), tech1, due tomorrow
 *   u_asap   NEW, unassigned, ASAP               t1_prog  IN_PROGRESS, tech1, overdue (task type B)
 *   t2_hold  ON_HOLD, tech2, due in 10 days (B)  lead_done COMPLETED, the lead (A)    t1_done COMPLETED, tech1 (B)    t2_cancel CANCELLED, tech2
 *
 * Outside P: an overdue task assigned to tech1 with no Pod (counts for "My work", never for P) and an unassigned one of another Pod.
 */
const FIVE = 5;

interface Scenario {
  pod: Json;
  other: Json;
  director: Api;
  lead: Api;
  tech1: Api;
  people: Record<'lead' | 'tech1' | 'tech2', { userId: number; username: string }>;
  typeA: Json;
  typeB: Json;
}

let s: Scenario;
const apis: Api[] = [];

const queue = async (api: Api, query: string): Promise<number> =>
  (await api.get<Json>(`/api/v1/task-queue?${query}${query ? '&' : ''}pageSize=1`)).total;

test.describe.configure({ mode: 'serial' });

test.describe('Dashboard consistency across tabs (API)', () => {
  test.beforeAll(async ({ admin, seed }) => {
    test.setTimeout(240_000);
    s = await build(admin, seed);
  });

  test.afterAll(async () => {
    for (const api of apis) await api.dispose();
  });

  test('Summary: every count equals the Task Queue behind its link, and the seeded numbers are the expected ones', async () => {
    const sum = await s.director.get<Json>(`/api/v1/dashboard?fresh=true&podScope=${s.pod.podId}`);
    for (const key of [
      'open',
      'unassigned',
      'overdue',
      'onHold',
      'dueSoon',
      'asapOpen',
      'completed',
      'created',
      'overdueCritical',
      'overdueHigh',
    ]) {
      const c = sum[key];
      expect(await queue(s.director, c.query), `${key} (${c.query})`).toBe(c.count);
    }
    expect(sum.open.count).toBe(FIVE);
    expect(sum.unassigned.count).toBe(2);
    expect(sum.overdue.count).toBe(2);
    expect(sum.onHold.count).toBe(1);
    expect(sum.dueSoon.count).toBe(1);
    expect(sum.asapOpen.count).toBe(1);
    expect(sum.completed.count).toBe(2);
    expect(sum.created.count).toBe(8);
    expect(sum.scope.podIds).toEqual([s.pod.podId]);
  });

  test('Breakdowns: every breakdown adds up to Open, each row equals its queue, overdue per row is a subset', async () => {
    const sum = await s.director.get<Json>(`/api/v1/dashboard?fresh=true&podScope=${s.pod.podId}`);
    const open = sum.open.count;
    for (const key of ['byTaskType', 'byPriority', 'byStatus', 'aging']) {
      const rows: Json[] = sum[key];
      expect(
        rows.reduce((n, r) => n + r.count, 0),
        key,
      ).toBe(open);
      for (const r of rows) {
        if (!r.query) continue;
        expect(await queue(s.director, r.query), `${key} ${r.label} (${r.query})`).toBe(r.count);
        expect(
          await queue(s.director, `${r.query}&overdue=true`),
          `${key} ${r.label} overdue`,
        ).toBe(r.overdue);
      }
    }
    const types = Object.fromEntries(sum.byTaskType.map((r: Json) => [r.label, r.count]));
    expect(types[s.typeA.name]).toBe(3); // u_over, u_asap, t1_soon
    expect(types[s.typeB.name]).toBe(2); // t1_prog, t2_hold
    expect(sum.byTaskType.reduce((n: number, r: Json) => n + r.overdue, 0)).toBe(sum.overdue.count);
  });

  test('Swimlane: the lane counts are the Task Queue totals, the groups add up to the lanes, Open is the three open lanes', async () => {
    const sum = await s.director.get<Json>(`/api/v1/dashboard?fresh=true&podScope=${s.pod.podId}`);
    const pod = `pod=${s.pod.podId}`;
    for (const groupBy of ['none', 'priority', 'assignee', 'clientMatter']) {
      const board = await s.director.get<Json>(
        `/api/v1/dashboard/swimlane?podScope=${s.pod.podId}&completedDays=30&groupBy=${groupBy}`,
      );
      const lane = (status: string) => board.lanes.find((l: Json) => l.status === status) as Json;
      expect(lane('NEW').count, groupBy).toBe(2);
      expect(lane('IN_PROGRESS').count).toBe(2);
      expect(lane('ON_HOLD').count).toBe(1);
      expect(lane('NEW').count + lane('IN_PROGRESS').count + lane('ON_HOLD').count).toBe(
        sum.open.count,
      );
      // Completed holds completed and cancelled tasks of the window.
      expect(lane('COMPLETED').count).toBe(3);
      for (const status of ['NEW', 'IN_PROGRESS', 'ON_HOLD']) {
        expect(await queue(s.director, `${pod}&status=${status}`), status).toBe(lane(status).count);
      }
      expect(await queue(s.director, `${pod}&status=COMPLETED&status=CANCELLED`)).toBe(
        lane('COMPLETED').count,
      );
      // Cards are capped, the count is not: every card is a task of the lane.
      for (const l of board.lanes) expect(l.cards.length).toBeLessThanOrEqual(l.count);
      if (groupBy !== 'none') {
        const top = board.groups as Json[];
        const sumOf = (pick: (c: Json) => number) => top.reduce((n, g) => n + pick(g.counts), 0);
        expect(
          sumOf((c) => c.new),
          `${groupBy} NEW`,
        ).toBe(lane('NEW').count);
        expect(sumOf((c) => c.inProgress)).toBe(lane('IN_PROGRESS').count);
        expect(sumOf((c) => c.onHold)).toBe(lane('ON_HOLD').count);
        expect(sumOf((c) => c.completed)).toBe(lane('COMPLETED').count);
      }
    }
  });

  test('Users: the unassigned number is the Summary one; the people of the Pod hold the assigned open tasks; Coverage counts the completed ones', async () => {
    const sum = await s.director.get<Json>(`/api/v1/dashboard?fresh=true&podScope=${s.pod.podId}`);
    const work = await s.director.get<Json>(
      `/api/v1/dashboard/workload?podScope=${s.pod.podId}&includeNoPod=true`,
    );
    expect(work.summary.unassignedTasks).toBe(sum.unassigned.count);
    const names = work.users.map((u: Json) => u.userId).sort();
    expect(names).toEqual(
      [s.people.lead.userId, s.people.tech1.userId, s.people.tech2.userId].sort(),
    );
    const open = (id: number) => work.users.find((u: Json) => u.userId === id).openTotal;
    // The Pod scope picks the people (the members of P) and a person's card is their whole workload: tech1 holds two open tasks of P and one
    // with no Pod, and all three are on the card (the drawer and the card's queue link list the same three). Summary and Swimlane count the
    // tasks of P only, so the cards add up to "assigned open tasks of P" plus what the members hold outside P.
    expect(open(s.people.tech1.userId)).toBe(3);
    expect(open(s.people.tech2.userId)).toBe(1);
    expect(open(s.people.lead.userId)).toBe(0);
    expect(
      await queue(
        s.director,
        `assignee=${s.people.tech1.userId}&status=NEW&status=IN_PROGRESS&status=ON_HOLD`,
      ),
      'the card of tech1 equals the queue of tech1',
    ).toBe(3);
    const inScope = work.users.reduce((n: number, u: Json) => n + u.openTotal, 0);
    expect(inScope).toBe(sum.open.count - sum.unassigned.count + 1);
    const overdue = work.users.reduce((n: number, u: Json) => n + u.overdue, 0);
    expect(overdue).toBe(sum.overdue.count - 1 + 1); // u_over is unassigned; tech1's no-Pod task is overdue
    const onHold = work.users.reduce((n: number, u: Json) => n + u.onHold, 0);
    expect(onHold).toBe(sum.onHold.count);

    const cov = await s.director.get<Json>(`/api/v1/dashboard/coverage?podScope=${s.pod.podId}`);
    expect(cov.summary.totalCompleted).toBe(sum.completed.count);
    const perType = Object.fromEntries(cov.taskTypes.map((t: Json) => [t.taskTypeId, t.total]));
    expect(perType[s.typeA.id]).toBe(1);
    expect(perType[s.typeB.id]).toBe(1);
    // Each cell opens the Task Queue with its own filter: the count is the cell.
    for (const cell of cov.cells as Json[]) {
      const n = await queue(
        s.director,
        `status=COMPLETED&assignee=${cell.userId}&type=${cell.taskTypeId}&completedFrom=${cov.from}&completedTo=${cov.to}`,
      );
      expect(n).toBeGreaterThanOrEqual(cell.completed);
    }
  });

  test('Trends: created and completed add up to the Summary, the last open and overdue points are the Summary tiles', async () => {
    const sum = await s.director.get<Json>(`/api/v1/dashboard?fresh=true&podScope=${s.pod.podId}`);
    const trend = await s.director.get<Json>(
      `/api/v1/dashboard/trend?fresh=true&podScope=${s.pod.podId}`,
    );
    const all: Json[] = trend.all;
    expect(all.reduce((n, p) => n + p.created, 0)).toBe(sum.created.count);
    expect(all.reduce((n, p) => n + p.completed, 0)).toBe(sum.completed.count);
    expect(all[all.length - 1].open).toBe(sum.open.count);
    expect(all[all.length - 1].overdue).toBe(sum.overdue.count);
    const types: Json[] = trend.types;
    expect(types.reduce((n, t) => n + t.created, 0)).toBe(sum.created.count);
    expect(types.reduce((n, t) => n + t.completed, 0)).toBe(sum.completed.count);
    for (const t of types.filter((x) => x.id === s.typeA.id || x.id === s.typeB.id)) {
      expect(await queue(s.director, t.createdQuery), `${t.name} created`).toBe(t.created);
      expect(await queue(s.director, t.completedQuery), `${t.name} completed`).toBe(t.completed);
      expect(await queue(s.director, t.openQuery), `${t.name} open`).toBe(t.open);
      expect(await queue(s.director, t.overdueQuery), `${t.name} overdue`).toBe(t.overdue);
    }
  });

  test('Periods: Created and Completed are the Task Queue for the period, and Trends adds up to them, for every period', async () => {
    for (const period of ['7d', '30d', '90d', 'this-month', 'last-month', '6m', '12m']) {
      const q = `fresh=true&podScope=${s.pod.podId}&period=${period}`;
      const sum = await s.director.get<Json>(`/api/v1/dashboard?${q}`);
      const trend = await s.director.get<Json>(`/api/v1/dashboard/trend?${q}`);
      for (const key of ['created', 'completed']) {
        expect(await queue(s.director, sum[key].query), `${period} ${key}`).toBe(sum[key].count);
        const total = (trend.all as Json[]).reduce((n, p) => n + p[key], 0);
        expect(total, `${period} ${key} in Trends`).toBe(sum[key].count);
      }
      expect(sum.period.key).toBe(period);
      expect(trend.period.from).toBe(sum.period.from);
      expect(trend.period.to).toBe(sum.period.to);
    }
    const weekly = await s.director.get<Json>(
      `/api/v1/dashboard/trend?fresh=true&podScope=${s.pod.podId}&period=90d`,
    );
    expect(weekly.granularity).toBe('week');
  });

  test("Pod Lead who is a member: the default scope (mine) gives the Director's Pod numbers; what the role may not see is empty", async () => {
    const asDirector = await s.director.get<Json>(
      `/api/v1/dashboard?fresh=true&podScope=${s.pod.podId}`,
    );
    const mine = await s.lead.get<Json>('/api/v1/dashboard?fresh=true&podScope=mine');
    for (const key of ['open', 'unassigned', 'overdue', 'onHold', 'dueSoon', 'asapOpen']) {
      expect(mine[key].count, key).toBe(asDirector[key].count);
    }
    expect(mine.scope.podIds).toEqual([s.pod.podId]);
    // The Pod Lead has no Breakdowns permission: zero or empty, never a number from somewhere else.
    expect(mine.byTaskType).toEqual([]);
    expect(mine.byStatus).toEqual([]);
    const board = await s.lead.get<Json>('/api/v1/dashboard/swimlane?podScope=mine');
    expect(board.lanes.find((l: Json) => l.status === 'NEW').count).toBe(2);
    const work = await s.lead.get<Json>('/api/v1/dashboard/workload?podScope=mine');
    expect(work.summary.unassignedTasks).toBe(mine.unassigned.count);
    const cov = await s.lead.get<Json>('/api/v1/dashboard/coverage?podScope=mine');
    expect(cov.summary.totalCompleted).toBe(asDirector.completed.count);
    // The same queue for the same pods (the drill-through of every tile).
    expect(await queue(s.lead, mine.open.query)).toBe(mine.open.count);
    expect(await queue(s.lead, mine.overdue.query)).toBe(mine.overdue.count);
    // The Trends tab is not theirs.
    expect((await s.lead.raw('GET', '/api/v1/dashboard/trend?podScope=mine')).status).toBe(403);
  });

  test('Director in no Pod: My pods is nothing, one chosen Pod and All pods are the Pod and everything', async () => {
    const mine = await s.director.get<Json>('/api/v1/dashboard?fresh=true&podScope=mine');
    expect(mine.open.count).toBe(0);
    expect(mine.created.count).toBe(0);
    expect(mine.scope.podIds).toEqual([]);
    const one = await s.director.get<Json>(`/api/v1/dashboard?fresh=true&podScope=${s.pod.podId}`);
    const other = await s.director.get<Json>(
      `/api/v1/dashboard?fresh=true&podScope=${s.other.podId}`,
    );
    expect(other.unassigned.count).toBe(1);
    // Scopes of two Pods never overlap, and All pods includes both (and every task with no Pod).
    expect(one.unassigned.count).toBe(2);
    const all = await s.director.get<Json>('/api/v1/dashboard?fresh=true&podScope=all');
    expect(all.open.count).toBeGreaterThanOrEqual(one.open.count + other.open.count);
    expect(all.unassigned.count).toBeGreaterThanOrEqual(
      one.unassigned.count + other.unassigned.count,
    );
    expect(one.scope.unassignedNoPod).toBeGreaterThanOrEqual(0);
  });

  test('Technician: Unassigned equals the queue of the Pod, "your work" equals My Work for the same definitions', async () => {
    const sum = await s.tech1.get<Json>('/api/v1/dashboard?fresh=true&podScope=mine');
    expect(sum.unassigned.count).toBe(2);
    expect(await queue(s.tech1, sum.unassigned.query)).toBe(2);
    // The summary tiles and breakdowns are not theirs.
    expect(sum.open.count).toBe(0);
    expect(sum.byTaskType).toEqual([]);
    // Own work, whatever the scope: two open in P (soon, in progress) and the no-Pod overdue one.
    expect(sum.mine).toEqual({ open: 3, overdue: 2 });
    const myWork = await s.tech1.get<Json>('/api/v1/my-work?view=active&pageSize=1');
    expect(myWork.counts.active).toBe(sum.mine.open);
    const otherScope = await s.tech1.get<Json>(
      `/api/v1/dashboard?fresh=true&podScope=${s.pod.podId}`,
    );
    expect(otherScope.mine).toEqual(sum.mine);
  });
});

async function build(admin: Api, seed: Seeder): Promise<Scenario> {
  const worldA = await seed.world({ stepCount: 1 });
  const worldB = await seed.world({ stepCount: 1 });
  const [lead, tech1, tech2] = await Promise.all([
    seed.user(['Pod Lead'], 'conslead'),
    seed.user(['Data Technician'], 'constech'),
    seed.user(['Data Technician'], 'constech'),
  ]);
  const director = await seed.user(['Director'], 'consdir');
  const tag = uid();
  const pod = await seed.pod(`Consistency ${tag}`, [lead.userId, tech1.userId, tech2.userId]);
  const other = await seed.pod(`Consistency other ${tag}`, [tech2.userId]);
  const day = (n: number) => dateInZone(FIRM_ZONE, n);
  const priorities = (await admin.get<Json>('/api/v1/priorities')) as Json;
  const list: Json[] = (Array.isArray(priorities) ? priorities : priorities.items).filter(
    (p: Json) => p.isActive,
  );
  list.sort((a: Json, b: Json) => a.sortOrder - b.sortOrder);
  const [first, , third] = list;
  const inP = { assignedPodId: pod.podId };

  await seed.task(worldA, {
    ...inP,
    title: `u_over ${tag}`,
    dueDate: day(-3),
    priorityId: first.id,
  });
  await seed.task(worldA, { ...inP, title: `u_asap ${tag}`, priorityId: third.id });
  await seed.task(worldA, {
    ...inP,
    title: `t1_soon ${tag}`,
    assignedUserId: tech1.userId,
    dueDate: day(1),
  });
  await seed.task(worldB, {
    ...inP,
    title: `t1_prog ${tag}`,
    assignedUserId: tech1.userId,
    dueDate: day(-1),
    priorityId: first.id,
  });
  const hold = await seed.task(worldB, {
    ...inP,
    title: `t2_hold ${tag}`,
    assignedUserId: tech2.userId,
    dueDate: day(10),
  });
  const holdApi = new TaskApi(admin, hold.taskId);
  const held = await holdApi.changeStatus('ON_HOLD', 'Waiting on the client');
  expect(held.status, JSON.stringify(held.body)).toBeLessThan(300);
  const finish = async (world: typeof worldA, title: string, userId: number) => {
    const t = await seed.task(world, { ...inP, title, assignedUserId: userId });
    const api = new TaskApi(admin, t.taskId);
    await api.completeSteps(1);
    const done = await api.complete();
    expect(done.status, JSON.stringify(done.body)).toBeLessThan(300);
  };
  await finish(worldA, `lead_done ${tag}`, lead.userId);
  await finish(worldB, `t1_done ${tag}`, tech1.userId);
  const cancelled = await seed.task(worldA, {
    ...inP,
    title: `t2_cancel ${tag}`,
    assignedUserId: tech2.userId,
  });
  const cancel = await new TaskApi(admin, cancelled.taskId).cancel('Not needed');
  expect(cancel.status).toBeLessThan(300);

  // Outside P.
  await seed.task(worldA, {
    title: `nopod_over ${tag}`,
    assignedUserId: tech1.userId,
    dueDate: day(-2),
  });
  await seed.task(worldA, { assignedPodId: other.podId, title: `other_u ${tag}` });

  const as = async (user: { username: string }) => {
    const api = await Api.as(user.username);
    apis.push(api);
    return api;
  };
  return {
    pod,
    other,
    director: await as(director),
    lead: await as(lead),
    tech1: await as(tech1),
    people: { lead, tech1, tech2 },
    typeA: worldA.taskType,
    typeB: worldB.taskType,
  };
}
