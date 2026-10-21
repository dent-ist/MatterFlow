import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { axeAvailable, axeBestPractice } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { podWorkFixtures } from '../support/pod-work-fixtures';

/**
 * Pod Work, By member block (epic #546, package WP-PW4): BUG-5 (#553, "Skip to member table" lands on the first member row) and BUG-6 / W7
 * (#555, an empty pod shows one message with an "Add members" action and no grid). Data: the fixtures of #547. Screenshots go to
 * `E2E_SCREENSHOTS_PW` when set (docs/ux/pod-work-review/fixes/pw4-members).
 */
const OUT = process.env['E2E_SCREENSHOTS_PW_MEMBERS'];

async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

const SIZES = [
  { name: '1366x768', width: 1366, height: 768 },
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '375x812', width: 375, height: 812 },
] as const;

const pageSideScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe('Pod Work By member block', () => {
  test('axe is available (the audits below really run)', () => {
    expect(axeAvailable(), 'set E2E_AXE_PATH to axe.min.js').toBe(true);
  });

  test.describe('#553 BUG-5: the skip link on By member lands on the member table', () => {
    test('"Skip to member table" moves focus to the first member row; on the other tabs "Skip to task list" lands on the grid', async ({
      seed,
      personas,
      asUser,
    }) => {
      const fx = await podWorkFixtures(seed, personas);
      const page = await asUser(fx.lead.username);
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto(`/pods/work?podId=${fx.busy.podId}&view=members`);
      await expect(page.locator('[data-members] tbody tr').first()).toBeVisible();

      const skip = page.getByRole('link', { name: 'Skip to member table' });
      await skip.focus();
      await expect(skip).toBeVisible();
      await page.keyboard.press('Enter');
      const firstRow = page.locator('[data-members] tbody tr').first();
      await expect
        .poll(() => firstRow.evaluate((row) => row.contains(document.activeElement)))
        .toBe(true);
      await expect(page.getByRole('link', { name: 'Skip to task list' })).toHaveCount(0);

      for (const view of ['queue', 'attention', 'all']) {
        await page.goto(`/pods/work?podId=${fx.busy.podId}&view=${view}`);
        await expect(page.locator('[data-task]').first()).toBeVisible();
        const link = page.getByRole('link', { name: 'Skip to task list' });
        await link.focus();
        await page.keyboard.press('Enter');
        await expect
          .poll(() =>
            page.evaluate(
              () =>
                !!document.activeElement?.closest('[data-task]') &&
                !document.querySelector('[data-members]'),
            ),
          )
          .toBe(true);
      }
    });

    test('an empty pod has no list to skip to: no "Skip to member table" link, just the message', async ({
      seed,
      personas,
      asUser,
    }) => {
      const fx = await podWorkFixtures(seed, personas);
      const page = await asUser(fx.lead.username);
      await page.goto(`/pods/work?podId=${fx.empty.podId}&view=members`);
      await expect(page.getByText('No members yet.')).toBeVisible();
      await expect(page.getByRole('link', { name: 'Skip to member table' })).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Skip to task list' })).toHaveCount(0);
    });
  });

  test.describe('#555 BUG-6 / W7: an empty pod shows one message with an action', () => {
    test('By member: one message, "Add members" for Pod.ManageMembers, no grid; it opens the pod in the admin Pods tab', async ({
      seed,
      personas,
      asUser,
    }) => {
      const fx = await podWorkFixtures(seed, personas);
      const page = await asUser(fx.lead.username);
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto(`/pods/work?podId=${fx.empty.podId}&view=members`);
      await expect(page.getByText('No members yet.')).toHaveCount(1);
      await expect(page.getByText(/Nobody in .* has open work/)).toHaveCount(0);
      await expect(page.locator('[data-members-empty]')).toHaveCount(1);
      await expect(page.locator('[data-members]')).toHaveCount(0);
      await expect(page.getByRole('table')).toHaveCount(0);
      await expect(page.locator('li[data-task]')).toHaveCount(0);
      const add = page.getByRole('link', { name: 'Add members' });
      await expect(add).toHaveCount(1);
      await expect(add).toHaveAttribute('href', `/admin/pods?pod=${fx.empty.podId}`);
      await shot(page, 'empty-pod-1366x768');

      await add.click();
      await expect(page).toHaveURL(new RegExp(`/admin/pods\\?pod=${fx.empty.podId}`));
      await expect(page.locator('#pod-name')).toHaveValue(fx.empty.name);
    });

    test('without Pod.ManageMembers the sentence has no link', async ({
      seed,
      personas,
      asUser,
    }) => {
      const fx = await podWorkFixtures(seed, personas);
      const page = await asUser(fx.readonly.username);
      await page.goto(`/pods/work?podId=${fx.empty.podId}&view=members`);
      await expect(page.getByText('No members yet.')).toBeVisible();
      await expect(page.getByRole('link', { name: 'Add members' })).toHaveCount(0);
      await expect(page.getByRole('table')).toHaveCount(0);
    });

    test('the other tabs of an empty pod keep their own messages', async ({
      seed,
      personas,
      asUser,
    }) => {
      const fx = await podWorkFixtures(seed, personas);
      const page = await asUser(fx.lead.username);
      await page.goto(`/pods/work?podId=${fx.empty.podId}`);
      await expect(page.getByText(`Nothing waiting in ${fx.empty.name}.`)).toBeVisible();
      await page.goto(`/pods/work?podId=${fx.empty.podId}&view=all`);
      await expect(page.getByText(`No open tasks in ${fx.empty.name}.`)).toBeVisible();
    });

    for (const size of SIZES) {
      test(`${size.name}: axe 0 and no sideways scroll on the empty pod's By member tab`, async ({
        seed,
        personas,
        asUser,
      }) => {
        const fx = await podWorkFixtures(seed, personas);
        const page = await asUser(fx.lead.username);
        await page.setViewportSize({ width: size.width, height: size.height });
        await page.goto(`/pods/work?podId=${fx.empty.podId}&view=members`);
        await expect(page.getByText('No members yet.')).toBeVisible();
        expect(await pageSideScroll(page)).toBeLessThanOrEqual(0);
        if (size.width === 375) await shot(page, 'empty-pod-375x812');
        const found = await axeBestPractice(page);
        expect(
          found.filter((v) => !['skip-link', 'region'].includes(v.id)),
          `axe at ${size.name}`,
        ).toEqual([]);
      });
    }
  });
});
