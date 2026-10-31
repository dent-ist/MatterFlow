import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { noHorizontalScroll, shot, SIZES } from '../support/screens';

/**
 * S5 (#620), S6 (#621), S2 / S22 (#626): the rail says "Asset types" for the administrator's page next to "Assets" for the records, the
 * main items are one list in one order with Projects and Assets indented under Matters (MM-59, a small gap in the 56 px rail), and the header carries the MatterFlow mark, which is also the favicon.
 */
const nav = (page: Page) => page.getByRole('navigation', { name: 'Main' });

async function openMenuIfPhone(page: Page): Promise<void> {
  if ((page.viewportSize()?.width ?? 1000) < 640) {
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await expect(nav(page)).toBeVisible();
  }
}

test.describe('The menu: order, indent and names (#620, #621, MM-59)', () => {
  test.setTimeout(300_000);

  test('one main list in one order, Projects and Assets indented under Matters, for a System Admin, at every width; "Asset types" differs from "Assets"', async ({
    page,
  }) => {
    expect(axeAvailable(), 'set E2E_AXE_PATH to axe.min.js').toBe(true);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto('/dashboard');
      await openMenuIfPhone(page);
      const main = nav(page).getByRole('list', { name: 'Main menu' });
      await expect(main.getByRole('link')).toHaveText([
        /Dashboard/,
        /My Matters/,
        /My Work/,
        /Clients/,
        /^Matters$/,
        /Projects/,
        /^Assets$/,
        /Pod Work/,
        /Task Queue/,
      ]);
      await expect(nav(page).getByRole('button', { name: 'More' })).toHaveCount(0);
      // Projects and Assets are children of Matters: indented in the panel and the phone Menu, a small gap instead in the 56 px rail.
      const left = async (name: string): Promise<number> =>
        (await main.getByRole('link', { name, exact: true }).boundingBox())!.x +
        parseFloat(
          await main
            .getByRole('link', { name, exact: true })
            .evaluate((a) => getComputedStyle(a).paddingLeft),
        );
      const rail = size.width >= 640 && size.width < 1100;
      if (rail) {
        const y = async (n: string): Promise<number> =>
          (await main.getByRole('link', { name: n, exact: true }).boundingBox())!.y;
        expect(
          (await y('Projects')) - (await y('Matters')),
          'gap above the children',
        ).toBeGreaterThanOrEqual(40); // the UI update menu rows are 36 px with a gap (tokens, UI-06)
      } else {
        expect(await left('Projects'), 'Projects is indented').toBeGreaterThan(
          (await left('Matters')) + 16,
        );
        expect(await left('Assets')).toBe(await left('Projects'));
      }
      const admin = nav(page).getByRole('list', { name: 'Administration' });
      await expect(admin.getByRole('link', { name: 'Asset types' })).toHaveAttribute(
        'href',
        '/admin/asset-types',
      );
      await expect(admin.getByRole('link', { name: 'Asset types' })).toHaveAttribute(
        'data-tip',
        'Asset types',
      );
      await expect(main.getByRole('link', { name: 'Assets', exact: true })).toHaveAttribute(
        'href',
        '/assets',
      );
      await expect(nav(page).getByRole('link', { name: 'Assets', exact: true })).toHaveCount(1);
      await expect(nav(page).getByRole('link', { name: 'Asset types', exact: true })).toHaveCount(
        1,
      );

      await shot(page, 'rail-groups');
      expect(await axeViolations(page), `rail groups at ${size.width}`).toEqual([]);
      await noHorizontalScroll(page);
    }
  });

  test('permission variants: the main list is drawn only when the person has items in it, and its heading is for screen readers only', async ({
    personas,
    asUser,
  }) => {
    const cases = [
      { who: 'technician' as const, main: true },
      { who: 'director' as const, main: true },
      { who: 'clientViewOnly' as const, main: true },
      { who: 'taskViewOnly' as const, main: true },
      { who: 'configurationAdmin' as const, main: false },
    ];
    for (const c of cases) {
      const person = await personas.named(c.who);
      const page = await asUser(person.username);
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto('/');
      await expect(nav(page)).toBeVisible();
      await expect(nav(page).getByRole('list', { name: 'Main menu' }), c.who).toHaveCount(
        c.main ? 1 : 0,
      );
      await expect(nav(page).locator('[data-nav-group] .mf-nav-heading')).toHaveCount(
        c.main ? 1 : 0,
      );
      await expect(nav(page).getByRole('button', { name: 'More' }), c.who).toHaveCount(0);
    }
    // A person with an Asset Types page but no Assets records sees "Asset types" and no "Assets".
    const config = await personas.named('configurationAdmin');
    const page = await asUser(config.username);
    await page.goto('/');
    await expect(nav(page).getByRole('link', { name: 'Asset types', exact: true })).toHaveCount(1);
    await expect(nav(page).getByRole('link', { name: 'Assets', exact: true })).toHaveCount(0);
  });

  test('keyboard: Tab follows the visual order (Clients, Matters, Projects, Assets, Pod Work), and Enter on "Asset types" opens it', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/clients');
    await nav(page).getByRole('link', { name: 'Clients' }).focus();
    await page.keyboard.press('Tab');
    await expect(nav(page).getByRole('link', { name: 'Matters', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(nav(page).getByRole('link', { name: 'Projects', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(nav(page).getByRole('link', { name: 'Assets', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(nav(page).getByRole('link', { name: 'Pod Work', exact: true })).toBeFocused();
    await nav(page).getByRole('link', { name: 'Asset types', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/admin\/asset-types/);
  });
});

test.describe('The MatterFlow mark (#626)', () => {
  test.setTimeout(120_000);

  test('the header shows the mark beside the name and the favicon files are the mark', async ({
    page,
    request,
  }) => {
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto('/dashboard');
      const logo = page.getByRole('link', { name: 'MatterFlow home' });
      await expect(logo).toBeVisible();
      await expect(logo.locator('img.mf-logo__mark')).toBeVisible();
      await expect(logo).toContainText('MatterFlow');
      const imgOk = await logo
        .locator('img')
        .evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0);
      expect(imgOk).toBe(true);
      await shot(page, 'logo-mark');
    }
    const hrefs = await page
      .locator('link[rel~="icon"], link[rel="apple-touch-icon"]')
      .evaluateAll((els) => els.map((e) => (e as HTMLLinkElement).getAttribute('href')));
    expect(hrefs).toEqual(
      expect.arrayContaining([
        'favicon.svg',
        'favicon-32.png',
        'favicon.ico',
        'apple-touch-icon.png',
      ]),
    );
    const types: Record<string, string> = {
      'favicon.svg': 'image/svg+xml',
      'favicon-32.png': 'image/png',
      'favicon.ico': 'image/',
      'apple-touch-icon.png': 'image/png',
    };
    for (const [file, type] of Object.entries(types)) {
      const res = await request.get(`/${file}`);
      expect(res.status(), file).toBe(200);
      expect(res.headers()['content-type'], file).toContain(type);
    }
    expect(await request.get('/favicon.svg').then((r) => r.text())).toContain('#1F4E9C');
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#1F4E9C');
  });
});
