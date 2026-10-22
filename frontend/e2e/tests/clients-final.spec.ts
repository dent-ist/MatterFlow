import fs from 'node:fs';
import path from 'node:path';
import { Locator, Page } from '@playwright/test';
import { ADMIN_USER, Api, Json } from '../support/api';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Seeder, uid } from '../support/seed';
import { TaskApi } from '../support/tasks';
import { FIRM_ZONE, dateInZone } from '../support/time';

/**
 * Final verification of the Clients, Matters and Projects epic (#245, WP15, #287): the checks that cut across the six screens after
 * every package landed.
 *
 *  1. The contract over Clients, Matters and Projects lists and Client, Matter and Project Details with every tab, at 1366x768, 1920x1080,
 *     768x1024 and 375x812: axe 0 (WCAG 2.2 AA and best-practice), no page-level sideways scroll, rows of 44 px (cards below 640 px), the
 *     header limits of the long-name records (tabs above y 200 at 1366, 260 on a phone), no Status clipped in a grid that has no scroll hint.
 *  2. The counts-equality check: 20 combinations (client, matter, project; with and without overdue work; three time zones; two empty
 *     records) in which the list columns, the record summary, the Task Queue totals behind the strip links and the Dashboard tiles of the
 *     pod that holds the work agree. Counts are the same for the whole viewer: re-checked in the browser for three people with different
 *     permissions (System Admin, all View permissions, no Task.View).
 *  3. The state smoke: 200 percent zoom at 1366 (a 683 px window), reduced motion, a lost connection on a list, the Tab stops before the
 *     first row (recorded).
 *
 * Every test works on its own tagged data and asserts nothing about global counts. Screenshots go to E2E_SCREENSHOTS when it is set
 * (docs/ux/clients-review/fixes/final).
 */
const OUT = process.env['E2E_SCREENSHOTS'];

const SIZES: [number, number][] = [
  [1366, 768],
  [1920, 1080],
  [768, 1024],
  [375, 812],
];

const ZONES = ['Pacific/Kiritimati', FIRM_ZONE, 'Etc/GMT+12'];
const OPEN = 'status=NEW&status=IN_PROGRESS&status=ON_HOLD';

const CLIENT_150 =
  'Meridian Pharmaceuticals Holdings International Incorporated and its Subsidiaries, Affiliates, Successors and Assigns in the Consolidated Proceedings'
    .padEnd(150, ' x')
    .slice(0, 150);
const MATTER_150 =
  'In re Meridian Pharmaceuticals Securities Litigation - Consolidated Multidistrict Class Action Proceedings, Second Request for Production of Documents'
    .padEnd(150, ' x')
    .slice(0, 150);
const PROJECT_130 =
  'Second request custodian collections, privilege review, rolling productions and the final certification of substantial completion for the court'
    .padEnd(130, ' x')
    .slice(0, 130);

const day = (offset: number) => dateInZone(FIRM_ZONE, offset);

async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  const size = page.viewportSize()!;
  await page.screenshot({ path: path.join(OUT, `${name}-${size.width}x${size.height}.png`) });
}

async function axeClean(page: Page, what: string): Promise<void> {
  if (axeAvailable()) expect(await axeViolations(page), what).toEqual([]);
}

async function noSideways(page: Page, what: string): Promise<void> {
  const m = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    inner: window.innerWidth,
  }));
  expect(m.doc, `${what}: page-level horizontal scroll`).toBeLessThanOrEqual(m.inner);
}

const top = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((el) => el.getBoundingClientRect().top);

/** Every table of the page: its Status header is inside the box that holds it, or the box scrolls and says so (the named scroll region). */
async function statusNotClipped(page: Page, what: string): Promise<void> {
  const tables = await page.locator('main table').count();
  for (let i = 0; i < tables; i++) {
    const table = page.locator('main table').nth(i);
    if (!(await table.isVisible())) continue;
    const result = await table.evaluate((t) => {
      const th = [...t.querySelectorAll('thead th')].find((h) =>
        /^Status/.test((h.textContent ?? '').trim()),
      );
      if (!th) return null;
      let box: HTMLElement | null = t.parentElement;
      while (box && !/(auto|scroll)/.test(getComputedStyle(box).overflowX)) box = box.parentElement;
      if (!box) return { fits: true, scrolls: false, named: false };
      const b = box.getBoundingClientRect();
      const h = th.getBoundingClientRect();
      return {
        fits: h.right <= b.right + 1,
        scrolls: box.scrollWidth > box.clientWidth + 1,
        named:
          /scrollable/.test(box.getAttribute('aria-label') ?? '') ||
          box.hasAttribute('data-scroll-hint'),
      };
    });
    if (!result) continue;
    expect(
      result.fits || (result.scrolls && result.named),
      `${what}: table ${i} clips Status without the scroll hint`,
    ).toBe(true);
  }
}

/** The heights of the data rows of the visible list: 44 px each. */
async function rowHeights(page: Page): Promise<number[]> {
  return page
    .locator('main table tbody tr')
    .evaluateAll((rows) =>
      rows
        .filter((r) => (r as HTMLElement).offsetParent !== null && r.querySelector('td a'))
        .map((r) => Math.round(r.getBoundingClientRect().height * 10) / 10),
    );
}

interface Data {
  token: string;
  client: Json;
  matter: Json;
  project: Json;
  longClient: Json;
  longMatter: Json;
  longProject: Json;
}
let data: Data;

test.describe('Clients final verification (#287)', () => {
  test.beforeAll(async ({ seed }) => {
    test.setTimeout(240_000);
    const token = uid();
    const world = await seed.world({ stepCount: 1 });
    const client = await seed.client({ name: `Final client ${token}` });
    const matter = await seed.matter({ client, name: `Final matter ${token}` });
    await seed.matter({ client, number: '00002', name: `Final second matter ${token}` });
    const project = await seed.project(matter, `Final project ${token}`);
    const longClient = await seed.client({ name: `${CLIENT_150} ${token}`.slice(0, 150) });
    const longMatter = await seed.matter({
      client: longClient,
      name: `${MATTER_150} ${token}`.slice(0, 150),
    });
    const longProject = await seed.project(longMatter, `${PROJECT_130} ${token}`.slice(0, 130));
    for (const [m, p] of [
      [matter, project],
      [longMatter, longProject],
    ]) {
      await seed.task(
        { ...world, matter: m },
        { title: `Final overdue ${token}`, projectId: p.projectId, dueDate: day(-3) },
      );
      await seed.task(
        { ...world, matter: m },
        { title: `Final far ${token}`, projectId: p.projectId, dueDate: day(20) },
      );
      await seed.task(
        { ...world, matter: m },
        { title: `Final matter-level ${token}`, dueDate: day(1) },
      );
    }
    data = { token, client, matter, project, longClient, longMatter, longProject };
  });

  // --- 1. the contract --------------------------------------------------------------------------------------------

  for (const [w, h] of SIZES) {
    test(`contract at ${w}x${h}: six screens and every tab: axe 0, no sideways scroll, 44 px rows, header limits, Status not clipped`, async ({
      page,
    }) => {
      test.setTimeout(240_000);
      await page.setViewportSize({ width: w, height: h });
      const phone = w < 640;
      const d = data;
      const screens: {
        key: string;
        url: string;
        kind: 'list' | 'record';
        tabs?: boolean;
        long?: boolean;
        grid?: boolean;
      }[] = [
        { key: 'clients-list', url: `/clients?name=${d.token}`, kind: 'list' },
        { key: 'matters-list', url: `/matters?name=${d.token}`, kind: 'list' },
        { key: 'projects-list', url: `/projects?name=${d.token}`, kind: 'list' },
        {
          key: 'client-overview',
          url: `/clients/${d.longClient.clientId}`,
          kind: 'record',
          tabs: true,
          long: true,
        },
        {
          key: 'client-matters',
          url: `/clients/${d.client.clientId}?tab=matters`,
          kind: 'record',
          tabs: true,
        },
        {
          key: 'matter-overview',
          url: `/matters/${d.longMatter.matterId}`,
          kind: 'record',
          tabs: true,
          long: true,
        },
        {
          key: 'matter-tasks',
          url: `/matters/${d.matter.matterId}?tab=tasks`,
          kind: 'record',
          tabs: true,
        },
        {
          key: 'matter-projects',
          url: `/matters/${d.matter.matterId}?tab=projects`,
          kind: 'record',
          tabs: true,
        },
        {
          key: 'matter-assets',
          url: `/matters/${d.matter.matterId}?tab=assets`,
          kind: 'record',
          tabs: true,
        },
        {
          key: 'project-tasks',
          url: `/projects/${d.longProject.projectId}`,
          kind: 'record',
          tabs: true,
          long: true,
        },
        {
          key: 'project-details',
          url: `/projects/${d.project.projectId}?tab=details`,
          kind: 'record',
          tabs: true,
        },
      ];
      for (const s of screens) {
        await page.goto(s.url);
        await expect(page.locator('main h1, main [data-record-header] h1').first()).toBeVisible();
        await expect(page.locator('[data-record-skeleton]')).toHaveCount(0);
        if (s.kind === 'list') {
          const rows = phone
            ? page.locator('mf-record-card-list li')
            : page.locator('main table tbody tr td a');
          await expect(rows.first()).toBeVisible();
          if (!phone) {
            const heights = await rowHeights(page);
            expect(heights.length, `${s.key}: rows`).toBeGreaterThan(0);
            for (const rowHeight of heights) expect(rowHeight, `${s.key}: row height`).toBe(44);
          }
        } else {
          await expect(page.locator('[role=tablist]')).toBeVisible();
          const tabsTop = await top(page, '[role=tablist]');
          // A matter also carries the project manager line and the small health strip (epic #667): up to 50 px more on a desktop, 130 on a phone.
          const extra = s.key.startsWith('matter') ? (phone ? 130 : 50) : 0;
          if (w >= 1024) expect(tabsTop, `${s.key}: tabs y`).toBeLessThanOrEqual(200 + extra);
          else if (phone)
            expect(tabsTop, `${s.key}: tabs y`).toBeLessThanOrEqual((s.long ? 260 : 200) + extra);
          if (s.long) console.log(`${s.key} ${w}x${h}: tabs at y ${Math.round(tabsTop)}`);
        }
        await statusNotClipped(page, `${s.key} at ${w}`);
        await noSideways(page, `${s.key} at ${w}`);
        await axeClean(page, `${s.key} at ${w}x${h}`);
        await shot(page, s.key);
      }
    });
  }

  // --- 2. counts equality -----------------------------------------------------------------------------------------

  interface Counted {
    name: string;
    client: Json;
    matter: Json;
    project: Json;
    pod: Json;
    /** Seeded for the Open / Overdue / ASAP / On hold numbers the page must show for the whole client. */
    expected: { open: number; overdue: number; asap: number; onHold: number };
    projectExpected: { open: number; overdue: number };
  }
  let withOverdue: Counted;
  let withoutOverdue: Counted;
  let emptyClient: Json;
  let emptyMatter: Json;
  let emptyProject: Json;

  async function counted(seed: Seeder, name: string, overdue: boolean): Promise<Counted> {
    const tag = `${name} ${uid()}`;
    const world = await seed.world({ stepCount: 1 });
    const client = await seed.client({ name: `Counts client ${tag}` });
    const matter = await seed.matter({ client, name: `Counts matter ${tag}` });
    const project = await seed.project(matter, `Counts project ${tag}`);
    const lead = await seed.user(['Pod Lead'], 'counts');
    const pod = await seed.pod(undefined, [lead.userId]);
    const mk = async (title: string, due: number | null, projectId?: number) =>
      seed.task(
        { ...world, matter },
        {
          title: `${title} ${tag}`,
          assignedPodId: pod.podId,
          ...(due === null ? {} : { dueDate: day(due) }),
          ...(projectId ? { projectId } : {}),
        },
      );
    await mk('p far', 25, project.projectId);
    await mk('p asap', null, project.projectId);
    await mk('m tomorrow', 1);
    await mk('m far', 30);
    if (overdue) {
      await mk('p late', -4, project.projectId);
      await mk('m late', -6);
    }
    const held = await mk('m held', 40);
    expect(
      (await new TaskApi(seed.admin, held.taskId).changeStatus('ON_HOLD', 'Waiting')).status,
    ).toBe(200);
    return {
      name: tag,
      client,
      matter,
      project,
      pod,
      expected: { open: overdue ? 7 : 5, overdue: overdue ? 2 : 0, asap: 1, onHold: 1 },
      projectExpected: { open: overdue ? 3 : 2, overdue: overdue ? 1 : 0 },
    };
  }

  test.beforeAll(async ({ seed }) => {
    test.setTimeout(240_000);
    withOverdue = await counted(seed, 'late', true);
    withoutOverdue = await counted(seed, 'calm', false);
    emptyClient = await seed.client({ name: `Counts empty client ${uid()}` });
    emptyMatter = await seed.matter({ client: emptyClient, name: `Counts empty matter ${uid()}` });
    emptyProject = await seed.project(emptyMatter, `Counts empty project ${uid()}`);
  });

  const total = async (api: Api, query: string): Promise<number> =>
    (await api.get<Json>(`/api/v1/task-queue?${query}&pageSize=1`)).total;

  /** The Task Queue totals behind the five strip links of a record. */
  async function queueNumbers(api: Api, scope: string) {
    return {
      open: await total(api, `${scope}&${OPEN}`),
      overdue: await total(api, `${scope}&${OPEN}&overdue=true`),
      asap: await total(api, `${scope}&${OPEN}&asap=true`),
      onHold: await total(api, `${scope}&status=ON_HOLD`),
    };
  }

  const KINDS = ['client', 'matter', 'project'] as const;
  type Kind = (typeof KINDS)[number];
  const idOf = (kind: Kind, c: { client: Json; matter: Json; project: Json }) =>
    kind === 'client'
      ? c.client.clientId
      : kind === 'matter'
        ? c.matter.matterId
        : c.project.projectId;
  const list = (kind: Kind) =>
    kind === 'client' ? 'clients' : kind === 'matter' ? 'matters' : 'projects';

  for (const zone of ZONES) {
    for (const [label, pick] of [
      ['with overdue', () => withOverdue],
      ['without overdue', () => withoutOverdue],
    ] as const) {
      for (const kind of KINDS) {
        test(`counts: ${kind} ${label} in ${zone}: list column, summary, Task Queue totals${kind === 'project' ? '' : ' and the Dashboard tiles of the pod'} agree`, async () => {
          const c = pick();
          const api = await Api.as(ADMIN_USER, { timeZone: zone });
          try {
            const id = idOf(kind, c);
            const item = (await api.get<Json>(`/api/v1/${list(kind)}/${id}`)) as Json;
            const summary = await api.get<Json>(`/api/v1/${list(kind)}/${id}/summary`);
            const scoped = await queueNumbers(api, `${kind}=${id}`);
            // The list column, the summary and the queue are one number.
            expect(item.openTaskCount, 'record open').toBe(scoped.open);
            expect(item.overdueTaskCount, 'record overdue').toBe(scoped.overdue);
            expect(summary.openTasks, 'summary open').toBe(scoped.open);
            expect(summary.overdue, 'summary overdue').toBe(scoped.overdue);
            expect(summary.asap, 'summary asap').toBe(scoped.asap);
            expect(summary.onHold, 'summary on hold').toBe(scoped.onHold);
            // The list endpoint answers the same numbers for the row.
            const row = (
              await api.get<Json>(`/api/v1/${list(kind)}?name=${encodeURIComponent(item.name)}`)
            ).items.find((r: Json) => r.name === item.name);
            expect([row.openTaskCount, row.overdueTaskCount]).toEqual([
              scoped.open,
              scoped.overdue,
            ]);
            // The seeded numbers (a viewer's zone moves a date-only due date by a day at most: overdue is the seeded count or one more).
            if (kind === 'project') {
              expect(scoped.open).toBe(c.projectExpected.open);
              expect(scoped.overdue).toBeGreaterThanOrEqual(c.projectExpected.overdue);
            } else {
              expect(scoped.open).toBe(c.expected.open);
              expect(scoped.overdue).toBeGreaterThanOrEqual(c.expected.overdue);
              expect(scoped.overdue).toBeLessThanOrEqual(c.expected.overdue + 1);
              expect(scoped.asap).toBe(c.expected.asap);
              expect(scoped.onHold).toBe(c.expected.onHold);
              // The pod holds exactly this client's work: the Dashboard tiles say the same, and their queries return the same totals.
              const dash = await api.get<Json>(
                `/api/v1/dashboard?fresh=true&podScope=${c.pod.podId}`,
              );
              expect(dash.open.count, 'tile open').toBe(scoped.open);
              expect(dash.overdue.count, 'tile overdue').toBe(scoped.overdue);
              expect(dash.asapOpen.count, 'tile asap').toBe(scoped.asap);
              expect(dash.onHold.count, 'tile on hold').toBe(scoped.onHold);
              expect(dash.dueSoon.count, 'tile due soon').toBe(summary.dueSoon);
              expect(
                await total(api, `${dash.dueSoon.query}&${kind}=${id}`),
                'due soon behind the link',
              ).toBe(summary.dueSoon);
            }
          } finally {
            await api.dispose();
          }
        });
      }
    }
  }

  test('counts: a record without work shows zeros everywhere (client, matter, project)', async () => {
    const api = await Api.as(ADMIN_USER, { timeZone: ZONES[0] });
    try {
      for (const [kind, id] of [
        ['client', emptyClient.clientId],
        ['matter', emptyMatter.matterId],
        ['project', emptyProject.projectId],
      ] as const) {
        const summary = await api.get<Json>(`/api/v1/${list(kind)}/${id}/summary`);
        expect([summary.openTasks, summary.overdue, summary.asap, summary.onHold], kind).toEqual([
          0, 0, 0, 0,
        ]);
        expect(await total(api, `${kind}=${id}&${OPEN}`), kind).toBe(0);
      }
    } finally {
      await api.dispose();
    }
  });

  test('counts: a person without Task.View gets no numbers (null, not a 403 and not a fake zero)', async ({
    seed,
  }) => {
    const role = await seed.role(['Client.View', 'Matter.View', 'Project.View'], 'E2E no tasks');
    const user = await seed.user([role.name], 'notasks');
    const api = await Api.as(user.username);
    try {
      for (const [kind, id] of [
        ['client', withOverdue.client.clientId],
        ['matter', withOverdue.matter.matterId],
        ['project', withOverdue.project.projectId],
      ] as const) {
        const item = await api.get<Json>(`/api/v1/${list(kind)}/${id}`);
        expect(item.openTaskCount ?? null, kind).toBeNull();
        expect(item.overdueTaskCount ?? null, kind).toBeNull();
      }
    } finally {
      await api.dispose();
    }
  });

  /** The numbers of a visible strip, by key. */
  async function strip(root: Locator): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const key of ['open', 'overdue', 'dueSoon', 'asap', 'onHold']) {
      const n = root.locator(`[data-strip-item="${key}"] .n`);
      if ((await n.count()) > 0) out[key] = Number((await n.first().textContent())?.trim());
    }
    return out;
  }

  const people: { label: string; permissions: string[] | null; tasks: boolean }[] = [
    { label: 'System Admin', permissions: null, tasks: true },
    {
      label: 'all View permissions',
      permissions: ['Client.View', 'Matter.View', 'Project.View', 'Task.View', 'Asset.View'],
      tasks: true,
    },
    {
      label: 'no Task.View',
      permissions: ['Client.View', 'Matter.View', 'Project.View'],
      tasks: false,
    },
  ];

  for (const person of people) {
    test(`counts in the browser for ${person.label}: list columns, Overview strip and Tasks strip equal the Task Queue behind each link`, async ({
      seed,
      asUser,
      page,
    }) => {
      test.setTimeout(180_000);
      let who = page;
      let api: Api | null = null;
      if (person.permissions) {
        const role = await seed.role(person.permissions, `E2E ${person.label}`);
        const user = await seed.user([role.name], 'final');
        who = await asUser(user.username);
        api = await Api.as(user.username);
      } else {
        api = await Api.as(ADMIN_USER);
      }
      await who.setViewportSize({ width: 1366, height: 768 });
      const c = withOverdue;
      const none = { open: 0, overdue: 0, asap: 0, onHold: 0 };
      const queue = person.tasks ? await queueNumbers(api, `client=${c.client.clientId}`) : none;
      const matterQueue = person.tasks
        ? await queueNumbers(api, `matter=${c.matter.matterId}`)
        : none;
      const projectQueue = person.tasks
        ? await queueNumbers(api, `project=${c.project.projectId}`)
        : none;

      // Lists: the columns of the row.
      for (const [url, grid, nameText, q] of [
        [
          `/clients?name=${encodeURIComponent(c.client.name)}`,
          'Clients list',
          c.client.name,
          queue,
        ],
        [
          `/matters?name=${encodeURIComponent(c.matter.name)}`,
          'Matters list',
          c.matter.name,
          matterQueue,
        ],
        [
          `/projects?name=${encodeURIComponent(c.project.name)}`,
          'Projects list',
          c.project.name,
          projectQueue,
        ],
      ] as const) {
        await who.goto(url);
        const region = who.getByRole('region', { name: `${grid}, scrollable` });
        const row = region.locator('tbody tr', { hasText: nameText });
        await expect(row).toBeVisible();
        if (!person.tasks) {
          await expect(row.locator('[data-count]')).toHaveCount(0);
          continue;
        }
        const open = Number((await row.locator('[data-count=open] a').innerText()).trim());
        expect(open, `${grid} open`).toBe(q.open);
        const overdueLink = row.locator('[data-count=overdue] a');
        const overdue =
          (await overdueLink.count()) > 0 ? Number((await overdueLink.innerText()).trim()) : 0;
        expect(overdue, `${grid} overdue`).toBe(q.overdue);
        await row.locator('[data-count=open] a').click();
        await expect(who.locator('[data-range]')).toContainText(`of ${q.open}`);
      }

      // Client Overview strip.
      await who.goto(`/clients/${c.client.clientId}`);
      const clientStrip = who.locator('[data-client-overview] [data-strip]');
      if (!person.tasks) {
        await expect(who.locator('[role=tablist]')).toBeVisible();
        await expect(clientStrip).toHaveCount(0);
        await who.goto(`/matters/${c.matter.matterId}`);
        await expect(who.locator('[data-matter-overview] [data-strip]')).toHaveCount(0);
        await who.goto(`/projects/${c.project.projectId}`);
        await expect(who.locator('mf-scoped-tasks [data-strip]')).toHaveCount(0);
        return;
      }
      await expect(clientStrip).toBeVisible();
      const clientNums = await strip(clientStrip);
      expect(clientNums).toMatchObject({
        open: queue.open,
        overdue: queue.overdue,
        asap: queue.asap,
        onHold: queue.onHold,
      });
      await clientStrip.locator('[data-strip-item="overdue"]').click();
      await expect(who.locator('[data-range]')).toContainText(`of ${queue.overdue}`);

      // Matter Overview strip and the toggle strip over the Tasks grid.
      await who.goto(`/matters/${c.matter.matterId}`);
      const matterStrip = who.locator('[data-matter-overview] [data-strip]');
      await expect(matterStrip).toBeVisible();
      expect(await strip(matterStrip)).toMatchObject({
        open: matterQueue.open,
        overdue: matterQueue.overdue,
        asap: matterQueue.asap,
        onHold: matterQueue.onHold,
      });
      await who.goto(`/matters/${c.matter.matterId}?tab=tasks`);
      const tasksStrip = who.locator('mf-scoped-tasks [data-strip]');
      await expect(tasksStrip).toBeVisible();
      expect(await strip(tasksStrip)).toMatchObject({
        open: matterQueue.open,
        overdue: matterQueue.overdue,
      });
      await tasksStrip.locator('[data-strip-item="overdue"]').click();
      await expect(who.locator('mf-scoped-tasks [data-range]')).toContainText(
        `of ${matterQueue.overdue}`,
      );

      // Project Tasks strip and the tab count.
      await who.goto(`/projects/${c.project.projectId}`);
      const projectStrip = who.locator('mf-scoped-tasks [data-strip]');
      await expect(projectStrip).toBeVisible();
      expect(await strip(projectStrip)).toMatchObject({
        open: projectQueue.open,
        overdue: projectQueue.overdue,
      });
      await expect(who.getByRole('tab', { name: /^Tasks/ })).toContainText(
        `(${projectQueue.open})`,
      );
      await shot(who, `counts-${person.label.replace(/\W+/g, '-')}`);
      if (who !== page) await who.close();
    });
  }

  // --- 3. states and keyboard -------------------------------------------------------------------------------------

  test('200 percent zoom at 1366 (a 683 px window): the six screens fit, axe 0', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 683, height: 384 });
    const d = data;
    for (const [key, url] of [
      ['clients', `/clients?name=${d.token}`],
      ['matters', `/matters?name=${d.token}`],
      ['projects', `/projects?name=${d.token}`],
      ['client', `/clients/${d.client.clientId}`],
      ['matter', `/matters/${d.matter.matterId}`],
      ['project', `/projects/${d.project.projectId}`],
    ] as const) {
      await page.goto(url);
      await expect(page.locator('main h1').first()).toBeVisible();
      await expect(page.locator('[data-record-skeleton]')).toHaveCount(0);
      await noSideways(page, `${key} at 683`);
      await statusNotClipped(page, `${key} at 683`);
      await axeClean(page, `${key} at 200 percent zoom`);
    }
    await shot(page, 'zoom-200');
  });

  test('reduced motion: lists and records render, the tab strip does not animate, axe 0', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/clients?name=${data.token}`);
    await expect(page.locator('main table tbody tr td a').first()).toBeVisible();
    await axeClean(page, 'clients list, reduced motion');
    await page.goto(`/matters/${data.matter.matterId}`);
    await expect(page.locator('[role=tablist]')).toBeVisible();
    const animated = await page.evaluate(
      () =>
        document
          .getAnimations()
          .filter(
            (a) =>
              (a.effect as KeyframeEffect | null)?.getComputedTiming().duration !== 0 &&
              a.playState === 'running',
          ).length,
    );
    expect(animated, 'running animations').toBe(0);
    await axeClean(page, 'matter, reduced motion');
  });

  test('a lost connection on a list: the error says so, Retry fails again while offline, and the rows come back by themselves when the connection does', async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/clients?name=${data.token}`);
    await expect(page.locator('main table tbody tr td a').first()).toBeVisible();
    await context.setOffline(true);
    await page.getByRole('columnheader', { name: /^Name/ }).getByRole('button').first().click();
    // The offline banner has its own Retry (it belongs to the whole app); this one is the list's.
    const retry = page
      .getByLabel('Clients list, scrollable')
      .getByRole('button', { name: 'Retry' });
    await expect(retry).toBeVisible();
    await axeClean(page, 'clients list, offline');
    // Retry while still offline reads again and fails again, with the same message and the button still there.
    await retry.click();
    await expect(retry).toBeVisible();
    // When the connection returns the list reads itself once (the shared list state, #611): no click is needed and the button goes.
    await context.setOffline(false);
    await expect(page.locator('main table tbody tr td a').first()).toBeVisible();
    await expect(retry).toHaveCount(0);
  });

  test('Tab stops before the first row of each list (recorded; the skip link is Tab 1)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    const stops: Record<string, number> = {};
    for (const [key, url] of [
      ['clients', `/clients?name=${data.token}`],
      ['matters', `/matters?name=${data.token}`],
      ['projects', `/projects?name=${data.token}`],
    ] as const) {
      await page.goto(url);
      await expect(page.locator('main table tbody tr td a').first()).toBeVisible();
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      let n = 0;
      for (n = 1; n <= 80; n++) {
        await page.keyboard.press('Tab');
        if (await page.evaluate(() => !!document.activeElement?.matches('tbody a.pg-name'))) break;
      }
      stops[key] = n;
      expect(n, `${key}: Tab stops to the first row`).toBeLessThanOrEqual(60);
    }
    console.log('Clients Tab stops before the first row', JSON.stringify(stops));
    test.info().annotations.push({ type: 'tab-stops', description: JSON.stringify(stops) });
  });
});
