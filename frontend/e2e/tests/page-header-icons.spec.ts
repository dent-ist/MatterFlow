import { expect, test } from '../support/fixtures';

test.describe('Page header icons', () => {
  test('every screen of the left navigation shows its navigation icon before the title, hidden from assistive technology', async ({
    page,
  }) => {
    await page.goto('/dashboard');
    const links = page.locator('nav a:has(i.pi)');
    await expect(links.first()).toBeVisible();
    const entries = await links.evaluateAll((as) =>
      as.map((a) => ({
        href: (a as HTMLAnchorElement).getAttribute('href') ?? '',
        icon: Array.from(a.querySelector('i.pi')!.classList).filter((c) => c.startsWith('pi-'))[0],
      })),
    );
    expect(entries.length).toBeGreaterThanOrEqual(14);
    for (const { href, icon } of entries) {
      await page.goto(href);
      const heading = page.getByRole('heading', { level: 1 }).first();
      await expect(heading, href).toBeVisible();
      const glyph = heading.locator('i[data-page-icon]');
      await expect(glyph, `${href} shows ${icon}`).toHaveClass(new RegExp(`\\b${icon}\\b`));
      await expect(glyph).toHaveAttribute('aria-hidden', 'true');
      // The icon adds nothing to the heading's name.
      expect(((await heading.textContent()) ?? '').trim().length, href).toBeGreaterThan(0);
    }
  });

  test('detail, create and search pages carry the icon of their section', async ({ page }) => {
    await page.goto('/tasks/new');
    await expect(
      page.getByRole('heading', { name: 'Create task', level: 1 }).locator('i[data-page-icon]'),
    ).toHaveClass(/pi-plus/);
    await page.goto('/search?q=a');
    await expect(
      page.getByRole('heading', { name: 'Search results', level: 1 }).locator('i[data-page-icon]'),
    ).toHaveClass(/pi-search/);
    await page.goto('/this-page-does-not-exist');
    await expect(page.getByRole('heading', { level: 1 }).locator('i[data-page-icon]')).toHaveClass(
      /pi-compass/,
    );
  });
});
