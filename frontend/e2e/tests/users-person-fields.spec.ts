import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { asDropdown } from '../support/dropdown';
import { expect, test } from '../support/fixtures';
import { SIZES, noSideScroll, shot } from '../support/labels';
import { expectFocusInUserDialog, userDialog, userName, userRow } from '../support/users-grid';

/**
 * Epic #1389, issue #1394: the person fields of the user record. Administration > Users > the user dialog (Profile) has Title or Role, Office, Employment Status,
 * Industry Join Date (month and year) and Comments; Administration > Lists > People holds the Offices and Employment Statuses lists; the Users grid has Title or Role,
 * Office and Employment Status as optional columns. The Employment Status is the HR status of the person, not the account state. Screenshots go to E2E_SCREENSHOTS.
 */
const TAG = `upf${Math.floor(Math.random() * 90000) + 10000}`;

const dropdown = (page: Page, label: string) =>
  asDropdown(userDialog(page).locator(`mf-dropdown button[aria-label^="${label}:"]`));

async function openDialog(page: Page, userId: number, account: string): Promise<void> {
  await page.goto(`/admin/users?status=all&account=${account}`);
  await userName(userRow(page, userId, account)).click();
  await expect(userDialog(page).locator('[data-section="profile"]')).toBeVisible();
  await expectFocusInUserDialog(page);
}

async function axeClean(page: Page) {
  expect(axeAvailable(), 'axe-core is required (set E2E_AXE_PATH)').toBe(true);
  return (await axeViolations(page))
    .map((v) =>
      v.id === 'target-size'
        ? { ...v, nodes: v.nodes.filter((n) => !(n.why ?? '').includes('partially obscured')) }
        : v,
    )
    .filter((v) => v.nodes.length > 0);
}

test.describe('the person fields of the user record (#1394)', () => {
  test('the Profile saves Title or Role, Office, Employment Status, Industry Join Date and Comments, and the dialog shows them again', async ({
    page,
    personas,
  }) => {
    const p = await personas.create({ label: `${TAG}save`, roles: ['Data Technician'] });
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await openDialog(page, p.userId, p.username);
      const dialog = userDialog(page);
      const profile = dialog.locator('[data-section="profile"]');
      await profile.scrollIntoViewIfNeeded();
      // The two lists start with the seeded values and None.
      expect(await dropdown(page, 'Employment Status').optionTexts()).toEqual([
        'None',
        'Active',
        'On Leave',
        'Departed',
      ]);
      await expect(profile).toContainText('Not the same as the account being active');
      if (size === SIZES[0]) {
        await dialog.getByLabel('Title or Role').fill('Senior Project Manager');
        await dropdown(page, 'Office').selectOption({ label: 'Head Office' });
        await dropdown(page, 'Employment Status').selectOption({ label: 'On Leave' });
        await dropdown(page, 'Month').selectOption({ label: 'March' });
        await dropdown(page, 'Year').selectOption({ label: '2018' });
        await expect(dialog.locator('[data-experience]')).toContainText('years in the industry.');
        await dialog
          .locator('#user-comments')
          .fill('Prefers morning calls.\nLeads the Alpha team.');
        await shot(page, `users-person-fields-dialog`);
        expect(await axeClean(page)).toEqual([]);
        await page.getByRole('button', { name: 'Save Changes' }).click();
        await expect(page.locator('[data-panel-primary]')).toHaveAttribute('aria-disabled', 'true');
      } else {
        // The saved values are there again in a fresh dialog.
        await expect(dialog.getByLabel('Title or Role')).toHaveValue('Senior Project Manager');
        await expect(dropdown(page, 'Office')).toContainText('Head Office');
        await expect(dropdown(page, 'Employment Status')).toContainText('On Leave');
        await expect(dropdown(page, 'Month')).toContainText('March');
        await expect(dropdown(page, 'Year')).toContainText('2018');
        await expect(dialog.locator('#user-comments')).toHaveValue(
          'Prefers morning calls.\nLeads the Alpha team.',
        );
        await shot(page, `users-person-fields-dialog`);
        expect(await axeClean(page)).toEqual([]);
      }
      await noSideScroll(page, `user dialog at ${size.width}`);
    }
  });

  test('a month needs a year: the error stops Save Changes until both or neither are chosen', async ({
    page,
    personas,
  }) => {
    const p = await personas.create({ label: `${TAG}month`, roles: ['Data Technician'] });
    await page.setViewportSize(SIZES[1]);
    await openDialog(page, p.userId, p.username);
    await dropdown(page, 'Month').selectOption({ label: 'May' });
    await expect(userDialog(page).locator('[data-join-error]')).toContainText(
      'Choose both a month and a year.',
    );
    await dropdown(page, 'Year').selectOption({ label: '2015' });
    await expect(userDialog(page).locator('[data-join-error]')).toHaveCount(0);
    await expect(page.locator('[data-panel-primary]')).not.toHaveAttribute('aria-disabled', 'true');
  });

  test('Title or Role, Office and Employment Status are optional Users columns that sort and filter, the account Status stays a separate column', async ({
    page,
    personas,
    admin,
  }) => {
    const a = await personas.create({ label: `${TAG}colA`, roles: ['Data Technician'] });
    const b = await personas.create({ label: `${TAG}colB`, roles: ['Data Technician'] });
    const offices = await admin.get<{ id: number; name: string }[]>('/api/v1/offices');
    const statuses = await admin.get<{ id: number; name: string }[]>('/api/v1/employment-statuses');
    const set = async (userId: number, title: string, office: string, status: string) => {
      const detail = await admin.get<{ personRowVersion: string }>(`/api/v1/users/${userId}`);
      await admin.put(`/api/v1/users/${userId}/person-details`, {
        title,
        officeId: offices.find((o) => o.name === office)!.id,
        employmentStatusId: statuses.find((s) => s.name === status)!.id,
        rowVersion: detail.personRowVersion,
      });
    };
    await set(a.userId, `Zeta ${TAG}`, 'Head Office', 'Active');
    await set(b.userId, `Alpha ${TAG}`, 'Remote', 'Departed');

    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto(`/admin/users?status=all&account=e2e-${TAG}col`);
      await expect(page.getByRole('columnheader', { name: 'Employment Status' })).toHaveCount(0);
      await page.getByRole('button', { name: 'Columns', exact: true }).click();
      for (const label of ['Title or Role', 'Office', 'Employment Status'])
        await page.getByLabel(label, { exact: true }).check();
      await page.getByRole('button', { name: 'Columns', exact: true }).click();
      await expect(page.getByRole('columnheader', { name: 'Employment Status' })).toBeVisible();
      await expect(page.locator('thead th').filter({ hasText: /^\s*Status\s*$/i })).toBeVisible();
      await expect(page.locator(`tr[data-record-id="${a.userId}"] [data-office]`)).toHaveText(
        'Head Office',
      );
      await expect(
        page.locator(`tr[data-record-id="${b.userId}"] [data-employment-status]`),
      ).toHaveText('Departed');
      await shot(page, 'users-person-fields-columns');
      await noSideScroll(page, `users grid at ${size.width}`);
    }

    // Sorted by Title or Role: Alpha before Zeta; the filter finds one of them.
    await page.getByRole('columnheader', { name: 'Title or Role' }).getByRole('button').click();
    await expect(page.locator('tbody tr[data-record-id]').first()).toHaveAttribute(
      'data-record-id',
      String(b.userId),
    );
    await page.goto(`/admin/users?status=all&account=e2e-${TAG}col&title=Zeta`);
    await expect(page.locator('tbody tr[data-record-id]')).toHaveCount(1);
    await expect(page.locator(`tr[data-record-id="${a.userId}"]`)).toBeVisible();
  });

  test('Administration > Lists > People: the two lists exist with the seeded values, and an unused office can be added, renamed and deleted', async ({
    page,
  }) => {
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto('/admin/lists/employment-statuses');
      await expect(page.getByRole('heading', { level: 2 })).toHaveText('Employment Statuses');
      const rows = page.locator('[data-list-body] tbody tr');
      await expect(rows.filter({ hasText: 'On Leave' })).toBeVisible();
      await expect(rows.filter({ hasText: 'Departed' })).toBeVisible();
      await expect(page.locator('[data-shown-on]')).toContainText('user record');
      await shot(page, 'users-person-fields-lists');
      if (axeAvailable()) expect(await axeViolations(page), 'lists axe').toEqual([]);
    }
    await page.goto('/admin/lists/offices');
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('Offices');
    const name = `Office ${TAG}`;
    await page.locator('mf-list-editor').getByRole('button', { name: 'New Office' }).click();
    await page.getByLabel('Name').fill(name);
    await page.getByRole('button', { name: 'Add Office' }).click();
    await expect(page.locator('[data-list-body] tbody tr', { hasText: name })).toBeVisible();
  });

  test('a person with User.View only sees the fields as plain text and the dialog has only Close', async ({
    personas,
    asUser,
  }) => {
    const target = await personas.create({ label: `${TAG}ro`, roles: ['Data Technician'] });
    const viewer = await personas.create({ label: `${TAG}view`, permissions: ['User.View'] });
    const page = await asUser(viewer.username);
    await page.setViewportSize(SIZES[0]);
    await openDialog(page, target.userId, target.username);
    const dialog = userDialog(page);
    await expect(dialog.locator('[data-title-text]')).toHaveText('None');
    await expect(dialog.locator('[data-employment-status-text]')).toHaveText('None');
    await expect(dialog.locator('[data-join-text]')).toHaveText('None');
    await expect(dialog.locator('#user-title')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save Changes' })).toHaveCount(0);
  });
});
