import { Page } from '@playwright/test';
import { Json } from '../support/api';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { SIZES, noSideScroll, openRowMenu, priorityRow, shot } from '../support/labels';
import { uid } from '../support/seed';

/**
 * WP-AD3 #609: New priority and Edit priority in the lookup dialog: name with counter, the color select with a custom color, a live badge,
 * the 4.5:1 contrast check, the duplicate-name message, the unsaved guard, focus back on the control that opened it, and a color that is
 * saved with the name only. Screenshots: E2E_SCREENSHOTS (fixes/ad3-labels).
 */
const dialog = (page: Page, name: string | RegExp = /^(New|Edit) priority$/) =>
  page.getByRole('dialog', { name });
const label = (page: Page) => page.locator('#priority-label');
const rowOf = priorityRow;

async function removeByLabel(
  admin: { get: <T>(p: string) => Promise<T>; raw: (m: string, p: string) => Promise<unknown> },
  name: string,
) {
  const list = await admin.get<Json[]>('/api/v1/priorities');
  for (const p of list.filter((x) => x.label === name || x.label.startsWith(name)))
    await admin.raw('DELETE', `/api/v1/priorities/${p.id}`);
}

test.describe('New priority and Edit priority (#609)', () => {
  test('New priority: the header action opens an empty dialog on the name field, the badge previews live, Add puts it last and focus goes back to the button', async ({
    page,
    admin,
  }) => {
    const name = `ad3 new ${uid().slice(0, 5)}`;
    await page.setViewportSize(SIZES[1]);
    await page.goto('/admin/priorities');
    try {
      const opener = page.getByRole('button', { name: 'New priority' });
      await opener.click();
      await expect(dialog(page)).toBeVisible();
      await expect(page).toHaveURL(/edit=new$/);
      await expect(label(page)).toBeFocused();
      await expect(dialog(page).locator('[data-char-count], #priority-label-count')).toContainText(
        '0 / 50',
      );
      await label(page).fill(name);
      await expect(dialog(page).locator('[data-preview]')).toContainText(name);
      await dialog(page).getByRole('button', { name: 'Add priority' }).click();
      await expect(dialog(page)).toBeHidden();
      await expect(page).not.toHaveURL(/edit=/);
      const last = page.locator('table.mf-grid tbody tr[data-row]').last();
      await expect(last).toHaveAttribute('data-row', name);
      await expect(opener).toBeFocused();
      await shot(page, 'priority-new-saved');
    } finally {
      await removeByLabel(admin, name);
    }
  });

  test('Edit priority: the name link opens it with the current values; name and color are saved together, never the color alone', async ({
    page,
    admin,
  }) => {
    const [made] = [
      await admin.post('/api/v1/priorities', {
        label: `ad3 edit ${uid().slice(0, 5)}`,
        color: 'low',
        isActive: true,
      }),
    ];
    const renamed = `${made.label} renamed`;
    await page.setViewportSize(SIZES[1]);
    await page.goto('/admin/priorities');
    try {
      const link = rowOf(page, made.label).locator('[data-edit]');
      await link.click();
      await expect(dialog(page, 'Edit priority')).toBeVisible();
      await expect(label(page)).toHaveValue(made.label);
      await expect(page.locator('#priority-color')).toHaveValue('low');

      // Changing the color changes the preview, not the row.
      await page.locator('#priority-color').selectOption('critical');
      await expect(dialog(page).locator('[data-preview] [data-priority]')).toHaveAttribute(
        'style',
        /critical/,
      );
      const listed = (await admin.get<Json[]>('/api/v1/priorities')).find((p) => p.id === made.id)!;
      expect(listed.color, 'nothing is saved by choosing a color').toBe('low');

      await label(page).fill(renamed);
      await dialog(page).getByRole('button', { name: 'Save priority' }).click();
      await expect(dialog(page)).toBeHidden();
      await expect(rowOf(page, renamed)).toBeVisible();
      const saved = (await admin.get<Json[]>('/api/v1/priorities')).find((p) => p.id === made.id)!;
      expect(saved).toMatchObject({ label: renamed, color: 'critical' });
      await expect(link)
        .toBeFocused()
        .catch(() => undefined);
    } finally {
      await removeByLabel(admin, made.label);
    }
  });

  test('a blank name, an unreadable custom color (a mid gray: neither white nor dark text reaches 4.5:1) and a duplicate name are explained and focus goes to the first invalid field', async ({
    page,
    admin,
  }) => {
    const unique = `ad3 inv ${uid().slice(0, 5)}`;
    await page.setViewportSize(SIZES[1]);
    await page.goto('/admin/priorities');
    await page.getByRole('button', { name: 'New priority' }).click();
    await dialog(page).getByRole('button', { name: 'Add priority' }).click();
    await expect(dialog(page).locator('[data-summary]')).toContainText('Enter a name.');
    await expect(label(page)).toHaveAttribute('aria-invalid', 'true');
    await expect(label(page)).toBeFocused();
    await shot(page, 'priority-invalid');

    await label(page).fill(unique);
    await page.locator('#priority-color').selectOption('custom');
    await page.locator('#priority-custom').fill('#808080');
    await dialog(page).getByRole('button', { name: 'Add priority' }).click();
    await expect(dialog(page).locator('[data-color-error]')).toContainText(
      'Text must be readable: 4.5:1 minimum',
    );
    await expect(page.locator('#priority-custom')).toBeFocused();
    expect((await admin.get<Json[]>('/api/v1/priorities')).some((p) => p.label === unique)).toBe(
      false,
    );

    // A readable custom color saves; then the same name again is a duplicate with the server's message under the field.
    await page.locator('#priority-custom').fill('#7a1f3d');
    try {
      await dialog(page).getByRole('button', { name: 'Add priority' }).click();
      await expect(dialog(page)).toBeHidden();
      await page.getByRole('button', { name: 'New priority' }).click();
      await label(page).fill(unique);
      await dialog(page).getByRole('button', { name: 'Add priority' }).click();
      await expect(dialog(page).locator('#priority-label-error')).toContainText(
        `A priority named '${unique}' exists.`,
      );
      await expect(dialog(page)).toBeVisible();
      await expect(label(page)).toBeFocused();
      await label(page).fill(`${unique} 2`);
      await expect(dialog(page).locator('#priority-label-error')).toHaveCount(0);
    } finally {
      await removeByLabel(admin, unique);
    }
  });

  test('a 46 character name is counted, previewed without breaking the dialog and saved', async ({
    page,
    admin,
  }) => {
    const long = `ad3 long ${uid().slice(0, 5)} `.padEnd(46, 'x');
    expect(long.length).toBe(46);
    await page.setViewportSize(SIZES[3]);
    await page.goto('/admin/priorities?edit=new');
    try {
      await label(page).fill(long);
      await expect(page.locator('#priority-label-count')).toContainText('46 / 50');
      const box = (await dialog(page).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(375);
      await noSideScroll(page, 'long name at 375');
      await shot(page, 'priority-long-name');
      await dialog(page).getByRole('button', { name: 'Add priority' }).click();
      await expect(dialog(page)).toBeHidden();
      expect((await admin.get<Json[]>('/api/v1/priorities')).some((p) => p.label === long)).toBe(
        true,
      );
    } finally {
      await removeByLabel(admin, long);
    }
  });

  test('Escape with edits asks first (Stay is the default), without edits closes at once, and focus returns to the opener', async ({
    page,
  }) => {
    await page.setViewportSize(SIZES[1]);
    await page.goto('/admin/priorities');
    const opener = page.getByRole('button', { name: 'New priority' });
    await opener.click();
    await expect(label(page)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeHidden();
    await expect(page.getByRole('dialog', { name: 'Leave without saving?' })).toHaveCount(0);
    await expect(opener).toBeFocused();

    await opener.click();
    await label(page).fill('half typed');
    await page.keyboard.press('Escape');
    const ask = page.getByRole('dialog', { name: 'Leave without saving?' });
    await expect(ask).toBeVisible();
    await expect(ask.getByRole('button', { name: 'Stay' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(ask).toBeHidden();
    await expect(label(page)).toHaveValue('half typed');
    await dialog(page).getByRole('button', { name: 'Cancel' }).click();
    await ask.getByRole('button', { name: 'Leave' }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(page).not.toHaveURL(/edit=/);
    await expect(opener).toBeFocused();
  });

  test('keyboard only: the name link opens Edit, Tab stays inside the dialog, Escape closes and focus is back on the link', async ({
    page,
  }) => {
    await page.setViewportSize(SIZES[1]);
    await page.goto('/admin/priorities');
    const link = rowOf(page, 'Critical').locator('[data-edit]');
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(dialog(page, 'Edit priority')).toBeVisible();
    await expect(label(page)).toBeFocused();
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]'))).toBe(
        true,
      );
    }
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeHidden();
    await expect(link).toBeFocused();
  });

  test('Edit from the row menu: Escape closes it and focus is back on the row menu button', async ({
    page,
  }) => {
    await page.setViewportSize(SIZES[1]);
    await page.goto('/admin/priorities');
    const menu = rowOf(page, 'Critical').getByRole('button', { name: /^Actions for / });
    await openRowMenu(page, menu);
    await page.getByRole('menuitem', { name: 'Edit priority' }).click();
    await expect(dialog(page, 'Edit priority')).toBeVisible();
    await expect(page).toHaveURL(/edit=\d+$/);
    await expect(label(page)).toHaveValue('Critical');
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeHidden();
    await expect(menu).toBeFocused();
  });

  for (const size of SIZES) {
    test(`${size.width}: the open dialog has no sideways page scroll and axe 0`, async ({
      page,
    }) => {
      test.skip(!axeAvailable(), 'axe-core is not available');
      await page.setViewportSize(size);
      await page.goto('/admin/priorities?edit=new');
      await expect(dialog(page)).toBeVisible();
      await page.locator('#priority-color').selectOption('custom');
      await page.locator('#priority-custom').fill('#808080');
      await label(page).fill('x');
      await dialog(page).getByRole('button', { name: 'Add priority' }).click();
      await expect(dialog(page).locator('[data-color-error]')).toBeVisible();
      const box = (await dialog(page).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(size.width);
      await noSideScroll(page, `dialog at ${size.width}`);
      expect(await axeViolations(page), `axe at ${size.width}`).toEqual([]);
      await shot(page, 'priority-dialog');
    });
  }

  test('permissions: a Task.View-only person gets the 403 page, a Priority.Manage person can open the dialog', async ({
    asUser,
    personas,
  }) => {
    const viewer = await asUser(
      (await personas.create({ permissions: ['Task.View'], label: 'ad3-v' })).username,
    );
    await viewer.goto('/admin/priorities?edit=new');
    await expect(
      viewer.getByRole('heading', { name: "You don't have permission to view this." }),
    ).toBeVisible();
    const manager = await asUser(
      (await personas.create({ permissions: ['Priority.Manage'], label: 'ad3-m' })).username,
    );
    await manager.goto('/admin/priorities');
    await manager.getByRole('button', { name: 'New priority' }).click();
    await expect(dialog(manager)).toBeVisible();
  });
});
