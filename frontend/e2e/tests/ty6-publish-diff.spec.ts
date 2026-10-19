import { Page } from '@playwright/test';
import { Api } from '../support/api';
import { expect, test } from '../support/fixtures';
import {
  SIZES,
  draftWorld,
  expectNoViolations,
  noSideScroll,
  shoot,
} from '../support/version-page';

/**
 * Task Types UX epic #352, WP-TY6, VP7 (#401): the publish dialog folds position shifts into one line ("11 steps moved", expandable),
 * lists as Moved only the steps that were really reordered, and keeps a long step title inside its row.
 */
const LONG =
  'Reconcile the processed document count against the custodian manifest and flag every exception for the project manager before sign-off. Then escalate the open items to the supervising attorney for review.'.slice(
    0,
    170,
  );

async function saveSteps(
  admin: Api,
  world: { wf: { workflowDefinitionId: number }; draftId: number },
  ids: number[],
): Promise<void> {
  const url = `/api/v1/workflows/${world.wf.workflowDefinitionId}/versions/${world.draftId}`;
  const current = await admin.get(url);
  await admin.put(url, {
    isOrdered: true,
    steps: ids.map((sourceStepDefinitionId) => ({
      sourceStepDefinitionId,
      isSkippable: false,
      skipCommentRequired: false,
    })),
    rowVersion: current.version.rowVersion,
  });
}

const dialog = (page: Page) => page.getByRole('dialog', { name: /^Publish / });

async function openPublish(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await expect(page.locator('[data-step-row]').first()).toBeVisible();
  await page.getByRole('button', { name: 'Publish...' }).click();
  await expect(dialog(page).locator('[data-diff]')).toBeVisible();
}

test.describe('Publish dialog diff (VP7, #401)', () => {
  test('two steps removed ahead of 11 steps: both removals listed, no Moved rows, one folded line that expands', async ({
    page,
    seed,
    admin,
  }) => {
    test.setTimeout(120_000);
    const world = await draftWorld(seed, admin, 13);
    await saveSteps(admin, world, world.wf.stepIds.slice(2));
    await openPublish(page, world.url);
    const diff = dialog(page).locator('[data-diff]');
    await expect(diff.locator('.wf-diff > li')).toHaveCount(3); // Removed x2 and the folded line
    await expect(diff).not.toContainText('Moved');
    await expect(diff.getByText('Removed', { exact: true })).toHaveCount(2);
    const folded = diff.locator('[data-shifted]');
    await expect(folded).toContainText('11 steps moved');
    // The list is closed until asked for; the toggle says what it does and is keyboard operable.
    const toggle = folded.getByRole('button', { name: 'Show steps' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(diff.locator('[data-shifted-list]')).toHaveCount(0);
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(folded.getByRole('button', { name: 'Hide steps' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    const items = diff.locator('[data-shifted-list] > li');
    await expect(items).toHaveCount(11);
    await expect(items.first()).toContainText(world.wf.stepTitles[2]);
    await expect(items.first()).toContainText('3 to 1');
    await expect(items.last()).toContainText('13 to 11');
    await expectNoViolations(page, 'publish dialog, folded list open');
  });

  test('a real reorder lists only the step that moved, with no folded line', async ({
    page,
    seed,
    admin,
  }) => {
    test.setTimeout(120_000);
    const world = await draftWorld(seed, admin, 13);
    const ids = world.wf.stepIds;
    await saveSteps(admin, world, [...ids.slice(1), ids[0]]); // the first step goes to the bottom
    await openPublish(page, world.url);
    const diff = dialog(page).locator('[data-diff]');
    await expect(diff.locator('.wf-diff > li')).toHaveCount(1);
    await expect(diff.locator('.wf-diff > li').first()).toContainText('Moved');
    await expect(diff.locator('.wf-diff > li').first()).toContainText(world.wf.stepTitles[0]);
    await expect(diff.locator('[data-shifted]')).toHaveCount(0);
  });

  test('mixed: a removal, an addition and a reorder are told apart; an unchanged draft says so', async ({
    page,
    seed,
    admin,
  }) => {
    test.setTimeout(120_000);
    const world = await draftWorld(seed, admin, 6);
    const ids = world.wf.stepIds;
    const added = (await seed.step({ title: 'Brand new step' })).id;
    // Step 2 removed, step 5 moved up to the second place, a new step before the last one.
    await saveSteps(admin, world, [ids[0], ids[4], ids[2], ids[3], added, ids[5]]);
    await openPublish(page, world.url);
    const rows = dialog(page).locator('[data-diff] .wf-diff > li');
    const text = (await rows.allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
    expect(text.some((t) => t.startsWith('Added') && t.includes('Brand new step'))).toBe(true);
    expect(text.some((t) => t.startsWith('Removed') && t.includes(world.wf.stepTitles[1]))).toBe(
      true,
    );
    expect(text.some((t) => t.startsWith('Moved') && t.includes(world.wf.stepTitles[4]))).toBe(
      true,
    );
    expect(text.filter((t) => t.startsWith('Moved'))).toHaveLength(1);
    await page.keyboard.press('Escape');
    // Back to the published content: nothing changed.
    await saveSteps(admin, world, ids);
    await openPublish(page, world.url);
    await expect(dialog(page).locator('[data-diff]')).toContainText(
      'No changes from the published version.',
    );
  });

  for (const size of SIZES) {
    test(`a 170-character step title stays inside its row (badge beside it, two lines at most), axe 0 and no side scroll at ${size.w}x${size.h}`, async ({
      page,
      seed,
      admin,
    }) => {
      test.setTimeout(120_000);
      const world = await draftWorld(seed, admin, 3);
      const long = (await seed.step({ title: LONG })).id;
      await saveSteps(admin, world, [...world.wf.stepIds.slice(1), long]);
      await page.setViewportSize({ width: size.w, height: size.h });
      await openPublish(page, world.url);
      const row = dialog(page).locator('.wf-diff > li', { hasText: LONG.slice(0, 40) });
      const badge = row.locator('mf-badge').first();
      const title = row.locator('.wf-diff__title');
      await expect(title).toHaveAttribute('title', new RegExp(`^${LONG.slice(0, 40)}`));
      const [b, t] = [(await badge.boundingBox())!, (await title.boundingBox())!];
      // The badge is beside the title (its top is within the first line), never above or below it.
      expect(Math.abs(b.y - t.y)).toBeLessThanOrEqual(8);
      expect(t.x).toBeGreaterThan(b.x + b.width - 1);
      const lines = await title.evaluate((e) =>
        Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight)),
      );
      expect(lines).toBeLessThanOrEqual(2);
      await noSideScroll(page);
      await shoot(page, 'publish-dialog-diff-long-title', size);
      await expectNoViolations(page, 'publish dialog long title');
    });
  }
});
