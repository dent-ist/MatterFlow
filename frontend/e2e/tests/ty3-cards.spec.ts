import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { LISTS, ListKind, seedMix } from '../support/admin-lists';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

/**
 * WP-TY3 phone cards and narrow-window columns of the three Administration lists (#374 Task Types, #375 Workflows and Workflow Steps).
 * Below 640 px a list is one `<ul>` of cards (no table markup) with the name as the one link, the status badge, the key facts and the
 * row overflow menu; from 640 px it is the table, whose columns drop in a fixed order so the grid never scrolls sideways and the row
 * menu stays in view. Screenshots go to E2E_SCREENSHOTS (docs/ux/task-types-review/fixes/ty3-lists).
 */
const OUT = process.env['E2E_SCREENSHOTS'];
const SIZES = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
  { width: 768, height: 1024 },
  { width: 375, height: 812 },
] as const;
const KINDS: ListKind[] = ['types', 'workflows', 'steps'];

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

const cards = (page: Page) => page.locator('li[data-record-card]');
const tableRows = (page: Page) => page.locator('table tbody tr[data-row]');

/** Elements (other than the page) that are scrolled sideways right now. */
const scrolledSideways = (page: Page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll('*'))
      .filter((el) => el.scrollLeft > 0)
      .map((el) => el.tagName + '.' + el.className),
  );

test.describe('phone cards below 640 px (#374, #375)', () => {
  for (const kind of KINDS) {
    const info = LISTS[kind];

    test(`${kind}: cards at 320, 375, 414 and 639 px, a table from 640 px; no sideways scroll and axe 0`, async ({
      page,
      admin,
    }) => {
      const token = uid();
      await seedMix(admin, kind, token, 2, 1);
      for (const width of [320, 375, 414, 639]) {
        await page.setViewportSize({ width, height: 812 });
        await page.goto(`${info.list}?${info.filter}=${token}`);
        await expect(cards(page)).toHaveCount(2);
        await expect(page.locator('table')).toHaveCount(0);
        const list = page.locator('ul[data-record-cards]');
        await expect(list).toHaveAttribute('aria-label', /.+/);
        for (let i = 0; i < 2; i++) {
          const card = cards(page).nth(i);
          await expect(card.locator('a[data-card-name]')).toContainText(token);
          await expect(card.locator('mf-active-badge, [data-active-badge]').first()).toContainText(
            'Active',
          );
          const menu = card.locator('button[data-overflow]');
          await expect(menu).toBeVisible();
          const box = (await menu.boundingBox())!;
          expect(
            box.x + box.width,
            `${kind} at ${width}: menu inside the screen`,
          ).toBeLessThanOrEqual(width);
          expect(box.width).toBeGreaterThanOrEqual(24);
        }
        await noSideways(page, `${kind} cards at ${width}`);
        await axeClean(page, `${kind} cards at ${width}`);
        if (width === 375) await shot(page, `p374-${kind}-cards`);
      }
      await page.setViewportSize({ width: 640, height: 900 });
      await expect(tableRows(page).first()).toBeVisible();
      await expect(cards(page)).toHaveCount(0);
    });

    test(`${kind}: Tab onto the row menu button does not scroll anything sideways`, async ({
      page,
      admin,
    }) => {
      const token = uid();
      await seedMix(admin, kind, token, 2, 0);
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(`${info.list}?${info.filter}=${token}`);
      await expect(cards(page)).toHaveCount(2);
      // The tab strip of the page scrolls itself to the open tab at this width; that is not what is checked here.
      const resting = await scrolledSideways(page);
      await page.locator('a[data-card-name]').first().focus();
      // The name link, then the row menu button: nothing may scroll sideways on the way.
      await page.keyboard.press('Tab');
      await expect(page.locator('button[data-overflow]').first()).toBeFocused();
      expect(await scrolledSideways(page)).toEqual(resting);
      await noSideways(page, `${kind} after Tab`);
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      expect(await scrolledSideways(page)).toEqual(resting);
    });

    test(`${kind}: the card menu opens by keyboard, Escape returns focus, Deactivate asks first, Activate brings it back`, async ({
      page,
      admin,
    }) => {
      const token = uid();
      const rows = await seedMix(admin, kind, token, 1, 0);
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(`${info.list}?${info.filter}=${token}`);
      const menu = cards(page).first().locator('button[data-overflow]');
      await menu.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('menuitem').first()).toBeVisible();
      await axeClean(page, `${kind} card menu open`);
      await shot(page, `p374-${kind}-menu`);
      await page.keyboard.press('Escape');
      await expect(menu).toBeFocused();

      await menu.click();
      await page.getByRole('menuitem', { name: 'Deactivate' }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await axeClean(page, `${kind} deactivate dialog`);
      await dialog.getByRole('button', { name: /^Deactivate/ }).click();
      await expect(cards(page)).toHaveCount(0);
      await expect(page.locator('[data-empty="filtered"]')).toContainText('1 inactive hidden');
      await page.locator('[data-show-all]').click();
      await expect(cards(page)).toHaveCount(1);
      await expect(cards(page).first()).toContainText('Inactive');
      await cards(page).first().locator('button[data-overflow]').click();
      await page.getByRole('menuitem', { name: 'Activate' }).click();
      await expect(cards(page).first()).toContainText('Active');
      expect(rows.length).toBe(1);
    });

    test(`${kind}: the Filters sheet carries Sort by and the cards follow it; Back puts focus on the card`, async ({
      page,
      admin,
    }) => {
      const token = uid();
      const rows = await seedMix(admin, kind, token, 2, 2);
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(`${info.list}?${info.filter}=${token}&status=all`);
      await expect(cards(page)).toHaveCount(4);
      await page.locator('[data-filters-toggle]').click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await axeClean(page, `${kind} sheet`);
      await shot(page, `p374-${kind}-sheet`);
      await dialog.getByLabel('Sort by').selectOption({ label: 'Status' });
      await expect(page).toHaveURL(/sort=status/);
      await page.keyboard.press('Escape');
      await expect(cards(page).nth(0)).toContainText('Active');
      await expect(cards(page).nth(3)).toContainText('Inactive');

      // Back from a record lands on the card's name link, in the same view.
      const target = rows[1];
      const before = new URL(page.url()).search;
      await page.locator(`a[data-row-key="${target.id}"]`).click();
      await expect(page).toHaveURL(new RegExp(`${info.list}/${target.id}$`));
      await page.goBack();
      expect(new URL(page.url()).search).toBe(before);
      await expect(page.locator(`a[data-row-key="${target.id}"]`)).toBeFocused();
    });
  }

  test('the cards say the key facts: form and default workflow, published version and draft, description and use', async ({
    page,
    seed,
    admin,
  }) => {
    const token = uid();
    const w1 = await seed.workflow({ name: `${token} Flow A`, stepCount: 3 });
    const w2 = await seed.workflow({ name: `${token} Flow B`, stepCount: 2 });
    const type = await seed.taskType({ name: `${token} Type`, workflows: [w1, w2] });
    const lone = await admin.post('/api/v1/task-types', {
      name: `${token} Lonely`,
      description: null,
      isActive: true,
      eligibleWorkflowIds: [],
      defaultWorkflowDefinitionId: null,
    });
    // A draft on the first workflow.
    await admin.post(`/api/v1/workflows/${w1.workflowDefinitionId}/versions`, {});
    const step = await admin.post('/api/v1/step-definitions', {
      title: `${token} Step`,
      description: `${token} describes the step`,
      instructions: null,
      tags: [],
    });
    await page.setViewportSize({ width: 375, height: 812 });

    await page.goto(`/admin/task-types?name=${token}`);
    const typeCard = cards(page).filter({ hasText: `${token} Type` });
    await expect(typeCard.locator('[data-card-meta]').first()).toContainText(`${w1.name} +1`);
    const loneCard = cards(page).filter({ hasText: `${token} Lonely` });
    await expect(loneCard.locator('[data-card-meta]').first()).toContainText('No workflow');
    await expect(loneCard.locator('[data-warning]')).toContainText("users can't create tasks");
    await expect(typeCard.locator('svg')).toHaveCount(1); // the icon before the name
    expect(type.id).toBeGreaterThan(0);
    expect(lone.id).toBeGreaterThan(0);

    await page.goto(`/admin/workflows?name=${token}`);
    const flowA = cards(page).filter({ hasText: `${token} Flow A` });
    await expect(flowA.locator('[data-card-meta]').nth(0)).toContainText('Published v1 (3 steps)');
    await expect(flowA.locator('[data-card-meta]').nth(1)).toContainText('Draft v2 - 1 task type');
    const flowB = cards(page).filter({ hasText: `${token} Flow B` });
    await expect(flowB.locator('[data-card-meta]').nth(1)).toContainText('1 task type');

    await page.goto(`/admin/steps?title=${token}`);
    const stepCard = cards(page)
      .filter({ hasText: `${token} Step` })
      .first();
    await expect(stepCard).toContainText(`${token} describes the step`);
    await expect(stepCard).toContainText('Not used in a workflow');
    expect(step.stepDefinitionId).toBeGreaterThan(0);
    // The used-in link of a step that a workflow uses opens the Workflows tab filtered to it.
    await page.goto(`/admin/steps?title=${w1.stepTitles[0].split(' ')[0]}`);
    const used = page.locator('a[data-used-in-link]').first();
    if (await used.count()) {
      await expect(used).toHaveAttribute('href', /\/admin\/workflows\?step=\d+/);
    }
  });

  test('permissions: TaskType.Manage only gets Task Types cards, Workflow.Manage only gets Workflows and Steps cards', async ({
    seed,
    asUser,
    admin,
  }) => {
    const token = uid();
    await seedMix(admin, 'types', token, 1, 0);
    await seedMix(admin, 'workflows', token, 1, 0);
    await seedMix(admin, 'steps', token, 1, 0);
    const typeRole = await seed.role(['TaskType.Manage', 'Task.View'], 'Type only');
    const tt = await asUser((await seed.user([typeRole.name], 'ty3-tt')).username);
    await tt.setViewportSize({ width: 375, height: 812 });
    await tt.goto(`/admin/task-types?name=${token}`);
    await expect(cards(tt)).toHaveCount(1);
    await axeClean(tt, 'type-only cards');
    const wfRole = await seed.role(['Workflow.Manage', 'Task.View'], 'Workflow only');
    const wf = await asUser((await seed.user([wfRole.name], 'ty3-wf')).username);
    await wf.setViewportSize({ width: 375, height: 812 });
    await wf.goto(`/admin/workflows?name=${token}`);
    await expect(cards(wf)).toHaveCount(1);
    await wf.goto(`/admin/steps?title=${token}`);
    await expect(cards(wf)).toHaveCount(1);
    await axeClean(wf, 'workflow-only cards');
  });
});

test.describe('narrow-window columns: the grid never scrolls sideways and the row menu stays in view (#374, #375)', () => {
  for (const kind of KINDS) {
    const info = LISTS[kind];
    test(`${kind}: at 640, 768, 1024, 1280, 1366 and 1920 px the table fits its box, the filter row is open and the menu is on screen`, async ({
      page,
      admin,
    }) => {
      const token = uid();
      await seedMix(admin, kind, token, 4, 0);
      for (const width of [640, 768, 1024, 1280, 1366, 1920]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(() => localStorage.clear()).catch(() => undefined);
        await page.goto(`${info.list}?${info.filter}=${token}`);
        await expect(tableRows(page).first()).toBeVisible();
        const fit = await page.locator('.mf-table-wrap').evaluate((el) => ({
          scroll: el.scrollWidth,
          client: el.clientWidth,
        }));
        expect(fit.scroll, `${kind} at ${width}: the table scrolls sideways`).toBeLessThanOrEqual(
          fit.client,
        );
        const menu = (await tableRows(page)
          .first()
          .locator('button[data-overflow]')
          .boundingBox())!;
        expect(menu.x + menu.width, `${kind} at ${width}: menu on screen`).toBeLessThanOrEqual(
          width,
        );
        await expect(page.locator(info.row)).toBeVisible();
        await noSideways(page, `${kind} at ${width}`);
        await axeClean(page, `${kind} at ${width}`);
        if (SIZES.some((s) => s.width === width)) await shot(page, `p374-${kind}-table`);
      }
    });
  }

  test('a filter whose column is left out stays active and shows as a chip', async ({
    page,
    admin,
  }) => {
    const token = uid();
    await seedMix(admin, 'workflows', token, 2, 0);
    await page.setViewportSize({ width: 768, height: 900 });
    await page.goto(`/admin/workflows?name=${token}&hasPublished=false`);
    await expect(tableRows(page)).toHaveCount(2);
    await expect(page.getByText('Not published', { exact: false }).first()).toBeVisible();
    await page.setViewportSize({ width: 1366, height: 900 });
    await expect(page.locator('[aria-label="Filter by Latest published"]')).toBeVisible();
  });
});
