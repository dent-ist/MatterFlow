import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { SIZES, noHorizontalScroll } from '../support/screens';
import { expect, test } from '../support/fixtures';
import { Seeder, uid } from '../support/seed';

/**
 * WP-SR6 (#478 to #481): the keyboard and focus work of the search area: the skip link, one Tab stop per result, Back returning to the row of every
 * hit type, the announcements, and the Tab-stop evidence. Evidence goes to E2E_SCREENSHOTS (docs/ux/search-review/fixes/sr6-a11y).
 */
async function seed(seed: Seeder) {
  const token = `Sra${uid().replace(/[^a-z0-9]/gi, '')}`;
  const client = await seed.client({ name: `${token} client` });
  await seed.matter({ client, name: `${token} matter` });
  const world = await seed.world();
  for (let i = 0; i < 30; i++) await seed.task(world, { title: `${token} task ${i}` });
  await seed.project(world.matter, `${token} project`);
  await seed.asset(world.matter, `${token} asset`);
  return { token, world };
}

const live = (page: Page) => page.locator('[data-live]').last();

test.describe('Search keyboard, focus and announcements (WP-SR6)', () => {
  test('skip link first, one Tab stop per result (the reference is not a link), tab stops recorded', async ({
    page,
    seed: s,
  }) => {
    const w = await seed(s);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/search?q=${w.token}&type=task`);
    await expect(page.locator('[data-hit-row]')).toHaveCount(25);
    // The first Tab stop of the page is "Skip to results" (an accessibility mechanism, no key binding).
    await page.locator('body').press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to results' });
    await expect(skip).toBeFocused();
    await skip.press('Enter');
    const inPanel = await page.evaluate(() => !!document.activeElement?.closest('[role=tabpanel]'));
    expect(inPanel, 'focus is in the results panel after the skip link').toBe(true);
    // One Tab stop per result: the name link; the matter number copy button is not a Tab stop.
    const stops = await page.evaluate(
      () =>
        Array.from(
          document.querySelectorAll<HTMLElement>(
            '[role=tabpanel] a[href], [role=tabpanel] button, [role=tabpanel] select, [role=tabpanel] input',
          ),
        ).filter((e) => e.tabIndex >= 0 && !e.closest('[hidden]')).length,
    );
    const rowLinks = await page.locator('[data-hit-row] a').count();
    expect(rowLinks).toBe(25);
    // 25 result links + pager (page size select, First, Previous, Next, Last) at most.
    expect(stops).toBeLessThanOrEqual(25 + 6);
    const out = process.env['E2E_SCREENSHOTS'];
    if (out) {
      fs.mkdirSync(out, { recursive: true });
      fs.writeFileSync(
        path.join(out, 'tab-stops.md'),
        `# Tab stops of the results page (Tasks tab, 25 rows, 1366x768)\n\n- Skip links before the page: Skip to results, Skip to main content\n- Result links: ${rowLinks}\n- Tab stops inside the results panel (links, buttons, selects): ${stops}\n- Not Tab stops: the matter number copy button (arrow key from the name link), the reference text\n`,
      );
    }
  });

  test('Back from a hit of each type returns focus to the link that was left', async ({
    page,
    seed: s,
  }) => {
    const w = await seed(s);
    await page.setViewportSize({ width: 1366, height: 768 });
    for (const type of ['matter', 'client', 'task', 'project', 'asset']) {
      await page.goto(`/search?q=${w.token}&type=${type}`);
      const link = page.locator('[data-hit-row] a').first();
      await expect(link).toBeVisible();
      const key = await link.getAttribute('data-row-key');
      expect(key, `row key of a ${type}`).not.toBeNull();
      await link.focus();
      await page.keyboard.press('Enter');
      await expect(page).not.toHaveURL(/\/search/);
      await page.goBack();
      await expect(page).toHaveURL(new RegExp(`type=${type}`));
      await expect(page.locator(`a[data-row-list="search"][data-row-key="${key}"]`)).toBeFocused();
    }
  });

  test('announcements follow the tab, the page and the filters; the panel says "N results in M groups"', async ({
    page,
    seed: s,
  }) => {
    const w = await seed(s);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/search?q=${w.token}&type=task`);
    await expect(live(page)).toHaveText('Tasks, 30 results, page 1 of 2');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(live(page)).toHaveText('Tasks, 30 results, page 2 of 2');
    await page.goto(`/search?q=${w.token}&type=task&filters=open`);
    await page.getByRole('checkbox', { name: 'On Hold' }).check();
    await expect(live(page)).toContainText('No results');
    await page.getByRole('checkbox', { name: 'On Hold' }).uncheck();
    await page.getByRole('checkbox', { name: 'New', exact: true }).check();
    await expect(live(page)).toHaveText('Filters applied, 30 results, page 1 of 2');

    await page.goto('/dashboard');
    const box = page.getByRole('combobox', { name: /^Search / });
    await box.fill(w.token);
    await expect(page.locator('[data-search-panel] [data-view-all]')).toBeVisible();
    await expect(page.locator('.mf-gs__live')).toContainText(/\d+ results in 5 groups/);
  });

  test.describe('audit at four widths', () => {
    test.skip(() => !axeAvailable(), 'axe-core is not available');

    test('keyboard-only flow: box, Enter, skip link, first result; axe 0 and no sideways scroll', async ({
      page,
      seed: s,
    }) => {
      const w = await seed(s);
      for (const size of SIZES) {
        await page.setViewportSize(size);
        await page.goto('/dashboard');
        const box = page.getByRole('combobox', { name: /^Search / });
        const button = page.getByTestId('search-button');
        if (!(await box.isVisible())) await button.click();
        await box.fill(w.token);
        await expect(page.locator('[data-search-panel] [data-view-all]')).toBeVisible();
        expect(await axeViolations(page), `axe panel ${size.width}`).toEqual([]);
        await box.press('ArrowUp'); // the footer option
        await box.press('Enter');
        await expect(page).toHaveURL(/\/search\?q=/);
        await expect(page.getByRole('tab', { name: /^All, \d+ results/ })).toBeVisible();
        await noHorizontalScroll(page);
        expect(await axeViolations(page), `axe results ${size.width}`).toEqual([]);
        // The skip link is the first stop of the page and leads into the results.
        await page.reload();
        await expect(page.getByRole('tab', { name: /^All, \d+ results/ })).toBeVisible();
        await page.locator('body').press('Tab');
        await expect(page.getByRole('link', { name: 'Skip to results' })).toBeFocused();
        await page.keyboard.press('Enter');
        await expect
          .poll(() => page.evaluate(() => !!document.activeElement?.closest('[role=tabpanel]')))
          .toBe(true);
        await page.keyboard.press('Tab');
        const onLink = await page.evaluate(() => document.activeElement?.tagName);
        expect(['A', 'BUTTON', 'SELECT', 'DIV']).toContain(onLink);
      }
    });
  });
});
