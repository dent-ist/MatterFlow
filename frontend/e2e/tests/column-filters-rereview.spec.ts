import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

/**
 * Regression tests of the UX re-review of the inline column filters (epic #75, docs/ux/column-filters/re-review-2026-10-20.md):
 * no Angular error in the console of the Task Queue (RR-01), one Clear filters at a time on every filtered empty list (RR-02),
 * the Users list rows and row actions at 1366 px (RR-03), an empty filtered list that says what the default Status hides (RR-04).
 */
const clearButtons = (page: Page) => page.getByRole('button', { name: 'Clear filters' });

test.describe('Column filters re-review', () => {
  test('the Task Queue opens without an Angular error in the console (RR-01)', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/tasks');
    await expect(page.getByRole('toolbar', { name: 'Quick views' })).toBeVisible();
    await expect(page.locator('tbody tr').first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(errors.filter((e) => /NG0\d+/.test(e))).toEqual([]);
  });

  test('an empty filtered list shows one Clear filters, never two (RR-02)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    const none = `${uid()}-none`;
    for (const url of [
      `/tasks?q=${none}`,
      `/my-work?q=${none}`,
      `/assets?name=${none}`,
      `/admin/task-types?name=${none}`,
      `/admin/asset-types?name=${none}`,
      `/admin/audit?q=${none}`,
      `/clients?name=${none}`,
      `/admin/pods?name=${none}`,
    ]) {
      await page.goto(url);
      await expect(page.getByText(/match these filters/), url).toBeVisible();
      await expect(clearButtons(page), url).toHaveCount(1);
    }
    // The count comes back with the bar's button when the list is not empty: Clear filters is the bar's then.
    await page.goto(`/assets?status=all`);
    await expect(page.locator('tbody tr').first()).toBeVisible();
    await expect(clearButtons(page)).toHaveCount(1);
  });

  test('a person row of the Users list is exactly 44 px and the row action stays in view at 1366 px (RR-03, #432)', async ({
    page,
    seed,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    const token = uid();
    const a = await seed.user(['Data Technician'], `rr-a-${token}`);
    await seed.user(['Data Scientist'], `rr-b-${token}`);
    await page.goto(`/admin/users?status=all&account=${token}`);
    const region = page.getByRole('region', { name: 'Users list, scrollable' });
    const rows = region.locator('tbody tr');
    await expect(rows).toHaveCount(2);
    for (const box of await rows.evaluateAll((trs) =>
      trs.map((tr) => tr.getBoundingClientRect().height),
    )) {
      expect(box).toBeGreaterThanOrEqual(43); // 44 px; the collapsed border adds up to a pixel (the First seen time wrapped to 119 px)
      expect(box).toBeLessThanOrEqual(45);
    }
    // The action is never out of sight.
    const open = rows
      .filter({ hasText: a.username })
      .getByRole('button', { name: /^Actions for / });
    await expect(open).toBeVisible();
    const regionBox = (await region.boundingBox())!;
    const openBox = (await open.boundingBox())!;
    expect(openBox.x).toBeGreaterThanOrEqual(regionBox.x);
    expect(openBox.x + openBox.width).toBeLessThanOrEqual(regionBox.x + regionBox.width + 1);
    if (axeAvailable()) expect(await axeViolations(page)).toEqual([]);
  });

  test('an empty filtered list says what the default Status hides and Show all reaches it (RR-04)', async ({
    page,
    seed,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    const matter = await seed.matter();
    const name = `Old ${uid()}`;
    const project = await seed.project(matter, name);
    await seed.admin.post(`/api/v1/projects/${project.projectId}/active`, {
      isActive: false,
      rowVersion: project.rowVersion,
    });
    await page.goto(`/projects?name=${name}`);
    const empty = page.locator('td[data-empty="filtered"]');
    await expect(empty).toContainText('No projects match these filters');
    await expect(empty.locator('[data-hidden-hint]')).toContainText('1 archived hidden');
    if (axeAvailable()) expect(await axeViolations(page)).toEqual([]);
    await empty.getByRole('button', { name: 'Show all' }).click();
    await expect(page).toHaveURL(/status=all/);
    await expect(page.locator('tbody tr').filter({ hasText: name })).toHaveCount(1);
    await expect(page.locator('[data-hidden-hint]')).toHaveCount(0);

    // A phone shows the same sentence in the card list.
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/projects?name=${name}`);
    const cards = page.locator('[data-empty="filtered"]');
    await expect(cards).toContainText('1 archived hidden');
    await cards.getByRole('button', { name: 'Show all' }).click();
    await expect(page.locator('[data-record-card]').filter({ hasText: name })).toHaveCount(1);
  });

  test('no filter cell holds two controls that read alike or an empty unlabelled box (RR-14, RR-15)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    // Workflows: one labelled Versions select (it was two selects that both read "Any").
    await page.goto('/admin/workflows');
    await expect(page.getByRole('combobox', { name: 'Filter by Versions' })).toBeVisible();
    await expect(page.locator('tr[data-filter-row] select')).toHaveCount(2); // Versions and Status
    // Audit: the Object id box says what it is before an object type is chosen.
    await page.goto('/admin/audit');
    await page.getByRole('button', { name: /^Filters/ }).click();
    const objectId = page.getByRole('textbox', { name: 'Filter by Object id' });
    await expect(objectId).toBeDisabled();
    await expect(objectId).toHaveAttribute('placeholder', 'Object id');
    // Every cell that holds more than one visible control: each one has its own text (a name in the box or on the button).
    for (const url of ['/matters', '/admin/steps', '/admin/audit']) {
      await page.goto(url);
      const toggle = page.getByRole('button', { name: /^Filters/ });
      if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
      const cells = await page.locator('tr[data-filter-row] td').evaluateAll((tds) =>
        tds
          .map((td) =>
            Array.from(td.querySelectorAll<HTMLElement>('input:not([aria-hidden]), select, button'))
              .filter((e) => e.getBoundingClientRect().width > 0)
              .map((e) =>
                e instanceof HTMLSelectElement
                  ? (e.options[e.selectedIndex]?.text ?? '')
                  : e instanceof HTMLInputElement
                    ? e.placeholder || e.value
                    : (e.textContent ?? '').trim(),
              ),
          )
          .filter((texts) => texts.length > 1),
      );
      for (const texts of cells) {
        expect(
          texts.every((t) => t.length > 0),
          `${url}: ${texts.join(' | ')}`,
        ).toBe(true);
        expect(new Set(texts).size, `${url}: ${texts.join(' | ')}`).toBe(texts.length);
      }
    }
  });
});
