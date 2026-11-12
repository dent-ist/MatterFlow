import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { SIZES, noSideScroll } from '../support/labels';
import { uid } from '../support/seed';

/**
 * Epic #1373 / #1375: the People page in the main menu (grid, search, Type and Status filters, New Person, Edit Person, Deactivate with Undo, System User rows)
 * and its permission variants: People.Manage = everything, People.View only = read only, no People.View = no menu item and the 403 page.
 * Needs the API with the People backend (#1374) and the Dev auth admin. The reusable person picker has no page that hosts it yet (the Matter Team panel is #1376);
 * it is covered by its unit specs and gets its e2e and axe checks with that panel.
 */
const search = (page: Page) => page.locator('[data-list-search] input');
const rowOf = (page: Page, name: string) =>
  page.locator('tbody tr', { has: page.locator('[data-person-name]', { hasText: name }) });
const dialog = (page: Page) => page.locator('.mf-formdlg');

/** Screenshots for the design evidence (E2E_SCREENSHOTS=<folder>); nothing is written without it. */
async function shot(page: Page, name: string) {
  const dir = process.env['E2E_SCREENSHOTS'];
  if (dir)
    await page.screenshot({
      path: `${dir}/people-${name}-${page.viewportSize()!.width}x${page.viewportSize()!.height}.png`,
    });
}

async function axeClean(page: Page, label: string) {
  if (axeAvailable()) expect(await axeViolations(page), label).toEqual([]);
}

test.describe('People page (#1375)', () => {
  test('Manage: menu item, New Person, search, Edit Person, Deactivate with Undo, Status filter', async ({
    page,
    seed,
  }) => {
    const token = uid().slice(0, 8);
    const first = `Zed${token}`;
    await page.setViewportSize(SIZES[1]);
    await page.goto('/clients');
    await expect(page.getByRole('heading', { level: 1, name: 'Clients' })).toBeVisible();
    const nav = page
      .locator('[data-nav-group="main"]')
      .getByRole('link', { name: 'People', exact: true });
    await expect(nav).toBeVisible();
    await nav.click();
    await expect(page).toHaveURL(/\/people/);
    await expect(page.getByRole('heading', { level: 1, name: 'People' })).toBeVisible();
    await expect(page.locator('mf-page-header')).toContainText('The shared address book');
    await axeClean(page, 'People page at 1366');
    await noSideScroll(page, 'People page at 1366');

    // New Person (External is the default; Company Name shows for External).
    await page.locator('[data-new-person] button, button[data-new-person]').first().click();
    await expect(dialog(page).locator('[data-panel-title]')).toContainText('New Person');
    // The dialog opens clean; leaving an empty required field says nothing; Create Person does (ux-spec 5: required is checked on submit).
    await expect(dialog(page).locator('[role=alert]')).toHaveCount(0);
    await dialog(page).locator('#person-first').focus();
    await dialog(page).locator('#person-last').focus();
    await expect(dialog(page).locator('[role=alert]')).toHaveCount(0);
    await dialog(page).getByRole('button', { name: 'Create Person' }).click();
    await expect(dialog(page)).toContainText('Enter a first name.');
    await expect(dialog(page)).toContainText('Enter a last name.');
    await dialog(page).locator('#person-first').fill(first);
    await dialog(page).locator('#person-last').fill('Tester');
    await dialog(page).locator('#person-title').fill('Court Reporter');
    await dialog(page).locator('#person-company').fill(`Tester Reporting ${token}`);
    await dialog(page).locator('#person-email').fill(`${first.toLowerCase()}@tester.example`);
    await axeClean(page, 'New Person dialog');
    await shot(page, 'new-person');
    await dialog(page).getByRole('button', { name: 'Create Person' }).click();
    await expect(page.getByText('Person created')).toBeVisible();

    await search(page).fill(first);
    const row = rowOf(page, `${first} Tester`);
    await expect(row).toHaveCount(1);
    await expect(row.locator('[data-person-kind]')).toHaveText('External');
    await expect(row.locator('[data-person-title]')).toHaveText('Court Reporter');
    await expect(row.locator('[data-person-company]')).toHaveText(`Tester Reporting ${token}`);
    // Name and Email are two columns.
    await expect(page.getByRole('columnheader', { name: 'Email' })).toHaveCount(1);
    await expect(row.locator('[data-person-name]')).not.toContainText('@');
    await expect(row.locator('[data-person-email]')).toHaveText(
      `${first.toLowerCase()}@tester.example`,
    );

    // Edit Person through the name button.
    await row.locator('[data-person-name]').click();
    await expect(dialog(page).locator('[data-panel-title]')).toContainText('Edit Person');
    await dialog(page).locator('#person-title').fill('Senior Reporter');
    await dialog(page).getByRole('button', { name: 'Save Changes' }).click();
    await expect(page.getByText('Person updated')).toBeVisible();
    await expect(row.locator('[data-person-title]')).toHaveText('Senior Reporter');

    // Deactivate (no question), the Undo toast, and the Status filter.
    await row.getByRole('button', { name: `Deactivate ${first} Tester` }).click();
    await expect(page.getByText(`${first} Tester deactivated.`)).toBeVisible();
    await expect(row).toHaveCount(0);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByText('Person reactivated')).toBeVisible();
    await expect(row).toHaveCount(1);
    await row.getByRole('button', { name: `Deactivate ${first} Tester` }).click();
    await expect(row).toHaveCount(0);
    await page.goto(`/people?q=${first}&status=inactive`);
    await expect(row).toHaveCount(1);
    await expect(page.locator('[data-chip]')).toContainText('Inactive');
    await row.getByRole('button', { name: `Reactivate ${first} Tester` }).click();
    await expect(page.getByText('Person reactivated')).toBeVisible();
    void seed;
  });

  test('Type filter and sort, at both desktop sizes with axe', async ({ page, admin }) => {
    const token = uid().slice(0, 8);
    await admin.post('/api/v1/people', {
      firstName: `Ann${token}`,
      lastName: 'Alpha',
      personType: 'INTERNAL',
      title: 'Partner',
    });
    await admin.post('/api/v1/people', {
      firstName: `Bob${token}`,
      lastName: 'Beta',
      personType: 'EXTERNAL',
      companyName: `Beta Co ${token}`,
    });
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto(`/people?q=${token}`);
      await expect(page.locator('[data-person-name]')).toHaveText([
        `Ann${token} Alpha`,
        `Bob${token} Beta`,
      ]);
      await page.goto(`/people?q=${token}&type=EXTERNAL`);
      await expect(page.locator('[data-person-name]')).toHaveText([`Bob${token} Beta`]);
      await page.goto(`/people?q=${token}&sort=-name`);
      await expect(page.locator('[data-person-name]')).toHaveText([
        `Bob${token} Beta`,
        `Ann${token} Alpha`,
      ]);
      await page.goto(`/people?q=${token}-nobody`);
      await expect(page.locator('[data-state-block]')).toContainText(
        'No people match these filters.',
      );
      await axeClean(page, `People page empty search at ${size.width}`);
      await page.goto(`/people?q=${token}`);
      await expect(page.locator('[data-person-name]')).toHaveCount(2);
      await axeClean(page, `People page at ${size.width}`);
      await shot(page, 'list');
      // The default columns fit the frame: no sideways scroll inside the grid either (D-43a).
      const overflow = await page.evaluate(() => {
        const area = document.querySelector('.mf-scroll-area') as HTMLElement | null;
        return area ? area.scrollWidth - area.clientWidth : -1;
      });
      expect(overflow, `grid scroll at ${size.width}`).toBeGreaterThan(-1);
      expect(overflow, `grid scroll at ${size.width}`).toBeLessThanOrEqual(0);
      await noSideScroll(page, `People page at ${size.width}`);
    }
  });

  test('New Person dialog at both desktop sizes: large two-column form, help follows the choice, axe', async ({
    page,
  }) => {
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto('/people');
      await page.locator('[data-new-person] button, button[data-new-person]').first().click();
      const d = dialog(page);
      await expect(d.locator('[data-type-help]')).toContainText(
        'External: works outside the firm.',
      );
      const box = await d.locator('#person-first').boundingBox();
      const last = await d.locator('#person-last').boundingBox();
      expect(Math.abs(box!.y - last!.y)).toBeLessThan(2); // side by side
      expect((await d.boundingBox())!.width).toBeCloseTo(768, 0);
      await d.locator('[data-type="INTERNAL"]').click();
      await expect(d.locator('#person-company')).toHaveCount(0);
      await expect(d.locator('[data-type-help]')).toContainText('Internal: works at the firm.');
      await d.locator('[data-type="EXTERNAL"]').click();
      await expect(d.locator('#person-company')).toBeVisible();
      await axeClean(page, `New Person dialog at ${size.width}`);
      await shot(page, 'new-person');
      await d.getByRole('button', { name: 'Cancel' }).click();
      await expect(d).toHaveCount(0);
    }
  });

  test('a system user is a System User row: name, email and type are read only, Title or Role is editable, no Deactivate', async ({
    page,
    personas,
    admin,
  }) => {
    const someone = await personas.create({ label: 'people-sys', permissions: ['Client.View'] });
    const name = someone.displayName ?? someone.username;
    await page.setViewportSize(SIZES[0]);
    await page.goto(`/people?q=${encodeURIComponent(name.split('\\').pop() ?? name)}`);
    const row = page.locator('tbody tr').first();
    await expect(row.locator('[data-person-kind]')).toHaveText('System User');
    await expect(row.locator('[data-row-toggle]')).toHaveCount(0);
    await row.locator('[data-person-name]').click();
    await expect(dialog(page).locator('[data-system-banner]')).toContainText(
      'This person is a system user.',
    );
    await expect(dialog(page).locator('#person-first')).toHaveCount(0);
    await expect(dialog(page).locator('[data-plain-field="type"]')).toContainText('System User');
    await dialog(page).locator('#person-title').fill('Records Clerk');
    await axeClean(page, 'Edit Person (system user)');
    await shot(page, 'edit-system-user');
    await dialog(page).getByRole('button', { name: 'Save Changes' }).click();
    await expect(page.getByText('Person updated')).toBeVisible();
    await expect(row.locator('[data-person-title]')).toHaveText('Records Clerk');
    void admin;
  });

  test('People.View only: read only (no New Person, no row menu); the name opens a read-only view', async ({
    asUser,
    personas,
    admin,
  }) => {
    const token = uid().slice(0, 8);
    await admin.post('/api/v1/people', {
      firstName: `View${token}`,
      lastName: 'Only',
      personType: 'EXTERNAL',
      comments: 'Prefers email.',
    });
    const viewer = await personas.create({ label: 'people-view', permissions: ['People.View'] });
    const page = await asUser(viewer.username);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto(`/people?q=View${token}`);
      await expect(page.locator('[data-person-name]')).toHaveText([`View${token} Only`]);
      await expect(page.locator('[data-new-person]')).toHaveCount(0);
      await expect(page.locator('[data-row-actions]')).toHaveCount(0);
      await axeClean(page, `People read only at ${size.width}`);
    }
    await page.locator('[data-person-name]').click();
    const view = dialog(page);
    await expect(view.locator('[data-panel-title]')).toContainText('Person');
    await expect(view.locator('input, textarea')).toHaveCount(0);
    await expect(view.locator('[data-plain-field="comments"]')).toContainText('Prefers email.');
    await expect(view.getByRole('button', { name: 'Close' }).first()).toBeVisible();
    await expect(view.getByRole('button', { name: 'Save Changes' })).toHaveCount(0);
    await axeClean(page, 'Person read-only view');
  });

  test('no People.View: no menu item and the 403 page for /people', async ({
    asUser,
    personas,
  }) => {
    const other = await personas.create({ label: 'people-none', permissions: ['Client.View'] });
    const page = await asUser(other.username);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto('/clients');
      await expect(
        page.locator('[data-nav-group="main"]').getByRole('link', { name: 'Clients', exact: true }),
      ).toBeVisible();
      await expect(
        page.locator('[data-nav-group="main"]').getByRole('link', { name: 'People', exact: true }),
      ).toHaveCount(0);
      await page.goto('/people');
      await expect(page.getByRole('heading', { name: "You don't have access." })).toBeVisible();
      await expect(page.locator('[data-person-name]')).toHaveCount(0);
      await axeClean(page, `People 403 at ${size.width}`);
    }
  });
});
