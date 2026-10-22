import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Persona } from '../support/personas';

/**
 * Users epic #422, WP-US2: the status segments above the grid (#429) and Filters with its count and Clear filters in the page header (#431).
 *  - Pending access (n) | Active (n) | Inactive (n) | All (n) from the counts endpoint; the pressed one is the `status` of the address; the
 *    default rule (Pending when somebody waits, else Active) is written into the address on first load and survives a reload;
 *  - the counts equal the rows of each segment and refresh after a grant;
 *  - one toolbar, one Tab stop, arrow keys move; the same for a person with User.View only; a Task.View-only person gets no list;
 *  - Filters (n) and the one Clear filters sit in the page header, Clear keeps the segment.
 * Screenshots for docs/ux/users-review/fixes/us2-status/ are written when E2E_SCREENSHOTS is set to the output folder.
 */
const SIZES = [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
] as const;

const OUT = process.env['E2E_SCREENSHOTS'];
const TAG = `us2s${Math.floor(Math.random() * 90000) + 10000}`;

let waiting: Persona;
let working: Persona;
let gone: Persona;

test.beforeAll(async ({ personas }) => {
  waiting = await personas.create({ label: `${TAG}wait`, displayName: `${TAG} Waiting Person` });
  working = await personas.create({ label: `${TAG}work`, roles: ['Data Technician'] });
  gone = await personas.create({ label: `${TAG}gone`, roles: ['Data Technician'], disabled: true });
});

async function shot(page: Page, name: string, width: number, height: number): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}-${width}x${height}.png`) });
}

const noSideScroll = (page: Page) =>
  page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
  );

async function axeClean(page: Page) {
  const found = await axeViolations(page);
  return found
    .map((v) =>
      v.id === 'target-size'
        ? { ...v, nodes: v.nodes.filter((n) => !(n.why ?? '').includes('partially obscured')) }
        : v,
    )
    .filter((v) => v.nodes.length > 0);
}

const segment = (page: Page, key: string) => page.locator(`[data-strip-item="${key}"]`);
const pressed = (page: Page) => page.locator('[data-strip-item][aria-pressed="true"]');

async function counts(admin: {
  get: <T>(url: string) => Promise<T>;
}): Promise<{ pending: number; active: number; inactive: number }> {
  return admin.get('/api/v1/users/counts');
}

test.describe('#429 status segments', () => {
  test('the counts are the rows of each segment, and All is their sum', async ({ page, admin }) => {
    const c = await counts(admin);
    const all = await admin.get<{ total: number }>('/api/v1/users?status=all&pageSize=1');
    expect(c.pending + c.active + c.inactive).toBe(all.total);
    for (const key of ['pending', 'active', 'inactive'] as const) {
      const list = await admin.get<{ total: number }>(`/api/v1/users?status=${key}&pageSize=1`);
      expect(list.total, `${key} rows`).toBe(c[key]);
    }

    await page.goto('/admin/users');
    await expect(segment(page, 'pending')).toContainText('Pending access');
    await expect(segment(page, 'pending')).toContainText(String(c.pending));
    await expect(segment(page, 'active')).toContainText(String(c.active));
    await expect(segment(page, 'inactive')).toContainText(String(c.inactive));
    await expect(segment(page, 'all')).toContainText(String(all.total));
  });

  for (const { width, height } of SIZES) {
    test(`default rule is written into the address and survives a reload; axe 0 and no side scroll at ${width}`, async ({
      page,
      admin,
    }) => {
      test.skip(!axeAvailable(), 'axe-core is not available');
      await page.setViewportSize({ width, height });
      const c = await counts(admin);
      const expected = c.pending > 0 ? 'pending' : 'active';
      await page.goto('/admin/users');
      await expect(page).toHaveURL(new RegExp(`status=${expected}`));
      await expect(pressed(page)).toHaveCount(1);
      await expect(pressed(page)).toHaveAttribute('data-strip-item', expected);

      await page.reload();
      await expect(page).toHaveURL(new RegExp(`status=${expected}`));
      await expect(pressed(page)).toHaveAttribute('data-strip-item', expected);

      expect(await noSideScroll(page)).toBe(true);
      expect(await axeClean(page)).toEqual([]);
      await shot(page, 'users-segments', width, height);
    });
  }

  test('Pending access is tinted only while somebody waits; the waiting person is listed under it and not under Active', async ({
    page,
  }) => {
    await page.goto(`/admin/users?status=pending&name=${TAG}`);
    await expect(page.locator(`tr[data-user="${waiting.userId}"]`)).toBeVisible();
    await expect(segment(page, 'pending')).toHaveClass(/tinted/);
    await page.goto(`/admin/users?status=active&name=${TAG}`);
    await expect(page.locator(`tr[data-user="${waiting.userId}"]`)).toHaveCount(0);
    await expect(page.locator(`tr[data-user="${working.userId}"]`)).toBeVisible(); // its name has the tag too, and it has access
  });

  test('choosing a segment updates the address and the grid; Back keeps the earlier segment; reload keeps it', async ({
    page,
  }) => {
    await page.goto(`/admin/users?status=all&account=e2e-${TAG}`);
    await expect(page.locator('tr[data-user]')).toHaveCount(3);

    await segment(page, 'inactive').click();
    await expect(page).toHaveURL(/status=inactive/);
    await expect(page.locator('tr[data-user]')).toHaveCount(1);
    await expect(page.locator(`tr[data-user="${gone.userId}"]`)).toBeVisible();
    await expect(pressed(page)).toHaveAttribute('data-strip-item', 'inactive');

    await segment(page, 'pending').click();
    await expect(page).toHaveURL(/status=pending/);
    await expect(page.locator('tr[data-user]')).toHaveCount(1);
    await expect(page.locator(`tr[data-user="${waiting.userId}"]`)).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/status=inactive/);
    await expect(pressed(page)).toHaveAttribute('data-strip-item', 'inactive');
    await expect(page.locator(`tr[data-user="${gone.userId}"]`)).toBeVisible();

    await page.reload();
    await expect(pressed(page)).toHaveAttribute('data-strip-item', 'inactive');
    // The pressed segment pressed again stays pressed.
    await segment(page, 'inactive').click();
    await expect(pressed(page)).toHaveAttribute('data-strip-item', 'inactive');
  });

  test('the counts refresh after access is granted', async ({ page, personas, seed }) => {
    const person = await personas.create({ label: `${TAG}grant`, displayName: `${TAG} Grant` });
    await page.goto(`/admin/users?status=pending&name=${TAG}%20Grant`);
    await expect(page.locator(`tr[data-user="${person.userId}"]`)).toBeVisible();
    const text = async () => (await segment(page, 'pending').textContent())!.replace(/\D+/g, '');
    const before = Number(await text());

    await seed.grantRoles(person.userId, ['Data Technician']);
    await segment(page, 'active').click();
    await expect(page.locator(`tr[data-user="${person.userId}"]`)).toBeVisible();
    await expect.poll(async () => Number(await text())).toBe(before - 1);
  });

  test('keyboard: one Tab stop for the toolbar, arrows move between the segments, Enter presses', async ({
    page,
  }) => {
    await page.goto(`/admin/users?status=all&account=e2e-${TAG}`);
    const bar = page.getByRole('toolbar', { name: 'Users by status' });
    await expect(bar).toBeVisible();
    expect(await bar.locator('button[tabindex="0"]').count()).toBe(1);
    expect(await bar.locator('button[tabindex="-1"]').count()).toBe(3);

    await pressed(page).focus();
    await page.keyboard.press('ArrowLeft');
    await expect(segment(page, 'inactive')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/status=inactive/);
    await expect(pressed(page)).toHaveAttribute('data-strip-item', 'inactive');
    await page.keyboard.press('Home');
    await expect(segment(page, 'pending')).toBeFocused();
    await page.keyboard.press('End');
    await expect(segment(page, 'all')).toBeFocused();
    // Tab leaves the toolbar after one stop, to the next control of the page.
    await page.keyboard.press('Tab');
    await expect(bar.locator('button:focus')).toHaveCount(0);
  });

  test('a person with User.View only sees the same segments; a Task.View-only person gets no list', async ({
    personas,
    asUser,
  }) => {
    const viewer = await personas.create({ label: `${TAG}view`, permissions: ['User.View'] });
    const page = await asUser(viewer.username);
    await page.goto('/admin/users');
    await expect(page.locator('[data-strip-item]')).toHaveCount(4);
    await expect(pressed(page)).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Grant access' })).toHaveCount(0);

    const other = await personas.named('taskViewOnly');
    const denied = await asUser(other.username);
    await denied.goto('/admin/users');
    await expect(denied.locator('[data-strip-item]')).toHaveCount(0);
  });
});

test.describe('#431 header Filters', () => {
  for (const { width, height } of SIZES) {
    test(`Filters with its count and the one Clear filters are in the page header at ${width}; Clear keeps the segment`, async ({
      page,
    }) => {
      test.skip(!axeAvailable(), 'axe-core is not available');
      await page.setViewportSize({ width, height });
      await page.goto(`/admin/users?status=all&account=e2e-${TAG}&name=e2e`);
      const header = page.locator('mf-page-header');
      const toggle = header.locator('[data-filters-toggle]');
      await expect(toggle).toBeVisible();
      await expect(header.locator('[data-filter-count]')).toHaveText('(2)'); // Name and Windows account; the segment is not a filter
      await expect(page.locator('mf-users-page [data-filters-toggle]')).toHaveCount(0);

      // Exactly one Clear filters on the page, wherever the row is (header while the row is open, the bar while it is closed or a sheet).
      await expect(page.locator('[data-clear-filters]')).toHaveCount(1);
      await shot(page, 'users-filters-header', width, height);
      expect(await noSideScroll(page)).toBe(true);
      expect(await axeClean(page)).toEqual([]);

      await page.locator('[data-clear-filters]').click();
      await expect(page).toHaveURL(/status=all/);
      await expect(page).not.toHaveURL(/name=|account=/);
      await expect(pressed(page)).toHaveAttribute('data-strip-item', 'all');
    });
  }

  test('the filter sheet opens from the header button below 640 and has no second Status filter', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/admin/users?status=all');
    await page.locator('mf-page-header [data-filters-toggle]').click();
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    // Exact: a role the suite created ("Status labels only ...") is a checkbox in the Roles filter and matches a substring.
    await expect(sheet.getByLabel('Status', { exact: true })).toHaveCount(0);
    expect(await axeClean(page)).toEqual([]);
    await shot(page, 'users-filters-sheet', 375, 812);
  });
});
