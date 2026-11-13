import { Page } from '@playwright/test';
import { Api, Json } from '../support/api';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { SIZES, noSideScroll } from '../support/labels';
import { Seeder, uid } from '../support/seed';

/**
 * Epic #1373 / #1379: the Vendors panel of the matter Summary, under the Team panel in the 340 px side column. No vendors is ONE line ("Vendors 0, No vendors linked, + Engage Vendor"),
 * one vendor is one compact row, many show the row cap (three at 1366x768, five at 1920x1080) and "Show All N"; the red "n Blacklisted" chip stays when the panel is folded. Edit Vendors is a large
 * dialog with the inline empty row (the vendor combobox), applied on Save; a Blacklisted vendor shows its reason and needs the tick before Save. Permissions: Vendor.View shows the panel (without it
 * the panel is gone), Vendor.Link enables Edit (without it Edit is disabled and the footer says "Needs Vendor.Link"). A vendor name opens the Vendor pop-up. Each test works on its own client,
 * matter and vendors (the database is shared).
 *
 * Screenshots (not a test: only with E2E_SCREENSHOTS set to the output folder):
 *   E2E_SCREENSHOTS=/tmp/vendors-summary frontend/e2e/run-local.sh -g "Vendors panel screenshots"
 */
const S1366 = SIZES[1];
const panel = (page: Page) => page.locator('[data-section-panel="vendors"]');
const rows = (page: Page) => panel(page).locator('[data-vendor-row]');
const dialog = (page: Page) => page.locator('.mf-formdlg');

async function shot(page: Page, name: string) {
  const dir = process.env['E2E_SCREENSHOTS'];
  if (dir)
    await page.screenshot({
      path: `${dir}/${name}-${page.viewportSize()!.width}x${page.viewportSize()!.height}.jpg`,
      type: 'jpeg',
      quality: 80,
    });
}

async function axeClean(page: Page, label: string) {
  if (axeAvailable()) expect(await axeViolations(page), label).toEqual([]);
}

test.describe('Matter Summary: the Vendors panel (#1379)', () => {
  // A new token for every test (and every repeat): vendor names are unique in the shared database.
  let token = uid().slice(0, 6);
  test.beforeEach(() => {
    token = uid().slice(0, 6);
  });

  async function matterOf(seed: Seeder) {
    const client = await seed.client();
    return seed.matter({ client, number: '00001', name: `Acme v. Beta ${token}` });
  }

  /** A vendor with one service; `note` is the reason when it is Blacklisted. */
  async function vendorOf(
    admin: Api,
    name: string,
    category = 'PREFERRED',
    extra: Json = {},
  ): Promise<Json> {
    return admin.post('/api/v1/vendors', { name: `${name} ${token}`, category, ...extra });
  }

  async function link(admin: Api, matter: Json, vendor: Json, confirm = false) {
    await admin.post(`/api/v1/matters/${matter.matterId}/vendors`, {
      vendorId: vendor.vendorId,
      confirmBlacklisted: confirm,
    });
  }

  /** Five Internal people on the team, so the Team panel is as tall as it gets. */
  async function fullTeam(admin: Api, matter: Json) {
    const titles = (await admin.get<Json[]>('/api/v1/team-titles')).filter((t) => t.isActive);
    for (const [i, first] of ['Maria', 'Helen', 'Victor', 'Tom', 'Grace'].entries()) {
      const p = await admin.post('/api/v1/people', {
        firstName: `${first}${token}`,
        lastName: 'Team',
        personType: 'INTERNAL',
        email: `${first}.${token}@demo.example`.toLowerCase(),
      });
      await admin.post(`/api/v1/matters/${matter.matterId}/team`, {
        personId: p.personId,
        teamTitleId: titles[i % titles.length].id,
      });
    }
  }

  test('no vendors is one line with + Engage Vendor; engaging one makes a single compact row', async ({
    page,
    seed,
    admin,
  }) => {
    const matter = await matterOf(seed);
    const vendor = await vendorOf(admin, 'Solo', 'PREFERRED', { note: 'Fine.' });
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto(`/matters/${matter.matterId}`);
      await expect(panel(page).locator('[data-panel-title]')).toHaveText('Vendors');
      await expect(panel(page).locator('[data-panel-count]')).toHaveText('0');
      await expect(panel(page).locator('[data-panel-empty]')).toHaveText('No vendors linked');
      await expect(panel(page).locator('[data-panel-toggle]')).toHaveCount(0);
      await expect(panel(page).locator('[data-vendor-engage]')).toContainText('Engage Vendor');
      await expect(panel(page)).not.toContainText('Add Vendor');
      const box = (await panel(page).boundingBox())!;
      expect(box.height, `one line at ${size.width}`).toBeLessThan(60);
      await noSideScroll(page, `Summary at ${size.width}`);
      await axeClean(page, `Summary without vendors at ${size.width}`);
    }
    await page.setViewportSize(S1366);
    await page.goto(`/matters/${matter.matterId}`);
    await panel(page).locator('[data-vendor-engage]').click();
    const d = dialog(page);
    await expect(d.locator('[data-panel-title]')).toContainText('Edit Vendors');
    await d.locator('#vendor-add').fill(`Solo ${token}`);
    await page.locator('[role=option][data-vendor-id]').first().click();
    await expect(d.locator('[data-vendor-rows] [data-vendor-row]')).toHaveCount(1);
    await expect(d.locator('[data-vendors-summary]')).toHaveText('1 added.');
    await d.locator('[data-panel-primary]').click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(panel(page).locator('[data-panel-count]')).toHaveText('1');
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).locator('[data-vendor-name]')).toContainText(`Solo ${token}`);
    await expect(rows(page).locator('[data-vendor-category]')).toContainText('Preferred');
    const saved = await admin.get<Json[]>(`/api/v1/matters/${matter.matterId}/vendors`);
    expect(saved.map((v) => v.vendorId)).toEqual([vendor.vendorId]);
  });

  test('many vendors: the row cap, Show All, the Blacklisted chip when folded, and Team plus Vendors fit the side column without scrolling', async ({
    page,
    seed,
    admin,
  }) => {
    const matter = await matterOf(seed);
    await fullTeam(admin, matter);
    const bad = await vendorOf(admin, 'Zed Bad', 'BLACKLISTED', { note: 'Lost a data set.' });
    await link(admin, matter, bad, true);
    for (const n of ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon']) {
      await link(admin, matter, await vendorOf(admin, n, n === 'Beta' ? 'NEUTRAL' : 'PREFERRED'));
    }
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto(`/matters/${matter.matterId}`);
      await expect(panel(page).locator('[data-panel-count]')).toHaveText('6');
      const cap = size.height >= 900 ? 5 : 3;
      await expect(rows(page)).toHaveCount(cap);
      await expect(page.locator('[data-vendors-show-all]')).toHaveText('Show All 6');
      // Blacklisted rows sort first.
      await expect(rows(page).first().locator('[data-vendor-name]')).toContainText('Zed Bad');
      await expect(rows(page).first().locator('[data-vendor-category]')).toContainText(
        'Blacklisted',
      );
      await expect(panel(page).locator('[data-blacklisted-chip]')).toContainText('1 Blacklisted');
      // Both panels fit the side column: it does not scroll, the page does not scroll.
      const fit = await page.evaluate(() => {
        const side = document.querySelector('[data-summary-side]') as HTMLElement;
        return {
          side: side.scrollHeight - side.clientHeight,
          page: document.documentElement.scrollHeight - document.documentElement.clientHeight,
        };
      });
      expect(fit.side, `the side column scrolls at ${size.width}`).toBeLessThanOrEqual(1);
      expect(fit.page, `the page scrolls at ${size.width}`).toBeLessThanOrEqual(0);
      await noSideScroll(page, `Summary at ${size.width}`);
      await axeClean(page, `Summary with vendors at ${size.width}`);
    }

    await page.setViewportSize(S1366);
    await page.goto(`/matters/${matter.matterId}`);
    const toggle = panel(page).locator('[data-panel-toggle]');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(rows(page)).toHaveCount(0);
    await expect(panel(page).locator('[data-panel-count]')).toHaveText('6');
    await expect(panel(page).locator('[data-blacklisted-chip]')).toBeVisible();
    await toggle.click();

    await page.locator('[data-vendors-show-all]').click();
    const all = dialog(page);
    await expect(all.locator('[data-panel-title]')).toContainText('Vendors (6)');
    await expect(all.locator('[data-vendor-all-row]')).toHaveCount(6);
    await expect(all.locator('[data-vendors-all-banner]')).toContainText('1 Blacklisted');
    await expect(all.locator('[data-panel-primary]')).toHaveCount(0);
    await axeClean(page, 'Vendors Show All dialog');
    await all.getByRole('button', { name: 'Close', exact: true }).last().click();
    await expect(dialog(page)).toHaveCount(0);
  });

  test('Edit Vendors: a Blacklisted vendor shows its reason and needs the tick; unlink and link are applied on Save', async ({
    page,
    seed,
    admin,
  }) => {
    const matter = await matterOf(seed);
    const old = await vendorOf(admin, 'Old Link');
    await link(admin, matter, old);
    const bad = await vendorOf(admin, 'Risky', 'BLACKLISTED', { note: 'Missed two deadlines.' });
    await page.setViewportSize(S1366);
    await page.goto(`/matters/${matter.matterId}`);
    await panel(page).locator('[data-vendor-edit]').click();
    const d = dialog(page);
    const save = d.locator('[data-panel-primary]');
    await expect(save).toHaveAttribute('aria-disabled', 'true'); // nothing changed yet
    await axeClean(page, 'Edit Vendors dialog');
    await d.locator('#vendor-add').fill(`Risky ${token}`);
    const option = page.locator('[role=option][data-vendor-id]').first();
    await expect(option).toContainText('Blacklisted');
    await shot(page, 'edit-vendors-combobox');
    await option.click();
    const warning = d.locator('[data-blacklisted-warning]');
    await expect(warning).toContainText('Missed two deadlines.');
    await expect(warning).toContainText('I have read this and still want to link it');
    await expect(d.locator('[data-vendors-summary]')).toContainText(
      'Tick the Blacklisted warning.',
    );
    await expect(save).toHaveAttribute('aria-disabled', 'true');
    await shot(page, 'edit-vendors-blacklisted');
    await axeClean(page, 'Edit Vendors dialog with a Blacklisted vendor');
    // The vendor is on the list now: the combobox shows it disabled.
    await d.locator('#vendor-add').fill(`Risky ${token}`);
    await expect(page.getByRole('option', { name: /Linked/ })).toBeVisible();
    await d.locator('#vendor-add').fill('');
    await page.keyboard.press('Escape');
    await expect(d).toBeVisible(); // Esc closed the list only, not the dialog
    await warning.locator('[data-blacklisted-tick]').check();
    await d.locator('[data-vendor-row]').first().locator('[data-remove-row]').click();
    await expect(d.locator('[data-vendors-summary]')).toHaveText('1 added, 1 removed.');
    await expect(save).not.toHaveAttribute('aria-disabled', 'true');
    await save.click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).locator('[data-vendor-name]')).toContainText(`Risky ${token}`);
    await expect(panel(page).locator('[data-blacklisted-chip]')).toContainText('1 Blacklisted');
    const saved = await admin.get<Json[]>(`/api/v1/matters/${matter.matterId}/vendors`);
    expect(saved.map((v) => v.vendorId)).toEqual([bad.vendorId]);
  });

  test('Edit Vendors: typed text that is not a picked vendor refuses the save, and a dirty Cancel asks first', async ({
    page,
    seed,
    admin,
  }) => {
    const matter = await matterOf(seed);
    await link(admin, matter, await vendorOf(admin, 'Keep'));
    await page.setViewportSize(S1366);
    await page.goto(`/matters/${matter.matterId}`);
    await panel(page).locator('[data-vendor-edit]').click();
    const d = dialog(page);
    await d.locator('[data-vendor-row]').first().locator('[data-remove-row]').click();
    await d.locator('#vendor-add').fill('Somebody Not Picked');
    await page.keyboard.press('Escape');
    await d.locator('[data-panel-primary]').click();
    await expect(d.getByText('Choose a vendor from the list.')).toBeVisible();
    await d.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('You have unsaved changes. Discard them?')).toBeVisible();
    await page.getByRole('button', { name: 'Keep Editing' }).click();
    await expect(d).toBeVisible();
    await d.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Discard Changes' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(panel(page).locator('[data-panel-count]')).toHaveText('1');
  });

  test('a vendor name opens the Vendor pop-up (read only for Vendor.View), and its Matters tab lists this matter', async ({
    asUser,
    personas,
    seed,
    admin,
  }) => {
    const matter = await matterOf(seed);
    const vendor = await vendorOf(admin, 'Pop', 'PREFERRED');
    await link(admin, matter, vendor);
    const viewer = await personas.create({
      label: 'vendor viewer',
      permissions: ['Matter.View', 'Client.View', 'Vendor.View'],
    });
    const page = await asUser(viewer.username);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto(`/matters/${matter.matterId}`);
      await rows(page).locator('[data-vendor-name]').click();
      const d = dialog(page);
      await expect(d.locator('[data-panel-title]')).toContainText(`Pop ${token}`);
      await expect(d.locator('[data-read-only]')).toContainText('Vendor.Manage');
      await expect(d.getByRole('tab', { name: /Matters/ })).toContainText('(1)');
      await d.getByRole('tab', { name: /Matters/ }).click();
      await expect(d.locator('[data-matter-name]')).toHaveText(`Acme v. Beta ${token}`);
      await axeClean(page, `Vendor pop-up from the Summary at ${size.width}`);
      await d.getByRole('button', { name: 'Close', exact: true }).last().click();
      await expect(dialog(page)).toHaveCount(0);
    }
  });

  test('permissions: Vendor.View only reads (Edit disabled, "Needs Vendor.Link" in the footer); Vendor.Link edits; no Vendor.View hides the panel', async ({
    asUser,
    personas,
    seed,
    admin,
  }) => {
    const matter = await matterOf(seed);
    await link(admin, matter, await vendorOf(admin, 'Perm'));
    const empty = await seed.matter({ client: await seed.client(), name: `Empty ${token}` });
    const base = ['Matter.View', 'Client.View'];
    const readOnly = await personas.create({
      label: 'vendor read',
      permissions: [...base, 'Vendor.View'],
    });
    const linker = await personas.create({
      label: 'vendor link',
      permissions: [...base, 'Vendor.View', 'Vendor.Link'],
    });
    const none = await personas.create({ label: 'vendor none', permissions: base });

    for (const size of SIZES) {
      const ro = await asUser(readOnly.username);
      await ro.setViewportSize(size);
      await ro.goto(`/matters/${matter.matterId}`);
      await expect(rows(ro)).toHaveCount(1);
      const edit = panel(ro).locator('[data-vendor-edit]');
      await expect(edit).toHaveAttribute('aria-disabled', 'true');
      await expect(panel(ro).locator('[data-vendor-reason]')).toHaveText(/Needs Vendor\.Link/);
      await edit.click({ force: true });
      await expect(dialog(ro)).toHaveCount(0);
      await shot(ro, 'summary-read-only');
      await axeClean(ro, `Summary with Vendor.View only at ${size.width}`);
      // Nothing linked: the empty line carries the reason instead of the button.
      await ro.goto(`/matters/${empty.matterId}`);
      await expect(panel(ro).locator('[data-vendor-engage]')).toHaveCount(0);
      await expect(panel(ro).locator('[data-vendor-reason]')).toHaveText(/Needs Vendor\.Link/);
      await axeClean(ro, `Empty Summary with Vendor.View only at ${size.width}`);

      const lk = await asUser(linker.username);
      await lk.setViewportSize(size);
      await lk.goto(`/matters/${matter.matterId}`);
      await expect(panel(lk).locator('[data-vendor-edit]')).not.toHaveAttribute(
        'aria-disabled',
        'true',
      );
      await expect(panel(lk).locator('[data-vendor-reason]')).toHaveCount(0);
      await axeClean(lk, `Summary with Vendor.Link at ${size.width}`);

      const nv = await asUser(none.username);
      await nv.setViewportSize(size);
      await nv.goto(`/matters/${matter.matterId}`);
      await expect(nv.locator('[data-section-panel="team"]')).toBeVisible();
      await expect(panel(nv)).toHaveCount(0);
      await expect(nv.locator('[data-summary-side]')).not.toContainText('Vendors');
      await axeClean(nv, `Summary without Vendor.View at ${size.width}`);
    }
  });

  test('a vendor list that answers 404 (a hidden matter) shows the panel error line and the rest of the Summary works', async ({
    page,
    seed,
    admin,
  }) => {
    // The sensitive-matter rule is off in the ordinary suite, so the 404 of a hidden matter is simulated; the real rule is covered by the Vendors integration tests.
    const matter = await matterOf(seed);
    await link(admin, matter, await vendorOf(admin, 'Hidden'));
    await page.route(`**/api/v1/matters/${matter.matterId}/vendors`, (route) =>
      route.fulfill({
        status: 404,
        contentType: 'application/problem+json',
        body: JSON.stringify({ status: 404, code: 'NOT_FOUND', title: 'Not found' }),
      }),
    );
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto(`/matters/${matter.matterId}`);
      await expect(page.locator('[data-vendors-error]')).toContainText(
        "Couldn't load the vendors.",
      );
      await expect(page.locator('[data-vendor-name]')).toHaveCount(0);
      await expect(page.locator('[data-section-panel="team"]')).toBeVisible();
      await expect(page.locator('[data-summary-details]')).toBeVisible();
      await axeClean(page, `Summary with a failed vendor list at ${size.width}`);
    }
  });

  test('Vendors panel screenshots', async ({ page, seed, admin }) => {
    test.skip(!process.env['E2E_SCREENSHOTS'], 'screenshots only with E2E_SCREENSHOTS');
    const none = await matterOf(seed);
    const one = await seed.matter({ client: await seed.client(), name: `One ${token}` });
    await link(admin, one, await vendorOf(admin, 'Only', 'NEUTRAL'));
    await vendorOf(admin, 'Risky', 'BLACKLISTED', { note: 'Missed two deadlines.' });
    const many = await seed.matter({ client: await seed.client(), name: `Many ${token}` });
    await fullTeam(admin, many);
    await link(admin, many, await vendorOf(admin, 'Zed Bad', 'BLACKLISTED', { note: 'x' }), true);
    for (const n of ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'])
      await link(admin, many, await vendorOf(admin, n));
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto(`/matters/${none.matterId}`);
      await expect(panel(page).locator('[data-panel-empty]')).toBeVisible();
      await shot(page, 'summary-none');
      await page.goto(`/matters/${one.matterId}`);
      await expect(rows(page)).toHaveCount(1);
      await shot(page, 'summary-one');
      await page.goto(`/matters/${many.matterId}`);
      await expect(panel(page).locator('[data-blacklisted-chip]')).toBeVisible();
      await shot(page, 'summary-many');
      await panel(page).locator('[data-panel-toggle]').click();
      await shot(page, 'summary-collapsed');
      await panel(page).locator('[data-panel-toggle]').click();
      await page.locator('[data-vendors-show-all]').click();
      await shot(page, 'show-all');
      await page.keyboard.press('Escape');
      // Edit Vendors on the one-vendor matter: the combobox open, then a Blacklisted vendor picked (reason and tick).
      await page.goto(`/matters/${one.matterId}`);
      await panel(page).locator('[data-vendor-edit]').click();
      await dialog(page).locator('#vendor-add').fill(`Risky ${token}`);
      await expect(page.locator('[role=option][data-vendor-id]').first()).toBeVisible();
      await shot(page, 'edit-vendors-combobox');
      await page.locator('[role=option][data-vendor-id]').first().click();
      await expect(dialog(page).locator('[data-blacklisted-reason]')).toContainText('Missed');
      await shot(page, 'edit-vendors-blacklisted');
      await page.keyboard.press('Escape');
      await dialog(page).getByRole('button', { name: 'Cancel' }).click();
      await page.getByRole('button', { name: 'Discard Changes' }).click();
    }
  });
});
