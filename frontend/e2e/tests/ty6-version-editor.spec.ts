import { Page } from '@playwright/test';
import { Api } from '../support/api';
import { expect, test } from '../support/fixtures';
import {
  SIZES,
  draftWorld,
  expectNoViolations,
  noSideScroll,
  rowMenu,
  shoot,
  stepRow,
  tabStops,
} from '../support/version-page';

/**
 * Task Types UX epic #352, WP-TY6 version editor: 44 px step rows (#394), the row overflow with Skip rules, Preview inputs and Remove
 * with Undo (#395), steps first with the library as a pane or a drawer (#396), the execution mode in the bar (#397) and leaving a dirty
 * draft is in ty6-version-leave.spec.ts. Screenshots go to the folder in E2E_SCREENSHOTS (docs/ux/task-types-review/fixes/ty6-version) when it is set.
 */
const LONG =
  'Reconcile the processed document count against the custodian manifest and flag every exception for the project manager before sign-off, '
    .repeat(2)
    .slice(0, 170);

/** Saves the draft's steps through the API (so a test can start from rules and orders the UI would take many clicks to make). */
async function saveDraft(
  admin: Api,
  world: { wf: { workflowDefinitionId: number }; draftId: number },
  steps: { id: number; skippable?: boolean; comment?: boolean }[],
  ordered = true,
): Promise<void> {
  const url = `/api/v1/workflows/${world.wf.workflowDefinitionId}/versions/${world.draftId}`;
  const current = await admin.get(url);
  await admin.put(url, {
    isOrdered: ordered,
    steps: steps.map((s) => ({
      sourceStepDefinitionId: s.id,
      isSkippable: s.skippable ?? false,
      skipCommentRequired: s.comment ?? false,
    })),
    rowVersion: current.version.rowVersion,
  });
}

const titlesOf = (page: Page) =>
  page.locator('[data-step-row] [data-step-title]').allTextContents();

test.describe('Version editor: step rows (VP2, #394)', () => {
  test('13 steps with a 170-character title: rows are 44 px, the long title clamps with a tooltip, one rule badge per row', async ({
    page,
    seed,
    admin,
  }) => {
    test.setTimeout(120_000);
    const steps = Array.from({ length: 13 }, (_, i) => ({ title: `Step ${i + 1}` }));
    steps[2] = { title: LONG };
    const world = await draftWorld(seed, admin, 13, { steps });
    await saveDraft(
      admin,
      world,
      world.wf.stepIds.map((id, i) => ({
        id,
        skippable: i % 3 === 1,
        comment: i % 3 === 1 && i > 3,
      })),
    );
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(world.url);
    const rows = page.locator('[data-step-row]');
    await expect(rows).toHaveCount(13);

    const heights = await rows.evaluateAll((els) =>
      els.map((e) => Math.round(e.getBoundingClientRect().height)),
    );
    // 12 rows with a short title are exactly 44 px; the long title is cut at two lines.
    expect(heights.filter((h) => h === 44)).toHaveLength(12);
    expect(heights[2]).toBeGreaterThan(44);
    expect(heights[2]).toBeLessThanOrEqual(60);
    const list = await page.locator('[data-steps] ol').boundingBox();
    expect(list!.height).toBeLessThanOrEqual(680);

    const long = rows.nth(2).locator('[data-step-title]');
    await expect(long).toHaveAttribute('title', world.wf.stepTitles[2]);
    const lines = await long.evaluate((e) => {
      const lh = parseFloat(getComputedStyle(e).lineHeight);
      return Math.round(e.getBoundingClientRect().height / lh);
    });
    expect(lines).toBeLessThanOrEqual(2);
    // The whole title is still the accessible text of the row.
    await expect(rows.nth(2)).toContainText(world.wf.stepTitles[2].slice(-20));

    // Exactly one rule badge per row, in the three combinations.
    const badges = await rows.evaluateAll((els) =>
      els.map(
        (e) => e.querySelectorAll('[data-skip-summary] mf-badge:not([data-inactive])').length,
      ),
    );
    expect(badges.every((n) => n === 1)).toBe(true);
    const texts = await rows.locator('[data-skip-summary]').allTextContents();
    const trimmed = texts.map((t) => t.replace(/\s+/g, ' ').trim());
    expect(trimmed).toContain('Required');
    expect(trimmed).toContain('Skippable');
    expect(trimmed).toContain('Skippable - comment');
    await shoot(page, 'rows-13-long-title', { w: 1366, h: 768 });
    for (const size of SIZES.slice(1)) {
      await page.setViewportSize({ width: size.w, height: size.h });
      await noSideScroll(page);
      await shoot(page, 'rows-13-long-title', size);
    }
  });

  test('an unordered workflow shows no numbers, and Alt+Arrow on a row still moves it with the live announcement', async ({
    page,
    seed,
    admin,
  }) => {
    test.setTimeout(120_000);
    const world = await draftWorld(seed, admin, 4);
    await page.goto(world.url);
    const [a, b] = world.wf.stepTitles;
    await expect(page.locator('.wsr__no')).toHaveCount(4);
    await rowMenu(page, a).focus();
    await page.keyboard.press('Alt+ArrowDown');
    await expect(page.locator('[data-steps] [data-live]')).toContainText(
      `Moved ${a} to position 2 of 4.`,
    );
    expect((await titlesOf(page)).slice(0, 2)).toEqual([b, a]);
    // The focus stays on the same control of the same row.
    await expect(rowMenu(page, a)).toBeFocused();
    await page.keyboard.press('Alt+ArrowUp');
    await expect(page.locator('[data-steps] [data-live]')).toContainText(
      `Moved ${a} to position 1 of 4.`,
    );
    await expect(rowMenu(page, a)).toBeFocused();
    expect((await titlesOf(page)).slice(0, 2)).toEqual([a, b]);
    // The same from the rule badge of the row.
    await stepRow(page, a).locator('[data-rule]').focus();
    await page.keyboard.press('Alt+ArrowDown');
    await expect(stepRow(page, a).locator('[data-rule]')).toBeFocused();

    // Unordered: no numbers.
    await saveDraft(
      admin,
      world,
      world.wf.stepIds.map((id) => ({ id })),
      false,
    );
    await page.reload();
    await expect(page.locator('[data-step-row]')).toHaveCount(4);
    await expect(page.locator('.wsr__no')).toHaveCount(0);
  });
});

test.describe('Version editor: row overflow and skip rules (VP2, #395)', () => {
  test('keyboard only: two Tab stops per row; reorder, set the skip rules and remove with Undo', async ({
    page,
    seed,
    admin,
  }) => {
    test.setTimeout(120_000);
    const world = await draftWorld(seed, admin, 4);
    const [a, b, c] = world.wf.stepTitles;
    await page.goto(world.url);
    await expect(page.locator('[data-step-row]')).toHaveCount(4);
    // Tab stops per row: the Skip rules badge and the overflow (two; recorded on #395).
    expect(await tabStops(page, '[data-step-row] >> nth=1')).toBe(2);

    // Move down with the menu: Enter opens, Arrow Down to Move down, Enter picks; focus is back on the row's overflow.
    await rowMenu(page, a).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: 'Move up' })).toHaveCount(0); // the first row cannot move up
    await expect(page.getByRole('menuitem', { name: 'Move down' })).toBeFocused();
    await page.keyboard.press('Enter');
    expect((await titlesOf(page)).slice(0, 2)).toEqual([b, a]);
    await expect(rowMenu(page, a)).toBeFocused();
    await expect(page.locator('[data-dirty]')).toBeVisible();

    // Skip rules: the menu entry opens the popover with focus in the first checkbox; Space, Tab, Space; Escape returns to the badge.
    await page.keyboard.press('Enter');
    await page.getByRole('menuitem', { name: 'Skip rules...' }).press('Enter');
    const pop = page.getByRole('dialog', { name: `Skip rules for ${a}` });
    await expect(pop).toBeVisible();
    await expect(pop.getByRole('checkbox', { name: 'Skippable' })).toBeFocused();
    await expect(pop.getByRole('checkbox', { name: 'Comment required on skip' })).toBeDisabled();
    await page.keyboard.press('Space');
    await expect(pop.getByRole('checkbox', { name: 'Comment required on skip' })).toBeEnabled();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Space');
    await expect(stepRow(page, a).locator('[data-skip-summary]')).toContainText(
      'Skippable - comment',
    );
    await page.keyboard.press('Escape');
    await expect(pop).toHaveCount(0);
    await expect(stepRow(page, a).locator('[data-rule]')).toBeFocused();
    // The badge opens it again (Enter) and a press outside closes it.
    await page.keyboard.press('Enter');
    await expect(pop).toBeVisible();
    await page.locator('h1').click();
    await expect(pop).toHaveCount(0);

    // Remove: the row goes, the focus moves to the next row's overflow, the shared Undo toast offers to bring it back.
    await rowMenu(page, c).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('menuitem', { name: 'Remove' }).press('Enter');
    await expect(page.locator('[data-step-row]')).toHaveCount(3);
    await expect(page.locator('[data-undo-toast]')).toContainText(
      `Removed ${c} from the workflow.`,
    );
    await expect(page.locator('[data-steps] [data-live]')).toContainText(
      `Removed ${c}. 3 steps remain.`,
    );
    await expect(rowMenu(page, world.wf.stepTitles[3])).toBeFocused();
    // Undo with the keyboard shortcut of the toast (Alt+Z, unchanged): back at its place with its rules.
    await page.keyboard.press('Alt+KeyZ');
    await expect(page.locator('[data-step-row]')).toHaveCount(4);
    expect((await titlesOf(page)).slice(0, 3)).toEqual([b, a, c]);
    await expect(page.locator('[data-steps] [data-live]')).toContainText(
      `Restored ${c} at position 3 of 4.`,
    );
    // Rules of a removed row come back too.
    await rowMenu(page, a).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('menuitem', { name: 'Remove' }).press('Enter');
    await page.locator('[data-undo]').click();
    await expect(stepRow(page, a).locator('[data-skip-summary]')).toContainText(
      'Skippable - comment',
    );
    expect((await titlesOf(page)).slice(0, 2)).toEqual([b, a]);

    // Save, and the server has the order and the rules.
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.locator('[data-dirty]')).toHaveCount(0);
    const saved = await admin.get(
      `/api/v1/workflows/${world.wf.workflowDefinitionId}/versions/${world.draftId}`,
    );
    expect(saved.steps.map((s: { title: string }) => s.title).slice(0, 2)).toEqual([b, a]);
    expect(saved.steps[1].isSkippable).toBe(true);
    expect(saved.steps[1].skipCommentRequired).toBe(true);
  });

  test('Preview inputs opens inline from the menu and the menu entry says Hide inputs afterwards', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await draftWorld(seed, admin, 0, {
      steps: [{ title: 'With input', requiredInput: true }, { title: 'Plain' }],
    });
    await page.goto(world.url);
    const [first] = world.wf.stepTitles;
    await rowMenu(page, first).click();
    await page.getByRole('menuitem', { name: 'Preview inputs' }).click();
    await expect(stepRow(page, first).locator('[data-preview-box]')).toBeVisible();
    await expect(stepRow(page, first).locator('[data-preview-box]')).toContainText('Result');
    await rowMenu(page, first).click();
    await expect(page.getByRole('menuitem', { name: 'Hide inputs' })).toBeVisible();
    await page.getByRole('menuitem', { name: 'Hide inputs' }).click();
    await expect(stepRow(page, first).locator('[data-preview-box]')).toHaveCount(0);
  });

  for (const size of SIZES) {
    test(`menus and the skip rules popover are placed in view, axe 0 with them open, no side scroll at ${size.w}x${size.h}`, async ({
      page,
      seed,
      admin,
    }) => {
      test.setTimeout(120_000);
      const world = await draftWorld(seed, admin, 26);
      await page.setViewportSize({ width: size.w, height: size.h });
      await page.goto(world.url);
      const titles = world.wf.stepTitles;
      // The row menu of a middle row, and of the last visible row of the pane (it must open upward, not be clipped).
      const rows = page.locator('[data-step-row]');
      await expect(rows).toHaveCount(26);
      const visibleLast = await rows.evaluateAll((els) => {
        const pane = els[0].closest('.mf-scroll-area') as HTMLElement;
        const limit = Math.min(pane.getBoundingClientRect().bottom, window.innerHeight);
        let last = 0;
        els.forEach((e, i) => {
          if (e.getBoundingClientRect().bottom <= limit - 4) last = i;
        });
        return last;
      });
      await rowMenu(page, titles[visibleLast]).click();
      const menu = page.getByRole('menu');
      await expect(menu).toBeVisible();
      const box = (await menu.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(size.h);
      expect(box.x + box.width).toBeLessThanOrEqual(size.w);
      await noSideScroll(page);
      await shoot(page, 'row-menu-open', size);
      await expectNoViolations(page, 'row menu open');
      await page.getByRole('menuitem', { name: 'Skip rules...' }).click();
      const pop = page.getByRole('dialog', { name: `Skip rules for ${titles[visibleLast]}` });
      await expect(pop).toBeVisible();
      const pbox = (await pop.boundingBox())!;
      expect(pbox.y).toBeGreaterThanOrEqual(0);
      expect(pbox.y + pbox.height).toBeLessThanOrEqual(size.h);
      expect(pbox.x).toBeGreaterThanOrEqual(0);
      expect(pbox.x + pbox.width).toBeLessThanOrEqual(size.w);
      await noSideScroll(page);
      await shoot(page, 'row-skip-rules-open', size);
      await expectNoViolations(page, 'skip rules popover open');
      await page.keyboard.press('Escape');
      // Scrolling the pane closes a popover or menu (its row moves away from it).
      await rowMenu(page, titles[1]).click();
      await expect(menu).toBeVisible();
      await rows
        .nth(1)
        .evaluate((e) => e.closest('.mf-scroll-area')?.dispatchEvent(new Event('scroll')));
      await expect(menu).toHaveCount(0);
    });
  }

  test('a read-only version: rule badges and a Preview inputs button per row, no overflow, no Skip rules', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await draftWorld(seed, admin, 3);
    await page.goto(world.publishedUrl);
    await expect(page.locator('[data-step-row]')).toHaveCount(3);
    await expect(page.locator('[data-steps] [data-overflow]')).toHaveCount(0);
    await expect(page.locator('[data-rule]')).toHaveCount(0);
    await expect(page.locator('[data-mode-badge]')).toContainText('Ordered');
    await expect(page.locator('[data-mode-button]')).toHaveCount(0);
    const first = world.wf.stepTitles[0];
    await stepRow(page, first)
      .getByRole('button', { name: `Preview inputs of ${first}` })
      .click();
    await expect(stepRow(page, first).locator('[data-preview-box]')).toBeVisible();
    await expect(
      stepRow(page, first).getByRole('button', { name: `Hide inputs of ${first}` }),
    ).toBeVisible();
    await expectNoViolations(page, 'read-only version');
  });
});

test.describe('Version editor: steps first, library pane or drawer (VP3, #396)', () => {
  test('1280 px and wider: the library is a left pane in reading order and both panes scroll inside; no Add step button', async ({
    page,
    seed,
    admin,
  }) => {
    test.setTimeout(120_000);
    const world = await draftWorld(seed, admin, 26);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(world.url);
    const library = page.locator('[data-library]');
    await expect(library).toBeVisible();
    const lib = (await page.locator('.wf-pane--lib').boundingBox())!;
    const steps = (await page.locator('.wf-pane--steps').boundingBox())!;
    expect(lib.x + lib.width).toBeLessThanOrEqual(steps.x + 1);
    // DOM order = reading order: the library pane comes first because it is on the left.
    const order = await page.evaluate(() => {
      const l = document.querySelector('.wf-pane--lib')!;
      const s = document.querySelector('.wf-pane--steps')!;
      return l.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING
        ? 'library first'
        : 'steps first';
    });
    expect(order).toBe('library first');
    await expect(page.getByRole('button', { name: /Add step$/ })).toHaveCount(0);
    // The library list scrolls inside the pane (26+ steps in the library); the page does not.
    const region = page.getByRole('region', { name: 'Library steps, scrollable' });
    await expect(region).toBeVisible();
    expect(await region.evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(true);
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight),
    ).toBeLessThanOrEqual(1);
    await noSideScroll(page);
    await shoot(page, 'library-pane', { w: 1366, h: 768 });
    await page.setViewportSize({ width: 1920, height: 1080 });
    await noSideScroll(page);
    await shoot(page, 'library-pane', { w: 1920, h: 1080 });
    await expectNoViolations(page, 'library pane at 1920');
    await page.setViewportSize({ width: 1366, height: 768 });
    await expectNoViolations(page, 'library pane');
    // Adding from the pane keeps focus in the list on the next Add button and announces it.
    const add = library.locator('[data-add]:not(:disabled)').first();
    const title = await add.getAttribute('aria-label');
    await add.click();
    await expect(page.locator('[data-steps] [data-live]')).toContainText('Added ');
    await expect(page.locator('[data-lib-added]')).toContainText('1 added');
    expect(title).toContain('Add ');
  });

  for (const size of SIZES.filter((s) => s.w < 1280)) {
    test(`below 1280 px the steps come first and the library is a drawer: focus trap, Esc, focus return, several adds, axe 0 at ${size.w}x${size.h}`, async ({
      page,
      seed,
      admin,
    }) => {
      test.setTimeout(120_000);
      const world = await draftWorld(seed, admin, 13);
      await page.setViewportSize({ width: size.w, height: size.h });
      await page.goto(world.url);
      await expect(page.locator('[data-step-row]')).toHaveCount(13);
      // No library in the page, and the first step is within the first screen.
      await expect(page.locator('[data-library]')).toHaveCount(0);
      const first = (await page.locator('[data-step-row]').first().boundingBox())!;
      expect(first.y + first.height).toBeLessThanOrEqual(size.h);
      await noSideScroll(page);

      const addStep = page.getByRole('button', { name: /Add step$/ });
      await addStep.click();
      const drawer = page.getByRole('dialog', { name: 'Add steps' });
      await expect(drawer).toBeVisible();
      await expect(drawer.locator('#wf-lib-search')).toBeFocused();
      await expect(drawer.locator('[data-lib-count]')).toBeVisible();
      await noSideScroll(page);
      await shoot(page, 'library-drawer', size);
      await expectNoViolations(page, 'library drawer open');

      // The drawer stays open for several adds; the count says how many and each add is announced.
      for (let i = 1; i <= 3; i++) {
        await drawer.locator('[data-add]:not(:disabled)').first().click();
        await expect(drawer.locator('[data-lib-added]')).toContainText(`${i} added`);
      }
      await expect(page.locator('[data-steps] [data-live]')).toContainText('Added ');
      await expect(page.locator('[data-step-row]')).toHaveCount(16);
      // Focus trap: Tab stays inside the drawer.
      for (let i = 0; i < 12; i++) await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('.mf-drawer'))).toBe(true);
      // Esc closes and focus returns to Add step; the count starts again next time.
      await page.keyboard.press('Escape');
      await expect(drawer).toHaveCount(0);
      await expect(addStep).toBeFocused();
      await addStep.click();
      await expect(drawer.locator('[data-lib-added]')).toHaveText('');
      await drawer.getByRole('button', { name: 'Close step library' }).click();
      await expect(addStep).toBeFocused();
    });
  }

  test('a library of more than 50 steps says "Showing the first 50 of N" and a search narrows it', async ({
    page,
    seed,
    admin,
  }) => {
    test.setTimeout(180_000);
    const world = await draftWorld(seed, admin, 2);
    for (let i = 0; i < 4; i++) {
      await Promise.all(
        Array.from({ length: 14 }, (_, k) => seed.step({ title: `Bulk library step ${i}-${k}` })),
      );
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(world.url);
    await expect(page.locator('[data-lib-count]')).toContainText(
      /Showing the first 50 of \d+ steps\. Search to narrow the list\./,
    );
    expect(await page.locator('[data-library] [data-lib]').count()).toBe(50);
    await page.locator('#wf-lib-search').fill('Bulk library step 0-1');
    await expect(page.locator('[data-lib-count]')).not.toContainText('Showing the first');
  });
});

test.describe('Version editor: execution mode in the bar (VP4, #397)', () => {
  for (const size of SIZES) {
    test(`the mode control opens a popover, the change is confirmed, axe 0 and no side scroll at ${size.w}x${size.h}`, async ({
      page,
      seed,
      admin,
    }) => {
      test.setTimeout(120_000);
      const world = await draftWorld(seed, admin, 4);
      await page.setViewportSize({ width: size.w, height: size.h });
      await page.goto(world.url);
      const button = page.getByRole('button', { name: 'Execution mode: Ordered' });
      await expect(button).toBeVisible();
      await expect(page.locator('[data-mode-box]')).toHaveCount(0); // the 130 px card is gone
      await button.focus();
      await page.keyboard.press('Enter');
      const pop = page.getByRole('dialog', { name: 'Execution mode' });
      await expect(pop).toBeVisible();
      await expect(pop.getByRole('radio', { name: /^Ordered/ })).toBeFocused();
      await expect(pop.locator('[data-mode-help]')).toContainText(
        'Ordered: steps must be resolved',
      );
      await noSideScroll(page);
      await shoot(page, 'mode-popover', size);
      await expectNoViolations(page, 'mode popover open');
      // Esc closes it and the focus is back on the button.
      await page.keyboard.press('Escape');
      await expect(pop).toHaveCount(0);
      await expect(button).toBeFocused();

      // Change to Unordered: the confirmation shows, Cancel keeps Ordered, Change mode applies it.
      await button.click();
      await pop.getByRole('radio', { name: /^Unordered/ }).click();
      const confirm = page.getByRole('dialog', { name: 'Change execution mode' });
      await expect(confirm).toBeVisible();
      await expectNoViolations(page, 'change mode dialog');
      await confirm.getByRole('button', { name: 'Cancel' }).click();
      await expect(page.getByRole('button', { name: 'Execution mode: Ordered' })).toBeFocused();
      await expect(page.locator('.wsr__no').first()).toBeVisible();
      await expect(page.locator('[data-dirty]')).toHaveCount(0);
      await page.getByRole('button', { name: 'Execution mode: Ordered' }).click();
      await pop.getByRole('radio', { name: /^Unordered/ }).click();
      await confirm.getByRole('button', { name: 'Change mode' }).click();
      await expect(page.getByRole('button', { name: 'Execution mode: Unordered' })).toBeVisible();
      await expect(page.locator('.wsr__no')).toHaveCount(0);
      await expect(page.locator('[data-dirty]')).toBeVisible();
      await expect(page.locator('#wf-reorder-help')).toContainText('The order is for display only');
      await noSideScroll(page);
    });
  }

  test('an empty draft changes the mode without a confirmation; read-only versions show the badge in the meta line', async ({
    page,
    admin,
    seed,
  }) => {
    const created = await admin.post('/api/v1/workflows', {
      name: `Empty ${Date.now()}`,
      description: null,
      isOrdered: true,
    });
    await page.goto(
      `/admin/workflows/${created.workflow.workflowDefinitionId}/versions/${created.versions[0].workflowVersionId}`,
    );
    await page.getByRole('button', { name: 'Execution mode: Ordered' }).click();
    await page.getByRole('radio', { name: /^Unordered/ }).click();
    await expect(page.getByRole('dialog', { name: 'Change execution mode' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Execution mode: Unordered' })).toBeVisible();

    const world = await draftWorld(seed, admin, 2, { stepCount: 2, ordered: false });
    await page.goto(world.publishedUrl);
    await expect(page.locator('[data-mode-badge]')).toContainText('Unordered');
    await expect(page.locator('[data-mode-help]')).toContainText(
      'Unordered: steps can be done in any order',
    );
  });
});
