import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { pmThree } from '../support/pm-fixtures';
import { SIZES } from '../support/screens';

/**
 * My Matters, a calmer page: the owner's review of batch 6 (epic #893, Release 3).
 *
 *  - the six tiles are ONE horizontal row at every desktop and tablet width (a phone: three across, two rows);
 *  - the Client dropdown never runs over the next filter's label;
 *  - the grids use quiet badges: a pill only for High and Critical priority, On hold and At risk, plain words otherwise;
 *  - the Due cell is never cut ("Overdue 26d" in full), the Matter name has room;
 *  - the sort order is visible: the active column heading is underlined and its arrow is the bold one.
 */
const settled = async (page: Page): Promise<void> => {
  await expect(page.locator('#mm-tab-overview')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator('[data-panel=attention] [data-task]').first()).toBeVisible();
};

test.describe('Batch 6 review fixes', () => {
  for (const size of SIZES) {
    test(`${size.width}x${size.height}: tiles, filters and grids`, async ({
      seed,
      personas,
      asUser,
    }) => {
      const p = await pmThree(seed, personas, `b6${size.width}`);
      const page = await asUser(p.pm.username);
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto('/my-matters');
      await settled(page);

      // Tiles: one row from 640 px up, equal widths, each word whole.
      const tiles = await page.locator('button[data-strip-item]').evaluateAll((els) =>
        els.map((e) => {
          const r = e.getBoundingClientRect();
          const label = e.querySelector('.tile__l') as HTMLElement | null;
          return {
            top: Math.round(r.top),
            width: Math.round(r.width),
            cut: label ? label.scrollWidth > label.clientWidth : false,
          };
        }),
      );
      expect(tiles).toHaveLength(6);
      expect(
        tiles.filter((t) => t.cut),
        'no tile word is cut',
      ).toEqual([]);
      if (size.width >= 640) {
        expect(new Set(tiles.map((t) => t.top)).size, 'one row of six').toBe(1);
        const widths = tiles.map((t) => t.width);
        expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
      } else {
        expect(new Set(tiles.map((t) => t.top)).size, 'two rows').toBe(2);
      }

      // The Client dropdown stays inside its field (wide screens: the bar is not drawn on a phone).
      if (size.width >= 640) {
        const overlap = await page.evaluate(() => {
          const client = document.querySelector('.fb__client')!.getBoundingClientRect();
          const input = document.querySelector('#mm-client')!.getBoundingClientRect();
          const next = document.querySelector('label[for=mm-role]')?.getBoundingClientRect();
          return {
            inside: input.right <= client.right + 0.5,
            clear: next ? input.right <= next.left + 0.5 || next.top >= input.bottom : true,
          };
        });
        expect(overlap.inside, 'the dropdown is inside its field').toBe(true);
        expect(overlap.clear, 'the dropdown does not cover the next label').toBe(true);
      }

      // Quiet badges: pills only for what needs a look.
      const pills = await page.evaluate(() => {
        const out = { priority: [] as string[], status: [] as string[] };
        for (const e of document.querySelectorAll(
          '[data-panel=attention] mf-priority-badge, [data-panel=deadlines] mf-priority-badge',
        ))
          out.priority.push((e.textContent ?? '').trim());
        for (const e of document.querySelectorAll(
          '[data-panel=attention] mf-status-badge, [data-panel=deadlines] mf-status-badge',
        ))
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
              '[data-panel=attention] td[data-col=due] .dc-l2, [data-panel=attention] td[data-col=due] .dc-l1',
            ),
          ]
            .filter((e) => (e as HTMLElement).scrollWidth > (e as HTMLElement).clientWidth)
            .map((e) => e.textContent?.trim()),
        );
        expect(cut, 'no Due cell is cut').toEqual([]);
        const due = page.locator('[data-panel=attention] th[data-col=due]');
        await expect(due).toHaveAttribute('aria-sort', /ascending|descending/);
        const mark = await due.locator('.wt-sort').evaluate((e) => getComputedStyle(e).boxShadow);
        expect(mark, 'the active heading is underlined').not.toBe('none');
        const other = await page
          .locator('[data-panel=attention] th[data-col=ref] .wt-sort .pi')
          .evaluate((e) => getComputedStyle(e).opacity);
        expect(Number(other), 'inactive arrows are faint').toBeLessThan(1);
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

      // The Calendar view (a month of weeks on a desktop, the list by matter on a phone).
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
