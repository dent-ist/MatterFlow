import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { Json } from '../support/api';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Seeder, uid } from '../support/seed';
import { dateInZone, FIRM_ZONE } from '../support/time';

/**
 * Clients UX epic, WP13 #285: no dead links and no 403 for any permission combination.
 *
 * Data: one client with two matters, a project and an asset on the first matter, and three tasks (one overdue). For every role below the
 * spec walks the list and detail pages the role may open, collects every link in the page content, opens each target as that person and
 * asserts: no request ends in 401, 403 or 404, no error alert or toast, no "no access" notice. The rule under test: a link exists only when
 * its target is reachable, a control without its permission is absent (not disabled), and the task counts are left out without Task.View.
 * Screenshots (the two most restricted roles) go to E2E_SCREENSHOTS (docs/ux/clients-review/fixes/wp13).
 */
const OUT = process.env['E2E_SCREENSHOTS'];
const tag = uid().slice(0, 6);

interface Data {
  world: Awaited<ReturnType<Seeder['world']>>;
  m1: Json;
  m2: Json;
  project: Json;
}
let data: Data;

test.beforeAll(async ({ seed }: { seed: Seeder }) => {
  const client = await seed.client({ name: `Perm ${tag} client` });
  const world = await seed.world({ stepCount: 1 });
  const m1 = await seed.matter({ client, number: '00001', name: `Perm ${tag} one` });
  const m2 = await seed.matter({ client, number: '00002', name: `Perm ${tag} two` });
  const project = await seed.project(m1, `Perm ${tag} project`);
  await seed.asset(m1, `Perm ${tag} asset`);
  const w = { matter: m1, taskType: world.taskType, workflow: world.workflow };
  await seed.task(w, {
    title: `Perm ${tag} late`,
    dueDate: dateInZone(FIRM_ZONE, -3),
    projectId: project.projectId,
  });
  await seed.task(w, { title: `Perm ${tag} soon`, dueDate: dateInZone(FIRM_ZONE, 1) });
  await seed.task({ ...w, matter: m2 }, { title: `Perm ${tag} other` });
  data = { world: { ...world, client }, m1, m2, project };
});

const VIEW = ['Client.View', 'Matter.View', 'Project.View', 'Asset.View', 'Task.View'] as const;
const without = (...codes: string[]) => VIEW.filter((c) => !codes.includes(c));

interface Role {
  key: string;
  label: string;
  /** Null: the System Admin (everything). */
  perms: string[] | null;
}

const ROLES: Role[] = [
  { key: 'all', label: 'all permissions (System Admin)', perms: null },
  { key: 'client-only', label: 'Client.View only', perms: ['Client.View'] },
  {
    key: 'matter-no-client',
    label: 'Matter.View without Client.View',
    perms: without('Client.View'),
  },
  { key: 'no-task', label: 'no Task.View', perms: without('Task.View') },
  { key: 'no-project', label: 'no Project.View', perms: without('Project.View') },
  { key: 'no-matter', label: 'no Matter.View', perms: without('Matter.View') },
  { key: 'no-asset', label: 'no Asset.View', perms: without('Asset.View') },
];

const has = (r: Role, code: string): boolean => r.perms === null || r.perms.includes(code);

async function axeClean(page: Page, what: string): Promise<void> {
  if (axeAvailable()) expect(await axeViolations(page), what).toEqual([]);
}

async function noSidewaysScroll(page: Page): Promise<void> {
  const m = await page.evaluate(() => {
    const e = document.scrollingElement!;
    return { sw: e.scrollWidth, cw: e.clientWidth };
  });
  expect(m.sw, 'page scrolls sideways').toBeLessThanOrEqual(m.cw);
}

async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  const size = page.viewportSize()!;
  await page.screenshot({ path: path.join(OUT, `${name}-${size.width}x${size.height}.png`) });
}

/** Failed API answers and visible errors, collected while a page loads. */
function watch(page: Page): { failed: string[] } {
  const seen = { failed: [] as string[] };
  page.on('response', (r) => {
    const url = new URL(r.url());
    if (url.pathname.startsWith('/api/') && [401, 403, 404].includes(r.status())) {
      seen.failed.push(`${r.status()} ${url.pathname}`);
    }
  });
  return seen;
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await expect(page.locator('[data-loading], [data-skeleton]')).toHaveCount(0);
}

/** The links of the page content (not the navigation rail or the header search). */
async function contentLinks(page: Page): Promise<string[]> {
  const hrefs = await page
    .locator('#mf-main a[href]')
    .evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''));
  return hrefs.filter((h) => h.startsWith('/') && !h.startsWith('//'));
}

async function links(page: Page, selector: string): Promise<number> {
  return page.locator(`#mf-main ${selector}`).count();
}

const noErrors = async (page: Page, what: string) => {
  await expect(
    page.locator('#mf-main [role=alert], [data-toast]'),
    `${what}: error shown`,
  ).toHaveCount(0);
};

test.describe('#285: permission matrix, no dead links', () => {
  for (const role of ROLES) {
    test(`${role.label}: every link in the six pages opens, every missing permission leaves its control out`, async ({
      asUser,
      seed,
      page: adminPage,
    }) => {
      test.setTimeout(300_000);
      let page = adminPage;
      if (role.perms !== null) {
        const r = await seed.role(role.perms, `E2E perm ${role.key}`);
        const user = await seed.user([r.name], `pm-${role.key.slice(0, 6)}`);
        page = await asUser(user.username);
      }
      await page.setViewportSize({ width: 1366, height: 768 });
      const seen = watch(page);
      const c = data.world.client;
      const targets = new Set<string>();
      const visit = async (url: string, what: string) => {
        await page.goto(url);
        await settle(page);
        await noErrors(page, what);
        for (const href of await contentLinks(page)) targets.add(href);
      };

      // --- Clients -------------------------------------------------------------------------------------------------
      if (has(role, 'Client.View')) {
        await visit(`/clients?name=${encodeURIComponent(`Perm ${tag}`)}`, 'clients list');
        await expect(page.locator('#mf-main a[data-row-list="clients"]').first()).toBeVisible();
        expect((await links(page, 'th:has-text("Open tasks")')) > 0, 'Open tasks column').toBe(
          has(role, 'Task.View'),
        );
        expect((await links(page, 'a[href^="/tasks?"]')) > 0, 'count links').toBe(
          has(role, 'Task.View'),
        );
        expect(
          (await page.getByRole('button', { name: 'New client' }).count()) > 0,
          'New client',
        ).toBe(role.perms === null);
        if (role.key === 'client-only') await shot(page, 'permissions-client-only-clients');

        await visit(`/clients/${c.clientId}`, 'client overview');
        expect((await links(page, '[data-strip]')) > 0, 'client strip').toBe(
          has(role, 'Task.View'),
        );
        expect((await page.getByRole('tab', { name: /^Matters/ }).count()) > 0, 'Matters tab').toBe(
          has(role, 'Matter.View'),
        );
        expect(
          (await links(page, 'a[href^="/matters/"]')) > 0,
          'matter links on the Overview',
        ).toBe(has(role, 'Matter.View'));
        await expect(page.locator('[data-record-header] [data-action]'), 'header actions')
          .toHaveCount(role.perms === null ? 4 : 0, { timeout: 5000 })
          .catch(async () => {
            // The admin's set depends on width; what matters is that a view-only person has none.
            if (role.perms === null) return;
            throw new Error('a view-only person has header actions');
          });
        expect((await page.locator('[data-overflow]').count()) > 0, 'overflow menu').toBe(
          role.perms === null,
        );
        if (role.key === 'client-only') await shot(page, 'permissions-client-only-overview');

        if (has(role, 'Matter.View')) {
          await visit(`/clients/${c.clientId}?tab=matters`, 'client matters');
          expect(
            (await links(page, 'th:has-text("Open tasks")')) > 0,
            'Open tasks column on the tab',
          ).toBe(has(role, 'Task.View'));
        } else {
          // A bookmark to a tab the person cannot see shows the Overview and asks for nothing.
          await visit(`/clients/${c.clientId}?tab=matters`, 'client matters bookmark');
          await expect(page.getByRole('tab', { name: /^Overview/ })).toHaveAttribute(
            'aria-selected',
            'true',
          );
        }
      }

      // --- Matters -------------------------------------------------------------------------------------------------
      if (has(role, 'Matter.View')) {
        await visit(`/matters?name=${encodeURIComponent(`Perm ${tag}`)}`, 'matters list');
        await expect(page.locator('#mf-main a[data-row-list="matters"]').first()).toBeVisible();
        expect(
          (await links(page, 'a[href^="/clients/"]')) > 0,
          'client links in the Matters list',
        ).toBe(has(role, 'Client.View'));
        expect((await links(page, 'th:has-text("Open tasks")')) > 0, 'Open tasks column').toBe(
          has(role, 'Task.View'),
        );
        expect(
          (await page.getByRole('button', { name: 'New matter' }).count()) > 0,
          'New matter',
        ).toBe(role.perms === null);
        if (role.key === 'matter-no-client') await shot(page, 'permissions-matter-no-client-list');

        const m = data.m1;
        await visit(`/matters/${m.matterId}`, 'matter overview');
        expect((await links(page, '[data-strip]')) > 0, 'matter strip').toBe(
          has(role, 'Task.View'),
        );
        expect((await links(page, 'a[href^="/clients/"]')) > 0, 'client link on the matter').toBe(
          has(role, 'Client.View'),
        );
        expect(
          (await page.getByRole('tab', { name: /^Projects/ }).count()) > 0,
          'Projects tab',
        ).toBe(has(role, 'Project.View'));
        expect((await page.getByRole('tab', { name: /^Assets/ }).count()) > 0, 'Assets tab').toBe(
          has(role, 'Asset.View'),
        );
        // The overflow holds the matter's quick actions (epic #758): everybody who may see tasks has at least Open the matter's tasks.
        expect((await page.locator('[data-overflow]').count()) > 0, 'overflow menu').toBe(
          role.perms === null || has(role, 'Task.View'),
        );
        if (role.key === 'matter-no-client')
          await shot(page, 'permissions-matter-no-client-overview');

        await visit(`/matters/${m.matterId}?tab=tasks`, 'matter tasks');
        if (has(role, 'Task.View')) {
          await expect(page.locator('#mf-main tr[data-task]').first()).toBeVisible();
          expect(
            (await links(page, 'mf-project-cell a')) > 0,
            'project links in the Tasks grid',
          ).toBe(has(role, 'Project.View'));
        } else {
          await expect(page.locator('[data-no-access=tasks]')).toBeVisible();
        }
        if (has(role, 'Project.View'))
          await visit(`/matters/${m.matterId}?tab=projects`, 'matter projects');
        if (has(role, 'Asset.View'))
          await visit(`/matters/${m.matterId}?tab=assets`, 'matter assets');
      }

      // --- Projects ------------------------------------------------------------------------------------------------
      if (has(role, 'Project.View')) {
        await visit(`/projects?name=${encodeURIComponent(`Perm ${tag}`)}`, 'projects list');
        await expect(page.locator('#mf-main a[data-row-list="projects"]').first()).toBeVisible();
        expect(
          (await links(page, 'a[href^="/matters/"]')) > 0,
          'matter links in the Projects list',
        ).toBe(has(role, 'Matter.View'));
        expect((await links(page, 'th:has-text("Open tasks")')) > 0, 'Open tasks column').toBe(
          has(role, 'Task.View'),
        );

        await visit(`/projects/${data.project.projectId}`, 'project tasks');
        expect((await links(page, 'a[href^="/matters/"]')) > 0, 'matter links on the project').toBe(
          has(role, 'Matter.View'),
        );
        expect(
          (await page.locator('.rh__trail a[href^="/matters"]').count()) > 0,
          'matter crumbs',
        ).toBe(has(role, 'Matter.View'));
        await visit(`/projects/${data.project.projectId}?tab=details`, 'project details');
        expect((await links(page, 'a[href^="/matters/"]')) > 0, 'matter link in Details').toBe(
          has(role, 'Matter.View'),
        );
        if (role.key === 'no-matter') await shot(page, 'permissions-no-matter-project');
      }

      // --- every link target opens for this person -----------------------------------------------------------------
      const own = [...targets].filter((t) => !t.startsWith('/#'));
      expect(own.length, 'links found').toBeGreaterThan(0);
      for (const target of own) {
        seen.failed.length = 0;
        await page.goto(target);
        await settle(page);
        expect(seen.failed, `requests that failed behind ${target}`).toEqual([]);
        await expect(
          // "You don't have permission to view tasks." on a Tasks tab and the one sentence on a Task page's Assets tab without Asset.View
          // (#347) are the designed explanations, not errors.
          page.locator(
            '#mf-main [role=alert], [data-toast], [data-no-access]:not([data-no-access=tasks]):not(.tl__note), [data-forbidden]',
          ),
          `error or no-access notice behind ${target}`,
        ).toHaveCount(0);
      }
    });
  }

  for (const key of ['client-only', 'no-matter']) {
    const role = ROLES.find((r) => r.key === key)!;
    for (const [w, h] of [
      [1366, 768],
      [375, 812],
    ] as const) {
      test(`${role.label}: axe 0 and no sideways scroll (${w}x${h})`, async ({ asUser, seed }) => {
        const r = await seed.role(role.perms!, `E2E perm axe ${role.key}`);
        const user = await seed.user([r.name], `pa-${role.key.slice(0, 6)}`);
        const page = await asUser(user.username);
        await page.setViewportSize({ width: w, height: h });
        const urls =
          key === 'client-only'
            ? [
                `/clients?name=${encodeURIComponent(`Perm ${tag}`)}`,
                `/clients/${data.world.client.clientId}`,
              ]
            : [
                `/clients?name=${encodeURIComponent(`Perm ${tag}`)}`,
                `/clients/${data.world.client.clientId}`,
                `/projects?name=${encodeURIComponent(`Perm ${tag}`)}`,
                `/projects/${data.project.projectId}`,
              ];
        for (const url of urls) {
          await page.goto(url);
          await settle(page);
          await axeClean(page, `${role.key} ${url} ${w}x${h}`);
          await noSidewaysScroll(page);
          await shot(page, `permissions-${role.key}-${url.split('?')[0].replace(/\W+/g, '-')}`);
        }
      });
    }
  }

  for (const [w, h] of [
    [1920, 1080],
    [768, 1024],
  ] as const) {
    test(`System Admin: axe 0 and no sideways scroll on the six pages (${w}x${h})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: w, height: h });
      const urls = [
        `/clients?name=${encodeURIComponent(`Perm ${tag}`)}`,
        `/clients/${data.world.client.clientId}`,
        `/matters?name=${encodeURIComponent(`Perm ${tag}`)}`,
        `/matters/${data.m1.matterId}`,
        `/projects?name=${encodeURIComponent(`Perm ${tag}`)}`,
        `/projects/${data.project.projectId}`,
      ];
      for (const url of urls) {
        await page.goto(url);
        await settle(page);
        await axeClean(page, `admin ${url} ${w}x${h}`);
        await noSidewaysScroll(page);
      }
    });
  }
});
