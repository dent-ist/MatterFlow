import { expect, test } from '../support/fixtures';
import { axeAvailable, axeViolations } from '../support/axe';
import { SIZES, noHorizontalScroll } from '../support/screens';

/**
 * Breadcrumb alignment in the shared page header and the record header: a link (24 px target), plain text and the current page share one
 * vertical centre (within 1 px), so the middle link of "Administration > Task Types > Workflows" does not sit lower than its neighbours.
 */
test.describe('Breadcrumb rows are vertically aligned', () => {
  test.setTimeout(300_000);

  test('every step shares one vertical centre at four sizes', async ({ page, seed }) => {
    const client = await seed.client();
    const matter = await seed.matter({ client });
    const project = await seed.project(matter);
    const pages = ['/admin/workflows/new', '/admin/steps/new', `/projects/${project.projectId}`];
    for (const size of SIZES) {
      await page.setViewportSize(size);
      for (const path of pages) {
        await page.goto(path);
        const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' }).first();
        await expect(crumbs).toBeVisible();
        // A record shows "Back to ..." instead of the trail on a phone.
        if (path.startsWith('/projects') && size.width < 640) continue;
        const centres = await crumbs.locator('li').evaluateAll((items) =>
          items.map((li) => {
            const r = (li.querySelector('a, span') ?? li).getBoundingClientRect();
            return { text: li.textContent!.trim(), centre: r.top + r.height / 2 };
          }),
        );
        expect(centres.length, `${path}: crumb count`).toBeGreaterThanOrEqual(3);
        for (const c of centres) {
          expect(
            Math.abs(c.centre - centres[0].centre),
            `${path} at ${size.width}: "${c.text}" off the row centre`,
          ).toBeLessThanOrEqual(1);
        }
        if (axeAvailable())
          expect(await axeViolations(page), `${path} at ${size.width}`).toEqual([]);
        await noHorizontalScroll(page);
      }
    }
  });
});
