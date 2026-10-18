import { Api, Json } from '../support/api';
import { expect, test } from '../support/fixtures';
import { Seeder, uid } from '../support/seed';
import { TaskApi } from '../support/tasks';
import { dateInZone, FIRM_ZONE } from '../support/time';

/**
 * My Work consistency audit (QA pass over the My Work epic #138). API level: for three people with different, overlapping sets of work, every
 * tab of My Work under every filter combination must give
 *
 *   - a tab count (`counts.<tab>`) equal to the grid total of that tab (`total`) and to the number of rows returned,
 *   - the same four counts whichever tab is asked for (the tab strip never changes when you switch tabs),
 *   - a grid total equal to the Task Queue total for the same person and the equivalent filters (what the "open in Task Queue" style links
 *     and the Dashboard's "Your work" tiles rely on), and the same set of tasks.
 *
 * 3 people x 4 tabs x 4 filter combinations = 48 checks. The database is shared, so each person is new and owns every task they are shown;
 * nothing here depends on global counts, the order of tests or the volume of data already in the database.
 */
const TABS = [
  { view: 'active', count: 'active' },
  { view: 'dueSoon', count: 'dueSoon' },
  { view: 'completed', count: 'completed' },
  { view: 'createdByMe', count: 'createdByMe' },
] as const;
type Tab = (typeof TABS)[number];

const OPEN = ['NEW', 'IN_PROGRESS', 'ON_HOLD'];
const CLOSED = ['COMPLETED', 'CANCELLED'];

interface Person {
  name: string;
  userId: number;
  api: Api;
}

interface Filters {
  label: string;
  /** Query string appended to both My Work and the Task Queue (no leading `&`). */
  query: string;
  /** The Task Queue status parameters for the "Created by me" tab: a request with no filter at all means open tasks only. */
  createdStatus: string[];
}

let people: Person[] = [];
let filters: Filters[] = [];
/** The TaskApi actions answer with the raw response; a setup step that failed must stop the scenario, not skew its numbers. */
function must(r: { status: number; body: Json }, what: string): void {
  if (r.status >= 300) throw new Error(`${what} -> ${r.status} ${JSON.stringify(r.body)}`);
}
/** Completes the only step of a task and then the task, as the dashboard audit does. */
async function finish(api: Api, taskId: number): Promise<void> {
  const task = new TaskApi(api, taskId);
  await task.completeSteps(1);
  must(await task.complete(), 'complete');
}
const today = (offset: number) => dateInZone(FIRM_ZONE, offset);

const qs = (parts: string[]) => parts.filter(Boolean).join('&');
const statusQuery = (codes: string[]) => codes.map((c) => `status=${c}`).join('&');

/** The Task Queue request that must give the same tasks as one My Work tab (see MyWorkAsync and TaskQueueRules). */
function queueQuery(tab: Tab, person: Person, f: Filters): string {
  switch (tab.view) {
    case 'active':
      return qs([`assignee=${person.userId}`, statusQuery(OPEN), f.query]);
    case 'dueSoon':
      // An explicit due date by the end of the day two days ahead, overdue included; ASAP never matches a due-date range.
      return qs([`assignee=${person.userId}`, statusQuery(OPEN), `dueTo=${today(2)}`, f.query]);
    case 'completed':
      // The Closed tab's default window is the last 90 days.
      return qs([
        `assignee=${person.userId}`,
        statusQuery(CLOSED),
        `completedFrom=${today(-90)}`,
        f.query,
      ]);
    default:
      return qs([`creator=${person.userId}`, statusQuery(f.createdStatus), f.query]);
  }
}

async function ids(api: Api, path: string): Promise<{ total: number; ids: number[] }> {
  const rows: number[] = [];
  let total = 0;
  for (let page = 1; page <= 5; page++) {
    const body = await api.get<Json>(
      `${path}${path.includes('?') ? '&' : '?'}page=${page}&pageSize=100`,
    );
    total = body.total;
    rows.push(...body.items.map((r: Json) => r.taskId as number));
    if (rows.length >= total) break;
  }
  return { total, ids: rows.sort((a, b) => a - b) };
}

async function build(admin: Api, seed: Seeder): Promise<void> {
  const worldA = await seed.world({ stepCount: 1 });
  const worldB = await seed.world({ stepCount: 1 });
  const priorities = await admin.get<{ id: number; label: string }[]>('/api/v1/priorities');
  const high = priorities.find((p) => p.label === 'High')!.id;
  const low = priorities.find((p) => p.label === 'Low')?.id ?? priorities[priorities.length - 1].id;
  const tag = uid();

  const users = [
    await seed.user(['Data Technician'], `mwc1-${tag}`),
    await seed.user(['Data Technician'], `mwc2-${tag}`),
    await seed.user(['Data Technician'], `mwc3-${tag}`),
  ];
  for (const u of users) {
    const api = await Api.as(u.username, { timeZone: FIRM_ZONE });
    people.push({ name: u.username, userId: u.userId, api });
  }

  const make = async (
    owner: Person,
    n: string,
    world: typeof worldA,
    extra: Json = {},
    as: Api = admin,
  ) => {
    const t = await seed.task(
      world,
      { title: `${n} ${tag}`, assignedUserId: owner.userId, ...extra },
      as,
    );
    return t;
  };

  // Each person gets a different mix. Everything is created by the System Admin unless the person creates it.
  for (const [i, p] of people.entries()) {
    const k = i + 1;
    await make(p, 'Asap', worldA, { priorityId: high });
    await make(p, 'Late', worldA, { dueDate: today(-3), priorityId: high });
    await make(p, 'Late small', worldB, { dueDate: today(-1), priorityId: low });
    await make(p, 'Today', worldB, { dueDate: today(0) });
    await make(p, 'In two days', worldA, { dueDate: today(2), priorityId: high });
    await make(p, 'Far', worldB, { dueDate: today(30) });
    const held = await make(p, 'Held', worldA, { dueDate: today(5) });
    must(
      await new TaskApi(admin, held.taskId).changeStatus('ON_HOLD', 'Waiting for the client'),
      'setup',
    );
    for (let n = 0; n < k; n++) await make(p, `Extra ${n}`, worldB, { dueDate: today(1 + n) });

    // Closed work: one completed, one cancelled (both inside the 90 day window of the Closed tab).
    const done = await make(p, 'Done', worldA, { priorityId: high });
    await finish(admin, done.taskId);
    const cancelled = await make(p, 'Cancelled', worldB);
    must(await new TaskApi(admin, cancelled.taskId).cancel('No longer needed'), 'setup');
    // ...and, when the stack allows a backdated row, one closed long ago (outside the window: on no count and in no grid).
    if (Seeder.canWriteLegacyText()) {
      const old = await make(p, 'Old done', worldA);
      await finish(admin, old.taskId);
      seed.ageTask(old.taskId, { createdDaysAgo: 200, completedDaysAgo: 150 });
    }

    // Created by the person: one open task for a colleague, one open and unassigned, one for themselves that they then close.
    const next = people[(i + 1) % people.length];
    const mine = (n: string, extra: Json = {}) =>
      seed.task(worldA, { title: `${n} ${tag}`, ...extra }, p.api);
    await mine('Made for colleague', { assignedUserId: next.userId, dueDate: today(1) });
    await mine('Made unassigned', { priorityId: high });
    const own = await mine('Made for me', { assignedUserId: p.userId, priorityId: high });
    await finish(p.api, own.taskId);
  }

  filters = [
    { label: 'no filter', query: '', createdStatus: OPEN },
    { label: 'priority High', query: `priority=${high}`, createdStatus: [] },
    { label: 'task type B', query: `type=${worldB.taskType.id}`, createdStatus: [] },
    { label: 'overdue', query: 'overdue=true', createdStatus: [] },
  ];
}

test.describe.configure({ mode: 'serial' });

test.describe('My Work consistency across tabs and filters (API)', () => {
  test.beforeAll(async ({ admin, seed }) => {
    test.setTimeout(600_000);
    people = [];
    await build(admin, seed);
  });

  test.afterAll(async () => {
    for (const p of people) await p.api.dispose();
  });

  test('the seeded people have the numbers the scenario was built for (a guard against a silently empty comparison)', async () => {
    for (const [i, p] of people.entries()) {
      const k = i + 1;
      const active = await p.api.get<Json>('/api/v1/my-work?view=active&pageSize=100');
      // Asap, Late, Late small, Today, In two days, Far, Held, k Extra, and the open task a colleague made for them.
      expect(active.counts.active, p.name).toBe(8 + k);
      // Late, Late small, Today, In two days, the colleague's task (due tomorrow) and the Extra tasks due within two days.
      const dueSoon = 5 + Math.min(k, 2);
      expect(active.counts.dueSoon, p.name).toBe(dueSoon);
      // Done, Cancelled and the closed task made for themselves; the old one is outside the window.
      expect(active.counts.completed, p.name).toBe(3);
      // Open tasks made by the person: for a colleague and unassigned.
      expect(active.counts.createdByMe, p.name).toBe(2);
    }
  });

  for (const personIndex of [0, 1, 2]) {
    test(`person ${personIndex + 1}: every tab under every filter agrees with its grid and with the Task Queue (16 combinations)`, async () => {
      const p = people[personIndex];
      for (const f of filters) {
        const counts: Record<string, number>[] = [];
        for (const tab of TABS) {
          const label = `${p.name} / ${tab.view} / ${f.label}`;
          const path = `/api/v1/my-work?view=${tab.view}${f.query ? `&${f.query}` : ''}`;
          const mine = await ids(p.api, path);
          const first = await p.api.get<Json>(`${path}&pageSize=100`);
          counts.push(first.counts);

          // Tab count = grid total = rows.
          expect(first.counts[tab.count], `${label}: count equals total`).toBe(first.total);
          expect(mine.total, label).toBe(first.total);
          expect(mine.ids.length, `${label}: rows equal total`).toBe(first.total);

          // Grid = Task Queue for the same person and the equivalent filters.
          const queue = await ids(p.api, `/api/v1/task-queue?${queueQuery(tab, p, f)}`);
          expect(queue.total, `${label}: Task Queue total (${queueQuery(tab, p, f)})`).toBe(
            mine.total,
          );
          expect(queue.ids, `${label}: same tasks as the Task Queue`).toEqual(mine.ids);
        }
        // The strip does not change with the tab.
        for (const c of counts)
          expect(c, `${p.name} / ${f.label}: counts across tabs`).toEqual(counts[0]);
      }
    });
  }

  test('the needs-attention strip equals the Task Queue for the same person', async () => {
    for (const p of people) {
      const page = await p.api.get<Json>('/api/v1/my-work?view=active&pageSize=1');
      const attention = page.attention;
      const overdue = await p.api.get<Json>(
        `/api/v1/task-queue?assignee=${p.userId}&overdue=true&pageSize=1`,
      );
      expect(attention.overdue, `${p.name}: strip overdue equals the Task Queue`).toBe(
        overdue.total,
      );
      const asap = await p.api.get<Json>(
        `/api/v1/task-queue?assignee=${p.userId}&asap=true&${statusQuery(OPEN)}&pageSize=1`,
      );
      expect(attention.asap, `${p.name}: strip ASAP equals the Task Queue`).toBe(asap.total);
      const held = await p.api.get<Json>(
        `/api/v1/task-queue?assignee=${p.userId}&status=ON_HOLD&pageSize=1`,
      );
      expect(attention.onHold, `${p.name}: strip On hold equals the Task Queue`).toBe(held.total);
    }
  });
});
