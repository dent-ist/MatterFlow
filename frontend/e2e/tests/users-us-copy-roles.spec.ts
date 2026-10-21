import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Persona } from '../support/personas';
import { openEditAvailability, userRow } from '../support/users-grid';

/**
 * Users epic #422, lane C:
 *  - #428 Access Pending copy (no stray space before the full stop, who is told, who to ask) and one From/Until hint in the availability dialog;
 *  - #447 Roles list: members and "12 of 50" permissions per role, a 320 px list pane, role names clamped to two lines with the full name as
 *    the tooltip, "Task 6/9" per permission group in the editor, counts that equal the editor.
 * Screenshots go to the folder in E2E_SCREENSHOTS (docs/ux/users-review/fixes/us1-bugs, us6-roles-pods) when it is set.
 */
const SIZES = [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
] as const;

const OUT = process.env['E2E_SCREENSHOTS'];
const TAG = `usc${Math.floor(Math.random() * 90000) + 10000}`;

async function shot(page: Page, name: string, width: number, height: number): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}-${width}x${height}.png`) });
}

const noSideScroll = (page: Page) =>
  page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
  );

/** axe without the one artifact of a scrolled page (a control half under a fixed bar is reported as partially obscured). */
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

test.describe('#428 Access Pending copy', () => {
  let waiting: Persona;
  test.beforeAll(async ({ personas }) => {
    waiting = await personas.create({ label: `${TAG}ap`, displayName: 'Pat Pending' });
  });

  for (const { width, height } of SIZES) {
    test(`copy, focus and axe at ${width}`, async ({ asUser }) => {
      test.skip(!axeAvailable(), 'axe-core is not available');
      const page = await asUser(waiting.username);
      await page.setViewportSize({ width, height });
      await page.goto('/');
      await expect(page).toHaveURL(/\/access-pending$/);
      const main = page.locator('main.mf-pending');
      const text = (await main.innerText()).replace(/\s+/g, ' ');

      // The account sits in brackets right after the name and the full stop follows the bracket.
      expect(text).toContain(
        `Pat Pending (${waiting.username}). An administrator needs to give you`,
      );
      expect(text).not.toMatch(/\) \./);
      expect(text).toContain(
        'An administrator is notified through the Users page: you do not need to resend this.',
      );
      expect(text).toContain('Ask your Pod Lead or manager if you need access sooner.');
      expect(text).not.toContain('Contact:');

      // The heading is focused on load; Copy and Check again are unchanged.
      await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
      await expect(page.getByRole('button', { name: /Copy/ })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Check again' })).toBeVisible();
      await page.getByRole('button', { name: 'Check again' }).click();
      await expect(page.locator('.mf-status')).toContainText('Still pending');

      expect(await noSideScroll(page)).toBe(true);
      expect(await axeClean(page)).toEqual([]);
      await shot(page, 'access-pending', width, height);
    });
  }
});

test.describe('#428 availability dialog: one date hint', () => {
  let person: Persona;
  test.beforeAll(async ({ personas }) => {
    person = await personas.create({ label: `${TAG}av`, roles: ['Data Technician'] });
  });

  for (const { width, height } of SIZES) {
    test(`one hint under the From and Until pair, axe 0 at ${width}`, async ({ page }) => {
      test.skip(!axeAvailable(), 'axe-core is not available');
      await page.setViewportSize({ width, height });
      await page.goto(`/admin/users?status=all&account=e2e-${TAG}av`);
      await openEditAvailability(userRow(page, person.userId, person.username));
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await dialog.getByLabel(/Out of office/).check();

      await expect(dialog.locator('.di__hint')).toHaveCount(0);
      const help = dialog.locator('[data-dates-help]');
      await expect(help).toHaveCount(1);
      await expect(help).toContainText('Type a date such as Oct 12, 2026 or 10/12/2026');
      await expect(help).toContainText('Leave From empty to start now.');
      // Both fields are described by that one hint.
      const helpId = await help.getAttribute('id');
      await expect(dialog.locator('#av-from')).toHaveAttribute('aria-describedby', helpId!);
      await expect(dialog.locator('#av-until')).toHaveAttribute('aria-describedby', helpId!);

      expect(await axeClean(page)).toEqual([]);
      expect(await noSideScroll(page)).toBe(true);
      await shot(page, 'availability-dialog', width, height);
    });
  }
});

test.describe('#447 Roles: counts, clamp and group counts', () => {
  const LONG = `${TAG} ${'Senior Document Review Coordinator '.repeat(3)}`.trim().slice(0, 90);
  let longRoleId: number;

  test.beforeAll(async ({ admin }) => {
    const role = await admin.post('/api/v1/roles', {
      name: LONG,
      description: 'A role with a very long name for the clamp test',
      permissionCodes: ['Task.View', 'Task.Create', 'Client.View'],
    });
    longRoleId = role.roleId;
  });

  for (const { width, height } of SIZES) {
    test(`list shows members and "n of total", clamp holds, axe 0 at ${width}`, async ({
      page,
      admin,
    }) => {
      test.skip(!axeAvailable(), 'axe-core is not available');
      await page.setViewportSize({ width, height });
      await page.goto('/admin/roles');
      const catalog: { permissions: unknown[] }[] = await admin.get('/api/v1/permissions');
      const total = catalog.reduce((n, g) => n + g.permissions.length, 0);
      const roles: { roleId: number; isSystemAdmin: boolean; permissionCount: number }[] =
        await admin.get('/api/v1/roles');

      for (const r of roles) {
        const cell = page.locator(`[data-role="${r.roleId}"] [data-perm-count]`);
        await expect(cell).toContainText(`${r.permissionCount} of ${total}`);
      }
      expect(await noSideScroll(page)).toBe(true);
      expect(await axeClean(page)).toEqual([]);
      await shot(page, 'roles-list', width, height);

      // Open the long-named role: the list pane is 320 px wide on a wide window, the name is two lines at most, the tooltip is the name.
      await page.locator(`[data-role="${longRoleId}"]`).click();
      await expect(page.locator('[data-editor]')).toBeVisible();
      const name = page.locator(`[data-role="${longRoleId}"] .mf-name`);
      await expect(name).toHaveAttribute('title', LONG);
      const lines = await name.evaluate((el) => {
        const style = getComputedStyle(el);
        // "normal" line height is about 1.2 x the font size; 1.5 is a safe divisor that still tells two lines from three.
        const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5;
        return Math.round(el.getBoundingClientRect().height / line);
      });
      expect(lines).toBeLessThanOrEqual(2);
      if (width >= 961) {
        const pane = await page
          .locator('.mf-list')
          .evaluate((el) => el.getBoundingClientRect().width);
        expect(Math.round(pane)).toBe(320);
      }

      // The count in the list equals the editor: ticked boxes, the header line and the sum of the groups.
      const ticked = await page.locator('[data-perm]:checked').count();
      expect(ticked).toBe(3);
      await expect(page.locator('[data-editor-count]')).toContainText(
        `${ticked} of ${total} permissions selected`,
      );
      await expect(page.locator('[data-group="Task"] [data-group-count]')).toContainText(
        /^\s*2\/\d+/,
      );
      expect(await noSideScroll(page)).toBe(true);
      expect(await axeClean(page)).toEqual([]);
      await shot(page, 'role-editor', width, height);
    });
  }

  test('a group count follows the boxes', async ({ page }) => {
    await page.goto('/admin/roles');
    await page.getByRole('button', { name: 'New role' }).click();
    const task = page.locator('[data-group="Task"] [data-group-count]');
    await expect(task).toContainText(/^\s*0\/\d+/);
    await page.locator('[data-perm="Task.Assign"]').check();
    // Assign needs View: both are ticked.
    await expect(task).toContainText(/^\s*2\/\d+/);
    await expect(page.locator('[data-editor-count]')).toContainText('2 of');
  });

  test('System Admin shows every permission, locked', async ({ page, admin }) => {
    await page.goto('/admin/roles');
    const roles: { roleId: number; isSystemAdmin: boolean }[] = await admin.get('/api/v1/roles');
    const sys = roles.find((r) => r.isSystemAdmin)!;
    await page.locator(`[data-role="${sys.roleId}"]`).click();
    const catalog: { permissions: unknown[] }[] = await admin.get('/api/v1/permissions');
    const total = catalog.reduce((n, g) => n + g.permissions.length, 0);
    await expect(page.locator('[data-editor-count]')).toContainText(
      `${total} of ${total} permissions selected`,
    );
    await expect(page.locator(`[data-role="${sys.roleId}"] [data-perm-count]`)).toContainText(
      `${total} of ${total}`,
    );
  });
});
