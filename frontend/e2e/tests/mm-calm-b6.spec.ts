import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { pmThree } from '../support/pm-fixtures';
import { SIZES } from '../support/screens';

/**
 * My Matters, a calmer page: the owner's review of batch 6 (epic #893, Release 3).
 *
 *  - the pre-filter dropdown (it replaced the six tiles, #942) is inside the screen at every width;
 *  - the Client and Matter dropdowns stay inside their fields and never cover the next control;
 *  - the grids use quiet badges: a pill only for High and Critical priority, On hold and At risk, plain words otherwise;
 *  - the Due cell is never cut ("Overdue 26d" in full), the Matter name has room;
 *  - the sort order is visible: the active column heading is underlined and its arrow is the bold one.
 */
const settled = async (page: Page): Promise<void> => {
  await expect(page.locator('#mm-tab-overview')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator('[data-panel=tasks] [data-task]').first()).toBeVisible();
};

test.describe('Batch 6 review fixes', () => {
  for (const size of SIZES) {
    test(`${size.width}x${size.height}: dropdowns and grid`, async ({ seed, personas, asUser }) => {
      const p = await pmThree(seed, personas, `b6${size.width}`);
      const page = await asUser(p.pm.username);
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto('/my-matters');
      await settled(page);

      // No tiles any more; the pre-filter dropdown is whole and inside the screen.
      await expect(page.locator('button[data-strip-item], [data-mm-strip]')).toHaveCount(0);
      const select = (await page.locator('select[data-prefilter]').boundingBox())!;
      expect(select.x).toBeGreaterThanOrEqual(0);
      expect(select.x + select.width).toBeLessThanOrEqual(size.width);
      const words = await page
        .locator('select[data-prefilter] option')
        .evaluateAll((os) => os.map((o) => (o.textContent ?? '').trim()));
      expect(words).toHaveLength(6);

      // The Client and Matter dropdowns stay inside their fields (wide screens: the bar is not drawn on a phone).
      if (size.width >= 640) {
        const overlap = await page.evaluate(() => {
          const field = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
          const client = field('.fb__client');
          const clientInput = field('#mm-client');
          const matter = field('.fb__matter');
          const matterInput = field('#mm-matter');
          return {
            clientInside: clientInput.right <= client.right + 0.5,
            matterInside: matterInput.right <= matter.right + 0.5,
            apart:
              clientInput.right <= matterInput.left + 0.5 || matterInput.top >= clientInput.bottom,
          };
        });
        expect(overlap.clientInside, 'the Client dropdown is inside its field').toBe(true);
        expect(overlap.matterInside, 'the Matter dropdown is inside its field').toBe(true);
        expect(overlap.apart, 'the two dropdowns do not cover each other').toBe(true);
      }

      // Quiet badges: pills only for what needs a look.
      const pills = await page.evaluate(() => {
        const out = { priority: [] as string[], status: [] as string[] };
        for (const e of document.querySelectorAll('[data-panel=tasks] mf-priority-badge'))
          out.priority.push((e.textContent ?? '').trim());
        for (const e of document.querySelectorAll('[data-panel=tasks] mf-status-badge'))
          out.status.push((e.textContent ?? '').trim());
        return out;
      });
      for (const t of pills.priority) expect(t, 'priority pills').toMatch(/High|Critical/i);
      for (const t of pills.status) expect(t, 'status pills').toMatch(/On hold/i);

      // Due is never cut, and the active sort is visible.
      if (size.width >= 640) {
        const cut = await page.evaluate(() =>
          [
            ...document.querySelectorAll(
              '[data-panel=tasks] td[data-col=due] .dc-l2, [data-panel=tasks] td[data-col=due] .dc-l1',
            ),
          ]
            .filter((e) => (e as HTMLElement).scrollWidth > (e as HTMLElement).clientWidth)
            .map((e) => e.textContent?.trim()),
        );
        expect(cut, 'no Due cell is cut').toEqual([]);
        // The default order is Urgency: the Urgency control is the marked one; a chosen heading is marked like the rest.
        const urgency = page.locator('[data-panel=tasks] [data-sort-urgency]');
        await expect(urgency).toHaveAttribute('aria-pressed', 'true');
        expect(
          await urgency.evaluate((e) => getComputedStyle(e).textDecorationLine),
          'the Urgency control is underlined',
        ).toContain('underline');
        const due = page.locator('[data-panel=tasks] th[data-col=due]');
        await due.locator('button.wt-sort').click();
        await expect(due).toHaveAttribute('aria-sort', /ascending|descending/);
        const mark = await due.locator('.wt-sort').evaluate((e) => getComputedStyle(e).boxShadow);
        expect(mark, 'the active heading is underlined').not.toBe('none');
        const other = await page
          .locator('[data-panel=tasks] th[data-col=title] .wt-sort .pi')
          .evaluate((e) => getComputedStyle(e).opacity);
        expect(Number(other), 'inactive arrows are faint').toBeLessThan(1);
      }
      // Issue #937: the grids fit without scrolling sideways at 768 px, and a grid that fits is no extra Tab stop.
      if (size.width >= 640) {
        const grids = await page.evaluate(() =>
          [...document.querySelectorAll('[data-panel=tasks] .wt-wrap')].map((e) => ({
            sideways: e.scrollWidth - e.clientWidth,
            scrolls: e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1,
            stop: e.hasAttribute('tabindex'),
          })),
        );
        expect(grids.length).toBeGreaterThan(0);
        for (const g of grids) {
          expect(g.sideways, 'no sideways scroll inside a grid').toBeLessThanOrEqual(1);
          expect(g.stop, 'a grid is a Tab stop only while it scrolls').toBe(g.scrolls);
        }
        await expect(page.locator('[data-scroll-hint].wt-hint--show')).toHaveCount(0);
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(0);
      if (axeAvailable()) expect(await axeViolations(page), `axe ${size.width}`).toEqual([]);
    });
  }

  for (const size of SIZES) {
    test(`${size.width}x${size.height}: the Calendar and the Data Area (pickers, info point, chart switch) are clean for axe`, async ({
      seed,
      personas,
      asUser,
    }) => {
      test.setTimeout(120_000);
      expect(axeAvailable(), 'set E2E_AXE_PATH to axe.min.js').toBe(true);
      const p = await pmThree(seed, personas, `b6d${size.width}`);
      for (let i = 0; i < 4; i++)
        await seed.asset(p.matters[i % p.matters.length], `Asset ${i} ${p.token}`);
      const page = await asUser(p.pm.username);
      await page.setViewportSize({ width: size.width, height: size.height });

      // The Calendar view (a month on a desktop, the list by day on a phone).
      await page.goto('/my-matters?view=calendar');
      await expect(page.locator('[data-panel=calendar]')).toBeVisible();
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
      expect(await axeViolations(page), `calendar ${size.width}`).toEqual([]);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(0);

      // The Data Area: closed, with each picker open, the info point open and each chart view.
      await page.goto('/my-matters?tab=data');
      await expect(page.locator('[data-panel="data"] [data-data-controls]')).toBeVisible();
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
      expect(await axeViolations(page), `data ${size.width}`).toEqual([]);
      for (const picker of ['matters', 'types', 'sizes']) {
        const summary = page.locator(`[data-pick-${picker}] summary`);
        if ((await summary.count()) === 0) continue;
        await summary.click();
        expect(await axeViolations(page), `${picker} picker open at ${size.width}`).toEqual([]);
        await page.keyboard.press('Escape');
      }
      await page.locator('[data-how]').click();
      expect(await axeViolations(page), `info point open at ${size.width}`).toEqual([]);
      await page.locator('[data-how]').click();
      for (const view of ['bar', 'pie', 'table']) {
        await page.locator(`[data-show-${view}]`).click();
        expect(await axeViolations(page), `${view} view at ${size.width}`).toEqual([]);
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(0);
    });
  }
});
