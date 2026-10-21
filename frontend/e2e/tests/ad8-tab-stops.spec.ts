import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

/**
 * WP-AD8 #659 (AD-E): the Tab stops of the five areas, recorded (never gated: the numbers are evidence, the targets are in the file) and the main
 * flows walked with the keyboard only: skip link, open a row, the row menu, a dialog, back with focus. Output: `tab-stops.json` in
 * E2E_SCREENSHOTS (docs/ux/admin-pages-review/fixes/ad8-states-focus). No keyboard shortcut is involved or added.
 */
const OUT = process.env['E2E_SCREENSHOTS'];

interface Stop {
  key: string;
  url: string;
  rows: string;
  /** The stops per row the review asks for (recorded next to the measurement; not asserted). */
  target: number | null;
}

const PAGES: Stop[] = [
  {
    key: 'priorities',
    url: '/admin/priorities',
    rows: 'table.mf-grid tbody tr[data-row]',
    target: 2,
  },
  {
    key: 'status-labels',
    url: '/admin/status-labels',
    rows: 'table.mf-grid tbody tr[data-row]',
    target: 2,
  },
  {
    key: 'asset-types',
    url: '/admin/asset-types',
    rows: '[data-types] tbody tr[data-row]',
    target: 2,
  },
  {
    key: 'link-roles',
    url: '/admin/asset-types?tab=link-roles',
    rows: '[data-roles] tbody tr[data-row]',
    target: 2,
  },
  { key: 'custom-fields', url: '/admin/custom-fields', rows: 'tbody tr[data-row]', target: 2 },
  {
    key: 'audit',
    url: '/admin/audit',
    rows: '#audit-table tbody tr[data-event], #audit-table tbody tr[data-group]',
    target: null,
  },
];

const results: Record<string, unknown> = {};

/** Tab presses from the top of the page until focus is inside the first row (at most `max`), or null. */
async function stopsToFirstRow(page: Page, rows: string, max = 80): Promise<number | null> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.evaluate(() => window.scrollTo(0, 0));
  for (let i = 1; i <= max; i++) {
    await page.keyboard.press('Tab');
    const inside = await page.evaluate((selector) => {
      const row = document.querySelector(selector);
      return !!row && row.contains(document.activeElement);
    }, rows);
    if (inside) return i;
  }
  return null;
}

/** The controls of the first row that are Tab stops (not `tabindex=-1`, visible). */
async function stopsInRow(page: Page, rows: string): Promise<string[]> {
  return page.evaluate((selector) => {
    const row = document.querySelector(selector);
    if (!row) return [];
    return Array.from(
      row.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]'),
    )
      .filter((el) => el.getAttribute('tabindex') !== '-1' && el.getBoundingClientRect().width > 0)
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}${el.getAttribute('aria-label') ? `[${el.getAttribute('aria-label')}]` : ''}`,
      );
  }, rows);
}

test.describe('Tab stops of the five administration areas (#659)', () => {
  test.afterAll(() => {
    if (!OUT) return;
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(
      path.join(OUT, 'tab-stops.json'),
      JSON.stringify({ width: 1366, height: 768, measuredAt: 'e2e', pages: results }, null, 2) +
        '\n',
    );
  });

  for (const p of PAGES) {
    test(`${p.key}: stops to the first row and stops per row are recorded at 1366`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto(p.url);
      await expect(page.locator(p.rows).first()).toBeVisible();
      const toFirstRow = await stopsToFirstRow(page, p.rows);
      const inRow = await stopsInRow(page, p.rows);
      results[p.key] = {
        url: p.url,
        stopsToFirstRow: toFirstRow,
        stopsPerRow: inRow.length,
        controls: inRow,
        targetPerRow: p.target,
        meetsTarget: p.target === null ? null : inRow.length <= p.target,
      };
      // Recorded, not gated: only that the first row can be reached by keyboard at all, and that a row has a way to act.
      expect(toFirstRow, `${p.key}: focus reaches the first row`).not.toBeNull();
      expect(inRow.length, `${p.key}: a row has at least one stop`).toBeGreaterThan(0);
    });
  }
});

test.describe('Keyboard-only flows (#659)', () => {
  test('Priorities: skip link, name link opens the dialog, Escape returns to the link; the row menu moves a row and keeps focus', async ({
    page,
    admin,
  }) => {
    const a = await admin.post('/api/v1/priorities', {
      label: `Kbd A ${uid()}`,
      color: 'low',
      isActive: true,
    });
    await admin.post('/api/v1/priorities', {
      label: `Kbd B ${uid()}`,
      color: 'low',
      isActive: true,
    });
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/admin/priorities');
    await expect(page.locator('table.mf-grid tbody tr[data-row]').first()).toBeVisible();

    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to table' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#labels-table')).toBeFocused();

    const link = page.locator(`tr[data-row="${a.label}"] [data-edit]`);
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Edit priority' })).toBeVisible();
    await expect(page.locator('#priority-label')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Edit priority' })).toBeHidden();
    await expect(link).toBeFocused();

    const menu = page.getByRole('button', { name: `Actions for ${a.label}` });
    await menu.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('menuitem', { name: 'Move down' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-announce]')).toContainText('moved to position');
    await expect(menu).toBeFocused();
    await admin.raw('DELETE', `/api/v1/priorities/${a.id}`);
  });

  test('Link Roles: the New button opens the dialog, Escape returns to it; the menu deactivates with the keyboard and focus stays on the row', async ({
    page,
    admin,
  }) => {
    const name = `Kbd ${uid()}`;
    await admin.post('/api/v1/asset-link-roles', { name, isActive: true });
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/admin/asset-types?tab=link-roles');
    const opener = page.getByRole('button', { name: 'New link role' });
    await opener.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'New link role' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'New link role' })).toBeHidden();
    await expect(opener).toBeFocused();

    const menu = page.getByRole('button', { name: `Actions for ${name}` });
    await menu.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('menuitem', { name: 'Deactivate' }).focus();
    await page.keyboard.press('Enter');
    const confirm = page.getByRole('dialog', { name: 'Deactivate link role?' });
    await expect(confirm).toBeVisible();
    await page.getByRole('button', { name: 'Deactivate link role' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator(`tr[data-row="${name}"]`)).toContainText('Inactive');
    await expect(menu).toBeFocused();
  });

  test('Asset Types: skip link, the name link opens the record, Back returns focus to the row', async ({
    page,
    admin,
  }) => {
    const name = `Kbd Type ${uid()}`;
    const type = await admin.post('/api/v1/asset-types', { name, description: null });
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/admin/asset-types?name=${encodeURIComponent(name)}`);
    const link = page.locator(`tr[data-row="${name}"] [data-open]`);
    await expect(link).toBeVisible();
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/admin/asset-types/${type.assetTypeId}$`));
    await page.goBack();
    await expect(link).toBeFocused();
  });

  test('Audit: the filter row is reachable, the details toggle is a button, Show only this operation ends on the chip', async ({
    page,
    admin,
  }) => {
    const type = await admin.post('/api/v1/asset-types', {
      name: `Kbd Audit ${uid()}`,
      description: null,
    });
    await admin.put(`/api/v1/asset-types/${type.assetTypeId}`, {
      name: `${type.name} v2`,
      description: 'changed',
      sortOrder: type.sortOrder,
      isActive: true,
      rowVersion: type.rowVersion,
    });
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/admin/audit?objectType=AssetType&objectId=${type.assetTypeId}`);
    await page.getByLabel('Group events of one operation').uncheck();
    const toggle = page.locator('tr[data-event] .au-toggle').first();
    await expect(toggle).toBeVisible();
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle).toBeFocused();
    const operation = page.locator('[data-show-operation]').first();
    await operation.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-chip="correlationId"] button')).toBeFocused();
  });
});
