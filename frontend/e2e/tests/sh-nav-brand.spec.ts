import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { noHorizontalScroll, shot, SIZES } from '../support/screens';

/**
 * S5 (#620), S6 (#621), S2 / S22 (#626): the rail says "Asset types" for the administrator's page next to "Assets" for the records, the
 * main items sit under Work and Records (dividers in the 56 px rail), and the header carries the MatterFlow mark, which is also the favicon.
 */
const nav = (page: Page) => page.getByRole('navigation', { name: 'Main' });

async function openMenuIfPhone(page: Page): Promise<void> {
  if ((page.viewportSize()?.width ?? 1000) < 640) {
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await expect(nav(page)).toBeVisible();
  }
}

test.describe('The rail: groups and names (#620, #621)', () => {
  test.setTimeout(300_000);

  test('Work and Records groups for a System Admin, at every width; "Asset types" differs from "Assets"', async ({
    page,
  }) => {
    expect(axeAvailable(), 'set E2E_AXE_PATH to axe.min.js').toBe(true);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto('/dashboard');
      await openMenuIfPhone(page);
      const work = nav(page).getByRole('list', { name: 'Work' });
      const records = nav(page).getByRole('list', { name: 'Records' });
      await expect(work.getByRole('link')).toHaveText([
        /Dashboard/,
        /My Matters/,
        /My Work/,
        /Task Queue/,
        /Pod Work/,
      ]);
      await expect(records.getByRole('link')).toHaveText([
        /Clients/,
        /Matters/,
        /Projects/,
        /^Assets$/,
      ]);
      const admin = nav(page).getByRole('list', { name: 'Administration' });
      await expect(admin.getByRole('link', { name: 'Asset types' })).toHaveAttribute(
        'href',
        '/admin/asset-types',
      );
      await expect(admin.getByRole('link', { name: 'Asset types' })).toHaveAttribute(
        'data-tip',
        'Asset types',
      );
      await expect(records.getByRole('link', { name: 'Assets', exact: true })).toHaveAttribute(
        'href',
        '/assets',
      );
      await expect(nav(page).getByRole('link', { name: 'Assets', exact: true })).toHaveCount(1);
      await expect(nav(page).getByRole('link', { name: 'Asset types', exact: true })).toHaveCount(
        1,
      );

      const heading = nav(page).locator('#mf-nav-work-heading');
      const visible = await heading.evaluate((h) => getComputedStyle(h).clipPath === 'none');
      const dividerTop = await nav(page)
        .locator('[data-nav-group="records"]')
        .evaluate((g) => getComputedStyle(g).borderTopWidth);
      if (size.width >= 1100 || size.width < 640) {
        expect(visible, `labels shown at ${size.width}`).toBe(true);
        expect(dividerTop).toBe('0px');
      } else {
        // The 56 px icon rail: the labels are for screen readers only, the groups are separated by a line.
        expect(visible, `labels hidden at ${size.width}`).toBe(false);
        expect(dividerTop).toBe('1px');
      }
      await shot(page, 'rail-groups');
      expect(await axeViolations(page), `rail groups at ${size.width}`).toEqual([]);
      await noHorizontalScroll(page);
    }
  });

  test('permission variants: only the groups a person has items in are drawn, and nobody sees a Work label without Work items', async ({
    personas,
    asUser,
  }) => {
    const cases = [
      { who: 'technician' as const, groups: ['Work', 'Records'] },
      { who: 'director' as const, groups: ['Work', 'Records'] },
      { who: 'clientViewOnly' as const, groups: ['Records'] },
      { who: 'taskViewOnly' as const, groups: ['Work', 'Records'] },
      { who: 'configurationAdmin' as const, groups: [] as string[] },
    ];
    for (const c of cases) {
      const person = await personas.named(c.who);
      const page = await asUser(person.username);
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto('/');
      await expect(nav(page)).toBeVisible();
      const headings = await nav(page)
        .locator('[data-nav-group] .mf-nav-heading')
        .allTextContents();
      expect(
        headings.map((h) => h.trim()),
        c.who,
      ).toEqual(c.groups);
      // Every list is named by its heading.
      for (const g of c.groups)
        await expect(nav(page).getByRole('list', { name: g })).toHaveCount(1);
    }
    // A person with an Asset Types page but no Assets records sees "Asset types" and no "Assets".
    const config = await personas.named('configurationAdmin');
    const page = await asUser(config.username);
    await page.goto('/');
    await expect(nav(page).getByRole('link', { name: 'Asset types', exact: true })).toHaveCount(1);
    await expect(nav(page).getByRole('link', { name: 'Assets', exact: true })).toHaveCount(0);
  });

  test('keyboard: Tab goes through Work then Records then Administration, and Enter on "Asset types" opens it', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/clients');
    await nav(page).getByRole('link', { name: 'Clients' }).focus();
    await page.keyboard.press('Tab');
    await expect(nav(page).getByRole('link', { name: 'Matters', exact: true })).toBeFocused();
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
