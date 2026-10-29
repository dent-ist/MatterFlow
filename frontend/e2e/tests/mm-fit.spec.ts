import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { inDays } from '../support/my-matters-fixtures';
import { pmThree } from '../support/pm-fixtures';

/**
 * The Overview fits the window (epic #893, issue #949, MM-57): on a desktop and a tablet the PAGE does not scroll, the title row, the filters, the pre-filter and the tab
 * strip stay, and only the grid (and the Calendar, the Activity table, the Breakdown) scrolls inside its own frame, with the heading row sticky and the pager below it.
 * A phone keeps the page scroll with cards. 150 open tasks make the grid longer than any window.
 */
const SIZES = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
  { width: 768, height: 1024 },
] as const;

const settled = async (page: Page): Promise<void> => {
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator('[data-mm-body]')).toHaveCSS('visibility', 'visible');
};

/** How far the page itself scrolls (the document and the shell's main area), in px. */
const pageScroll = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const doc = document.scrollingElement!;
    const main = document.querySelector('.mf-main') as HTMLElement | null;
    return Math.max(
      doc.scrollHeight - doc.clientHeight,
      main ? main.scrollHeight - main.clientHeight : 0,
    );
  });

test.describe('My Matters fits the window (#949)', () => {
  for (const size of SIZES) {
    test(`${size.width}x${size.height}: the page does not scroll, the grid does, header sticky, pager below`, async ({
      seed,
      personas,
      asUser,
    }) => {
      test.setTimeout(240_000);
      const p = await pmThree(seed, personas, `fit${size.width}`);
      const on = (i: number) => ({
        matter: { matterId: p.matters[i % p.matters.length].matterId },
        taskType: p.world.taskType,
        workflow: p.world.workflow,
      });
      for (let i = 0; i < 150; i++)
        await seed.task(on(i), {
          title: `Fit ${i} ${p.token}`,
          dueDate: i % 3 === 0 ? '2000-01-0' + (1 + (i % 9)) : inDays(2 + (i % 20)),
          assignedUserId: p.other.userId,
        });
      const page = await asUser(p.pm.username);
      await page.setViewportSize(size);
      await page.goto('/my-matters');
      await settled(page);
      await expect(page.locator('[data-panel=tasks] tr[data-task]').first()).toBeVisible();

      expect(await pageScroll(page), 'the page itself scrolls').toBeLessThanOrEqual(1);
      const frame = page.locator('[data-panel=tasks] .wt-wrap');
      const box = await frame.evaluate((e) => ({
        scrolls: e.scrollHeight > e.clientHeight + 1,
        height: e.clientHeight,
      }));
      expect(box.scrolls, 'the grid scrolls inside its frame').toBe(true);
      expect(box.height, 'room for about five rows').toBeGreaterThan(150);
      await expect(frame).toHaveAttribute('tabindex', '0');
      await expect(frame).toHaveAttribute('role', 'region');
      await expect(frame).toHaveAttribute('aria-label', /.+/);

      // The title row, the filters, the tab strip and the pager are in view while the rows scroll.
      await frame.evaluate((e) => (e.scrollTop = 400));
      const pinned = await page.evaluate(() => {
        const inView = (sel: string) => {
          const el = document.querySelector(sel);
          if (!el) return false;
          const r = el.getBoundingClientRect();
          return r.top >= 0 && r.bottom <= innerHeight + 1;
        };
        const wrap = document.querySelector('[data-panel=tasks] .wt-wrap') as HTMLElement;
        const th = wrap.querySelector('thead th') as HTMLElement;
        return {
          title: inView('mf-page-header'),
          tabs: inView('mf-tabs'),
          select: inView('select[data-prefilter]'),
          pager: inView('[data-panel=tasks] mf-pager'),
          headSticky:
            Math.abs(th.getBoundingClientRect().top - wrap.getBoundingClientRect().top) < 2,
        };
      });
      expect(pinned).toEqual({
        title: true,
        tabs: true,
        select: true,
        pager: true,
        headSticky: true,
      });
      expect(await pageScroll(page), 'the page scrolled with the rows').toBeLessThanOrEqual(1);

      // The keyboard: the frame is one Tab stop and PageDown scrolls it.
      await frame.evaluate((e) => (e.scrollTop = 0));
      await frame.focus();
      await page.keyboard.press('PageDown');
      await expect.poll(() => frame.evaluate((e) => e.scrollTop)).toBeGreaterThan(0);
      await page.keyboard.press('Tab');
      await expect(frame).not.toBeFocused();

      // The Calendar, the Activity table and the Breakdown: the page still does not scroll.
      for (const url of [
        '/my-matters?view=calendar',
        '/my-matters?tab=activity',
        '/my-matters?tab=breakdown',
        '/my-matters?tab=data',
      ]) {
        await page.goto(url);
        await settled(page);
        expect(await pageScroll(page), `the page scrolls on ${url}`).toBeLessThanOrEqual(1);
        if (size.width === 1366)
          await page.screenshot({
            path: `../docs/ux/my-matters-calm/after/fit-1366-${/(?:view|tab)=(\w+)/.exec(url)![1]}.png`,
          });
      }
      await page.goto('/my-matters?tab=activity');
      await settled(page);
      const at = page.locator('.at__wrap');
      if (await at.count()) {
        await expect(at).toHaveAttribute('role', 'region');
        expect(await at.evaluate((e) => e.scrollHeight > e.clientHeight + 1)).toBe(true);
      }
      await page.goto('/my-matters');
      await settled(page);
      if (size.width === 1366) {
        // Print shows the whole list, not the part in the frame.
        await page.emulateMedia({ media: 'print' });
        const printed = await page.evaluate(() => {
          const wrap = document.querySelector('[data-panel=tasks] .wt-wrap') as HTMLElement;
          return {
            frame: wrap.scrollHeight - wrap.clientHeight,
            rows: wrap.querySelectorAll('tr[data-task]').length,
          };
        });
        expect(printed.frame, 'print: the frame cuts the list').toBeLessThanOrEqual(1);
        expect(printed.rows).toBe(25);
        await page.emulateMedia({ media: 'screen' });
      }
      await page.screenshot({
        path: `../docs/ux/my-matters-calm/after/fit-${size.width}x${size.height}.png`,
      });
      if (axeAvailable()) expect(await axeViolations(page), 'axe').toEqual([]);
    });
  }

  test('375x812: the page scrolls as a whole and the rows are cards', async ({
    seed,
    personas,
    asUser,
  }) => {
    const p = await pmThree(seed, personas, 'fitphone');
    const page = await asUser(p.pm.username);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/my-matters');
    await settled(page);
    await expect(page.locator('[data-panel=tasks] [data-task]').first()).toBeVisible();
    const frame = page.locator('[data-panel=tasks] .wt-wrap');
    expect(await frame.evaluate((e) => e.scrollHeight - e.clientHeight)).toBeLessThanOrEqual(1);
    expect(await pageScroll(page), 'the page scrolls as a whole').toBeGreaterThan(0);
    await page.screenshot({ path: '../docs/ux/my-matters-calm/after/fit-375x812.png' });
    if (axeAvailable()) expect(await axeViolations(page), 'axe').toEqual([]);
  });
});
