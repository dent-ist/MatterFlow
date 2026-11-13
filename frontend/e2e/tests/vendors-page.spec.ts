import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { SIZES, noSideScroll } from '../support/labels';
import { uid } from '../support/seed';

/**
 * Epic #1373 / #1378: the Vendors page in the main menu (grid, search by name, website and service, Category, Service and Area filters, New Vendor, row menu), the vendor pop-up
 * (tabs Overview, Contacts and Matters, view first, edit in place, contacts with notes inline, delete with the linked-matters block) and the Services and Areas lists of
 * Administration > Lists. Permission variants: Vendor.Manage = everything, Vendor.View only = read only, no Vendor.View = no menu item and the 403 page.
 * Needs the API with the Vendors backend (#1377) and the Dev auth admin (a System Admin holds every permission).
 */
const search = (page: Page) => page.locator('[data-list-search] input');
const rowOf = (page: Page, name: string) =>
  page.locator('tbody tr', { has: page.locator('[data-vendor-name]', { hasText: name }) });
const dialog = (page: Page) => page.locator('.mf-formdlg');
const tab = (page: Page, name: string) =>
  dialog(page).getByRole('tab', { name: new RegExp(`^${name}`) });

/** Screenshots for the design evidence (E2E_SCREENSHOTS=<folder>); nothing is written without it. */
async function shot(page: Page, name: string) {
  const dir = process.env['E2E_SCREENSHOTS'];
  if (dir)
    await page.screenshot({
      path: `${dir}/vendors-${name}-${page.viewportSize()!.width}x${page.viewportSize()!.height}.png`,
    });
}

async function axeClean(page: Page, label: string) {
  if (axeAvailable()) expect(await axeViolations(page), label).toEqual([]);
}

/** The dialog is 768 px wide and 640 px high, or 90% of the window when that is less (D-31a). */
async function expectTabbedSize(page: Page, label: string) {
  const box = (await dialog(page).boundingBox())!;
  const vh = page.viewportSize()!.height;
  expect(box.width, `${label} width`).toBeCloseTo(768, 0);
  expect(box.height, `${label} height`).toBeCloseTo(Math.min(640, vh * 0.9), 0);
}

test.describe('Vendors page (#1378)', () => {
  test('Manage: menu item after People, New Vendor, search, pop-up tabs, edit in place, contact note, delete', async ({
    page,
    admin,
  }) => {
    const token = uid().slice(0, 8);
    const name = `Vend${token} Legal`;
    const service = `Svc${token}`;
    const area = `Area${token}`;
    const svc = await admin.post('/api/v1/vendor-services', { name: service, isActive: true });
    const are = await admin.post('/api/v1/vendor-areas', { name: area, isActive: true });
    const person = await admin.post('/api/v1/people', {
      firstName: `Con${token}`,
      lastName: 'Tact',
      personType: 'EXTERNAL',
      title: 'Account Manager',
      email: `con${token}@vendor.example`,
    });

    await page.setViewportSize(SIZES[0]);
    await page.goto('/clients');
    await expect(page.getByRole('heading', { level: 1, name: 'Clients' })).toBeVisible();
    const items = page.locator('[data-nav-group="main"] a');
    const labels = await items.allInnerTexts();
    const at = labels.map((l) => l.trim()).indexOf('Vendors');
    expect(at, 'Vendors is in the main menu').toBeGreaterThan(-1);
    expect(labels.map((l) => l.trim())[at - 1]).toBe('People');
    await items.filter({ hasText: 'Vendors' }).first().click();
    await expect(page).toHaveURL(/\/vendors/);
    await expect(page.getByRole('heading', { level: 1, name: 'Vendors' })).toBeVisible();
    await expect(page.locator('mf-page-header')).toContainText('name, website or service');
    await axeClean(page, 'Vendors page');

    // New Vendor: the form in its own dialog, no tabs; the name is required.
    await page.locator('[data-new-vendor] button, button[data-new-vendor]').first().click();
    await expect(dialog(page).locator('[data-panel-title]')).toContainText('New Vendor');
    await expect(dialog(page).getByRole('tab')).toHaveCount(0);
    await dialog(page).getByRole('button', { name: 'Create Vendor' }).click();
    await expect(dialog(page)).toContainText('Enter the vendor name.');
    await dialog(page).locator('#vendor-name').fill(name);
    await dialog(page).locator('#vendor-website').fill(`vend${token}.example`);
    await dialog(page).locator('[data-category="PREFERRED"]').click();
    await dialog(page).locator('#vendor-services').click();
    await page.getByRole('option', { name: service }).click();
    await page.keyboard.press('Escape');
    await dialog(page).locator('#vendor-areas').click();
    await page.getByRole('option', { name: area }).click();
    await page.keyboard.press('Escape');
    await dialog(page).locator('#vendor-ai-new').fill('Relativity aiR');
    await dialog(page).locator('[data-add-tech-ai]').click();
    await dialog(page).locator('#vendor-note').fill('E2E vendor.');
    await shot(page, 'new-vendor');
    await dialog(page).getByRole('button', { name: 'Create Vendor' }).click();
    await expect(page.getByText('Vendor created')).toBeVisible();

    // Search by name, by website and by service finds it; the row is one line.
    for (const text of [`Vend${token}`, `vend${token}.example`, service]) {
      await search(page).fill(text);
      await expect(rowOf(page, name)).toHaveCount(1);
    }
    const row = rowOf(page, name);
    await expect(row.locator('[data-vendor-category]')).toContainText('Preferred');
    await expect(row.locator('[data-vendor-services]')).toHaveText(service);
    await expect(row.locator('[data-vendor-areas]')).toHaveText(area);

    // The pop-up: view first, three tabs, the facts.
    await row.locator('[data-vendor-name]').click();
    const d = dialog(page);
    await expect(d.locator('[data-panel-title]')).toContainText(name);
    await expect(d.locator('[data-panel-title]')).toContainText('Preferred');
    await expect(d.getByRole('tab')).toHaveText([/Overview/, /Contacts \(0\)/, /Matters \(0\)/]);
    await expect(d.locator('[data-vendor-facts]')).toContainText('Relativity aiR');
    await expect(d.locator('[data-vendor-facts]')).toContainText('E2E vendor.');
    await expectTabbedSize(page, 'view');
    await expect(d.getByRole('button', { name: 'Delete Vendor' })).toBeVisible();
    await expect(d.getByRole('button', { name: 'Edit Vendor' })).toBeVisible();
    await axeClean(page, 'Vendor pop-up Overview');
    await shot(page, 'popup-overview');

    // Edit in place: the other tabs wait, Cancel asks when something was typed.
    await d.getByRole('button', { name: 'Edit Vendor' }).click();
    await expect(d.locator('[data-panel-title]')).toContainText('Edit Vendor');
    await expect(tab(page, 'Contacts')).toHaveAttribute('aria-disabled', 'true');
    await expectTabbedSize(page, 'edit');
    await d.locator('#vendor-note').fill('E2E vendor, edited.');
    await axeClean(page, 'Vendor pop-up edit');
    await shot(page, 'popup-edit');
    await d.getByRole('button', { name: 'Cancel' }).click();
    await expect(d.locator('[data-discard-ask]')).toContainText('You have unsaved changes.');
    await d.locator('[data-guard-keep] button, button[data-guard-keep]').click();
    await d.getByRole('button', { name: 'Save Changes' }).click();
    await expect(page.getByText('Vendor updated')).toBeVisible();
    await expect(d.locator('[data-fact-note]')).toContainText('edited');

    // Contacts: add the person, then a Do Not Hire note inline (no second dialog).
    await tab(page, 'Contacts').click();
    await expect(d.locator('[data-contacts-empty]')).toBeVisible();
    await d.locator('[data-add-contact] button, button[data-add-contact]').click();
    await d.locator('#vendor-contact-person').fill(`Con${token}`);
    await page.getByRole('option', { name: new RegExp(`Con${token} Tact`) }).click();
    await d.getByRole('button', { name: 'Add Contact' }).last().click();
    await expect(page.getByText('Contact added')).toBeVisible();
    const contact = d.locator('[data-contact]', { hasText: `Con${token} Tact` });
    await expect(contact).toHaveCount(1);
    await expect(contact.locator('[data-contact-flag="NONE"]')).toBeVisible();
    await contact.locator('[data-edit-note]').click();
    await expect(page.locator('.mf-formdlg')).toHaveCount(1);
    await contact.locator('[data-flag="DO_NOT_HIRE"]').click();
    await contact.locator('#note-text').fill('Missed two deadlines.');
    await axeClean(page, 'Contact note form');
    await shot(page, 'popup-contact-note');
    await contact.locator('[data-note-save] button, button[data-note-save]').click();
    await expect(page.getByText('Note saved')).toBeVisible();
    await expect(contact.locator('[data-contact-note]')).toContainText('Missed two deadlines.');
    await expect(contact.locator('[data-contact-note]')).toContainText('Reported');
    await shot(page, 'popup-contacts');
    await d.getByRole('button', { name: 'Close' }).first().click();
    await expect(d).toHaveCount(0);
    // The list shows the contact count and the Do Not Hire flag.
    await expect(row.locator('[data-vendor-contacts]')).toContainText('1');
    await expect(row.locator('[data-do-not-hire]')).toBeVisible();

    // Delete from the pop-up: the question in the footer, then it is gone.
    await row.locator('[data-vendor-name]').click();
    await d.getByRole('button', { name: 'Delete Vendor' }).click();
    await expect(d.locator('[data-delete-ask]')).toContainText(`Delete ${name}?`);
    await shot(page, 'popup-delete');
    await d.getByRole('button', { name: 'Keep Vendor' }).click();
    await expect(d.locator('[data-delete-ask]')).toHaveCount(0);
    await d.getByRole('button', { name: 'Delete Vendor' }).click();
    await d.locator('[data-delete-confirm] button, button[data-delete-confirm]').click();
    await expect(page.getByText('Vendor deleted')).toBeVisible();
    await expect(rowOf(page, name)).toHaveCount(0);
    void svc;
    void are;
    void person;
  });

  test('a vendor linked to a matter lists it on the Matters tab and cannot be deleted: the block names the count', async ({
    page,
    admin,
    seed,
  }) => {
    const token = uid().slice(0, 8);
    const name = `Linked${token} Vendors`;
    const vendor = await admin.post('/api/v1/vendors', { name, category: 'PREFERRED' });
    const client = await seed.client({ name: `Client ${token}` });
    const matter = await seed.matter({ client, name: `Matter ${token}` });
    await admin.post(`/api/v1/matters/${matter.matterId}/vendors`, { vendorId: vendor.vendorId });

    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto(`/vendors?q=${token}`);
      const row = rowOf(page, name);
      await expect(row.locator('[data-vendor-matters]')).toHaveText('1');
      await row.locator('[data-vendor-name]').click();
      const d = dialog(page);
      await expect(tab(page, 'Matters')).toContainText('(1)');
      await tab(page, 'Matters').click();
      await expect(d.locator('[data-matter-ref]')).toContainText(matter.matterNumber ?? '');
      await expect(d.locator('[data-matter-name]')).toHaveText(`Matter ${token}`);
      // The grid has the room for its rows inside the dialog (not collapsed to its heading): 40 px heading and the 44 px row (84 px for one matter).
      const frame = (await d.locator('.mf-scroll').boundingBox())!;
      expect(frame.height, `matters grid height at ${size.width}`).toBeGreaterThan(80);
      // All five columns fit the 734 px of the tab: no sideways scroll inside the grid.
      const side = await d.locator('.mf-scroll').evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(side, `matters grid sideways scroll at ${size.width}`).toBeLessThanOrEqual(0);
      const rowBox = (await d.locator('tbody tr').first().boundingBox())!;
      expect(rowBox.height, `matters row height at ${size.width}`).toBeCloseTo(44, -1);
      await expectTabbedSize(page, `matters tab at ${size.width}`);
      await axeClean(page, `Vendor pop-up Matters at ${size.width}`);
      await shot(page, 'popup-matters');
      await d.getByRole('button', { name: 'Delete Vendor' }).click();
      await expect(d.locator('[data-delete-blocked]')).toContainText('linked to 1 matter');
      await expect(d.getByRole('button', { name: 'Delete Vendor' })).toHaveCount(0);
      await shot(page, 'popup-delete-blocked');
      await d.getByRole('button', { name: 'Keep Vendor' }).click();
      await expect(d.locator('[data-delete-blocked]')).toHaveCount(0);
      await d.getByRole('button', { name: 'Close', exact: true }).click();
      // The row menu says why Delete is not offered.
      await row.getByRole('button', { name: /^Actions for/ }).click();
      await expect(page.getByRole('menuitem', { name: /Delete Vendor/ })).toHaveAttribute(
        'aria-disabled',
        'true',
      );
      await page.keyboard.press('Escape');
    }
    await admin.delete(`/api/v1/matters/${matter.matterId}/vendors/${vendor.vendorId}`);
    await admin.delete(`/api/v1/vendors/${vendor.vendorId}`);
  });

  test('filters (Category, Service, Area), sort, the empty state and no sideways scroll, at both sizes with axe', async ({
    page,
    admin,
  }) => {
    const token = uid().slice(0, 8);
    const svc = await admin.post('/api/v1/vendor-services', { name: `Fs${token}`, isActive: true });
    const are = await admin.post('/api/v1/vendor-areas', { name: `Fa${token}`, isActive: true });
    await admin.post('/api/v1/vendors', {
      name: `Alpha${token}`,
      category: 'PREFERRED',
      serviceIds: [svc.id],
      areaIds: [are.id],
    });
    await admin.post('/api/v1/vendors', { name: `Beta${token}`, category: 'BLACKLISTED' });
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto(`/vendors?q=${token}`);
      await expect(page.locator('[data-vendor-name]')).toHaveText([
        `Alpha${token}`,
        `Beta${token}`,
      ]);
      await axeClean(page, `Vendors page at ${size.width}`);
      await shot(page, 'list');
      const overflow = await page.evaluate(() => {
        const area = document.querySelector('.mf-scroll-area') as HTMLElement | null;
        return area ? area.scrollWidth - area.clientWidth : -1;
      });
      expect(overflow, `grid scroll at ${size.width}`).toBeLessThanOrEqual(0);
      await noSideScroll(page, `Vendors page at ${size.width}`);
      await page.goto(`/vendors?q=${token}&category=BLACKLISTED`);
      await expect(page.locator('[data-vendor-name]')).toHaveText([`Beta${token}`]);
      await expect(page.locator('[data-vendor-category]')).toContainText('Blacklisted');
      await page.goto(`/vendors?q=${token}&serviceId=${svc.id}`);
      await expect(page.locator('[data-vendor-name]')).toHaveText([`Alpha${token}`]);
      await page.goto(`/vendors?q=${token}&areaId=${are.id}&serviceId=${svc.id}`);
      await expect(page.locator('[data-vendor-name]')).toHaveText([`Alpha${token}`]);
      await page.goto(`/vendors?q=${token}&sort=-name`);
      await expect(page.locator('[data-vendor-name]')).toHaveText([
        `Beta${token}`,
        `Alpha${token}`,
      ]);
      await page.goto(`/vendors?q=${token}-nobody`);
      await expect(page.locator('[data-state-block]')).toContainText(
        'No vendors match these filters.',
      );
      await axeClean(page, `Vendors empty search at ${size.width}`);
      await shot(page, 'empty');
    }
  });

  test('the pop-up at both desktop sizes: 768 px wide, fixed height, every tab with axe, a Blacklisted warning', async ({
    page,
    admin,
  }) => {
    const token = uid().slice(0, 8);
    const name = `Black${token} Group`;
    await admin.post('/api/v1/vendors', {
      name,
      category: 'BLACKLISTED',
      note: 'Do not use.',
      techAi: ['Some AI'],
    });
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto(`/vendors?q=${token}`);
      await rowOf(page, name).locator('[data-vendor-name]').click();
      const d = dialog(page);
      await expect(d.locator('[data-blacklisted-banner]')).toContainText('Blacklisted.');
      await expect(d.locator('[data-panel-title]')).toContainText('Blacklisted');
      await expectTabbedSize(page, `Overview at ${size.width}`);
      await axeClean(page, `Overview at ${size.width}`);
      const heights: number[] = [];
      for (const t of ['Overview', 'Contacts', 'Matters']) {
        await tab(page, t).click();
        heights.push((await d.boundingBox())!.height);
        await axeClean(page, `${t} tab at ${size.width}`);
        await shot(page, `popup-${t.toLowerCase()}`);
      }
      // A tab change never makes the dialog jump (D-31a).
      expect(new Set(heights.map((h) => Math.round(h))).size).toBe(1);
      await page.keyboard.press('Escape');
      await expect(d).toHaveCount(0);
    }
  });

  test('Vendor.View only: no New Vendor, no row menu, the pop-up is read only and says why', async ({
    asUser,
    personas,
    admin,
  }) => {
    const token = uid().slice(0, 8);
    const name = `Read${token} Only`;
    await admin.post('/api/v1/vendors', { name, category: 'PREFERRED', note: 'Look only.' });
    const viewer = await personas.create({
      label: 'vendor-view',
      permissions: ['Vendor.View', 'Matter.View'],
    });
    const page = await asUser(viewer.username);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto(`/vendors?q=${token}`);
      await expect(page.locator('[data-vendor-name]')).toHaveText([name]);
      await expect(page.locator('[data-new-vendor]')).toHaveCount(0);
      await expect(page.locator('[data-row-actions]')).toHaveCount(0);
      await axeClean(page, `Vendors read only at ${size.width}`);
      await page.locator('[data-vendor-name]').click();
      const d = dialog(page);
      await expect(d.locator('[data-fact-note]')).toContainText('Look only.');
      await expect(d.getByRole('button', { name: 'Edit Vendor' })).toHaveCount(0);
      await expect(d.getByRole('button', { name: 'Delete Vendor' })).toHaveCount(0);
      await expect(d.locator('[data-read-only]')).toContainText('Vendor.Manage');
      await expect(d.getByRole('button', { name: 'Close' }).first()).toBeVisible();
      await tab(page, 'Contacts').click();
      await expect(d.locator('[data-add-contact]')).toHaveCount(0);
      await expect(d.locator('[data-contacts-readonly]')).toBeVisible();
      await axeClean(page, `Vendor pop-up read only at ${size.width}`);
      await shot(page, 'popup-readonly');
      await page.keyboard.press('Escape');
      await expect(d).toHaveCount(0);
    }
  });

  test('no Vendor.View: no menu item and the 403 page for /vendors', async ({
    asUser,
    personas,
  }) => {
    const other = await personas.create({ label: 'vendor-none', permissions: ['Client.View'] });
    const page = await asUser(other.username);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto('/clients');
      await expect(
        page.locator('[data-nav-group="main"]').getByRole('link', { name: 'Clients', exact: true }),
      ).toBeVisible();
      await expect(
        page.locator('[data-nav-group="main"]').getByRole('link', { name: 'Vendors', exact: true }),
      ).toHaveCount(0);
      await page.goto('/vendors');
      await expect(page.getByRole('heading', { name: "You don't have access." })).toBeVisible();
      await expect(page.locator('[data-vendor-name]')).toHaveCount(0);
      await axeClean(page, `Vendors 403 at ${size.width}`);
    }
  });
});

test.describe('Services and Areas on Administration > Lists (#1378)', () => {
  test('Vendor.Manage maintains Vendor Services and Vendor Areas: add, rename, deactivate, delete; In Use links to the Vendors list', async ({
    asUser,
    personas,
    admin,
  }) => {
    const token = uid().slice(0, 8);
    const manager = await personas.create({
      label: 'vendor-lists',
      permissions: ['Vendor.View', 'Vendor.Manage'],
    });
    const page = await asUser(manager.username);
    const used = await admin.post('/api/v1/vendor-services', {
      name: `Used${token}`,
      isActive: true,
    });
    await admin.post('/api/v1/vendors', {
      name: `UsesService${token}`,
      category: 'PREFERRED',
      serviceIds: [used.id],
    });
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto('/admin/lists/vendor-services');
      await expect(page.getByRole('heading', { level: 2 })).toHaveText('Vendor Services');
      await expect(page).toHaveTitle('Lists: Vendor Services - LPT Hub');
      // A person who manages only the two Vendor lists sees a catalogue of two, in the group Vendors.
      await expect(page.getByRole('listbox', { name: 'Lists' }).getByRole('option')).toHaveText([
        /Vendor Services/,
        /Vendor Areas/,
      ]);
      await expect(page.locator('[data-shown-on]')).toContainText('Vendors list');
      await axeClean(page, `Vendor Services at ${size.width}`);
      await shot(page, 'admin-services');
      await page.getByRole('option', { name: /^Vendor Areas/ }).click();
      await expect(page.getByRole('heading', { level: 2 })).toHaveText('Vendor Areas');
      await axeClean(page, `Vendor Areas at ${size.width}`);
      await shot(page, 'admin-areas');
    }

    await page.goto('/admin/lists/vendor-services');
    await expect(page.locator('[data-list-body] tbody tr').first()).toBeVisible();
    const name = `Svc${token}`;
    await page
      .locator('mf-list-editor')
      .getByRole('button', { name: 'New Service' })
      .first()
      .click();
    await page.locator('#matter-list-name').fill(name);
    await page.getByRole('button', { name: 'Add Service' }).click();
    const row = page.locator(`[data-list-body] tbody tr[data-row="${name}"]`);
    await expect(row).toHaveCount(1);
    // Rename, Deactivate (asks), Activate, Delete (a service nothing uses).
    await row.getByRole('button', { name: /^Actions for/ }).click();
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    await page.locator('#matter-list-name').fill(`${name} B`);
    await page.getByRole('button', { name: 'Save Name' }).click();
    const renamed = page.locator(`[data-list-body] tbody tr[data-row="${name} B"]`);
    await expect(renamed).toHaveCount(1);
    await renamed.getByRole('button', { name: /^Actions for/ }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Delete Service' }).click();
    await expect(renamed).toHaveCount(0);

    // A used service shows how many vendors use it, as a link to the Vendors list filtered by it; it cannot be deleted.
    const usedRow = page.locator(`[data-list-body] tbody tr[data-row="Used${token}"]`);
    await expect(usedRow.locator('[data-in-use] a')).toHaveText('1');
    await expect(usedRow.locator('[data-in-use] a')).toHaveAttribute(
      'href',
      new RegExp(`/vendors\\?serviceId=${used.id}$`),
    );
    await usedRow.getByRole('button', { name: /^Actions for/ }).click();
    await expect(page.getByRole('menuitem', { name: 'Delete' })).toHaveCount(0);
  });

  test('the System Admin sees eleven lists in five groups, Vendors last', async ({ page }) => {
    await page.setViewportSize(SIZES[0]);
    await page.goto('/admin/lists/vendor-areas');
    const options = page.getByRole('listbox', { name: 'Lists' }).getByRole('option');
    await expect(options).toHaveCount(11);
    await expect(options.nth(9)).toContainText('Vendor Services');
    await expect(options.nth(10)).toContainText('Vendor Areas');
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('Vendor Areas');
  });
});
