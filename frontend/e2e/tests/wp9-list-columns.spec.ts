import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { Api, Json } from '../support/api';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Seeder, uid } from '../support/seed';
import { TaskApi } from '../support/tasks';
import { FIRM_ZONE, dateInZone } from '../support/time';

/**
 * Clients UX epic, WP9 list columns (#266 Open tasks and Overdue, #267 the Projects list, #268 the name is the link). On Clients, Matters,
 * Projects and the client's Matters tab: the counts equal the Task Queue totals behind their links, sorting by Open tasks and Overdue works
 * (first click descending, in the URL, survives a reload), the name is the one link and the number is plain text, the Projects list shows
 * the matter (shared two-line cell) and the client, a viewer without Task.View gets no count columns, and every list passes axe, never
 * scrolls the page sideways, keeps 44 px rows and never clips Status at 1366x768, 1920x1080, 768x1024 and 375x812.
 * Screenshots go to E2E_SCREENSHOTS when it is set (docs/ux/clients-review/fixes/wp9).
 */
const OUT = process.env['E2E_SCREENSHOTS'];

const SIZES = [
  [1366, 768],
  [1920, 1080],
  [768, 1024],
  [375, 812],
] as const;

const grid = (page: Page, name: string) =>
  page.getByRole('region', { name: `${name}, scrollable` });

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
  const widths = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    inner: window.innerWidth,
  }));
  expect(widths.doc, `${what}: page scrolls sideways`).toBeLessThanOrEqual(widths.inner);
}

/** The names of the data rows (the link in the `col`-th cell), in order. */
async function names(page: Page, region: string, col = 2): Promise<string[]> {
  return grid(page, region)
    .locator(`tbody tr:not([data-skeleton]):not(.gb-state) td:nth-child(${col}) a.pg-name`)
    .evaluateAll((els) => els.map((e) => e.getAttribute('title') ?? e.textContent!.trim()));
}

/** Waits for the first row to be this name. */
async function expectFirst(page: Page, region: string, expected: string, col = 2): Promise<void> {
  await expect.poll(async () => (await names(page, region, col))[0]).toBe(expected);
}

/** Waits for the list to show these names in this order (a sort reloads the rows after the address changed). */
async function expectNames(page: Page, region: string, expected: string[], col = 2): Promise<void> {
  await expect.poll(() => names(page, region, col)).toEqual(expected);
}

/** What a count cell shows: the digits of a link or of a plain 0, "-" for the dash of a zero overdue. */
async function countOf(
  row: ReturnType<Page['locator']>,
  kind: 'open' | 'overdue',
): Promise<number> {
  const cell = row.locator(`[data-count=${kind}]`);
  const link = cell.locator('a');
  if ((await link.count()) > 0) return Number((await link.innerText()).trim());
  return 0;
}

interface World {
  token: string;
  client: Json;
  m1: Json;
  m2: Json;
  project: Json;
  sort: Json[]; // three clients with 1, 3 and 2 open tasks
  longProject: Json;
}

async function build(seed: Seeder, admin: Api): Promise<World> {
  const token = uid();
  const base = await seed.world(); // a task type and a workflow to create tasks with
  const client = await seed.client({ name: `Wp9 client ${token}` });
  const m1 = await seed.matter({ client, number: '00001', name: `Wp9 matter ${token} one` });
  const m2 = await seed.matter({ client, number: '00002', name: `Wp9 matter ${token} two` });
  const project = await seed.project(m1, `Wp9 project ${token}`);
  const w1 = { matter: m1, taskType: base.taskType, workflow: base.workflow };
  const w2 = { matter: m2, taskType: base.taskType, workflow: base.workflow };
  await seed.task(w1, { title: `Wp9 over ${token}`, dueDate: dateInZone(FIRM_ZONE, -3) });
  await seed.task(w1, { title: `Wp9 asap ${token}` });
  await seed.task(w1, { title: `Wp9 later ${token}`, dueDate: dateInZone(FIRM_ZONE, 5) });
  await seed.task(w1, {
    title: `Wp9 project over ${token}`,
    dueDate: dateInZone(FIRM_ZONE, -2),
    projectId: project.projectId,
  });
  await seed.task(w2, { title: `Wp9 two ${token}`, dueDate: dateInZone(FIRM_ZONE, 7) });
  // A closed task counts nowhere.
  const closed = await seed.task(w2, {
    title: `Wp9 closed ${token}`,
    dueDate: dateInZone(FIRM_ZONE, -9),
  });
  expect((await new TaskApi(admin, closed.taskId).cancel('Not needed')).status).toBeLessThan(300);

  // Three clients with 1, 3 and 2 open tasks (1 overdue on the middle one) for the sort.
  const sort: Json[] = [];
  for (const [i, open] of [1, 3, 2].entries()) {
    const c = await seed.client({ name: `Wp9 sort ${token} ${'ABC'[i]}` });
    const m = await seed.matter({
      client: c,
      number: '00001',
      name: `Wp9 sort matter ${token} ${'ABC'[i]}`,
    });
    for (let t = 0; t < open; t++) {
      await seed.task(
        { matter: m, taskType: base.taskType, workflow: base.workflow },
        {
          title: `Wp9 s ${token} ${i}${t}`,
          ...(i === 1 && t === 0 ? { dueDate: dateInZone(FIRM_ZONE, -1) } : {}),
        },
      );
    }
    sort.push({ client: c, matter: m });
  }
  const longProject = await seed.project(
    m2,
    (
      `Wp9 long project ${token} ` + 'covering the document review for all custodians '.repeat(3)
    ).slice(0, 130),
  );
  // The same project name on two matters: only the Matter cell tells them apart.
  await seed.project(m2, `Wp9 project ${token}`);
  return { token, client, m1, m2, project, sort, longProject };
}

test.describe('WP9 list columns', () => {
  let w: World;
  test.beforeAll(async ({ seed, admin }) => {
    test.setTimeout(180_000);
    w = await build(seed, admin);
  });

  test.describe('counts equal the Task Queue (#266, #267)', () => {
    test('Clients: the client row shows the open and overdue count the Task Queue shows behind each link', async ({
      page,
      admin,
    }) => {
      await page.goto(`/clients?name=${w.token}`);
      const row = grid(page, 'Clients list').locator('tbody tr', {
        hasText: `Wp9 client ${w.token}`,
      });
      await expect(row).toBeVisible();
      expect(await countOf(row, 'open')).toBe(5);
      expect(await countOf(row, 'overdue')).toBe(2);
      // The same numbers as the summary endpoint (one definition for the list, the strip and the Dashboard).
      const summary = await admin.get<Json>(`/api/v1/clients/${w.client.clientId}/summary`);
      expect([summary.openTasks, summary.overdue]).toEqual([5, 2]);

      await row.locator('[data-count=open] a').click();
      await expect(page).toHaveURL(new RegExp(`/tasks\\?client=${w.client.clientId}&`));
      await expect(page.locator('[data-range]')).toContainText('of 5');
      await page.goBack();
      await row.locator('[data-count=overdue] a').click();
      await expect(page).toHaveURL(/overdue=true/);
      await expect(page.locator('[data-range]')).toContainText('of 2');
    });

    test('Matters and the client Matters tab: zero overdue is a dash, positive counts match the matter-scoped queue', async ({
      page,
    }) => {
      for (const url of [`/matters?name=${w.token}`, `/clients/${w.client.clientId}?tab=matters`]) {
        await page.goto(url);
        const region = grid(page, 'Matters list');
        const one = region.locator('tbody tr', { hasText: `Wp9 matter ${w.token} one` });
        const two = region.locator('tbody tr', { hasText: `Wp9 matter ${w.token} two` });
        await expect(one).toBeVisible();
        expect([await countOf(one, 'open'), await countOf(one, 'overdue')]).toEqual([4, 2]);
        expect([await countOf(two, 'open'), await countOf(two, 'overdue')]).toEqual([1, 0]);
        // Zero work is not an error: no link, not red, an en dash that is spoken as "0 overdue tasks".
        await expect(two.locator('[data-count=overdue] a')).toHaveCount(0);
        await expect(two.locator('[data-count=overdue]')).toContainText('–');
        await expect(two.locator('[data-count=overdue]')).toContainText('0 overdue tasks');
      }
      await page.goto(`/matters?name=${w.token}`);
      const one = grid(page, 'Matters list').locator('tbody tr', {
        hasText: `Wp9 matter ${w.token} one`,
      });
      await one.locator('[data-count=open] a').click();
      await expect(page).toHaveURL(new RegExp(`matter=${w.m1.matterId}&`));
      await expect(page.locator('[data-range]')).toContainText('of 4');
      await page.goBack();
      await one.locator('[data-count=overdue] a').click();
      await expect(page.locator('[data-range]')).toContainText('of 2');
    });

    test('Projects: the count is the project own tasks and the link opens the project scoped queue', async ({
      page,
    }) => {
      await page.goto(`/projects?name=${w.token}`);
      const row = grid(page, 'Projects list').locator('tbody tr', {
        has: page.locator(`[title="${w.project.name}"]`),
        hasText: `Wp9 matter ${w.token} one`,
      });
      await expect(row).toBeVisible();
      expect([await countOf(row, 'open'), await countOf(row, 'overdue')]).toEqual([1, 1]);
      await row.locator('[data-count=open] a').click();
      await expect(page).toHaveURL(new RegExp(`project=${w.project.projectId}&`));
      await expect(page.locator('[data-range]')).toContainText('of 1');
    });
  });

  test.describe('sorting by Open tasks and Overdue (#266)', () => {
    const sortName = (letter: string) => `Wp9 sort ${w.token} ${letter}`;

    test('Clients: the first click on Open tasks sorts the busiest first, aria-sort and the URL follow, a reload keeps it', async ({
      page,
    }) => {
      await page.goto(`/clients?name=Wp9 sort ${w.token}`);
      const head = grid(page, 'Clients list').getByRole('columnheader', { name: 'Open tasks' });
      await head.getByRole('button').click();
      await expect(page).toHaveURL(/sort=-openTasks/);
      await expect(head).toHaveAttribute('aria-sort', 'descending');
      await expectNames(page, 'Clients list', ['B', 'C', 'A'].map(sortName));
      await page.reload();
      await expect(head).toHaveAttribute('aria-sort', 'descending');
      await expectNames(page, 'Clients list', ['B', 'C', 'A'].map(sortName));
      await head.getByRole('button').click();
      await expect(head).toHaveAttribute('aria-sort', 'ascending');
      await expectNames(page, 'Clients list', ['A', 'C', 'B'].map(sortName));
      // Overdue: only B has one, so it comes first when the busiest overdue is asked for.
      const over = grid(page, 'Clients list').getByRole('columnheader', { name: 'Overdue' });
      await over.getByRole('button').click();
      await expect(page).toHaveURL(/sort=-overdue/);
      await expectFirst(page, 'Clients list', sortName('B'));
    });

    test('Matters and Projects sort by the counts too', async ({ page }) => {
      await page.goto(`/matters?name=Wp9 matter ${w.token}&sort=-openTasks`);
      await expectFirst(page, 'Matters list', `Wp9 matter ${w.token} one`);
      await page.goto(`/matters?name=Wp9 matter ${w.token}&sort=openTasks`);
      await expectFirst(page, 'Matters list', `Wp9 matter ${w.token} two`);
      await page.goto(`/projects?name=Wp9 project ${w.token}`);
      const head = grid(page, 'Projects list').getByRole('columnheader', { name: 'Overdue' });
      await head.getByRole('button').click();
      await expect(page).toHaveURL(/sort=-overdue/);
      await expect(head).toHaveAttribute('aria-sort', 'descending');
      // The project with the overdue task (on matter one) first.
      await expect(
        grid(page, 'Projects list').locator('tbody tr').first().locator('mf-matter-cell'),
      ).toContainText(`Wp9 matter ${w.token} one`);
    });
  });

  test.describe('the name is the one link (#268)', () => {
    const lists = [
      {
        label: 'Clients',
        region: 'Clients list',
        url: () => `/clients?name=${w.token}`,
        number: 'td.pg-mono',
      },
      {
        label: 'Matters',
        region: 'Matters list',
        url: () => `/matters?name=${w.token}`,
        number: '.mf-ref',
      },
      {
        label: 'Client Matters tab',
        region: 'Matters list',
        url: () => `/clients/${w.client.clientId}?tab=matters`,
        number: '.mf-ref',
      },
    ];
    for (const list of lists) {
      test(`${list.label}: one record link per row, the number is plain text, Tab goes name first`, async ({
        page,
      }) => {
        await page.goto(list.url());
        const rows = grid(page, list.region).locator('tbody tr:not([data-skeleton])');
        await expect(rows.first()).toBeVisible();
        const first = rows.first();
        await expect(first.locator(`${list.number} a`)).toHaveCount(0);
        // Links besides the name: the Client link of Matters and the count links; none of them is the number.
        await expect(first.locator('a.pg-name').first()).toHaveAttribute(
          'href',
          /^\/(clients|matters)\/\d+$/,
        );
        await first.locator('a.pg-name').first().focus();
        await page.keyboard.press('Tab');
        const next = await page.evaluate(() => document.activeElement?.tagName);
        expect(['A', 'BUTTON']).toContain(next); // the copy button or the next link, never a second link to the same record
      });
    }
  });

  test.describe('the Projects list identifies a project (#267)', () => {
    test('two projects with the same name differ by the Matter cell; client from 1100 px; archived and long names', async ({
      page,
      seed,
    }) => {
      const archived = await seed.project(w.m2, `Wp9 archived ${w.token}`);
      await seed.admin.post(`/api/v1/projects/${archived.projectId}/active`, {
        isActive: false,
        rowVersion: archived.rowVersion,
      });
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto(`/projects?name=${w.token}`);
      const region = grid(page, 'Projects list');
      const same = region.locator('tbody tr', {
        has: page.locator(`[title="Wp9 project ${w.token}"]`),
      });
      await expect(same).toHaveCount(2);
      const cells = await same.locator('mf-matter-cell').allInnerTexts();
      expect(new Set(cells).size).toBe(2); // distinguishable at a glance
      const refs = await same.locator('mf-matter-cell .mf-ref').allInnerTexts();
      expect(new Set(refs).size).toBe(2);
      await expect(same.first().locator('mf-matter-cell [data-matter-name]')).toBeVisible();
      // Client column from 1100 px, with the client name and the number in the tooltip.
      await expect(region.getByRole('columnheader', { name: 'Client' })).toBeVisible();
      await expect(same.first().locator('.pg-clip')).toHaveText(`Wp9 client ${w.token}`);
      await expect(same.first().locator('.pg-clip')).toHaveAttribute(
        'title',
        new RegExp(w.client.clientNumber),
      );
      // The matter reference links to the matter.
      await expect(same.first().locator('mf-matter-cell a.mf-ref')).toHaveAttribute(
        'href',
        /\/matters\/\d+/,
      );
      // A 130 character name clamps at two lines with a tooltip; the row is still 44 px.
      const long = region.locator(`.pg-name[title="${w.longProject.name}"]`);
      await expect(long).toBeVisible();
      // Archived keeps its grey badge with text and its matter cell (status All shows it).
      await page.goto(`/projects?name=${w.token}&status=all`);
      const gone = region.locator('tbody tr', { hasText: `Wp9 archived ${w.token}` });
      await expect(gone).toContainText('Archived');
      await expect(gone.locator('mf-matter-cell .mf-ref')).toBeVisible();
      await shot(page, 'projects-list-archived');
      await page.goto(`/projects?name=${w.token}`);
      await expect(long).toBeVisible();
      const box = await long.evaluate((el) => ({
        h: el.clientHeight,
        line: parseFloat(getComputedStyle(el).lineHeight),
      }));
      expect(box.h).toBeLessThanOrEqual(box.line * 2 + 1);
      for (const h of await region
        .locator('tbody tr:not([data-skeleton]):not(.gb-state)')
        .evaluateAll((rs) => rs.map((r) => r.getBoundingClientRect().height))) {
        expect(h).toBeGreaterThanOrEqual(43);
        expect(h).toBeLessThanOrEqual(45);
      }
      await page.setViewportSize({ width: 768, height: 1024 });
      await expect(region.getByRole('columnheader', { name: 'Client' })).toHaveCount(0);
      await expect(same.first().locator('mf-matter-cell .mf-ref')).toBeVisible();
    });

    test('Matters: the Client column drops below 900 px and Projects is not a column any more', async ({
      page,
    }) => {
      const region = grid(page, 'Matters list');
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto(`/matters?name=${w.token}`);
      await expect(region.getByRole('columnheader', { name: 'Client' })).toBeVisible();
      await expect(region.getByRole('columnheader', { name: 'Projects' })).toHaveCount(0);
      await page.setViewportSize({ width: 768, height: 1024 });
      await expect(region.getByRole('columnheader', { name: 'Client' })).toHaveCount(0);
      await expect(region.getByRole('columnheader', { name: 'Status' })).toBeVisible();
    });
  });

  test.describe('client Matters tab', () => {
    test('the same columns minus Client; the header owns New matter (no second button in the tab)', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto(`/clients/${w.client.clientId}?tab=matters`);
      const region = grid(page, 'Matters list');
      await expect(region.locator('tbody tr').first()).toBeVisible();
      const heads = await region.locator('thead tr:first-child th').allInnerTexts();
      expect(heads.map((h) => h.trim())).toEqual([
        'Matter',
        'Name',
        'Open tasks',
        'Overdue',
        'Status',
      ]);
      await expect(page.locator('[data-page-actions] [data-action="new-matter"]')).toHaveCount(1);
      await expect(page.locator('[data-create-matter]')).toHaveCount(0);
      await shot(page, 'client-matters-tab');
    });
  });

  test.describe('without Task.View (#266)', () => {
    test('no count columns and no count in the API answer; the lists still work', async ({
      asUser,
      seed,
    }) => {
      const role = await seed.role(
        ['Client.View', 'Matter.View', 'Project.View'],
        'E2E no task view',
      );
      const user = await seed.user([role.name], 'wp9-notask');
      const page = await asUser(user.username);
      const lists = [
        [
          `/clients?name=${w.token}`,
          'Clients list',
          ['Client number', 'Name', 'Matters', 'Status'],
        ],
        [
          `/matters?name=${w.token}`,
          'Matters list',
          ['Matter reference', 'Name', 'Client', 'Status'],
        ],
        [`/projects?name=${w.token}`, 'Projects list', ['Name', 'Matter', 'Client', 'Status']],
        [`/clients/${w.client.clientId}?tab=matters`, 'Matters list', ['Matter', 'Name', 'Status']],
      ] as const;
      for (const [url, region, heads] of lists) {
        await page.goto(url);
        const r = grid(page, region);
        await expect(r.locator('tbody tr').first()).toBeVisible();
        expect(
          (await r.locator('thead tr:first-child th').allInnerTexts()).map((h) => h.trim()),
        ).toEqual([...heads]);
        await expect(page.locator('[data-count]')).toHaveCount(0);
      }
      // An old bookmark with a count sort keeps working: the default order, no error.
      await page.goto(`/clients?name=${w.token}&sort=-openTasks`);
      await expect(grid(page, 'Clients list').locator('tbody tr').first()).toBeVisible();
      await expect(page.locator('[data-error]')).toHaveCount(0);
      const api = await page.request.get(`/api/v1/clients?name=${w.token}`);
      const body = await api.json();
      expect(body.items[0].openTaskCount ?? null).toBeNull();
      await shot(page, 'clients-no-task-view');
      // Without Matter.View the matter reference in Projects is text, not a link.
      const role2 = await seed.role(['Project.View', 'Task.View'], 'E2E projects only');
      const user2 = await seed.user([role2.name], 'wp9-nomatter');
      const page2 = await asUser(user2.username);
      await page2.goto(`/projects?name=${w.token}`);
      const row = grid(page2, 'Projects list').locator('tbody tr').first();
      await expect(row.locator('mf-matter-cell .mf-ref')).toBeVisible();
      await expect(row.locator('mf-matter-cell a')).toHaveCount(0);
    });
  });

  test.describe('layout at four sizes', () => {
    const screens = [
      {
        name: 'clients-list',
        region: 'Clients list',
        url: () => `/clients?name=${w.token}`,
        count: true,
      },
      {
        name: 'matters-list',
        region: 'Matters list',
        url: () => `/matters?name=${w.token}`,
        count: true,
      },
      {
        name: 'projects-list',
        region: 'Projects list',
        url: () => `/projects?name=${w.token}`,
        count: true,
      },
      {
        name: 'client-matters',
        region: 'Matters list',
        url: () => `/clients/${w.client.clientId}?tab=matters`,
        count: true,
      },
    ];
    for (const screen of screens) {
      test(`${screen.name}: axe 0, no sideways scroll, 44 px rows, Status never clipped from 768 px`, async ({
        page,
      }) => {
        test.setTimeout(120_000);
        for (const [width, height] of SIZES) {
          await page.setViewportSize({ width, height });
          await page.goto(screen.url());
          const what = `${screen.name} ${width}`;
          if (width < 640) {
            // Below 640 px the list is cards (WP12, wp12-phone-cards.spec.ts has their anatomy): status is on every card, 64 px and up.
            const cardList = page.locator('li[data-record-card]');
            await expect(cardList.first()).toBeVisible();
            for (const h of await cardList.evaluateAll((rs) =>
              rs.map((r) => r.getBoundingClientRect().height),
            ))
              expect(h, what).toBeGreaterThanOrEqual(64);
            await expect(page.locator('table.pg-table')).toHaveCount(0);
            await axeClean(page, what);
            await noSideways(page, what);
            await shot(page, screen.name);
            continue;
          }
          const region = grid(page, screen.region);
          await expect(region.locator('tbody tr:not([data-skeleton])').first()).toBeVisible();
          for (const h of await region
            .locator('tbody tr:not([data-skeleton]):not(.gb-state)')
            .evaluateAll((rs) => rs.map((r) => r.getBoundingClientRect().height))) {
            expect(h, what).toBeGreaterThanOrEqual(43);
            expect(h, what).toBeLessThanOrEqual(45);
          }
          if (width >= 768) {
            const fit = await region.evaluate((area) => {
              const status = Array.from(area.querySelectorAll('thead tr:first-child th')).at(-1)!;
              return {
                right: status.getBoundingClientRect().right,
                box: area.getBoundingClientRect().right,
                scroll: area.scrollWidth - area.clientWidth,
              };
            });
            expect(fit.right, `${what}: Status is clipped`).toBeLessThanOrEqual(fit.box + 1);
            expect(fit.scroll, `${what}: the grid scrolls sideways`).toBeLessThanOrEqual(1);
          }
          await axeClean(page, what);
          await noSideways(page, what);
          await shot(page, screen.name);
        }
      });
    }
  });
});
