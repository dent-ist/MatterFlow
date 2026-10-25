import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { SIZES, noHorizontalScroll, shot } from '../support/screens';
import { expect, test } from '../support/fixtures';
import { Seeder, uid } from '../support/seed';

/**
 * WP-SR3 #466: the results page is a fixed-height page with counted tabs; the type, the page and the page size are in the address.
 * Screenshots go to E2E_SCREENSHOTS (docs/ux/search-review/fixes/sr3-results).
 */
const FORBIDDEN = "You don't have permission to view this.";

/** A token no other test uses, a matter whose tasks, project and assets carry it, and how many of each. */
async function seedResults(seed: Seeder, tasks = 30) {
  const token = `Srt${uid().replace(/[^a-z0-9]/gi, '')}`;
  const world = await seed.world();
  for (let i = 0; i < tasks; i++) await seed.task(world, { title: `${token} task ${i}` });
  await seed.project(world.matter, `${token} project`);
  await seed.asset(world.matter, `${token} asset one`);
  await seed.asset(world.matter, `${token} asset two`);
  return { token, world, tasks, projects: 1, assets: 2 };
}

const tabs = (page: Page) => page.getByRole('tablist', { name: 'Search results by type' });

async function counts(page: Page): Promise<string[]> {
  return (await tabs(page).getByRole('tab').allTextContents()).map((t) =>
    t.replace(/\s+/g, ' ').trim(),
  );
}

/** The page itself does not scroll: only the grid does (fixed mode, from 768 px wide). */
async function pageScroll(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollHeight - document.documentElement.clientHeight,
  );
}

test.describe('Search results: counted tabs on a fixed page (#466)', () => {
  test('the tabs carry the true totals of the API; a zero tab stays; an old link opens All', async ({
    page,
    seed,
    admin,
  }) => {
    const s = await seedResults(seed);
    const api = await admin.get(`/api/v1/search?q=${s.token}&limit=5`);
    const total = (type: string) =>
      api.groups.find((g: { type: string }) => g.type === type).total as number;
    expect(total('task')).toBe(s.tasks);

    await page.goto(`/search?q=${s.token}`);
    await expect(page.getByRole('heading', { name: 'Search results', level: 1 })).toBeVisible();
    await expect(tabs(page).getByRole('tab', { name: /^All/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const sum =
      total('client') + total('matter') + total('project') + total('task') + total('asset');
    await expect
      .poll(() => counts(page))
      .toEqual([
        `All (${sum})`,
        `Matters (${total('matter')})`,
        `Clients (${total('client')})`,
        `Tasks (${s.tasks})`,
        `Projects (${s.projects})`,
        `Assets (${s.assets})`,
      ]);
    // The zero tabs (Matters, Clients) are still tabs, and the section headings carry the same true counts (not "5+").
    await expect(tabs(page).getByRole('tab', { name: /^Matters, 0 results/ })).toBeVisible();
    await expect(page.getByRole('region', { name: `Tasks (${s.tasks})` })).toBeVisible();
    await expect(page.locator('[data-section=task] [data-hit-row]')).toHaveCount(5);
  });

  test('the tab, the page and the page size are in the address; Back, Forward and a reload keep them', async ({
    page,
    seed,
  }) => {
    const s = await seedResults(seed);
    await page.goto(`/search?q=${s.token}`);
    await expect(tabs(page).getByRole('tab', { name: /^Tasks/ })).toBeVisible();

    await tabs(page)
      .getByRole('tab', { name: /^Tasks/ })
      .click();
    await expect(page).toHaveURL(new RegExp(`type=task`));
    await expect(page.locator('[data-hit-row]')).toHaveCount(25);
    await expect(page.locator('[data-range]')).toContainText(`1-25 of ${s.tasks}`);

    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.locator('[data-hit-row]')).toHaveCount(s.tasks - 25);
    await expect(page.locator('[data-range]')).toContainText(`26-${s.tasks} of ${s.tasks}`);

    await page.reload();
    await expect(page).toHaveURL(/type=task.*page=2|page=2.*type=task/);
    await expect(page.locator('[data-hit-row]')).toHaveCount(s.tasks - 25);
    await expect(tabs(page).getByRole('tab', { name: /^Tasks/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await page.goBack();
    await expect(page).toHaveURL(/type=task/);
    await expect(page).not.toHaveURL(/page=2/);
    await expect(page.locator('[data-hit-row]')).toHaveCount(25);
    await page.goBack();
    await expect(page).not.toHaveURL(/type=/);
    await expect(tabs(page).getByRole('tab', { name: /^All/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.goForward();
    await expect(page).toHaveURL(/type=task/);

    // The page size is in the address too and a different size starts again at page 1.
    await page.getByLabel('Rows per page').selectOption('50');
    await expect(page).toHaveURL(/pageSize=50/);
    await expect(page.locator('[data-hit-row]')).toHaveCount(s.tasks);
  });

  test('changing only the tab or the page does not ask for the counts again', async ({
    page,
    seed,
  }) => {
    const s = await seedResults(seed);
    const asked: string[] = [];
    page.on('request', (r) => {
      const url = new URL(r.url());
      if (url.pathname === '/api/v1/search') asked.push('summary');
      if (url.pathname === '/api/v1/search/advanced') asked.push('advanced');
    });
    await page.goto(`/search?q=${s.token}`);
    await expect(tabs(page).getByRole('tab', { name: /^Tasks, \d+ results/ })).toBeVisible();
    await tabs(page)
      .getByRole('tab', { name: /^Tasks/ })
      .click();
    await expect(page.locator('[data-range]')).toBeVisible();
    await tabs(page)
      .getByRole('tab', { name: /^Assets/ })
      .click();
    await expect(page.locator('[data-hit-row]')).toHaveCount(s.assets);
    await tabs(page).getByRole('tab', { name: /^All/ }).click();
    await expect(page.locator('[data-section=task]')).toBeVisible();
    expect(asked.filter((a) => a === 'summary')).toHaveLength(1);
    expect(asked.filter((a) => a === 'advanced')).toHaveLength(2);
  });

  test('the tabs follow the roving pattern and Tab then lands in the results', async ({
    page,
    seed,
  }) => {
    const s = await seedResults(seed, 6);
    await page.goto(`/search?q=${s.token}`);
    const all = tabs(page).getByRole('tab', { name: /^All/ });
    await expect(all).toHaveAttribute('aria-selected', 'true');
    await all.focus();
    await page.keyboard.press('ArrowRight'); // Matters: the next tab is selected as it takes focus
    await expect(page).toHaveURL(/type=matter/);
    await expect(tabs(page).getByRole('tab', { name: /^Matters/ })).toBeFocused();
    await page.keyboard.press('ArrowRight'); // Clients
    await expect(page).toHaveURL(/type=client/);
    await expect(tabs(page).getByRole('tab', { name: /^Clients/ })).toBeFocused();
    await page.keyboard.press('ArrowRight'); // Tasks
    await expect(page).toHaveURL(/type=task/);
    await expect(tabs(page).getByRole('tab', { name: /^Tasks/ })).toBeFocused();
    await expect(page.locator('[data-hit-row]')).toHaveCount(s.tasks);
    await page.keyboard.press('Tab');
    const inPanel = await page.evaluate(() => !!document.activeElement?.closest('[role=tabpanel]'));
    expect(inPanel, 'focus is in the tab panel after Tab').toBe(true);
  });

  test('a type that does not exist or that the person may not view opens All', async ({
    seed,
    asUser,
  }) => {
    const s = await seedResults(seed, 3);
    const role = await seed.role(['Client.View', 'Matter.View'], 'E2E search tabs matters');
    const user = await seed.user([role.name], 'search-tabs-cm');
    const page = await asUser(user.username);
    for (const type of ['task', 'banana', 'asset,task']) {
      await page.goto(`/search?q=${s.world.matter.matterRef}&type=${type}`);
      await expect(tabs(page).getByRole('tab', { name: /^All/ })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expect(page.getByRole('heading', { name: FORBIDDEN })).toHaveCount(0);
    }
  });

  const VARIANTS: { key: string; permissions: string[]; tabs: string[] }[] = [
    { key: 'task-only', permissions: ['Task.View'], tabs: ['All', 'Tasks'] },
    {
      key: 'client-matter',
      permissions: ['Client.View', 'Matter.View'],
      tabs: ['All', 'Matters', 'Clients'],
    },
    { key: 'asset-only', permissions: ['Asset.View'], tabs: ['All', 'Assets'] },
  ];
  for (const v of VARIANTS) {
    test(`${v.key}: only the tabs of the types the person may view, counted`, async ({
      seed,
      asUser,
    }) => {
      const s = await seedResults(seed, 3);
      const role = await seed.role(v.permissions, `E2E search tabs ${v.key}`);
      const user = await seed.user([role.name], `search-tabs-${v.key}`);
      const page = await asUser(user.username);
      await page.goto(`/search?q=${s.world.matter.matterRef}`);
      await expect(tabs(page).getByRole('tab').first()).toContainText('All');
      await expect
        .poll(async () => (await counts(page)).map((t) => t.replace(/ \(.*/, '')))
        .toEqual(v.tabs);
      for (const text of await counts(page)) expect(text).toMatch(/\(\d[\d,]*\+?\)$/);
    });
  }

  test('a person with no View permission gets the 403 page', async ({ personas, asUser }) => {
    const nobody = await personas.create({ label: 'srt-none', permissions: ['Pod.View'] });
    const page = await asUser(nobody.username);
    await page.goto('/search?q=anything&type=task');
    await expect(page.getByRole('heading', { name: FORBIDDEN, level: 1 })).toBeVisible();
  });

  test.describe('four sizes', () => {
    test.skip(() => !axeAvailable(), 'axe-core is not available');

    test('the header, echo line and tabs stay while the grid scrolls; axe 0; no sideways scroll', async ({
      page,
      seed,
    }) => {
      const s = await seedResults(seed);
      for (const size of SIZES) {
        await page.setViewportSize(size);
        for (const tab of ['', '&type=task']) {
          const where = `${size.width}${tab}`;
          await page.goto(`/search?q=${s.token}${tab}`);
          await expect(tabs(page).getByRole('tab', { name: /^Tasks, \d+ results/ })).toBeVisible();
          // Rows in a table, cards below 640 px.
          await expect(page.locator('[data-hit-row], li.rc').first()).toBeVisible();
          await noHorizontalScroll(page);
          expect(await axeViolations(page), `axe at ${where}`).toEqual([]);
          if (size.width >= 768) {
            // Fixed mode: the page never scrolls, the grid does, and the header, echo line and tabs do not move.
            expect(await pageScroll(page), `page scroll at ${where}`).toBeLessThanOrEqual(0);
            const h1 = page.getByRole('heading', { name: 'Search results', level: 1 });
            const before = (await h1.boundingBox())!;
            const tabBefore = (await tabs(page).boundingBox())!;
            const area = page.locator('.mf-scroll-area').first();
            await area.evaluate((el) => (el.scrollTop = el.scrollHeight));
            expect((await h1.boundingBox())!.y, `H1 moved at ${where}`).toBe(before.y);
            expect((await tabs(page).boundingBox())!.y, `tabs moved at ${where}`).toBe(tabBefore.y);
            await expect(page.locator('[data-page-description]')).toBeVisible();
            await area.evaluate((el) => (el.scrollTop = 0));
          }
          await shot(page, tab ? 'sr3-results-tasks' : 'sr3-results-all');
        }
      }
    });
  });
});
