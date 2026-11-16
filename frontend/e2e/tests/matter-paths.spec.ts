import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { SIZES, shot } from '../support/labels';
import { uid } from '../support/seed';

/**
 * Epic #1389 / #1391: a matter carries up to 10 DMS paths and up to 10 DFS paths. Edit Matter has repeatable lines per kind (single-line inputs, a Remove icon button on each
 * line, the text button "Add Path"), checked when a line is left and on Save; the Summary > Paths group shows every path on its own line with its own Copy button (and the
 * open-link icon for a web address). Each test works on its own client and matter (the database is shared).
 */
const form = (page: Page) => page.locator('[data-matter-form]');
const dmsLines = (page: Page) => form(page).locator('[data-dms-paths] [data-path-line]');
const dfsLines = (page: Page) => form(page).locator('[data-dfs-paths] [data-path-line]');

/** The Edit Matter form scrolls under its sticky bar; axe measures what is on screen, so the check runs from the top of the form (as a person opening it sees it). */
async function scrollToTop(page: Page) {
  await page.evaluate(() => {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
      if (el.scrollTop > 0) el.scrollTop = 0;
    }
    window.scrollTo(0, 0);
  });
}

/** The picture of the path lists: the DMS group is scrolled to the top of the form's scroll area, so both lists are in the shot. */
async function shotPaths(page: Page, name: string) {
  await form(page)
    .locator('[data-dms-paths]')
    .evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await shot(page, name);
}

async function axeClean(page: Page, label: string) {
  if (!axeAvailable()) return;
  await scrollToTop(page);
  expect(await axeViolations(page), label).toEqual([]);
}

test.describe('Matter paths: several DMS and DFS paths (#1391)', () => {
  test('Edit Matter: add, validate, remove and save several paths; the Summary lists each with Copy', async ({
    page,
    seed,
    admin,
  }) => {
    const token = uid();
    const client = await seed.client({ name: `Paths Client ${token}` });
    const matter = await seed.matter({ client, number: '00001', name: `Paths ${token}` });
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto(`/matters/${matter.matterId}/edit`);
      await expect(page.getByRole('heading', { level: 1, name: 'Edit Matter' })).toBeVisible();
      // One empty line per kind to start with, no Remove button on an empty single line.
      await expect(dmsLines(page)).toHaveCount(1);
      await expect(dfsLines(page)).toHaveCount(1);
      await expect(form(page).locator('[data-remove-path]')).toHaveCount(0);

      // Add lines: the new line takes the focus; the DMS list gets three, the DFS list two.
      await form(page).locator('[data-dms-paths] [data-add-path]').click();
      await expect(form(page).locator('#matter-dms-path-1')).toBeFocused();
      await form(page).locator('[data-dms-paths] [data-add-path]').click();
      await form(page).locator('[data-dfs-paths] [data-add-path]').click();
      await expect(dmsLines(page)).toHaveCount(3);
      await expect(dfsLines(page)).toHaveCount(2);
      await form(page).locator('#matter-dms-path-0').fill('\\\\fs01\\dms\\Matters\\one');
      await form(page).locator('#matter-dms-path-1').fill('C:\\Matters\\two');
      await form(page).locator('#matter-dms-path-1').blur();
      await form(page).locator('#matter-dms-path-2').fill('https://dms.example.com/three');
      await form(page).locator('#matter-dfs-path-0').fill('https://dfs.example.com/a');
      await form(page).locator('#matter-dfs-path-1').fill('HTTPS://DFS.example.com/A');
      await form(page).locator('#matter-dfs-path-1').blur();

      // One message under the line it is about, in the words of the guideline; Save refuses and lists them.
      await expect(dmsLines(page).nth(1).locator('[data-path-error]')).toContainText(
        'Drive-letter paths such as C:\\ are not accepted.',
      );
      await expect(dmsLines(page).nth(0).locator('[data-path-error]')).toHaveCount(0);
      await expect(dfsLines(page).nth(1).locator('[data-path-error]')).toContainText(
        'This path is already in the list.',
      );
      await form(page).getByRole('button', { name: 'Save Changes' }).click();
      await expect(form(page).locator('[data-summary]')).toContainText(
        'Fix the following to save:',
      );
      await axeClean(page, `Edit Matter with path errors at ${size.width}`);
      await shotPaths(page, `matter-paths-1391/edit-validation`);

      // Fix: remove the bad DMS line and the repeated DFS line (Remove is on every line of a longer list).
      await dmsLines(page).nth(1).locator('[data-remove-path]').click();
      await dfsLines(page).nth(1).locator('[data-remove-path]').click();
      await expect(dmsLines(page)).toHaveCount(2);
      await expect(dfsLines(page)).toHaveCount(1);
      await expect(form(page).locator('#matter-dms-path-1')).toHaveValue(
        'https://dms.example.com/three',
      );
      await expect(form(page).locator('[data-path-error]')).toHaveCount(0);
      await axeClean(page, `Edit Matter with several paths at ${size.width}`);
      await shotPaths(page, `matter-paths-1391/edit-several`);
      await form(page).getByRole('button', { name: 'Save Changes' }).click();

      await expect(page).toHaveURL(new RegExp(`/matters/${matter.matterId}(\\?|$)`));
      const saved = await admin.get(`/api/v1/matters/${matter.matterId}`);
      expect(saved.dmsPaths).toEqual([
        '\\\\fs01\\dms\\Matters\\one',
        'https://dms.example.com/three',
      ]);
      expect(saved.dfsPaths).toEqual(['https://dfs.example.com/a']);

      // Summary > Paths: each path on its own line with its own Copy button; the web address has the open icon.
      const dms = page.locator('[data-dms-path]');
      await expect(dms.locator('[data-path-row]')).toHaveCount(2);
      await expect(dms.locator('button.mf-copy').nth(0)).toHaveAttribute(
        'aria-label',
        'Copy DMS Path 1',
      );
      await expect(dms.locator('button.mf-copy').nth(1)).toHaveAttribute(
        'aria-label',
        'Copy DMS Path 2',
      );
      await expect(dms.locator('[data-path-link]')).toHaveCount(1);
      const rows = await dms
        .locator('[data-path-row]')
        .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
      expect(rows[1], 'the second path is on its own line').toBeGreaterThan(rows[0]);
      const dfs = page.locator('[data-dfs-path]');
      await expect(dfs.locator('[data-path-row]')).toHaveCount(1);
      await expect(dfs.locator('button.mf-copy')).toHaveAttribute('aria-label', 'Copy DFS Path');
      await axeClean(page, `Matter Summary with several paths at ${size.width}`);
      await shot(page, `matter-paths-1391/summary-paths`);

      // Reset for the second size.
      const fresh = await admin.get(`/api/v1/matters/${matter.matterId}`);
      await admin.put(`/api/v1/matters/${matter.matterId}`, {
        name: fresh.name,
        isSensitive: false,
        rowVersion: fresh.rowVersion,
      });
    }
  });

  test('Copy puts the exact path of its own line on the clipboard', async ({
    page,
    context,
    seed,
    admin,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const token = uid();
    const client = await seed.client({ name: `Copy Client ${token}` });
    const matter = await seed.matter({ client, number: '00001', name: `Copy ${token}` });
    await admin.put(`/api/v1/matters/${matter.matterId}`, {
      name: matter.name,
      isSensitive: false,
      rowVersion: matter.rowVersion,
      dmsPaths: ['\\\\fs01\\dms\\first', 'https://dms.example.com/second'],
    });
    await page.setViewportSize(SIZES[1]);
    await page.goto(`/matters/${matter.matterId}`);
    await page.locator('[data-dms-path] button.mf-copy').nth(1).click();
    await expect(page.locator('[data-dms-path] button.mf-copy').nth(1)).toContainText('Copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      'https://dms.example.com/second',
    );
    await page.locator('[data-dms-path] button.mf-copy').nth(0).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('\\\\fs01\\dms\\first');
  });

  test('the limit is ten per kind: Add Path is disabled at ten lines and the help says so', async ({
    page,
    seed,
  }) => {
    const token = uid();
    const client = await seed.client({ name: `Limit Client ${token}` });
    const matter = await seed.matter({ client, number: '00001', name: `Limit ${token}` });
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto(`/matters/${matter.matterId}/edit`);
      const add = form(page).locator('[data-dms-paths] [data-add-path]');
      for (let i = 0; i < 9; i++) await add.click();
      await expect(dmsLines(page)).toHaveCount(10);
      await expect(add).toBeDisabled();
      await expect(form(page).locator('[data-dfs-paths] [data-add-path]')).toBeEnabled();
      await expect(form(page).locator('[data-dms-paths] [data-path-help]')).toContainText(
        'Up to 10',
      );
      await axeClean(page, `Edit Matter with ten lines at ${size.width}`);
      await shotPaths(page, `matter-paths-1391/limit`);
    }
  });

  test('the API refuses an eleventh path and keeps the saved list', async ({ seed, admin }) => {
    const token = uid();
    const client = await seed.client({ name: `Api Client ${token}` });
    const matter = await seed.matter({ client, number: '00001', name: `Api ${token}` });
    const ten = Array.from({ length: 10 }, (_, i) => `https://dms.example.com/${i}`);
    await admin.put(`/api/v1/matters/${matter.matterId}`, {
      name: matter.name,
      isSensitive: false,
      rowVersion: matter.rowVersion,
      dmsPaths: ten,
    });
    const fresh = await admin.get(`/api/v1/matters/${matter.matterId}`);
    expect(fresh.dmsPaths).toEqual(ten);
    const refused = await admin.raw('PUT', `/api/v1/matters/${matter.matterId}`, {
      name: fresh.name,
      isSensitive: false,
      rowVersion: fresh.rowVersion,
      dmsPaths: [...ten, 'https://dms.example.com/10'],
    });
    expect(refused.status).toBe(400);
    expect((await admin.get(`/api/v1/matters/${matter.matterId}`)).dmsPaths).toEqual(ten);
  });

  test('Summary at 1366x768: an ordinary matter (one path of each kind) keeps the two-column Details without an inner scroll; several paths still fit the page', async ({
    page,
    seed,
    admin,
  }) => {
    const token = uid();
    const client = await seed.client({ name: `Fit Client ${token}` });
    const matter = await seed.matter({ client, number: '00001', name: `Fit ${token}` });
    await admin.put(`/api/v1/matters/${matter.matterId}`, {
      name: matter.name,
      isSensitive: false,
      rowVersion: matter.rowVersion,
      dmsPaths: ['\\\\fs01\\dms\\Matters\\1048\\0017'],
      dfsPaths: ['https://dfs.example.com/matters/10482/0017'],
    });
    await page.setViewportSize(SIZES[1]);
    await page.goto(`/matters/${matter.matterId}`);
    const card = page.locator('[data-summary-details]');
    await expect(card).toBeVisible();
    const scrolls = () =>
      page.evaluate(() => {
        const body = document.querySelector(
          '[data-summary-details] .dc__body',
        ) as HTMLElement | null;
        return body ? body.scrollHeight - body.clientHeight : 0;
      });
    expect(await scrolls(), 'no inner scroll for an ordinary matter').toBeLessThanOrEqual(1);
    const pageOverflow = () =>
      page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    const ordinaryOverflow = await pageOverflow();
    const groups = await page
      .locator('[data-details-group]')
      .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
    expect(new Set(groups).size, 'the groups sit in two columns').toBe(2);

    const fresh = await admin.get(`/api/v1/matters/${matter.matterId}`);
    await admin.put(`/api/v1/matters/${matter.matterId}`, {
      name: fresh.name,
      isSensitive: false,
      rowVersion: fresh.rowVersion,
      dmsPaths: Array.from({ length: 4 }, (_, i) => `\\\\fs01\\dms\\Matters\\${i}`),
      dfsPaths: Array.from({ length: 4 }, (_, i) => `https://dfs.example.com/matters/${i}`),
    });
    await page.reload();
    await expect(page.locator('[data-dms-path] [data-path-row]')).toHaveCount(4);
    // Several paths never make the page itself scroll more than the ordinary matter does (D-03); the Details card scrolls inside itself when the paths need more room.
    const offenders = await page.evaluate(() => {
      const clipped = (e: HTMLElement): boolean => {
        for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) {
          const y = getComputedStyle(p).overflowY;
          if (
            (y === 'auto' || y === 'scroll' || y === 'hidden') &&
            p.getBoundingClientRect().bottom <= window.innerHeight + 1
          )
            return true;
        }
        return false;
      };
      return Array.from(document.querySelectorAll<HTMLElement>('body *'))
        .filter((e) => e.getBoundingClientRect().bottom > window.innerHeight + 1 && !clipped(e))
        .slice(0, 12)
        .map(
          (e) =>
            `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 60)} bottom=${Math.round(e.getBoundingClientRect().bottom)}`,
        );
    });
    expect(await pageOverflow(), offenders.join(' | ')).toBeLessThanOrEqual(ordinaryOverflow);
    await shot(page, 'matter-paths-1391/summary-many-1366');
    await axeClean(page, 'Matter Summary with four paths of each kind');
  });
});
