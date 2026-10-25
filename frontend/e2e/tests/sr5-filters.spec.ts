import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { SIZES, noHorizontalScroll, shot } from '../support/screens';
import { expect, test } from '../support/fixtures';
import { Seeder, uid } from '../support/seed';

/**
 * WP-SR5 (Search review S6; #474 to #477): the Filters panel of a type tab, applied live, in the address, with chips and one Clear filters; the
 * old Advanced search address redirects to the results page. Screenshots go to E2E_SCREENSHOTS (docs/ux/search-review/fixes/sr5-filters).
 */
async function seedTwoMatters(seed: Seeder) {
  const token = `Srf${uid().replace(/[^a-z0-9]/gi, '')}`;
  const client = await seed.client({ name: `${token} client` });
  const secret = await seed.matter({
    client,
    number: '00001',
    name: `${token} sensitive`,
    sensitive: true,
  });
  const open = await seed.matter({ client, number: '00002', name: `${token} open` });
  const a = await seed.world();
  const b = await seed.world();
  for (let i = 0; i < 3; i++) await seed.task(a, { title: `${token} alpha ${i}` });
  for (let i = 0; i < 2; i++) await seed.task(b, { title: `${token} beta ${i}` });
  await seed.asset(a.matter, `${token} asset`);
  await seed.project(a.matter, `${token} project`);
  return { token, client, secret, open, a, b };
}

const rows = (page: Page) => page.locator('[data-hit-row], li.rc');

test.describe('Search filters and the Advanced search redirect (WP-SR5)', () => {
  test('/search/advanced redirects for each of the five types, keeping type, q and the filters', async ({
    page,
    seed,
  }) => {
    const s = await seedTwoMatters(seed);
    await page.setViewportSize({ width: 1366, height: 768 });
    for (const type of ['client', 'matter', 'project', 'task', 'asset']) {
      await page.goto(`/search/advanced?type=${type}&q=${s.token}&page=1`);
      await expect(page).toHaveURL(new RegExp(`/search\\?.*type=${type}`));
      await expect(page).toHaveURL(/filters=open/);
      await expect(page).toHaveURL(new RegExp(`q=${s.token}`));
      await expect(page.locator('[data-filters-panel]')).toBeVisible();
      await expect(rows(page).first()).toBeVisible();
    }
    // The old filters keep working through the redirect.
    await page.goto(`/search/advanced?type=task&q=${s.token}&matter=${s.a.matter.matterId}`);
    await expect(rows(page)).toHaveCount(3);
    await expect(page.locator('[data-filter-chip]')).toContainText('Matter:');
    // No type: the All tab.
    await page.goto(`/search/advanced?q=${s.token}`);
    await expect(page).not.toHaveURL(/type=/);
    await expect(page.getByRole('tab', { name: /^All/ })).toHaveAttribute('aria-selected', 'true');
  });

  test('tasks by matter: applied live, chip removable by keyboard, Back restores, Clear filters returns focus to the button', async ({
    page,
    seed,
  }) => {
    const s = await seedTwoMatters(seed);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/search?q=${s.token}&type=task`);
    await expect(rows(page)).toHaveCount(5);
    const button = page.getByRole('button', { name: /^Filters/ });
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('[data-filters-panel]')).toBeVisible();

    // Pick the matter of the first world: no Search button, the list follows at once, and the address says so.
    await page.locator('#sf-matter').fill(s.a.matter.matterRef);
    await page.locator('[data-filters-panel]').getByRole('option').first().click();
    await expect(rows(page)).toHaveCount(3);
    await expect(page).toHaveURL(new RegExp(`matter=${s.a.matter.matterId}`));
    await expect(button).toContainText('Filters (1)');
    await expect(page.locator('[data-filter-chip]')).toHaveCount(1);

    // Back restores the previous filters (none), Forward the matter.
    await page.goBack();
    await expect(rows(page)).toHaveCount(5);
    await page.goForward();
    await expect(rows(page)).toHaveCount(3);

    // A task status filter combines with it; the chip is a button that Enter removes.
    await page.getByLabel('On Hold').check();
    await expect(rows(page)).toHaveCount(0);
    await expect(page.locator('[data-empty]')).toContainText('No results match these filters');
    const chip = page.getByRole('button', { name: /^Remove filter Task status: On Hold/ });
    await chip.focus();
    await page.keyboard.press('Enter');
    await expect(rows(page)).toHaveCount(3);

    // One Clear filters: everything is dropped and focus is back on the Filters button.
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(rows(page)).toHaveCount(5);
    await expect(page).not.toHaveURL(/matter=/);
    await expect(button).toBeFocused();
    await expect(button).toHaveText('Filters');
  });

  test('matters: Status offers Any (the default), Active and Inactive; Sensitive only finds the sensitive matter', async ({
    page,
    seed,
  }) => {
    const s = await seedTwoMatters(seed);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/search?q=${s.token}&type=matter&filters=open`);
    await expect(rows(page)).toHaveCount(2);
    const status = page.locator('#sf-active');
    await expect(status).toHaveValue('any');
    expect((await status.locator('option').allTextContents()).map((t) => t.trim())).toEqual([
      'Any',
      'Active',
      'Inactive',
    ]);
    await page.locator('#sf-sensitive').selectOption('true');
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText(`${s.token} sensitive`);
    await expect(page).toHaveURL(/sensitive=true/);
    await page.locator('#sf-active').selectOption('false');
    await expect(rows(page)).toHaveCount(0);
  });

  test('assets by asset type and status; clients by status; projects by matter', async ({
    page,
    seed,
  }) => {
    const s = await seedTwoMatters(seed);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/search?q=${s.token}&type=asset&filters=open`);
    await expect(rows(page)).toHaveCount(1);
    expect(await page.locator('#sf-asset-type option').count()).toBeGreaterThan(1);
    await page.locator('#sf-active').selectOption('true');
    await expect(rows(page)).toHaveCount(1);
    await page.locator('#sf-asset-type').selectOption({ index: 1 });
    await expect(page).toHaveURL(/assetType=\d+/);

    await page.goto(`/search?q=${s.token}&type=client&filters=open`);
    await expect(page.locator('[data-filters-panel] label')).toHaveText(['Status']);
    await page.locator('#sf-active').selectOption('false');
    await expect(rows(page)).toHaveCount(0);

    await page.goto(`/search?q=${s.token}&type=project&matter=${s.a.matter.matterId}&filters=open`);
    await expect(rows(page)).toHaveCount(1);
    await page.goto(`/search?q=${s.token}&type=project&matter=${s.b.matter.matterId}&filters=open`);
    await expect(rows(page)).toHaveCount(0);
  });

  test('a person with Task.View only gets task filters without record pickers', async ({
    seed,
    asUser,
  }) => {
    const s = await seedTwoMatters(seed);
    const role = await seed.role(['Task.View'], 'E2E filters tasks only');
    const user = await seed.user([role.name], 'filters-tasks');
    const page = await asUser(user.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/search?q=${s.token}&type=task&filters=open`);
    await expect(rows(page)).toHaveCount(5);
    await expect(page.locator('#sf-client')).toHaveCount(0);
    await expect(page.locator('#sf-matter')).toHaveCount(0);
    await page.getByLabel('Requestor').fill('zzzz-nobody');
    await expect(rows(page)).toHaveCount(0);
    await expect(page).toHaveURL(/requestor=zzzz-nobody/);
  });

  test.describe('four sizes', () => {
    test.skip(() => !axeAvailable(), 'axe-core is not available');

    test('axe 0 and no sideways scroll with the panel open (and a picker list open) on every type', async ({
      page,
      seed,
    }) => {
      const s = await seedTwoMatters(seed);
      for (const size of SIZES) {
        await page.setViewportSize(size);
        for (const type of ['client', 'matter', 'project', 'task', 'asset']) {
          await page.goto(`/search?q=${s.token}&type=${type}&filters=open&active=true`);
          await expect(page.locator('[data-filters-panel]')).toBeVisible();
          await expect(rows(page).first()).toBeVisible();
          await noHorizontalScroll(page);
          expect(await axeViolations(page), `axe ${type} at ${size.width}`).toEqual([]);
        }
        // A picker with its list open (tasks: matter picker).
        await page.goto(`/search?q=${s.token}&type=task&filters=open`);
        await page.locator('#sf-matter').fill(s.a.matter.matterRef);
        await expect(
          page.locator('[data-filters-panel]').getByRole('option').first(),
        ).toBeVisible();
        expect(await axeViolations(page), `axe picker open at ${size.width}`).toEqual([]);
        await noHorizontalScroll(page);
        await shot(page, 'sr5-filters-picker');
        await page.goto(
          `/search?q=${s.token}&type=task&filters=open&status=NEW&matter=${s.a.matter.matterId}`,
        );
        await expect(page.locator('[data-filter-chip]').first()).toBeVisible();
        await shot(page, 'sr5-filters-chips');
      }
    });
  });
});
