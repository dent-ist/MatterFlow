import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Seeder, uid } from '../support/seed';

/**
 * WP-SR7 (#482): the permission matrix of the search area. For each permission set: the placeholder, the groups of the panel, the tabs and their
 * counts (equal to the API's totals for that person), the Searched in line, the Filters controls, and that every result opens without a refused
 * API call. A person with no View permission gets the 403 page.
 */
const FORBIDDEN = "You don't have permission to view this.";

async function seedAll(seed: Seeder) {
  const token = `Srm${uid().replace(/[^a-z0-9]/gi, '')}`;
  const client = await seed.client({ name: `${token} client` });
  await seed.matter({ client, name: `${token} matter` });
  const world = await seed.world();
  for (let i = 0; i < 4; i++) await seed.task(world, { title: `${token} task ${i}` });
  await seed.project(world.matter, `${token} project`);
  await seed.asset(world.matter, `${token} asset`);
  return { token };
}

const MATRIX = [
  {
    key: 'task-only',
    permissions: ['Task.View'],
    types: ['task'],
    placeholder: 'Search tasks... (Ctrl+K)',
    searchedIn: 'Searched in: Tasks',
    filters: ['Task status', 'Requestor'],
  },
  {
    key: 'client-matter',
    permissions: ['Client.View', 'Matter.View'],
    types: ['matter', 'client'],
    placeholder: 'Search clients, matters... (Ctrl+K)',
    searchedIn: 'Searched in: Matters and Clients',
    filters: ['Client', 'Status', 'Sensitive matter'],
  },
  {
    key: 'asset-only',
    permissions: ['Asset.View'],
    types: ['asset'],
    placeholder: 'Search assets... (Ctrl+K)',
    searchedIn: 'Searched in: Assets',
    filters: ['Asset type', 'Status'],
  },
] as const;

const LABEL: Record<string, string> = {
  matter: 'Matters',
  client: 'Clients',
  task: 'Tasks',
  project: 'Projects',
  asset: 'Assets',
};

async function openBox(page: Page) {
  const box = page.getByRole('combobox', { name: /^Search / });
  const button = page.getByTestId('search-button');
  await box.or(button).first().waitFor({ state: 'visible' });
  if (!(await box.isVisible())) await button.click();
  return box;
}

test.describe('Search permission matrix (WP-SR7)', () => {
  for (const row of MATRIX) {
    test(`${row.key}: panel, tabs and counts, Searched in, filters, links`, async ({
      seed,
      asUser,
    }) => {
      const s = await seedAll(seed);
      const role = await seed.role([...row.permissions], `E2E matrix ${row.key}`);
      const user = await seed.user([role.name], `matrix-${row.key}`);
      const page = await asUser(user.username);
      await page.setViewportSize({ width: 1366, height: 768 });
      const denied: string[] = [];
      page.on('response', (r) => {
        if (r.url().includes('/api/') && (r.status() === 403 || r.status() === 401))
          denied.push(`${r.status()} ${r.url()}`);
      });

      // The box and the panel.
      await page.goto('/my-work').catch(() => undefined);
      if (!/\/(my-work|search)/.test(page.url())) await page.goto('/search?q=ab');
      const box = await openBox(page);
      await expect(box).toHaveAttribute('placeholder', row.placeholder);
      await box.fill(s.token);
      await expect(page.locator('[data-search-panel] [data-view-all]')).toBeVisible();
      const groups = await page
        .locator('[data-group]')
        .evaluateAll((els) => els.map((e) => e.getAttribute('data-group')));
      expect([...groups].sort()).toEqual([...row.types].sort());
      await expect(page.locator('[data-searched-in]')).toHaveText(row.searchedIn);

      // The tabs: only the person's types, each count equal to the API's total for this person.
      const api = await (await page.request.get(`/api/v1/search?q=${s.token}&limit=5`)).json();
      await page.goto(`/search?q=${s.token}`);
      const tabs = page.getByRole('tablist', { name: 'Search results by type' }).getByRole('tab');
      await expect(tabs.first()).toContainText('All');
      for (const type of row.types) {
        const total = api.groups.find((g: { type: string }) => g.type === type).total as number;
        await expect(tabs.filter({ hasText: new RegExp(LABEL[type]) })).toContainText(`(${total})`);
      }
      await expect(tabs).toHaveCount(row.types.length + 1);
      await expect(page.locator('[data-searched-in]')).toHaveText(
        row.searchedIn.replace(/(\w+) and (\w+)$/, '$1 and $2'),
      );

      // The Filters controls offered to this person (no picker for records they may not view).
      await page.goto(`/search?q=${s.token}&type=${row.types[0]}&filters=open`);
      await expect(page.locator('[data-filters-panel]')).toBeVisible();
      const labels = (
        await page
          .locator(
            '[data-filters-panel] > div > label, [data-filters-panel] label.mf-field__label, [data-filters-panel] legend',
          )
          .allTextContents()
      ).map((t) => t.replace(/\s+/g, ' ').replace('(required)', '').trim());
      for (const f of row.filters) expect(labels).toContain(f);

      // Every result opens (no dead link): a refused API call or the 403 heading is a defect.
      for (const type of row.types) {
        await page.goto(`/search?q=${s.token}&type=${type}`);
        await expect(page.locator('[data-hit-row]').first()).toBeVisible();
        const hrefs = await page
          .locator('[data-hit-row] a')
          .evaluateAll((els) => els.map((e) => e.getAttribute('href')!));
        expect(hrefs.length).toBeGreaterThan(0);
        for (const href of hrefs) {
          await page.goto(href);
          await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
          await expect(page.getByRole('heading', { name: FORBIDDEN })).toHaveCount(0);
        }
      }
      expect(denied, `refused API calls as ${row.key}`).toEqual([]);

      if (axeAvailable()) {
        await page.goto(`/search?q=${s.token}&type=${row.types[0]}&filters=open`);
        expect(await axeViolations(page), `axe ${row.key}`).toEqual([]);
      }
    });
  }

  test('a person with no View permission gets the 403 page on every search address', async ({
    personas,
    asUser,
  }) => {
    const nobody = await personas.create({ label: 'srm-none', permissions: ['Pod.View'] });
    const page = await asUser(nobody.username);
    for (const url of [
      '/search?q=anything',
      '/search?q=anything&type=task',
      '/search/advanced?type=task&q=x',
    ]) {
      await page.goto(url);
      await expect(page.getByRole('heading', { name: FORBIDDEN, level: 1 })).toBeVisible();
    }
  });
});
