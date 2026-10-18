import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { Json } from '../support/api';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Seeder, uid } from '../support/seed';

/**
 * Clients UX epic, WP4 (#257, folds BUG-4, BUG-5, P2, P3, P4): Project Details has the tab pattern of Client and Matter. Tasks (n) is the
 * default and absent from the address, Details is `?tab=details`; the side panel is gone, so the Tasks grid is as wide as the page.
 * Measured on the real page at 1366x768, 1920x1080, 768x1024 and 375x812 with a project name of 130 characters; axe finds nothing on
 * either tab and the page never scrolls sideways. Screenshots go to E2E_SCREENSHOTS when it is set (docs/ux/clients-review/fixes/wp4).
 */
const OUT = process.env['E2E_SCREENSHOTS'];

const SIZES = [
  [1366, 768],
  [1920, 1080],
  [768, 1024],
  [375, 812],
] as const;

const PROJECT_130 =
  'Custodian Interviews, Document Collection, Privilege Review and Production Workstream for the Second Wave of Regulatory Requests Phase';
const DESCRIPTION =
  'Second-wave custodian work: interviews, collection, privilege review, production.';

let data: {
  world: Awaited<ReturnType<Seeder['world']>>;
  project: Json;
  empty: Json;
  archived: Json;
  taskCount: number;
};

async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  const size = page.viewportSize()!;
  await page.screenshot({ path: path.join(OUT, `${name}-${size.width}x${size.height}.png`) });
}

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

/** BUG-4 / BUG-5: no column header is cut off by the grid's box unless the scroll hint says there is more. */
async function noSilentClipping(page: Page, what: string): Promise<void> {
  const wrap = page.locator('.wt-wrap').first();
  const overflowing = await wrap.evaluate((e) => e.scrollWidth - e.clientWidth > 1);
  if (overflowing) {
    await expect(page.locator('[data-scroll-hint].wt-hint--show'), `${what}: hint`).toBeVisible();
    return;
  }
  const clipped = await page.evaluate(() => {
    const box = document.querySelector('.wt-wrap')!.getBoundingClientRect();
    return Array.from(document.querySelectorAll('.wt-wrap thead th'))
      .filter((th) => {
        const r = th.getBoundingClientRect();
        return r.width > 0 && (r.left < box.left - 1 || r.right > box.right + 1);
      })
      .map((th) => th.textContent?.trim());
  });
  expect(clipped, `${what}: clipped headers without the hint`).toEqual([]);
}

const url = (p: Json, tab?: string) => `/projects/${p.projectId}${tab ? `?tab=${tab}` : ''}`;
const ready = (page: Page) =>
  expect(page.locator('[data-record-header] h1 [data-name]')).toBeVisible();

test.beforeAll(async ({ seed }: { seed: Seeder }) => {
  const world = await seed.world();
  const project = await seed.admin.post('/api/v1/projects', {
    matterId: world.matter.matterId,
    name: PROJECT_130,
    description: DESCRIPTION,
  });
  const titles = [
    'Interview the records custodian about the legacy archive',
    'Collect mailboxes for the second wave of requests',
    'Privilege review of batch one',
    'Prepare the production volume and the cover letter',
    'Reconcile the privilege log against the production set',
    'Brief the partner on open questions',
  ];
  for (const title of titles) {
    await seed.task(world, { title: `${title} ${uid()}`, projectId: project.projectId });
  }
  const empty = await seed.project(world.matter, `Empty project ${uid()}`);
  const archived = await seed.project(world.matter, `Archived project ${uid()}`);
  await seed.admin.post(`/api/v1/projects/${archived.projectId}/active`, {
    isActive: false,
    rowVersion: archived.rowVersion,
  });
  data = { world, project, empty, archived, taskCount: titles.length };
});

test.describe('WP4: project tabs at four sizes', () => {
  for (const [w, h] of SIZES) {
    test(`Tasks and Details tabs at ${w}x${h}: no side panel, full-width grid, nothing clipped, axe clean, no sideways scroll`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(url(data.project));
      await ready(page);
      await expect(page.locator('[data-record-skeleton]')).toHaveCount(0);

      // Tabs: Tasks (n) first and selected, Details second.
      await expect(page.getByRole('tab')).toHaveText([`Tasks (${data.taskCount})`, 'Details']);
      await expect(page.getByRole('tab', { name: /^Tasks/ })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expect(page).not.toHaveURL(/tab=/);
      await expect(page.getByRole('complementary')).toHaveCount(0);
      await expect(page.locator('mf-detail-layout')).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Tasks', level: 2 })).toBeAttached();

      // The grid fills the width: it is not squeezed beside a panel.
      const rows = page.locator('.wt-wrap tbody tr');
      await expect(rows).toHaveCount(data.taskCount);
      const wrap = (await page.locator('.wt-wrap').boundingBox())!;
      const main = (await page.locator('mf-fixed-page').boundingBox())!;
      expect(wrap.width, 'grid width vs page').toBeGreaterThan(main.width - 80);

      const firstRow = (await rows.first().boundingBox())!;
      // The summary strip (WP7, one 28 px line plus its margin) sits above the grid now.
      if (w === 1366) expect(firstRow.y, 'first task row y at 1366').toBeLessThan(370);
      if (w === 768) expect(firstRow.y, 'first task row y at 768').toBeLessThan(h);
      console.log(`${w}x${h}: first task row at y ${Math.round(firstRow.y)}`);

      await noSilentClipping(page, `Tasks at ${w}`);
      await noSidewaysScroll(page);
      await axeClean(page, `Tasks tab at ${w}x${h}`);
      await shot(page, 'tasks');

      // Details: the facts, no Name, the description, the status.
      await page.getByRole('tab', { name: 'Details' }).click();
      await expect(page).toHaveURL(/tab=details/);
      const body = page.locator('[data-details-tab]');
      await expect(body.locator('dt')).toHaveText(['Matter', 'Description', 'Status', 'Created']);
      await expect(body).toContainText(DESCRIPTION);
      await expect(body).toContainText('Active');
      await expect(body).not.toContainText(PROJECT_130);
      await expect(body).toContainText(data.world.matter.matterRef);
      await expect(page.locator('.wt-wrap')).toBeHidden();
      await noSidewaysScroll(page);
      await axeClean(page, `Details tab at ${w}x${h}`);
      await shot(page, 'details');

      // Back to Tasks: the tab leaves the address.
      await page.getByRole('tab', { name: /^Tasks/ }).click();
      await expect(page).not.toHaveURL(/tab=/);
      await expect(page.locator('.wt-wrap')).toBeVisible();
      await noSilentClipping(page, `Tasks again at ${w}`);
    });
  }

  test('the status column is visible at 1366 and 768 without opening anything (BUG-5)', async ({
    page,
  }) => {
    for (const [w, h] of [
      [1366, 768],
      [768, 1024],
    ] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(url(data.project));
      await ready(page);
      const status = page.locator('.wt-wrap thead th', { hasText: 'Status' });
      await expect(status).toBeVisible();
      const [box, wrap] = await Promise.all([
        status.boundingBox(),
        page.locator('.wt-wrap').boundingBox(),
      ]);
      const overflowing = await page
        .locator('.wt-wrap')
        .evaluate((e) => e.scrollWidth > e.clientWidth + 1);
      if (!overflowing) expect(box!.x + box!.width).toBeLessThanOrEqual(wrap!.x + wrap!.width + 1);
      else await expect(page.locator('[data-scroll-hint].wt-hint--show')).toBeVisible();
    }
  });
});

test.describe('WP4: behaviour', () => {
  test('the old stored panel preference changes nothing', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('mf.detail-panel.open', 'true'));
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(url(data.project));
    await ready(page);
    await expect(page.getByRole('complementary')).toHaveCount(0);
    await expect(page.getByRole('tab')).toHaveCount(2);
    expect(await page.evaluate(() => localStorage.getItem('mf.detail-panel.open'))).toBe('true');
  });

  test('?tab=details deep-links; the keys of the tab list work; the title follows the tab', async ({
    page,
  }) => {
    await page.goto(url(data.project, 'details'));
    await ready(page);
    await expect(page.getByRole('tab', { name: 'Details' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.locator('[data-details-tab]')).toBeVisible();
    // The count is known even though the person opened Details first.
    await expect(page.getByRole('tab', { name: /^Tasks/ })).toHaveText(`Tasks (${data.taskCount})`);
    await expect.poll(() => page.title()).toMatch(/^Custodian Interviews.*: Details - MatterFlow$/);

    await page.getByRole('tab', { name: 'Details' }).focus();
    await page.keyboard.press('Home');
    await expect(page.getByRole('tab', { name: /^Tasks/ })).toBeFocused();
    await expect(page).not.toHaveURL(/tab=/);
    await expect.poll(() => page.title()).toMatch(/^Custodian Interviews.*: Tasks - MatterFlow$/);
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Details' })).toBeFocused();
    await expect(page).toHaveURL(/tab=details/);
    await page.keyboard.press('ArrowRight'); // wraps
    await expect(page.getByRole('tab', { name: /^Tasks/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.keyboard.press('End');
    await expect(page.getByRole('tab', { name: 'Details' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('a project without tasks shows Tasks (0) and no Description row; an old ?tab=activity link shows Tasks', async ({
    page,
  }) => {
    await page.goto(url(data.empty));
    await ready(page);
    await expect(page.getByRole('tab', { name: /^Tasks/ })).toHaveText('Tasks (0)');
    await page.getByRole('tab', { name: 'Details' }).click();
    await expect(page.locator('[data-details-tab] dt')).toHaveText(['Matter', 'Status', 'Created']);
    await expect(page.locator('[data-details-tab]')).not.toContainText('No description');

    await page.goto(url(data.project, 'activity'));
    await ready(page);
    await expect(page.getByRole('tab', { name: /^Tasks/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('a link that opens the grid already filtered shows the open count from the summary; the filter survives a visit to Details', async ({
    page,
  }) => {
    await page.goto(`${url(data.project)}?q=Privilege`);
    await ready(page);
    await expect(page.locator('.wt-wrap tbody tr')).toHaveCount(2);
    // The count is the summary's open count (WP7), so a filtered link no longer leaves the tab without a number.
    await expect(page.getByRole('tab').first()).toHaveText(`Tasks (${data.taskCount})`);
    await page.getByRole('tab', { name: 'Details' }).click();
    await page.getByRole('tab', { name: /^Tasks/ }).click();
    await expect(page.locator('.wt-wrap tbody tr')).toHaveCount(2);
    await expect(page.getByRole('tab').first()).toHaveText(`Tasks (${data.taskCount})`);
  });

  test('an archived project keeps its banner, disables Create task with the reason and shows Archived in Details', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(url(data.archived));
    await ready(page);
    await expect(page.locator('[data-archived-banner]')).toBeVisible();
    const create = page.locator('[data-action=create-task]');
    await expect(create).toHaveAttribute('aria-disabled', 'true');
    await page.getByRole('tab', { name: 'Details' }).click();
    await expect(page.locator('[data-details-tab]')).toContainText('Archived');
    await shot(page, 'archived-details');
  });

  test('archive and restore from the header overflow still work with the tabs', async ({
    page,
    seed,
  }) => {
    const p = await seed.project(data.world.matter, `Flow ${uid()}`);
    await page.goto(url(p));
    await ready(page);
    await page.locator('[data-overflow]').click();
    await page.getByRole('menuitem', { name: 'Archive' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Archive' }).click();
    await expect(page.locator('[data-archived-banner]')).toBeVisible();
    await page.getByRole('tab', { name: 'Details' }).click();
    await expect(page.locator('[data-details-tab]')).toContainText('Archived');
    await page.locator('[data-overflow]').click();
    await expect(page.getByRole('menuitem', { name: 'Restore' })).toBeVisible();
  });

  test.describe('permission variants', () => {
    test('without Task.View: no count, a notice instead of the grid; without Matter.View the matter is text', async ({
      asUser,
      seed,
    }) => {
      const role = await seed.role(['Project.View'], 'E2E project only');
      const user = await seed.user([role.name], 'wp4-noview');
      const page = await asUser(user.username);
      await page.goto(url(data.project));
      await ready(page);
      await expect(page.getByRole('tab').first()).toHaveText('Tasks');
      await expect(page.locator('[data-no-access=tasks]')).toBeVisible();
      await page.getByRole('tab', { name: 'Details' }).click();
      await expect(page.locator('[data-matter-value]')).toContainText(data.world.matter.matterRef);
      await expect(page.locator('[data-matter-value] a')).toHaveCount(0);
      await expect(page.locator('[data-page-actions] button')).toHaveCount(0);
    });

    test('with Matter.View and Task.View the matter is a link and the count shows; Edit stays in the header', async ({
      asUser,
      seed,
    }) => {
      const role = await seed.role(
        ['Project.View', 'Project.Edit', 'Matter.View', 'Task.View'],
        'E2E project editor',
      );
      const user = await seed.user([role.name], 'wp4-edit');
      const page = await asUser(user.username);
      await page.goto(url(data.project, 'details'));
      await ready(page);
      await expect(page.locator('[data-matter-value] a')).toHaveAttribute(
        'href',
        `/matters/${data.world.matter.matterId}`,
      );
      await expect(page.getByRole('tab', { name: /^Tasks/ })).toHaveText(
        `Tasks (${data.taskCount})`,
      );
      await expect(page.locator('[data-page-actions] [data-action=edit]')).toBeVisible();
      await expect(
        page.locator('[data-details-tab]').getByRole('button', { name: /Edit|Archive|Restore/ }),
      ).toHaveCount(0);
    });
  });
});
