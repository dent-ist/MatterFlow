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
 * Clients UX epic, WP10 matter tabs (#273 Projects tab, #274 Assets tab). Screenshots go to E2E_SCREENSHOTS when it is set
 * (docs/ux/clients-review/fixes/wp10).
 *
 * Matter "big" has 40 projects: 33 active ("Wave 1" to "Wave 33", so text order and number order differ) and 7 archived ("Legacy 1" to
 * "Legacy 7"). "Wave 3" has 3 open tasks (1 overdue) and a description, "Wave 12" has 1 open task, "Wave 20" has a 130-character name.
 * Matter "assets" has 6 assets (one without an external reference, one inactive) and no project; "empty" has neither; "retired" has two
 * archived projects only.
 */
const OUT = process.env['E2E_SCREENSHOTS'];

const SIZES = [
  [1366, 768],
  [1920, 1080],
  [768, 1024],
  [375, 812],
] as const;

const LONG_NAME = `Wave 20 ${'document review for all custodians '.repeat(4)}`.slice(0, 130);
const DESCRIPTION =
  'Intake, processing and first-pass review of the custodian data collected in the first wave of the investigation';

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

interface World {
  token: string;
  client: Json;
  big: Json;
  assets: Json;
  empty: Json;
  retired: Json;
  waves: Map<number, Json>;
  legacy: Json[];
}

const projectsUrl = (m: Json) => `/matters/${m.matterId}?tab=projects`;
const assetsUrl = (m: Json) => `/matters/${m.matterId}?tab=assets`;
const tabTexts = async (page: Page) =>
  (await page.getByRole('tab').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
const ready = (page: Page) =>
  expect(page.locator('[data-record-header] h1 [data-name]')).toBeVisible();
const projectNames = (page: Page) =>
  page
    .locator('[data-matter-projects] [data-project-name]')
    .evaluateAll((els) => els.map((e) => e.textContent!.trim()));

async function build(seed: Seeder, admin: Api): Promise<World> {
  const token = uid();
  const base = await seed.world();
  const client = await seed.client({ name: `Wp10 client ${token}` });
  const big = await seed.matter({ client, number: '00001', name: `Wp10 big ${token}` });
  const assets = await seed.matter({ client, number: '00002', name: `Wp10 assets ${token}` });
  const empty = await seed.matter({ client, number: '00003', name: `Wp10 empty ${token}` });
  const retired = await seed.matter({ client, number: '00004', name: `Wp10 retired ${token}` });

  const waves = new Map<number, Json>();
  for (let start = 1; start <= 33; start += 11) {
    await Promise.all(
      Array.from({ length: 11 }, (_, i) => start + i).map(async (n) => {
        const name = n === 20 ? LONG_NAME : `Wave ${n}`;
        const p = await admin.post('/api/v1/projects', {
          matterId: big.matterId,
          name,
          ...(n === 3 ? { description: DESCRIPTION } : {}),
        });
        waves.set(n, p);
      }),
    );
  }
  const legacy: Json[] = [];
  for (let n = 1; n <= 7; n++) {
    const p = await seed.project(big, `Legacy ${n}`);
    await admin.post(`/api/v1/projects/${p.projectId}/active`, {
      isActive: false,
      rowVersion: p.rowVersion,
    });
    legacy.push(p);
  }
  const wave3 = { matter: big, taskType: base.taskType, workflow: base.workflow };
  const projectId = waves.get(3)!.projectId;
  await seed.task(wave3, { title: `Wp10 a ${token}`, projectId });
  await seed.task(wave3, { title: `Wp10 b ${token}`, projectId });
  await seed.task(wave3, {
    title: `Wp10 over ${token}`,
    projectId,
    dueDate: dateInZone(FIRM_ZONE, -3),
  });
  await seed.task(wave3, { title: `Wp10 w12 ${token}`, projectId: waves.get(12)!.projectId });
  const closed = await seed.task(wave3, { title: `Wp10 closed ${token}`, projectId });
  expect((await new TaskApi(admin, closed.taskId).cancel('Not needed')).status).toBeLessThan(300);

  for (const n of [1, 2]) {
    const p = await seed.project(retired, `Old ${n}`);
    await admin.post(`/api/v1/projects/${p.projectId}/active`, {
      isActive: false,
      rowVersion: p.rowVersion,
    });
  }

  // Six assets on one matter: one has an external reference, one is inactive.
  const typeId = (await seed.asset(assets, `Wp10 seed ${token}`)).assetTypeId;
  for (const [i, ext] of [undefined, 'REF-1', undefined, 'REF-2'].entries()) {
    await admin.post('/api/v1/assets', {
      matterId: assets.matterId,
      assetTypeId: typeId,
      displayName: `Wp10 asset ${i + 1} ${token}`,
      ...(ext ? { externalReference: ext } : {}),
    });
  }
  const old = await seed.asset(assets, `Wp10 old ${token}`);
  await admin.post(`/api/v1/assets/${old.assetId}/active`, {
    isActive: false,
    rowVersion: old.rowVersion,
  });
  return { token, client, big, assets, empty, retired, waves, legacy };
}

test.describe('WP10 matter tabs', () => {
  let w: World;
  test.beforeAll(async ({ seed, admin }) => {
    test.setTimeout(300_000);
    w = await build(seed, admin);
  });

  test.describe('Projects tab (#273)', () => {
    test('Active first in number order, Archived (7) collapsed, columns without Description, counts equal the Task Queue', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto(projectsUrl(w.big));
      await ready(page);
      expect(await tabTexts(page)).toEqual([
        'Overview',
        'Tasks (4)',
        'Projects (40)',
        'Assets (0)',
      ]);
      const table = page.locator('[data-matter-projects]');
      await expect(table.locator('thead th')).toHaveText([
        'Name',
        'Open tasks',
        'Overdue',
        'Status',
      ]);
      const names = await projectNames(page);
      expect(names).toHaveLength(33);
      expect(names.slice(0, 4)).toEqual(['Wave 1', 'Wave 2', 'Wave 3', 'Wave 4']);
      expect(names[32]).toBe('Wave 33');
      expect(names[19]).toBe(LONG_NAME);

      const toggle = page.locator('[data-archived-toggle]');
      await expect(toggle).toHaveAccessibleName(/^Archived \(7 projects ?\)$/);
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(Math.round((await toggle.locator('xpath=ancestor::tr').boundingBox())!.height)).toBe(
        36,
      );

      // Rows are 44 px, with or without a description; the description is the muted second line with the full text as tooltip.
      const heights = await table
        .locator('[data-project-row]')
        .evaluateAll((rs) => rs.map((r) => Math.round(r.getBoundingClientRect().height)));
      expect(new Set(heights)).toEqual(new Set([44]));
      const row3 = table.locator('[data-project-row]', { hasText: 'Wave 3' }).first();
      await expect(row3.locator('[data-project-description]')).toHaveAttribute(
        'title',
        DESCRIPTION,
      );
      await expect(row3.locator('[data-project-name]')).toHaveText('Wave 3');
      await expect(table.locator('[data-project-description]')).toHaveCount(1);
      await expect(table.locator('[data-project-name]').nth(19)).toHaveAttribute(
        'title',
        LONG_NAME,
      );

      // The counts are the Project Tasks totals.
      const row = table.locator('[data-project-row]').nth(2);
      await expect(row.locator('[data-count=open] a')).toHaveText('3');
      await expect(row.locator('[data-count=overdue] a')).toHaveText(/1/);
      const open12 = table.locator('[data-project-row]').nth(11);
      await expect(open12.locator('[data-count=open] a')).toHaveText('1');
      await expect(open12.locator('[data-count=overdue]')).toContainText('–');
      const summary = await page.request.get(
        `/api/v1/projects/${w.waves.get(3)!.projectId}/summary`,
      );
      expect(await summary.json()).toMatchObject({ openTasks: 3, overdue: 1 });
      await row.locator('[data-count=open] a').click();
      await expect(page).toHaveURL(new RegExp(`project=${w.waves.get(3)!.projectId}&`));
      await expect(page.locator('[data-range]')).toContainText('of 3');
      await page.goBack();
      await ready(page);
      await row.locator('[data-count=overdue] a').click();
      await expect(page.locator('[data-range]')).toContainText('of 1');
      await page.goBack();

      await ready(page);
      await shot(page, 'matter-projects-collapsed');
      await page.locator('[data-archived-toggle]').click();
      await expect(page.locator('[data-archived-toggle]')).toHaveAttribute('aria-expanded', 'true');
      const all = await projectNames(page);
      expect(all).toHaveLength(40);
      expect(all.slice(33)).toEqual(Array.from({ length: 7 }, (_, i) => `Legacy ${i + 1}`));
      await page.locator('[data-project-row]').last().scrollIntoViewIfNeeded();
      await shot(page, 'matter-projects-expanded');
    });

    test('the group header works with Enter and Space and is forgotten on the next visit', async ({
      page,
    }) => {
      await page.goto(projectsUrl(w.big));
      await ready(page);
      const toggle = page.locator('[data-archived-toggle]');
      await toggle.focus();
      await page.keyboard.press('Enter');
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      expect(await projectNames(page)).toHaveLength(40);
      await page.keyboard.press('Space');
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(await projectNames(page)).toHaveLength(33);
      await page.keyboard.press('Enter');
      await expect(toggle).toBeFocused();
      await page.reload();
      await ready(page);
      await expect(page.locator('[data-archived-toggle]')).toHaveAttribute(
        'aria-expanded',
        'false',
      );
    });

    test('when every project is archived the group starts open', async ({ page }) => {
      await page.goto(projectsUrl(w.retired));
      await ready(page);
      await expect(page.locator('[data-archived-toggle]')).toHaveAttribute('aria-expanded', 'true');
      expect(await projectNames(page)).toEqual(['Old 1', 'Old 2']);
      await expect(page.locator('[data-matter-projects] thead th').first()).toBeVisible();
    });

    test('a matter without projects keeps the empty state with its New project action', async ({
      page,
    }) => {
      await page.goto(projectsUrl(w.empty));
      await ready(page);
      await expect(page.locator('[data-empty=projects]')).toContainText(
        'No projects in this matter yet.',
      );
      await page.locator('[data-empty-new-project]').click();
      await expect(page).toHaveURL(new RegExp(`/projects/new\\?matterId=${w.empty.matterId}`));
    });

    test('creating or archiving a project updates the counts and the group when the tab is shown again', async ({
      page,
      seed,
      admin,
    }) => {
      const matter = await seed.matter({ client: w.client, number: '00005' });
      const first = await seed.project(matter, 'Alpha');
      await seed.project(matter, 'Beta');
      await page.goto(projectsUrl(matter));
      await ready(page);
      expect(await tabTexts(page)).toContain('Projects (2)');
      await expect(page.locator('[data-archived-toggle]')).toHaveCount(0);

      // Archive from the project page, then come back with Back.
      await page
        .locator('[data-matter-projects] [data-project-name]', { hasText: 'Alpha' })
        .click();
      await expect(page).toHaveURL(new RegExp(`/projects/${first.projectId}`));
      await ready(page);
      await page.locator('[data-overflow]').click();
      await page.getByRole('menuitem', { name: 'Archive' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Archive' }).click();
      await expect(page.locator('[data-archived-banner]')).toBeVisible();
      await page.goBack();
      await ready(page);
      expect(await projectNames(page)).toEqual(['Beta']);
      await expect(page.locator('[data-archived-toggle]')).toContainText('Archived (1');

      // A new project (made elsewhere) shows in the tab and the count after a reload of the page data.
      await admin.post('/api/v1/projects', { matterId: matter.matterId, name: 'Gamma' });
      await page.reload();
      await ready(page);
      expect(await tabTexts(page)).toContain('Projects (3)');
      expect(await projectNames(page)).toEqual(['Beta', 'Gamma']);
      expect(first.projectId).toBeGreaterThan(0);
    });
  });

  test.describe('Assets tab (#274)', () => {
    test('empty External reference is a dash, New asset is only in the header overflow, the tab says how many', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto(assetsUrl(w.assets));
      await ready(page);
      // 6 assets, 5 shown (Active is the default Status) and the pager says why.
      expect(await tabTexts(page)).toEqual(['Overview', 'Tasks (0)', 'Projects (0)', 'Assets (6)']);
      const rows = page.locator('mf-matter-assets tbody tr:not(.gb-state)');
      await expect(rows).toHaveCount(5);
      await expect(page.locator('mf-matter-assets [data-hidden], mf-pager')).toContainText(
        '1 inactive hidden',
      );
      const dashes = page.locator('mf-matter-assets [data-none]');
      await expect(dashes).toHaveCount(3);
      await expect(dashes.first()).toHaveAttribute('aria-hidden', 'true');
      // The External reference cell reads "None" for a screen reader; the Size column (#883) now sits before it, so the row is checked, not a fixed column.
      await expect(page.locator('mf-matter-assets tbody tr:not(.gb-state)').first()).toContainText(
        'None',
      );
      // No New asset button in the tab; the 44 px rows hold.
      await expect(page.getByRole('button', { name: 'New asset' })).toHaveCount(0);
      const heights = await rows.evaluateAll((rs) =>
        rs.map((r) => Math.round(r.getBoundingClientRect().height)),
      );
      expect(new Set(heights)).toEqual(new Set([44]));
      await shot(page, 'matter-assets');

      await page.locator('[data-overflow]').click();
      await page.getByRole('menuitem', { name: 'New asset' }).click();
      await expect(page).toHaveURL(new RegExp(`/assets/new\\?matterId=${w.assets.matterId}`));
    });

    test('a matter without assets shows the empty state with New asset', async ({ page }) => {
      await page.goto(assetsUrl(w.empty));
      await ready(page);
      expect(await tabTexts(page)).toContain('Assets (0)');
      await expect(page.locator('mf-matter-assets [data-empty=none]')).toContainText(
        'No assets in this matter yet.',
      );
      await shot(page, 'matter-assets-empty');
      await page.locator('[data-empty-new-asset]').click();
      await expect(page).toHaveURL(new RegExp(`/assets/new\\?matterId=${w.empty.matterId}`));
    });
  });

  test.describe('permission variants', () => {
    test('without Task.View and Asset.View: no count columns, no Assets tab, no failed request', async ({
      asUser,
      seed,
    }) => {
      const role = await seed.role(['Matter.View', 'Project.View'], 'E2E wp10 projects only');
      const user = await seed.user([role.name], 'wp10-a');
      const page = await asUser(user.username);
      const failed: string[] = [];
      page.on('response', (r) => {
        if (r.status() >= 400) failed.push(`${r.status()} ${new URL(r.url()).pathname}`);
      });
      await page.goto(projectsUrl(w.big));
      await ready(page);
      expect(await tabTexts(page)).toEqual(['Overview', 'Tasks', 'Projects (40)']);
      await expect(page.locator('[data-matter-projects] thead th')).toHaveText(['Name', 'Status']);
      await expect(page.locator('[data-count]')).toHaveCount(0);
      expect(await projectNames(page)).toHaveLength(33);
      await shot(page, 'matter-projects-no-task-view');
      // A bookmark to the Assets tab lands on the Overview.
      await page.goto(assetsUrl(w.assets));
      await ready(page);
      await expect(page.getByRole('tab', { name: /^Overview/ })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(failed, 'failed requests').toEqual([]);
    });

    test('without Project.View: no Projects tab; with Asset.View but not Asset.Create: no New asset anywhere', async ({
      asUser,
      seed,
    }) => {
      const role = await seed.role(['Matter.View', 'Asset.View', 'Task.View'], 'E2E wp10 assets');
      const user = await seed.user([role.name], 'wp10-b');
      const page = await asUser(user.username);
      const failed: string[] = [];
      page.on('response', (r) => {
        if (r.status() >= 400) failed.push(`${r.status()} ${new URL(r.url()).pathname}`);
      });
      await page.goto(assetsUrl(w.empty));
      await ready(page);
      expect(await tabTexts(page)).toEqual(['Overview', 'Tasks (0)', 'Assets (0)']);
      await expect(page.locator('mf-matter-assets [data-empty=none]')).toBeVisible();
      await expect(page.locator('[data-empty-new-asset]')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'New asset' })).toHaveCount(0);
      await page.goto(projectsUrl(w.big));
      await ready(page);
      await expect(page.getByRole('tab', { name: /^Overview/ })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(failed, 'failed requests').toEqual([]);
    });

    test('with Asset.Create the header overflow offers New asset', async ({ asUser, seed }) => {
      const role = await seed.role(
        ['Matter.View', 'Asset.View', 'Asset.Create'],
        'E2E wp10 create',
      );
      const user = await seed.user([role.name], 'wp10-c');
      const page = await asUser(user.username);
      await page.goto(assetsUrl(w.assets));
      await ready(page);
      await page.locator('[data-overflow]').click();
      await expect(page.getByRole('menuitem', { name: 'New asset' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'New asset' })).toHaveCount(0);
    });
  });

  test.describe('accessibility and layout', () => {
    for (const [width, height] of SIZES) {
      test(`${width}x${height}: axe 0 and no sideways scroll on Projects (collapsed, expanded), Assets and the empty tabs`, async ({
        page,
      }) => {
        test.setTimeout(120_000);
        await page.setViewportSize({ width, height });
        const what = `${width}x${height}`;

        await page.goto(projectsUrl(w.big));
        await ready(page);
        await expect(page.locator('[data-archived-toggle]')).toBeVisible();
        await axeClean(page, `projects collapsed ${what}`);
        await noSideways(page, `projects collapsed ${what}`);
        await shot(page, 'matter-projects');
        // The grid scrolls inside its box when it is wider than the window (the hint is the grid's); never the page.
        await page.locator('[data-archived-toggle]').click();
        await expect(page.locator('[data-project-row]')).toHaveCount(40);
        // Rows that sit half under the sticky header are not a fair axe sample: look at the top of the list.
        await page.locator('[data-matter-projects]').evaluate((t) => {
          for (let e = t.parentElement; e; e = e.parentElement) e.scrollTop = 0;
        });
        await axeClean(page, `projects expanded ${what}`);
        await noSideways(page, `projects expanded ${what}`);
        if (width >= 768) {
          const fit = await page.locator('[data-matter-projects]').evaluate((t) => {
            const area = t.closest('.mf-scroll-area, .mf-scroll') as HTMLElement;
            const status = Array.from(t.querySelectorAll('thead th')).at(-1)!;
            return {
              right: status.getBoundingClientRect().right,
              box: area.getBoundingClientRect().right,
            };
          });
          expect(fit.right, `${what}: Status is clipped`).toBeLessThanOrEqual(fit.box + 1);
        }

        await page.goto(assetsUrl(w.assets));
        await ready(page);
        await expect(page.locator('mf-matter-assets tbody tr').first()).toBeVisible();
        await axeClean(page, `assets ${what}`);
        await noSideways(page, `assets ${what}`);
        await shot(page, 'matter-assets');

        await page.goto(projectsUrl(w.empty));
        await ready(page);
        await expect(page.locator('[data-empty=projects]')).toBeVisible();
        await axeClean(page, `empty projects ${what}`);
        await noSideways(page, `empty projects ${what}`);

        await page.goto(assetsUrl(w.empty));
        await ready(page);
        await expect(page.locator('[data-empty-new-asset]')).toBeVisible();
        await axeClean(page, `empty assets ${what}`);
        await noSideways(page, `empty assets ${what}`);
        await shot(page, 'matter-assets-empty');
      });
    }
  });
});
