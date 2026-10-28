import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { openHeaderOptions } from '../support/mm-header';
import { mmWorld } from '../support/my-matters-fixtures';

/**
 * #926 (MM-33): a press inside the Options popover, its scrollbar included, never closes it; a long list of task types has a search box and the
 * ones in force first. Escape and a click outside still close it.
 */
test.describe('Focus list with many task types (#926)', () => {
  test('dragging the scrollbar with the mouse (and letting go outside) keeps the popover open; search and checked-first work', async ({
    seed,
    personas,
    asUser,
  }) => {
    test.setTimeout(240_000);
    const w = await mmWorld(seed, personas, 'fscroll');
    const m = await w.matter('Scroll alpha');
    await w.task(m, { dueDate: '2000-01-01' });
    const extra: { id: number; name: string }[] = [];
    for (let i = 0; i < 31; i++) extra.push(await seed.taskType({ workflows: [w.world.workflow] }));
    const page = await asUser(w.pm.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/my-matters');
    await openHeaderOptions(page);
    const list = page.locator('[data-focus-inline] ul');
    await expect(list).toBeVisible();
    expect(await list.evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(true);
    await expect(page.locator('[data-focus-search]')).toBeVisible();

    // A scrollbar drag that is let go outside the panel: the press begins on the list, and the browser then fires the click on the common ancestor
    // (the page), which is what used to close the popover. (Headless Chromium crashes on a real press on a scrollbar, so the two events are sent as the
    // browser sends them.) The wheel scrolls the list too.
    await page.evaluate(() => {
      const ul = document.querySelector('[data-focus-inline] ul')!;
      ul.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await expect(page.locator('[data-header-options] details[data-options]')).toHaveAttribute(
      'open',
      '',
    );
    // The list scrolls with the wheel (the list is scrolled by script: headless Chromium here cannot press a real scrollbar).
    await list.evaluate((e) => (e.scrollTop = 200));
    await expect.poll(() => list.evaluate((e) => e.scrollTop)).toBeGreaterThan(0);

    // A real press inside the panel (the search box) does not close it either.
    await page.locator('[data-focus-search]').click();
    await expect(page.locator('[data-header-options] details[data-options]')).toHaveAttribute(
      'open',
      '',
    );

    // Search narrows the list; a ticked type is listed first once saved.
    const target = extra[20];
    await page.locator('[data-focus-search]').fill(target.name);
    await expect(page.locator('[data-focus-option]')).toHaveCount(1);
    await page.locator(`[data-focus-option="${target.id}"]`).check();
    await page.locator('[data-focus-save]').click();
    await openHeaderOptions(page);
    await expect(page.locator('[data-focus-option]').first()).toHaveAttribute(
      'data-focus-option',
      String(target.id),
    );
    if (axeAvailable()) expect(await axeViolations(page), 'axe, Focus open').toEqual([]);

    // Escape and a click outside still close it.
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-header-options] details[data-options]')).not.toHaveAttribute(
      'open',
      '',
    );
    await openHeaderOptions(page);
    await page.locator('mf-page-header h1').click();
    await expect(page.locator('[data-header-options] details[data-options]')).not.toHaveAttribute(
      'open',
      '',
    );
  });
});
