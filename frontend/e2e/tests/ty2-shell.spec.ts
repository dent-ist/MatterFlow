import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { LISTS, ListKind, seedMix } from '../support/admin-lists';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

/**
 * WP-TY2 page shell of the Task Types administration (#363 descriptions, #365 filter row open by default, #369 hidden-count line and
 * Status sort, #370 list states). Screenshots go to E2E_SCREENSHOTS (docs/ux/task-types-review/fixes/ty2-shell).
 */
const OUT = process.env['E2E_SCREENSHOTS'];
const SIZES = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
  { width: 768, height: 1024 },
  { width: 375, height: 812 },
] as const;

const TABS = [
  {
    key: 'task-types',
    url: '/admin/task-types',
    text: 'What people can request: a request form and its eligible workflows.',
    row: '#task-type-filter-row',
  },
  {
    key: 'workflows',
    url: '/admin/workflows',
    text: 'Ordered steps a request follows, with versions you publish.',
    row: '#workflow-filter-row',
  },
  {
    key: 'steps',
    url: '/admin/steps',
    text: 'The reusable steps and inputs that workflows are built from.',
    row: '#step-filter-row',
  },
] as const;

async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  const size = page.viewportSize()!;
  await page.screenshot({ path: path.join(OUT, `${name}-${size.width}x${size.height}.png`) });
}

async function noSideScroll(page: Page, what: string): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${what}: page-level horizontal scroll`).toBeLessThanOrEqual(0);
}

const description = (page: Page) => page.locator('[data-page-description]');
/** The number of text lines of the page description and whether its text is cut off. */
const measure = (page: Page) =>
  description(page).evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const tops = new Set(Array.from(range.getClientRects()).map((r) => Math.round(r.top)));
    return { clipped: el.scrollWidth > el.clientWidth, lines: tops.size };
  });
const toggle = (page: Page) => page.locator('[data-filters-toggle]');

test.describe('one short sentence per tab (#363)', () => {
  for (const tab of TABS) {
    test(`${tab.key}: the description is the agreed sentence, whole on one line at 1366 and 1920`, async ({
      page,
    }) => {
      await page.goto(tab.url);
      for (const size of [SIZES[0], SIZES[1]]) {
        await page.setViewportSize(size);
        await expect(description(page)).toHaveText(tab.text);
        expect(tab.text.length).toBeLessThanOrEqual(90);
        const box = await measure(page);
        expect(box.clipped, `${tab.key} at ${size.width} is cut off`).toBe(false);
        expect(box.lines, `${tab.key} at ${size.width}`).toBe(1);
        await expect(description(page)).toHaveAttribute('title', tab.text);
      }
      await page.setViewportSize(SIZES[3]);
      const { lines } = await measure(page);
      expect(lines, `${tab.key} at 375`).toBeLessThanOrEqual(2);
      await expect(page).toHaveTitle(/Task Types|Workflows|Workflow Steps/);
    });
  }
});

test.describe('the filter row is open from 640 px and the Filters button sits in the header (#365)', () => {
  for (const tab of TABS) {
    test(`${tab.key}: open at 768, 1366 and 1920, closed at 375, button in the header, no extra toolbar row`, async ({
      page,
    }) => {
      for (const size of SIZES) {
        await page.setViewportSize(size);
        await page.evaluate(() => localStorage.clear()).catch(() => undefined);
        await page.goto(tab.url);
        await expect(page.locator('tbody, mf-record-card-list').first()).toBeVisible();
        const open = size.width >= 640;
        if (open) await expect(page.locator(tab.row)).toBeVisible();
        else await expect(page.locator(tab.row)).toHaveCount(0);
        // The button is one of the page header's actions, not a row of its own above the grid.
        const header = page.locator('mf-page-header');
        await expect(header.locator('[data-filters-toggle]')).toBeVisible();
        // No row of its own for the button. A narrow window that leaves a column out may keep a row with the one "Other filters" button.
        const toolbar = page.locator('[data-grid-toolbar]');
        if ((await toolbar.count()) > 0) {
          await expect(toolbar).toHaveText(/^\s*Other filters\s*$/);
        }
        if (open) await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
        await noSideScroll(page, `${tab.key} at ${size.width}`);
        if (axeAvailable()) {
          expect(await axeViolations(page), `${tab.key} at ${size.width}`).toEqual([]);
        }
        await shot(page, `p3-${tab.key}`);
      }
    });

    test(`${tab.key}: the choice is remembered for this tab and does not leak to the others`, async ({
      page,
    }) => {
      await page.setViewportSize(SIZES[0]);
      await page.goto(tab.url);
      await expect(page.locator(tab.row)).toBeVisible();
      await toggle(page).click();
      await expect(page.locator(tab.row)).toHaveCount(0);
      await page.reload();
      await expect(toggle(page)).toBeVisible();
      await expect(page.locator(tab.row)).toHaveCount(0);
      // The other tabs keep their own default.
      for (const other of TABS.filter((t) => t.key !== tab.key)) {
        await page.goto(other.url);
        await expect(page.locator(other.row)).toBeVisible();
      }
      // Open it again by keyboard.
      await page.goto(tab.url);
      await toggle(page).focus();
      await page.keyboard.press('Enter');
      await expect(page.locator(tab.row)).toBeVisible();
      await page.reload();
      await expect(page.locator(tab.row)).toBeVisible();
    });
  }

  test('on a phone the Filters button opens the sheet and its filters work', async ({ page }) => {
    await page.setViewportSize(SIZES[3]);
    await page.goto('/admin/task-types');
    await toggle(page).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    if (axeAvailable()) expect(await axeViolations(page)).toEqual([]);
    await shot(page, 'p3-sheet-task-types');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(toggle(page)).toBeFocused();
  });

  test('permissions: Workflow.Manage only gets the button on Workflows; TaskType.Manage only on Task Types; Task.View only gets the 403', async ({
    seed,
    asUser,
  }) => {
    const wfRole = await seed.role(['Workflow.Manage', 'Task.View'], 'Workflow only');
    const wf = await asUser((await seed.user([wfRole.name], 'ty2-wfonly')).username);
    await wf.goto('/admin/task-types');
    await expect(wf).toHaveURL(/\/admin\/workflows$/);
    await expect(wf.locator('mf-page-header [data-filters-toggle]')).toBeVisible();
    await expect(wf.locator('#workflow-filter-row')).toBeVisible();

    const typeRole = await seed.role(['TaskType.Manage', 'Task.View'], 'Type only');
    const tt = await asUser((await seed.user([typeRole.name], 'ty2-ttonly')).username);
    await tt.goto('/admin/task-types');
    await expect(tt.locator('mf-page-header [data-filters-toggle]')).toBeVisible();
    await expect(tt.locator('#task-type-filter-row')).toBeVisible();

    const viewerRole = await seed.role(['Task.View'], 'Viewer');
    const viewer = await asUser((await seed.user([viewerRole.name], 'ty2-viewer')).username);
    await viewer.goto('/admin/task-types');
    await expect(
      viewer.getByRole('heading', { name: "You don't have permission to view this." }),
    ).toBeVisible();
    await expect(viewer.locator('[data-filters-toggle]')).toHaveCount(0);
  });
});

const KINDS: ListKind[] = ['types', 'workflows', 'steps'];
const dataRows = (page: Page) => page.locator('tbody tr[data-row]');

test.describe('the list says what the default Status hides and Status sorts (#369)', () => {
  for (const kind of KINDS) {
    const info = LISTS[kind];

    test(`${kind}: "n inactive hidden" with Show all in the pager, counted under the same filters`, async ({
      page,
      admin,
    }) => {
      const token = uid();
      await seedMix(admin, kind, token, 3, 2);
      const other = uid();
      await seedMix(admin, kind, other, 0, 4); // inactive ones that do not match the filter are not counted
      await page.setViewportSize(SIZES[0]);
      await page.goto(`${info.list}?${info.filter}=${token}`);
      await expect(dataRows(page)).toHaveCount(3);
      const pager = page.locator('mf-pager');
      await expect(pager).toContainText('Showing 1-3 of 3 active');
      await expect(pager.locator('[data-hidden-hint]')).toContainText('2 inactive hidden');
      if (axeAvailable()) expect(await axeViolations(page)).toEqual([]);
      await shot(page, `p369-${kind}-hint`);

      // The link applies Status = All in the address and lists them all; the hint goes.
      await pager.locator('[data-show-all]').click();
      await expect(page).toHaveURL(/status=all/);
      await expect(dataRows(page)).toHaveCount(5);
      await expect(pager.locator('[data-hidden-hint]')).toHaveCount(0);
      await expect(pager).toContainText('Showing 1-5 of 5');

      // Keyboard: the link is a button that Enter operates.
      await page.goto(`${info.list}?${info.filter}=${token}`);
      await pager.locator('[data-show-all]').focus();
      await page.keyboard.press('Enter');
      await expect(dataRows(page)).toHaveCount(5);
    });

    test(`${kind}: a list whose matches are all inactive says so and offers Show all`, async ({
      page,
      admin,
    }) => {
      const token = uid();
      await seedMix(admin, kind, token, 0, 2);
      await page.setViewportSize(SIZES[0]);
      await page.goto(`${info.list}?${info.filter}=${token}`);
      const empty = page.locator('[data-empty="filtered"]');
      await expect(empty).toContainText(`No ${info.noun} match these filters`);
      await expect(empty.locator('[data-hidden-hint]')).toContainText('2 inactive hidden');
      await empty.locator('[data-show-all]').click();
      await expect(dataRows(page)).toHaveCount(2);
    });

    test(`${kind}: Status sorts (Active first, then Inactive first) with aria-sort`, async ({
      page,
      admin,
    }) => {
      const token = uid();
      const rows = await seedMix(admin, kind, token, 2, 2);
      await page.setViewportSize(SIZES[0]);
      await page.goto(`${info.list}?${info.filter}=${token}&status=all`);
      await expect(dataRows(page)).toHaveCount(4);
      const header = page.getByRole('columnheader', { name: 'Status' });
      await expect(header).toHaveAttribute('aria-sort', 'none');
      await header.getByRole('button').click();
      await expect(page).toHaveURL(/sort=status/);
      await expect(header).toHaveAttribute('aria-sort', 'ascending');
      const order = () =>
        dataRows(page).evaluateAll((trs) => trs.map((tr) => tr.getAttribute('data-row')));
      const active = rows.filter((r) => r.active).map((r) => r.name);
      await expect.poll(async () => (await order()).slice(0, 2).sort()).toEqual(active.sort());
      await header.getByRole('button').click();
      await expect(header).toHaveAttribute('aria-sort', 'descending');
      await expect.poll(async () => (await order()).slice(2).sort()).toEqual(active.sort());
      // Keyboard: the header button is operable with Enter.
      await header.getByRole('button').focus();
      await page.keyboard.press('Enter');
      await expect(header).toHaveAttribute('aria-sort', 'ascending');
    });
  }

  test('permissions: the hint and the Status sort are the same for Workflow.Manage only and TaskType.Manage only', async ({
    admin,
    seed,
    asUser,
  }) => {
    const token = uid();
    await seedMix(admin, 'workflows', token, 1, 1);
    await seedMix(admin, 'types', token, 1, 1);
    const wfRole = await seed.role(['Workflow.Manage', 'Task.View'], 'Workflow only');
    const wf = await asUser((await seed.user([wfRole.name], 'ty2-wf2')).username);
    await wf.goto(`/admin/workflows?name=${token}`);
    await expect(wf.locator('mf-pager [data-hidden-hint]')).toContainText('1 inactive hidden');
    await expect(wf.getByRole('columnheader', { name: 'Status' })).toHaveAttribute(
      'aria-sort',
      'none',
    );
    const typeRole = await seed.role(['TaskType.Manage', 'Task.View'], 'Type only');
    const tt = await asUser((await seed.user([typeRole.name], 'ty2-tt2')).username);
    await tt.goto(`/admin/task-types?name=${token}`);
    await expect(tt.locator('mf-pager [data-hidden-hint]')).toContainText('1 inactive hidden');
  });
});
