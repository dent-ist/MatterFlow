import { request } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { BASE_URL } from '../support/api';
import {
  GOOD_SVG,
  UNSAFE_SVG,
  makePng,
  putIcon,
  resetBranding,
  setBrandingName,
  tempFile,
} from '../support/branding';
import { expect, test } from '../support/fixtures';
import { failMe } from '../support/personas';
import { SIZES, noHorizontalScroll, shot } from '../support/screens';
import { toasts } from '../support/toasts';

/**
 * Epic #850 (BR-06): Administration > Settings > Branding end to end. The application name and icon are global, so this file runs in its own Playwright
 * project after the rest of the suite (see playwright.config.ts) and every test starts from, and leaves, the built-in branding.
 */
const SAVED = 'Saved. Other users see it the next time they load the page.';
const WIDEST_NAME = 'W'.repeat(40);

test.beforeEach(async ({ admin }) => resetBranding(admin));
test.afterAll(async ({ admin }) => resetBranding(admin));

const publicBranding = async (): Promise<{
  appName: string;
  iconUrl: string | null;
  iconKind: string | null;
}> => {
  const anonymous = await request.newContext({
    baseURL: BASE_URL,
    extraHTTPHeaders: { 'X-MatterFlow-Client': 'web' },
  });
  try {
    const response = await anonymous.get('/api/v1/branding');
    expect(response.status()).toBe(200);
    return response.json();
  } finally {
    await anonymous.dispose();
  }
};

test.describe('the administrator changes the name and the icon', () => {
  test('Save shows the new name and icon in this tab at once, and after a reload in the header, the title and the icon link', async ({
    page,
  }) => {
    await page.goto('/admin/settings');
    await expect(page).toHaveTitle('Settings: Branding - MatterFlow');
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Branding' })).toBeVisible();
    await expect(page.getByLabel('Application name (required)')).toHaveValue('MatterFlow');

    await page.getByLabel('Application name (required)').fill('Smith & Co Legal');
    await expect(page.locator('[data-preview-header]')).toHaveText('Smith & Co Legal');
    await expect(page.locator('[data-preview-tab]')).toContainText(
      'Matters: Overview - Smith & Co Legal',
    );
    await page.locator('[data-icon-input]').setInputFiles(tempFile('logo.png', makePng(128)));
    await expect(page.locator('[data-icon-file]')).toContainText('logo.png');
    await shot(page, 'settings-edited');

    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(toasts(page)).toContainText(SAVED);
    await expect(page.locator('.mf-logo [data-app-name]')).toHaveText('Smith & Co Legal');
    await expect(page).toHaveTitle('Settings: Branding - Smith & Co Legal');
    await expect(page.locator('[data-last-changed]')).toContainText('Last changed');

    await page.reload();
    await expect(page.locator('.mf-logo [data-app-name]')).toHaveText('Smith & Co Legal');
    await expect(page.locator('.mf-logo')).toHaveAttribute('aria-label', 'Smith & Co Legal home');
    await expect(page).toHaveTitle('Settings: Branding - Smith & Co Legal');
    const href = await page.locator('link[rel="icon"]').first().getAttribute('href');
    expect(href).toMatch(/^\/api\/v1\/branding\/icon\?v=[0-9a-f]{12}$/);
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', href!);
    await expect(page.locator('link[data-mf-icon]').first()).toHaveAttribute('data-mf-icon', href!);
    await expect
      .poll(() =>
        page.locator('.mf-logo img').evaluate((img: HTMLImageElement) => img.naturalWidth),
      )
      .toBe(128);
    await shot(page, 'settings-saved');

    // Anyone, signed in or not, gets the same name and the icon bytes.
    const view = await publicBranding();
    expect(view.appName).toBe('Smith & Co Legal');
    expect(view.iconKind).toBe('png');
    const icon = await page.request.get(href!);
    expect(icon.status()).toBe(200);
    expect(icon.headers()['content-type']).toBe('image/png');
  });

  test('an SVG icon is used as the tab icon without an apple-touch-icon', async ({ page }) => {
    await page.goto('/admin/settings');
    await page.locator('[data-icon-input]').setInputFiles(tempFile('mark.svg', GOOD_SVG));
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(toasts(page)).toContainText(SAVED);
    await page.reload();
    await expect(page.locator('link[rel="icon"]').first()).toHaveAttribute('type', 'image/svg+xml');
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(0);
    expect((await publicBranding()).iconKind).toBe('svg');
  });

  test('the 404, error and access-pending pages show the new name', async ({
    page,
    admin,
    asUser,
    personas,
  }) => {
    await setBrandingName(admin, 'Harbor Legal');

    await page.goto('/this/page/does/not/exist');
    await expect(page.locator('[data-state-brand]')).toHaveText('Harbor Legal');
    await expect(page.locator('[data-not-found-search]')).toHaveAttribute(
      'placeholder',
      'Search Harbor Legal',
    );

    const error = await asUser((await personas.named('technician')).username);
    await failMe(error);
    await error.goto('/');
    await expect(error.locator('[data-state-brand]')).toHaveText('Harbor Legal');
    await expect(error.locator('[data-state-reason]')).toContainText(
      'Harbor Legal could not load your account.',
    );

    const pending = await asUser((await personas.named('pending')).username);
    await pending.goto('/');
    await expect(pending.locator('.mf-brand')).toHaveText('Harbor Legal');
    await expect(pending.locator('main')).toContainText('before you can use Harbor Legal.');
  });

  test('Reset to default returns MatterFlow and the built-in icon, and nothing changes until Save', async ({
    page,
    admin,
  }) => {
    await setBrandingName(admin, 'Temporary Name');
    await page.goto('/admin/settings');
    await page.locator('[data-icon-input]').setInputFiles(tempFile('logo.png', makePng(64)));
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(toasts(page)).toContainText(SAVED);
    await expect(page.locator('.mf-logo [data-app-name]')).toHaveText('Temporary Name');

    await page.locator('[data-reset-name]').getByRole('button').click();
    await page.locator('[data-reset-icon]').getByRole('button').click();
    await expect(page.getByLabel('Application name (required)')).toHaveValue('MatterFlow');
    await expect(page.locator('[data-icon-file]')).toContainText('Built-in icon');
    // Not saved yet: everyone still sees the custom values.
    expect((await publicBranding()).appName).toBe('Temporary Name');

    await page.getByRole('button', { name: 'Save changes' }).click();
    // The "Saved" toast of the first save may still be on screen (identical toasts are folded), so wait for the server's state, not the toast.
    await expect
      .poll(async () => {
        const view = await publicBranding();
        return [view.appName, view.iconUrl];
      })
      .toEqual(['MatterFlow', null]);
    await page.reload();
    await expect(page.locator('.mf-logo [data-app-name]')).toHaveText('MatterFlow');
    await expect(page.locator('link[rel="icon"]').first()).toHaveAttribute('href', 'favicon.svg');
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
      'href',
      'apple-touch-icon.png',
    );
    await expect(page).toHaveTitle('Settings: Branding - MatterFlow');
  });
});

test.describe('refusals', () => {
  test('an unsafe SVG is refused with a message under the file field and nothing is stored', async ({
    page,
  }) => {
    await page.goto('/admin/settings');
    await page.locator('[data-icon-input]').setInputFiles(tempFile('evil.svg', UNSAFE_SVG));
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.locator('[data-icon-error]')).toContainText('This SVG cannot be used');
    await expect(page.locator('[data-summary]')).toBeVisible();
    await expect(toasts(page)).toHaveCount(0);
    expect((await publicBranding()).iconUrl).toBeNull();
  });

  test('a wrong type is refused by its content, whatever the file is called', async ({ page }) => {
    await page.goto('/admin/settings');
    await page
      .locator('[data-icon-input]')
      .setInputFiles(tempFile('logo.png', 'this is plain text, not a picture'));
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.locator('[data-icon-error]')).toContainText('Use a PNG, SVG or ICO file.');
    expect((await publicBranding()).iconUrl).toBeNull();
  });

  test('a 300 KB file is refused with the limit in the message, in the page and at the server', async ({
    page,
  }) => {
    await page.goto('/admin/settings');
    await page
      .locator('[data-icon-input]')
      .setInputFiles(tempFile('big.png', Buffer.alloc(300 * 1024, 1)));
    await expect(page.locator('[data-icon-error]')).toContainText(
      'The icon is larger than 256 KB.',
    );
    await expect(page.locator('[data-icon-file]')).toHaveText('Built-in icon.');

    const refused = await putIcon(tempFile('huge.png', Buffer.alloc(400 * 1024, 1)));
    expect(refused.status).toBe(413);
    expect(refused.body.code).toBe('BRANDING_ICON_TOO_LARGE');
    const justOver = await putIcon(
      tempFile('over.png', Buffer.concat([makePng(64), Buffer.alloc(262144)])),
    );
    expect(justOver.status).toBe(400);
    expect(justOver.body.code).toBe('BRANDING_ICON_TOO_LARGE');
    expect((await publicBranding()).iconUrl).toBeNull();
  });

  test('a name with markup is refused under the field', async ({ page }) => {
    await page.goto('/admin/settings');
    await page.getByLabel('Application name (required)').fill('<b>Bold</b>');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.locator('#st-name-error')).toContainText('cannot contain');
    await expect(page.getByLabel('Application name (required)')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect((await publicBranding()).appName).toBe('MatterFlow');
  });

  test('a 40 character limit stops the typing', async ({ page }) => {
    await page.goto('/admin/settings');
    await page.getByLabel('Application name (required)').fill('x'.repeat(60));
    await expect(page.getByLabel('Application name (required)')).toHaveValue('x'.repeat(40));
    await expect(page.locator('#st-name-count')).toHaveText('40 / 40');
  });
});

test.describe('who can see it', () => {
  test('a person without Settings.Manage has no menu item and gets the 403 page', async ({
    personas,
    asUser,
  }) => {
    const technician = await asUser((await personas.named('technician')).username);
    await technician.goto('/');
    await expect(technician.locator('nav').getByRole('link', { name: 'Settings' })).toHaveCount(0);
    await technician.goto('/admin/settings');
    // The 403 page keeps the address that was asked for (#598), so the address stays /admin/settings.
    await expect(technician.getByRole('heading', { level: 1 })).toContainText(
      "You don't have permission",
    );
  });

  test('a role with only Settings.Manage sees the menu item and the page', async ({
    personas,
    asUser,
  }) => {
    const holder = await asUser(
      (await personas.create({ label: 'settings', permissions: ['Settings.Manage'] })).username,
    );
    await holder.goto('/admin/settings');
    await expect(holder.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    await expect(holder.locator('nav').getByRole('link', { name: 'Settings' })).toBeVisible();
  });
});

test.describe('keyboard', () => {
  test('the file picker is a button: Tab reaches it and Enter opens the chooser', async ({
    page,
  }) => {
    await page.goto('/admin/settings');
    const choose = page.getByRole('button', { name: 'Choose file...' });
    await choose.focus();
    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press('Enter');
    expect((await chooser).isMultiple()).toBe(false);
  });

  test('the form can be completed with the keyboard alone', async ({ page }) => {
    await page.goto('/admin/settings');
    await page.getByLabel('Application name (required)').focus();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Keyboard Firm');
    await page.getByRole('button', { name: 'Save changes' }).focus();
    await page.keyboard.press('Enter');
    await expect(toasts(page)).toContainText(SAVED);
    expect((await publicBranding()).appName).toBe('Keyboard Firm');
  });
});

test.describe('accessibility and reflow', () => {
  test.setTimeout(240_000);

  test('the settings page is clean in axe and does not scroll sideways at the four sizes, also with errors, a chosen file and the longest name', async ({
    page,
    admin,
  }) => {
    expect(axeAvailable(), 'axe-core is required: set E2E_AXE_PATH to the path of axe.min.js').toBe(
      true,
    );
    await setBrandingName(admin, WIDEST_NAME);
    const check = async (what: string, width: number): Promise<void> => {
      expect(await axeViolations(page), `${what} at ${width}`).toEqual([]);
      await noHorizontalScroll(page);
    };
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto('/admin/settings');
      await expect(page.getByLabel('Application name (required)')).toHaveValue(WIDEST_NAME);
      await check('settings', size.width);

      await page.locator('[data-icon-input]').setInputFiles(tempFile('mark.svg', GOOD_SVG));
      await expect(page.locator('[data-icon-file]')).toContainText('mark.svg');
      await check('settings with a chosen file', size.width);

      await page.locator('[data-icon-input]').setInputFiles(tempFile('evil.svg', UNSAFE_SVG));
      await page.getByRole('button', { name: 'Save changes' }).click();
      await expect(page.locator('[data-icon-error]')).toBeVisible();
      await check('settings with errors', size.width);
      await shot(page, 'settings-errors');
    }
  });

  test('a 40 character name never widens the shell: header, a list page and the settings page at 320 and the four sizes', async ({
    page,
    admin,
  }) => {
    expect(axeAvailable()).toBe(true);
    await setBrandingName(admin, WIDEST_NAME);
    const offenders: string[] = [];
    for (const size of [{ width: 320, height: 640 }, ...SIZES]) {
      await page.setViewportSize(size);
      for (const url of ['/', '/clients', '/admin/settings', '/no/such/page']) {
        await page.goto(url);
        await expect(page.locator('.mf-logo [data-app-name]').first()).toBeVisible();
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        if (overflow > 0)
          offenders.push(`${url} at ${size.width}: page scrolls sideways by ${overflow}px`);
        const box = (await page.locator('.mf-logo').boundingBox())!;
        if (box.x + box.width > size.width + 0.5)
          offenders.push(`${url} at ${size.width}: the logo ends at ${box.x + box.width}`);
        // The text is whole in the page; only its drawing is cut with an ellipsis.
        expect(await page.locator('.mf-logo [data-app-name]').textContent()).toBe(WIDEST_NAME);
      }
      await page.goto('/');
      if (size.width >= 375)
        expect(await axeViolations(page), `shell at ${size.width}`).toEqual([]);
      if (size.width === 1366 || size.width === 375) await shot(page, 'shell-long-name');
    }
    expect(offenders).toEqual([]);
  });

  test('the longest name also fits the Access Pending and error pages at 320 and 375', async ({
    admin,
    asUser,
    personas,
  }) => {
    await setBrandingName(admin, WIDEST_NAME);
    const username = (await personas.named('pending')).username;
    const technician = (await personas.named('technician')).username;
    for (const width of [320, 375]) {
      const pending = await asUser(username);
      await pending.setViewportSize({ width, height: 700 });
      await pending.goto('/');
      await expect(pending.locator('.mf-brand')).toHaveText(WIDEST_NAME);
      await noHorizontalScroll(pending);

      const error = await asUser(technician);
      await failMe(error);
      await error.setViewportSize({ width, height: 700 });
      await error.goto('/');
      await expect(error.locator('[data-state-brand]')).toHaveText(WIDEST_NAME);
      await noHorizontalScroll(error);
    }
  });

  test('the document title keeps the rule: page, tab, name', async ({ page, admin }) => {
    await setBrandingName(admin, 'Rule Check');
    await page.goto('/admin/settings');
    await expect(page).toHaveTitle('Settings: Branding - Rule Check');
    await page.goto('/clients');
    await expect(page).toHaveTitle('Clients - Rule Check');
  });
});
