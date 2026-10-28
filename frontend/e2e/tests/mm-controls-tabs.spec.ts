import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { inDays, mmWorld } from '../support/my-matters-fixtures';
import { pmThree } from '../support/pm-fixtures';
import { expect, test } from '../support/fixtures';
import { SIZES } from '../support/screens';

/**
 * My Matters layout stability (issues #824, #825).
 *
 * #824: every control of the filter row (Client, Role, Clear filters) has the same height and the same top and bottom edge, at the
 * four widths (on a phone the controls are in the Filters sheet); the Dates controls of the Deadlines tab (#906) are as high as one another.
 * The Client and Role controls are only drawn for a person whose matters have several clients and both roles, so these tests use the
 * three-matter persona (`pmThree`).
 * #825: the tab strip stays at exactly the same top (y) on all four tabs: with data and with none, while loading, with an error, after a
 * reload and on a deep link.
 */
const TABS = ['overview', 'deadlines', 'breakdown', 'data', 'activity', 'trends'] as const;
type Tab = (typeof TABS)[number];
const url = (tab: Tab, extra = ''): string =>
  `/my-matters?${tab === 'overview' ? '' : `tab=${tab}`}${extra}`;

const noHorizontalScroll = async (page: Page): Promise<void> => {
  await expect
    .poll(
      () =>
        page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      { message: 'page-level horizontal scroll' },
    )
    .toBeLessThanOrEqual(0);
};

/** The top of the tab strip, rounded to a hundredth of a pixel. */
const stripTop = async (page: Page): Promise<number> => {
  const box = await page.locator('mf-tabs.mm__tabs').boundingBox();
  expect(box, 'the tab strip is on the page').not.toBeNull();
  return Math.round(box!.y * 100) / 100;
};

/** Waits until the panels of the tab have finished loading (nothing busy, no "Loading" text, no skeleton). */
const settled = async (page: Page, tab: Tab): Promise<void> => {
  await expect(page.locator(`#mm-tab-${tab}`)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-mm-tabpanel] >> text=/^Loading /')).toHaveCount(0);
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
};

interface Measure {
  tag: string;
  top: number;
  height: number;
  bottom: number;
}

const measure = async (page: Page, selector: string, tag: string): Promise<Measure> => {
  const box = await page.locator(selector).first().boundingBox();
  expect(box, `${tag} is visible`).not.toBeNull();
  return { tag, top: box!.y, height: box!.height, bottom: box!.y + box!.height };
};

/** Every control is as high as the first; controls on the same line of a wrapped row also start and end where it does. */
const expectSameBox = (all: Measure[], where: string): void => {
  const ref = all[0];
  for (const m of all) {
    expect(m.height, `${where}: ${m.tag} is as high as ${ref.tag}`).toBeCloseTo(ref.height, 1);
    const sameLine = Math.abs(m.top + m.height / 2 - (ref.top + ref.height / 2)) < ref.height / 2;
    if (!sameLine) continue;
    expect(m.top, `${where}: ${m.tag} starts where ${ref.tag} starts`).toBeCloseTo(ref.top, 1);
    expect(m.bottom, `${where}: ${m.tag} ends where ${ref.tag} ends`).toBeCloseTo(ref.bottom, 1);
  }
};

/** A dialog or a toast that is still opening is scaled: measure once every finite animation has finished. */
const still = (page: Page): Promise<unknown> =>
  page.waitForFunction(() => !document.getAnimations().some((a) => a.playState === 'running'));

test.describe('My Matters: filter row and tab strip are stable', () => {
  for (const size of SIZES) {
    test(`filter controls have one height at ${size.width} px (axe, no sideways scroll)`, async ({
      seed,
      personas,
      asUser,
    }) => {
      const p = await pmThree(seed, personas, `fh${size.width}`);
      const page = await asUser(p.pm.username);
      await page.setViewportSize({ width: size.width, height: size.height });

      // Overview: Client, Role and Clear filters (a non-default role makes Clear filters appear).
      await page.goto('/my-matters?role=primary');
      const phone = size.width < 640;
      let scope = page.locator('body');
      if (phone) {
        await page.locator('[data-filters-open]').click();
        scope = page.getByRole('dialog', { name: 'Filters' });
      }
      await expect(scope.locator('#mm-client')).toBeVisible();
      await expect(scope.locator('[data-clear-filters]')).toBeVisible();
      const prefix = phone ? '[role=dialog] ' : '';
      const row = async (): Promise<Measure[]> => [
        await measure(page, `${prefix}#mm-client`, 'Client'),
        await measure(page, `${prefix}#mm-role`, 'Role'),
        await measure(page, `${prefix}[data-clear-filters]`, 'Clear filters'),
      ];
      await still(page);
      const all = await row();
      // Controls beside each other share their bottom edge; on a phone they are stacked, so only the heights have to agree.
      for (const m of all) expect(m.height, `${m.tag} height`).toBeCloseTo(all[0].height, 1);
      if (!phone) expectSameBox(all, `${size.width} px (row)`);
      if (phone) await page.getByRole('button', { name: 'Show results' }).click();

      // The Dates controls live in the Deadlines tab (they are never in the bar): one height, also with the custom range's From / To.
      await page.goto(`/my-matters?tab=deadlines&role=primary&range=custom`);
      await expect(page.locator('#mm-from')).toBeVisible();
      await expect(page.locator('[data-mm-filters] #mm-range')).toHaveCount(0);
      await still(page);
      const dates = [
        await measure(page, '#mm-range', 'Dates'),
        await measure(page, '#mm-from', 'From'),
        await measure(page, '#mm-to', 'To'),
      ];
      for (const m of dates) expect(m.height, `${m.tag} height`).toBeCloseTo(dates[0].height, 1);
      if (!phone) expectSameBox(dates, `${size.width} px (custom dates)`);

      await noHorizontalScroll(page);
      if (axeAvailable()) {
        expect(await axeViolations(page), `axe at ${size.width}`).toEqual([]);
      }
    });

    test(`the chosen client is as high as the other controls at ${size.width} px`, async ({
      seed,
      personas,
      asUser,
    }) => {
      const p = await pmThree(seed, personas, `fc${size.width}`);
      const page = await asUser(p.pm.username);
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto('/my-matters');
      const phone = size.width < 640;
      if (phone) await page.locator('[data-filters-open]').click();
      const prefix = phone ? '[role=dialog] ' : '';
      const input = page.locator(`${prefix}#mm-client`);
      await input.fill(p.clients[0].name.slice(0, 12));
      await page.locator(`${prefix}[role=option]`).first().click();
      await expect(page.locator(`${prefix}[data-chosen]`)).toBeVisible();
      await still(page);
      const chosen = await measure(page, `${prefix}[data-chosen]`, 'Chosen client');
      const role = await measure(page, `${prefix}#mm-role`, 'Role');
      const clear = await measure(page, `${prefix}[data-clear-filters]`, 'Clear filters');
      expectSameBox([role, chosen, clear], `${size.width} px (chosen client)`);
    });
  }

  for (const size of SIZES) {
    test(`the Activity tab's filter row has one control height at ${size.width} px`, async ({
      seed,
      personas,
      asUser,
    }) => {
      const w = await mmWorld(seed, personas, `fa${size.width}`);
      const a = await w.matter('Activity height');
      await w.task(a, { dueDate: inDays(2) });
      const page = await asUser(w.pm.username);
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto(url('activity'));
      await settled(page, 'activity');
      const matter = await measure(page, '#at-matter', 'Matter');
      const kind = await measure(page, '#at-kind', 'Kind');
      expectSameBox([matter, kind], `${size.width} px (activity filters)`);
    });
  }

  for (const size of SIZES) {
    test(`the tab strip keeps its place on all four tabs at ${size.width} px (data, reload, deep link, axe)`, async ({
      seed,
      personas,
      asUser,
    }) => {
      test.slow(); // five tabs, each visited four ways, with axe
      const w = await mmWorld(seed, personas, `ts${size.width}`);
      const a = await w.matter('Strip alpha');
      await w.task(a, { dueDate: '2000-01-01' });
      await w.task(a, { dueDate: inDays(2) });
      await w.task(a);
      const page = await asUser(w.pm.username);
      await page.setViewportSize({ width: size.width, height: size.height });

      // Deep link to each tab: the strip's top is the same.
      const tops = new Map<string, number>();
      for (const tab of TABS) {
        await page.goto(url(tab));
        await settled(page, tab);
        tops.set(`deep ${tab}`, await stripTop(page));
      }
      // Switching by click, in the order of the strip and back.
      await page.goto(url('overview'));
      await settled(page, 'overview');
      for (const tab of [...TABS, 'deadlines', 'overview'] as Tab[]) {
        await page.locator(`#mm-tab-${tab}`).click();
        await settled(page, tab);
        tops.set(`click ${tab}`, await stripTop(page));
      }
      // Reload on each tab.
      for (const tab of TABS) {
        await page.goto(url(tab));
        await page.reload();
        await settled(page, tab);
        tops.set(`reload ${tab}`, await stripTop(page));
      }
      // The same filters (Client + Role + a custom range) on every tab.
      for (const tab of TABS) {
        await page.goto(url(tab, '&role=primary&range=custom&from=2026-01-01&to=2026-12-31'));
        await settled(page, tab);
        tops.set(`filtered ${tab}`, await stripTop(page));
      }
      // The strip is where it is on every tab; a filter that adds a line to the row (a custom range) moves it, but alike on every tab.
      for (const group of ['deep|click|reload', 'filtered']) {
        const entries = [...tops].filter(([k]) => new RegExp(`^(${group}) `).test(k));
        const first = entries[0][1];
        for (const [k, v] of entries)
          expect(v, `strip top at ${size.width} px: ${k}`).toBeCloseTo(first, 1);
      }

      await noHorizontalScroll(page);
      if (axeAvailable()) {
        for (const tab of TABS) {
          await page.goto(url(tab));
          await settled(page, tab);
          expect(await axeViolations(page), `axe ${tab} at ${size.width}`).toEqual([]);
        }
      }
    });
  }

  test('an old ?tab=workload link opens Overview, and its strip is where the others are', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'tsw');
    const page = await asUser(w.pm.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(url('overview'));
    await settled(page, 'overview');
    const top = await stripTop(page);
    await page.goto('/my-matters?tab=workload');
    await settled(page, 'overview');
    expect(await stripTop(page)).toBeCloseTo(top, 1);
    await expect(page.locator('[data-mm-tabpanel] [data-panel-error]')).toHaveCount(0);
    await expect(page.locator('[data-panel=workload]')).toHaveCount(0);
    await expect(page.locator('[role=tab]')).toHaveText([
      'Overview',
      'Deadlines',
      'Breakdown',
      'Data',
      'Activity',
      'Trends',
    ]);
  });

  test('the tab strip keeps its place while loading, with no data and with an error', async ({
    seed,
    personas,
    asUser,
  }) => {
    // A manager with no matters at all: every panel is an empty state.
    const empty = await mmWorld(seed, personas, 'tse');
    const page = await asUser(empty.pm.username);
    await page.setViewportSize({ width: 1366, height: 768 });

    const emptyTops = new Map<string, number>();
    for (const tab of TABS) {
      await page.goto(url(tab));
      await settled(page, tab);
      emptyTops.set(`empty ${tab}`, await stripTop(page));
    }

    // Slow answers: the strip is measured while the panels are still loading, and again once they are in.
    await page.route('**/api/v1/my-matters/**', async (route) => {
      await new Promise((r) => setTimeout(r, 1200));
      await route.continue();
    });
    const loadTops = new Map<string, number>();
    for (const tab of TABS) {
      await page.goto(url(tab));
      await expect(page.locator('mf-tabs.mm__tabs')).toBeVisible();
      loadTops.set(`loading ${tab}`, await stripTop(page));
      await settled(page, tab);
      loadTops.set(`loaded ${tab}`, await stripTop(page));
    }
    await page.unroute('**/api/v1/my-matters/**');

    // Every My Matters call fails: the panels show their errors.
    await page.route('**/api/v1/my-matters/**', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }),
    );
    const errorTops = new Map<string, number>();
    for (const tab of TABS) {
      await page.goto(url(tab));
      await expect(page.locator(`#mm-tab-${tab}`)).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('[data-strip-error]')).toBeVisible();
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
      errorTops.set(`error ${tab}`, await stripTop(page));
    }

    // Within one situation the strip is where it is on every tab. (An error alert above the strip is part of the strip's own situation and
    // is on every tab alike, so it is compared among the error cases only. A person with nothing at all has no strip of zeros once the summary
    // is in (#920), so "loading" and "loaded" are two situations.)
    const only = (prefix: string) => new Map([...loadTops].filter(([k]) => k.startsWith(prefix)));
    for (const [name, tops] of [
      ['empty', emptyTops],
      ['loading', only('loading')],
      ['loaded', only('loaded')],
      ['error', errorTops],
    ] as const) {
      const first = [...tops.values()][0];
      for (const [k, v] of tops) expect(v, `strip top (${name}): ${k}`).toBeCloseTo(first, 1);
    }
  });

  for (const size of SIZES) {
    test(`Recent activity shows five events at most, one line each, and View all activity opens the tab at ${size.width} px (#827)`, async ({
      seed,
      personas,
      asUser,
    }) => {
      const w = await mmWorld(seed, personas, `ra${size.width}`);
      const a = await w.matter('Activity five');
      const longTitle = `A very long task title that cannot fit on one line of the recent activity panel ${'x'.repeat(100)}`;
      for (let i = 0; i < 8; i++) await w.task(a, { title: i === 7 ? longTitle : `Task ${i}` });
      const page = await asUser(w.pm.username);
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto('/my-matters');
      const rows = page.locator('[data-panel=activity] [data-activity-row]');
      await expect(rows.first()).toBeVisible();
      expect(await rows.count()).toBeLessThanOrEqual(5);
      expect(await rows.count()).toBeGreaterThan(0);
      // One line per event: the sentence is cut with an ellipsis, the whole of it is the tooltip.
      const link = page.locator('[data-panel=activity] [data-activity-link]').first();
      const box = (await link.boundingBox())!;
      expect(box.height, 'one line').toBeLessThanOrEqual(size.width < 640 ? 45 : 32);
      const overflow = await link.evaluate((el) => ({
        title: el.getAttribute('title'),
        text: el.textContent!.trim(),
        cut: el.scrollWidth > el.clientWidth,
      }));
      expect(overflow.title).toBe(overflow.text);
      // A 200-character title fits a 1920 px panel; below that it is cut with an ellipsis.
      if (size.width < 1920) expect(overflow.cut, 'the long sentence is cut').toBe(true);
      await noHorizontalScroll(page);
      if (axeAvailable()) expect(await axeViolations(page), `axe ${size.width}`).toEqual([]);
      await page.locator('[data-view-all-activity]').click();
      await expect(page).toHaveURL(/tab=activity/);
      await expect(page.locator('#mm-tab-activity')).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('[data-panel=activity-tab]')).toBeVisible();
    });
  }
});
