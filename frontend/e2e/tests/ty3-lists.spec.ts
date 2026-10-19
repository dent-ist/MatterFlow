import fs from 'node:fs';
import path from 'node:path';
import { Locator, Page } from '@playwright/test';
import { Api } from '../support/api';
import { expect, test } from '../support/fixtures';
import { axeAvailable, axeViolations } from '../support/axe';
import { Seeder, uid } from '../support/seed';

/**
 * WP-TY3 Lists on the grid contract (epic #352): the row overflow menu on the three Administration lists.
 * With E2E_SCREENSHOTS set to a folder the tests also save a screenshot per list and width (docs/ux/task-types-review/fixes/ty3-lists).
 */
const SHOTS = process.env['E2E_SCREENSHOTS'];
const SIZES = [
  { w: 1366, h: 768 },
  { w: 1920, h: 1080 },
  { w: 768, h: 1024 },
  { w: 375, h: 812 },
];

async function shot(page: Page, name: string, w: number): Promise<void> {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}-${w}.png`) });
}

interface World {
  token: string;
  type: { id: number; name: string };
  workflow: { workflowDefinitionId: number; name: string };
  step: { id: number; title: string };
}

/** One task type, one workflow with a draft in progress and one step, all carrying a unique token in their names. */
async function world(seed: Seeder, admin: Api): Promise<World> {
  const token = uid();
  const step = await seed.step({ title: `Menu step ${token}` });
  const workflow = await seed.workflow({
    name: `Menu workflow ${token}`,
    steps: [{ stepDefinitionId: step.id, title: step.title }],
  });
  await admin.post(`/api/v1/workflows/${workflow.workflowDefinitionId}/versions`, {});
  const type = await seed.taskType({ name: `Menu type ${token}`, workflows: [workflow] });
  return { token, type, workflow, step };
}

const LISTS = {
  types: (w: World) => ({
    url: `/admin/task-types?name=${w.token}`,
    name: w.type.name,
    items: ['Edit form', 'Deactivate'],
  }),
  workflows: (w: World) => ({
    url: `/admin/workflows?name=${w.token}`,
    name: w.workflow.name,
    items: ['Open draft v2', 'Deactivate'],
  }),
  steps: (w: World) => ({
    url: `/admin/steps?title=${w.token}`,
    name: w.step.title,
    items: ['Edit inputs', 'Deactivate'],
  }),
};

const rowOf = (page: Page, name: string): Locator => page.locator(`tr[data-row="${name}"]`);
const menuButton = (page: Page, name: string): Locator =>
  rowOf(page, name).getByRole('button', { name: `Actions for ${name}` });

/** The Tab stops inside a row: links, buttons and controls that Tab reaches. */
async function tabStops(row: Locator): Promise<number> {
  return row.evaluate(
    (r) =>
      r.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select, [tabindex]:not([tabindex="-1"])',
      ).length,
  );
}

test.describe('Row overflow menu on the three lists (#355)', () => {
  for (const size of SIZES) {
    test(`at ${size.w}x${size.h} the menu button is in view without sideways scroll, opens by keyboard, has no axe violations and returns focus`, async ({
      page,
      seed,
      admin,
    }, info) => {
      test.skip(!axeAvailable(), 'axe-core not installed (set E2E_AXE_PATH to axe.min.js)');
      const w = await world(seed, admin);
      await page.setViewportSize({ width: size.w, height: size.h });
      for (const [key, build] of Object.entries(LISTS)) {
        const list = build(w);
        await page.goto(list.url);
        const row = rowOf(page, list.name);
        await expect(row, key).toBeVisible();
        const button = menuButton(page, list.name);
        await expect(button, key).toBeVisible();

        // Visible inside the table's box without scrolling it, and the page does not scroll sideways.
        const wrap = (await page.locator('.mf-table-wrap').first().boundingBox())!;
        const box = (await button.boundingBox())!;
        expect(box.x, key).toBeGreaterThanOrEqual(wrap.x - 1);
        expect(box.x + box.width, key).toBeLessThanOrEqual(wrap.x + wrap.width + 1);
        expect(box.width, key).toBeGreaterThanOrEqual(44);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          ),
          key,
        ).toBe(true);
        // The text links of the old Actions column are gone: the name is the only link of the row that is not a chip or a count.
        await expect(
          row.getByRole('link', { name: /^(Edit the request form|Edit inputs)/ }),
        ).toHaveCount(0);
        await expect(row.getByRole('button', { name: /^(Deactivate|Activate) / })).toHaveCount(0);
        info.annotations.push({
          type: `tab-stops ${key} ${size.w}`,
          description: String(await tabStops(row)),
        });

        // Keyboard: Enter opens, the entries are what the list offers, Escape closes and focus is back on the button.
        await button.focus();
        await page.keyboard.press('Enter');
        const menu = page.getByRole('menu', { name: `Actions for ${list.name}` });
        await expect(menu, key).toBeVisible();
        await expect(menu.getByRole('menuitem'), key).toHaveText(list.items);
        const menuBox = (await menu.boundingBox())!;
        expect(menuBox.x, key).toBeGreaterThanOrEqual(0);
        expect(menuBox.x + menuBox.width, key).toBeLessThanOrEqual(size.w + 1);
        expect(menuBox.y + menuBox.height, key).toBeLessThanOrEqual(size.h + 1);
        expect(await axeViolations(page), `${key} axe with the menu open`).toEqual([]);
        if (key === 'types') await shot(page, 'menu-open', size.w);
        await page.keyboard.press('Escape');
        await expect(menu, key).toHaveCount(0);
        await expect(button, key).toBeFocused();
        if (key === 'types') await shot(page, 'task-types', size.w);
        if (key === 'workflows') await shot(page, 'workflows', size.w);
        if (key === 'steps') await shot(page, 'steps', size.w);
      }
    });
  }

  test('Edit form, Open draft and Edit inputs open their pages; the name link is unchanged', async ({
    page,
    seed,
    admin,
  }) => {
    const w = await world(seed, admin);
    await page.goto(LISTS.types(w).url);
    await menuButton(page, w.type.name).click();
    await page.getByRole('menuitem', { name: 'Edit form' }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/task-types/${w.type.id}/form$`));

    await page.goto(LISTS.workflows(w).url);
    await menuButton(page, w.workflow.name).click();
    await page.getByRole('menuitem', { name: /Open draft v2/ }).click();
    await expect(page).toHaveURL(
      new RegExp(`/admin/workflows/${w.workflow.workflowDefinitionId}/versions/\\d+$`),
    );

    await page.goto(LISTS.steps(w).url);
    await menuButton(page, w.step.title).click();
    await page.getByRole('menuitem', { name: 'Edit inputs' }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/steps/${w.step.id}/form$`));

    await page.goto(LISTS.steps(w).url);
    await rowOf(page, w.step.title).getByRole('link', { name: w.step.title }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/steps/${w.step.id}$`));
  });

  test('a workflow without a draft offers only Deactivate; Deactivate keeps its confirm dialog and Activate comes back on the inactive row', async ({
    page,
    seed,
  }) => {
    const token = uid();
    const workflow = await seed.workflow({ name: `Plain workflow ${token}` });
    const step = await seed.step({ title: `Plain step ${token}` });
    const type = await seed.taskType({ name: `Plain type ${token}`, workflows: [workflow] });

    // Workflow: one entry, the confirm dialog, then the row leaves the Active list; Status = All shows it with Activate.
    await page.goto(`/admin/workflows?name=${token}`);
    await menuButton(page, workflow.name).click();
    await expect(page.getByRole('menuitem')).toHaveText(['Deactivate']);
    await page.getByRole('menuitem', { name: 'Deactivate' }).click();
    const dialog = page.getByRole('dialog', { name: 'Deactivate workflow?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Keep active' }).click();
    await expect(dialog).toBeHidden();
    await expect(rowOf(page, workflow.name)).toBeVisible();
    await menuButton(page, workflow.name).click();
    await page.getByRole('menuitem', { name: 'Deactivate' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Deactivate workflow' }).click();
    await expect(rowOf(page, workflow.name)).toHaveCount(0);
    await page.goto(`/admin/workflows?name=${token}&status=all`);
    await menuButton(page, workflow.name).click();
    await page.getByRole('menuitem', { name: 'Activate' }).click();
    await expect(page.locator('[data-announce]')).toContainText('activated');
    await menuButton(page, workflow.name).click();
    await expect(page.getByRole('menuitem')).toHaveText(['Deactivate']);
    await page.keyboard.press('Escape');

    // Step.
    await page.goto(`/admin/steps?title=${token}`);
    await menuButton(page, step.title).click();
    await page.getByRole('menuitem', { name: 'Deactivate' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Deactivate step' }).click();
    await expect(rowOf(page, step.title)).toHaveCount(0);
    await page.goto(`/admin/steps?title=${token}&status=all`);
    await menuButton(page, step.title).click();
    await expect(page.getByRole('menuitem')).toHaveText(['Edit inputs', 'Activate']);
    await page.getByRole('menuitem', { name: 'Activate' }).click();
    await expect(page.locator('[data-announce]')).toContainText('activated');

    // Task type.
    await page.goto(`/admin/task-types?name=${token}`);
    await menuButton(page, type.name).click();
    await page.getByRole('menuitem', { name: 'Deactivate' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Deactivate task type' }).click();
    await expect(rowOf(page, type.name)).toHaveCount(0);
    await page.goto(`/admin/task-types?name=${token}&status=all`);
    await menuButton(page, type.name).click();
    await expect(page.getByRole('menuitem')).toHaveText(['Edit form', 'Activate']);
    await page.getByRole('menuitem', { name: 'Activate' }).click();
    await expect(page.locator('[data-announce]')).toContainText('activated');
  });

  test('the menu of the last row is not clipped by the scrolling table (it opens upward)', async ({
    page,
    seed,
  }) => {
    const token = uid();
    for (let i = 0; i < 3; i++) await seed.step({ title: `Bottom step ${token} ${i}` });
    await page.setViewportSize({ width: 1366, height: 600 });
    await page.goto(`/admin/steps?title=${token}&size=10`);
    const rows = page.locator('tbody tr[data-row]');
    await expect(rows).toHaveCount(3);
    await rows.last().locator('button[data-overflow]').scrollIntoViewIfNeeded();
    await rows.last().locator('button[data-overflow]').click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    const box = (await menu.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(600);
    // A resize (or a scroll) closes it: the button it hangs from has moved.
    await page.setViewportSize({ width: 1300, height: 600 });
    await expect(menu).toHaveCount(0);
  });

  test.describe('permission variants', () => {
    test('Workflow.Manage only: Workflows and Steps rows have their menus (Task Types is not offered); TaskType.Manage only: the Task Types menu; Task.View only: the 403 page and no menu', async ({
      seed,
      admin,
      asUser,
    }) => {
      const w = await world(seed, admin);
      const wfRole = await seed.role(['Workflow.Manage', 'Task.View'], 'TY3 workflow only');
      const wfUser = await seed.user([wfRole.name], 'ty3-wf');
      const wfPage = await asUser(wfUser.username);
      await wfPage.goto(LISTS.workflows(w).url);
      await menuButton(wfPage, w.workflow.name).click();
      await expect(wfPage.getByRole('menuitem')).toHaveText(['Open draft v2', 'Deactivate']);
      await wfPage.keyboard.press('Escape');
      await wfPage.goto(LISTS.steps(w).url);
      await menuButton(wfPage, w.step.title).click();
      await expect(wfPage.getByRole('menuitem')).toHaveText(['Edit inputs', 'Deactivate']);
      await wfPage.goto('/admin/task-types');
      await expect(wfPage).toHaveURL(/\/admin\/workflows$/);
      await expect(wfPage.locator('table[data-task-types]')).toHaveCount(0);

      const ttRole = await seed.role(['TaskType.Manage', 'Task.View'], 'TY3 type only');
      const ttUser = await seed.user([ttRole.name], 'ty3-tt');
      const ttPage = await asUser(ttUser.username);
      await ttPage.goto(LISTS.types(w).url);
      await menuButton(ttPage, w.type.name).click();
      await expect(ttPage.getByRole('menuitem')).toHaveText(['Edit form', 'Deactivate']);
      await ttPage.goto('/admin/workflows');
      await expect(ttPage).toHaveURL(/\/admin\/task-types$/);
      await expect(ttPage.locator('table[data-workflows], table[data-steps]')).toHaveCount(0);

      const viewRole = await seed.role(['Task.View'], 'TY3 viewer');
      const viewer = await seed.user([viewRole.name], 'ty3-view');
      const viewPage = await asUser(viewer.username);
      for (const url of ['/admin/task-types', '/admin/workflows', '/admin/steps']) {
        await viewPage.goto(url);
        await expect(
          viewPage.getByRole('heading', { name: "You don't have permission to view this." }),
        ).toBeVisible();
        await expect(viewPage.locator('button[data-overflow]')).toHaveCount(0);
      }
    });
  });
});
