import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { LISTS, ListKind, seedMix } from '../support/admin-lists';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

/**
 * WP-AD2 list kit, second batch, proven on the Administration lists that already run on the kit: the grid-body states with the hidden-count
 * line (#575, `AdminListState`, Task Types and Steps), the phone cards of `AdminCardSpec` (#579, Workflow Steps) and the health-strip chips
 * (#581, Task Types). Screenshots go to E2E_SCREENSHOTS (docs/ux/admin-pages-review/fixes/ad2-kit).
 */
const OUT = process.env['E2E_SCREENSHOTS'];
const SIZES = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 768, height: 1024 },
  { width: 375, height: 812 },
] as const;
const KINDS: ListKind[] = ['types', 'steps'];

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

const axeClean = async (page: Page, what: string) => {
  if (axeAvailable()) expect(await axeViolations(page), what).toEqual([]);
};

test.describe('grid-body states on the real columns (#575)', () => {
  for (const kind of KINDS) {
    const info = LISTS[kind];

    test(`${kind}: a filter that finds only inactive records says "n inactive hidden" with Show all, at four widths`, async ({
      page,
      admin,
    }) => {
      const token = uid();
      await seedMix(admin, kind, token, 0, 2);
      for (const size of SIZES) {
        await page.setViewportSize(size);
        await page.goto(`${info.list}?${info.filter}=${token}`);
        const none = page.locator('[data-empty="filtered"]');
        await expect(none).toContainText(`No ${info.noun} match these filters`);
        await expect(none.locator('[data-hidden-hint]')).toContainText('2 inactive hidden');
        await expect(none.getByRole('button', { name: 'Show all' })).toBeVisible();
        // One Clear filters at a time: the body's, not a second one in the bar.
        await expect(page.getByRole('button', { name: 'Clear filters' })).toHaveCount(1);
        await axeClean(page, `${kind} no-match at ${size.width}`);
        await noSideScroll(page, `${kind} no-match at ${size.width}`);
        await shot(page, `states-${kind}-hidden`);
      }
      await page.setViewportSize(SIZES[1]);
      await page.goto(`${info.list}?${info.filter}=${token}`);
      await page
        .locator('[data-empty="filtered"]')
        .getByRole('button', { name: 'Show all' })
        .click();
      await expect(page).toHaveURL(/status=all/);
      await expect(
        page.locator('tbody tr[data-row]').or(page.locator('li[data-record-card]')).first(),
      ).toBeVisible();
    });
  }

  test('the skeleton of Task Types has the columns of the table at 1366 and the loaded table keeps its place', async ({
    page,
  }) => {
    await page.setViewportSize(SIZES[1]);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(
      (url) => url.pathname === '/api/v1/task-types',
      async (route) => {
        await held;
        await route.continue();
      },
    );
    await page.goto(LISTS.types.list);
    const skeleton = page.locator('tbody [data-skeleton]');
    await expect(skeleton).toHaveCount(5);
    const headers = await page.locator('thead tr').first().locator('th').count();
    expect(await skeleton.first().locator('td').count()).toBe(headers);
    await axeClean(page, 'skeleton at 1366');
    await shot(page, 'states-types-skeleton');
    release();
    await expect(page.locator('tbody tr[data-row]').first()).toBeVisible();
  });
});

test.describe('phone cards of AdminCardSpec (#579), on Workflow Steps', () => {
  test('375: a card is 2 to 4 lines tall with the same facts and the same menu entries as the row; 639 is cards, 640 the table', async ({
    page,
    admin,
  }) => {
    const token = uid();
    const rows = await seedMix(admin, 'steps', token, 2, 1);
    expect(rows).toHaveLength(3);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/admin/steps?title=${token}&status=all`);
    const cards = page.locator('li[data-record-card]');
    await expect(cards).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      const box = (await cards.nth(i).boundingBox())!;
      // 24 px lines: the name plus one to three muted lines, never a clipped or a taller card.
      expect(box.height, `card ${i}`).toBeGreaterThanOrEqual(48);
      expect(box.height, `card ${i}`).toBeLessThanOrEqual(4 * 24 + 16);
      await expect(cards.nth(i).locator('[data-card-meta]')).not.toHaveCount(4);
    }
    const first = cards.first();
    await expect(first.locator('a[data-card-name]')).toContainText(token);
    // The menu has what the table row's menu has.
    await first.locator('button[data-overflow]').click();
    const cardEntries = await page.getByRole('menuitem').allInnerTexts();
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1366, height: 768 });
    await expect(page.locator('li[data-record-card]')).toHaveCount(0);
    await page.locator('tbody tr[data-row]').first().locator('button[data-overflow]').click();
    const rowEntries = await page.getByRole('menuitem').allInnerTexts();
    await page.keyboard.press('Escape');
    expect(cardEntries.map((t) => t.trim())).toEqual(rowEntries.map((t) => t.trim()));
    // The boundary.
    await page.setViewportSize({ width: 639, height: 812 });
    await expect(page.locator('table')).toHaveCount(0);
    await expect(cards.first()).toBeVisible();
    await page.setViewportSize({ width: 640, height: 812 });
    await expect(page.locator('table')).toHaveCount(1);
    await expect(page.locator('li[data-record-card]')).toHaveCount(0);
  });

  test('keyboard only: Tab reaches the card link, then the menu; Enter opens the step; Back puts focus on the card', async ({
    page,
    admin,
  }) => {
    const token = uid();
    const rows = await seedMix(admin, 'steps', token, 1, 0);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/admin/steps?title=${token}`);
    const link = page.locator('li[data-record-card] a[data-card-name]').first();
    await expect(link).toBeVisible();
    await link.focus();
    await page.keyboard.press('Tab');
    await expect(page.locator('li[data-record-card] button[data-overflow]').first()).toBeFocused();
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/admin/steps/${rows[0].id}`));
    await page.goBack();
    await expect(page.locator('li[data-record-card] a[data-card-name]').first()).toBeFocused();
    await axeClean(page, 'steps cards, 375');
    await shot(page, 'cards-steps');
  });
});

test.describe('health strip chips from stripItems (#581), on Task Types', () => {
  test('the chips count the library, press into the address, and the pressed chip again goes back to Active', async ({
    page,
    admin,
  }) => {
    const token = uid();
    await seedMix(admin, 'types', token, 2, 1);
    await page.setViewportSize(SIZES[1]);
    await page.goto(`/admin/task-types?name=${token}`);
    const strip = page.locator('[data-strip]');
    const inactive = strip.locator('[data-strip-item="inactive"]');
    await expect(inactive).toHaveAttribute('aria-pressed', 'false');
    await inactive.click();
    await expect(page).toHaveURL(/status=inactive/);
    await expect(inactive).toHaveAttribute('aria-pressed', 'true');
    await expect(strip.locator('[data-strip-item="active"]')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await inactive.click();
    await expect(page).not.toHaveURL(/status=inactive/);
    await expect(strip.locator('[data-strip-item="active"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await axeClean(page, 'strip chips at 1366');
    await shot(page, 'strip-types');
  });
});
