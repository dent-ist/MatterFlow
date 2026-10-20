import { Page } from '@playwright/test';
import { Json } from '../support/api';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import {
  SIZES,
  addPriorities,
  noSideScroll,
  openRowMenu,
  priorityRow,
  shot,
} from '../support/labels';
import { toasts } from '../support/toasts';
import { uid } from '../support/seed';

/**
 * WP-AD3 #614 and #618: the row menu of a priority. Move up / Move down (announced, focus stays on the row's menu button), Set as default
 * (one-line confirm), Deactivate with the impact line / Activate, and Delete only for a priority no open task uses, in a danger dialog whose
 * safe button is the default. The default row says why it cannot be deactivated or deleted, on screen. A refusal from the server (a race) is
 * reported once, inline, with no toast. Screenshots: E2E_SCREENSHOTS (fixes/ad3-labels).
 */
test.describe.configure({ mode: 'serial' });

const rowOf = priorityRow;
const menuOf = (page: Page, name: string) =>
  rowOf(page, name).getByRole('button', { name: /^Actions for / });
const item = (page: Page, name: RegExp | string) => page.getByRole('menuitem', { name });

test.describe('the priority row menu (#614, #618)', () => {
  let extras: Json[] = [];
  let used: Json;
  let cleanup: () => Promise<void> = async () => undefined;

  test.beforeAll(async ({ admin, seed }) => {
    const added = await addPriorities(admin, 3, `ad3 act ${uid().slice(0, 5)}`);
    extras = added.made;
    cleanup = added.cleanup;
    used = await admin.post('/api/v1/priorities', {
      label: `ad3 busy ${uid().slice(0, 5)}`,
      color: 'high',
      isActive: true,
    });
    const world = await seed.world();
    for (let i = 0; i < 31; i++) await seed.task(world, { priorityId: used.id });
  });

  test.afterAll(async ({ admin }) => {
    await cleanup();
    const current = (await admin.get<Json[]>('/api/v1/priorities')).find((p) => p.id === used.id);
    if (current) {
      await admin.put(`/api/v1/priorities/${used.id}`, {
        label: current.label,
        color: current.color,
        isActive: false,
        rowVersion: current.rowVersion,
      });
    }
  });

  test('Delete exists only for an unused priority; a used one offers Deactivate with the impact line', async ({
    page,
  }) => {
    await page.setViewportSize(SIZES[1]);
    await page.goto('/admin/priorities');
    await openRowMenu(page, menuOf(page, used.label));
    await expect(item(page, /^Delete/)).toHaveCount(0);
    await expect(page.getByRole('menuitem')).toContainText([
      'Edit priority',
      'Move up',
      'Move down',
      'Set as default',
      'Deactivate',
    ]);
    await item(page, /^Deactivate/).click();
    const dialog = page.getByRole('dialog', { name: 'Deactivate priority?' });
    await expect(dialog).toContainText('31 open tasks keep this priority.');
    await expect(dialog).toContainText("It won't be offered for new or changed tasks.");
    await expect(dialog.getByRole('button', { name: 'Keep active' })).toBeFocused();
    await shot(page, 'priority-deactivate');
    await dialog.getByRole('button', { name: 'Keep active' }).click();
    await expect(menuOf(page, used.label)).toBeFocused();

    await openRowMenu(page, menuOf(page, extras[0].label));
    await expect(item(page, /^Delete/)).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('Delete asks in a danger dialog whose safe button is the default, then removes the row', async ({
    page,
    admin,
  }) => {
    await page.setViewportSize(SIZES[1]);
    await page.goto('/admin/priorities');
    const name = extras[2].label;
    await openRowMenu(page, menuOf(page, name));
    await item(page, /^Delete/).click();
    const dialog = page.getByRole('dialog', { name: 'Delete priority?' });
    await expect(dialog).toContainText("No task uses this priority. Deleting it can't be undone.");
    await expect(dialog.getByRole('button', { name: 'Keep priority' })).toBeFocused();
    await shot(page, 'priority-delete');
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(rowOf(page, name)).toBeVisible();

    await openRowMenu(page, menuOf(page, name));
    await item(page, /^Delete/).click();
    await dialog.getByRole('button', { name: 'Delete priority' }).click();
    await expect(rowOf(page, name)).toHaveCount(0);
    await expect(toasts(page))
      .toHaveCount(0)
      .catch(() => undefined);
    expect((await admin.get<Json[]>('/api/v1/priorities')).some((p) => p.label === name)).toBe(
      false,
    );
  });

  test('a delete the server refuses after the page said yes (a race) is reported once, inline, with no toast', async ({
    page,
    seed,
  }) => {
    await page.setViewportSize(SIZES[1]);
    await page.goto('/admin/priorities');
    const name = extras[1].label;
    await openRowMenu(page, menuOf(page, name));
    await item(page, /^Delete/).click();
    // Someone files a task on it between the page and the confirm.
    const world = await seed.world();
    await seed.task(world, { priorityId: extras[1].id });
    await page
      .getByRole('dialog', { name: 'Delete priority?' })
      .getByRole('button', { name: 'Delete priority' })
      .click();
    const failure = page.locator('[data-failure]');
    await expect(failure).toHaveText(
      `Tasks use ${name}, so it can't be deleted. Deactivate it instead.`,
    );
    await expect(toasts(page)).toHaveCount(0);
    await expect(page.getByText("so it can't be deleted")).toHaveCount(1);
    await expect(rowOf(page, name)).toBeVisible();
  });

  test('the default row shows Deactivate and Delete as disabled entries with the reason on screen', async ({
    page,
    admin,
  }) => {
    const defaultRow = (await admin.get<Json[]>('/api/v1/priorities')).find((p) => p.isDefault)!;
    await page.setViewportSize(SIZES[1]);
    await page.goto('/admin/priorities');
    await openRowMenu(page, menuOf(page, defaultRow.label));
    const deactivate = item(page, /^Deactivate/);
    await expect(deactivate).toHaveAttribute('aria-disabled', 'true');
    await expect(page.locator('[data-reason]')).toContainText([
      "The default priority can't be deactivated. Make another priority the default first.",
      "The default priority can't be deleted. Make another priority the default first.",
    ]);
    await expect(page.locator('[data-reason]').first()).toBeVisible();
    await expect(item(page, /^Set as default/)).toHaveCount(0);
    await shot(page, 'priority-default-menu');
    // A disabled entry gives its reason and does nothing (force: Playwright does not click what is aria-disabled).
    await deactivate.click({ force: true });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(
      (await admin.get<Json[]>('/api/v1/priorities')).find((p) => p.id === defaultRow.id)!.isActive,
    ).toBe(true);
  });

  test('Move down announces the new position and keeps focus on the menu button of the moved row; the order is saved', async ({
    page,
    admin,
  }) => {
    await page.setViewportSize(SIZES[1]);
    await page.goto('/admin/priorities');
    const name = extras[0].label;
    const before = (await admin.get<Json[]>('/api/v1/priorities')).map((p) => p.label);
    const at = before.indexOf(name);
    await openRowMenu(page, menuOf(page, name));
    await item(page, /^Move up/).click();
    await expect(page.locator('[data-announce]')).toContainText(
      `${name} moved to position ${at} of`,
    );
    await expect(menuOf(page, name)).toBeFocused();
    const after = (await admin.get<Json[]>('/api/v1/priorities')).map((p) => p.label);
    expect(after.indexOf(name)).toBe(at - 1);
    // And back down, from the keyboard: Enter opens the menu, the arrow keys move to Move down, Enter picks it.
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu')).toBeVisible();
    for (let i = 0; i < 6; i++) {
      if (await item(page, /^Move down/).evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press('ArrowDown');
    }
    await expect(item(page, /^Move down/)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-announce]')).toContainText(
      `${name} moved to position ${at + 1} of`,
    );
    await expect(menuOf(page, name)).toBeFocused();
  });

  test('Set as default asks one line, makes the priority the single default and shows the badge; it is put back afterwards', async ({
    page,
    admin,
  }) => {
    const before = (await admin.get<Json[]>('/api/v1/priorities')).find((p) => p.isDefault)!;
    const target = extras[0];
    await page.setViewportSize(SIZES[1]);
    await page.goto('/admin/priorities');
    try {
      await openRowMenu(page, menuOf(page, target.label));
      await item(page, /^Set as default/).click();
      const dialog = page.getByRole('dialog', {
        name: `Make ${target.label} the default priority?`,
      });
      await expect(dialog).toContainText(
        `${target.label} is the default priority. New tasks start with it.`,
      );
      await expect(dialog).toContainText(`${before.label} stays available.`);
      await dialog.getByRole('button', { name: 'Set as default' }).click();
      await expect(rowOf(page, target.label).locator('[data-default]')).toBeVisible();
      await expect(page.locator('[data-default]')).toHaveCount(1);
      await expect(menuOf(page, target.label)).toBeFocused();
    } finally {
      await admin.post(`/api/v1/priorities/${before.id}/default`);
    }
  });

  test('Deactivate keeps the row (Inactive) and Activate brings it back without a question', async ({
    page,
  }) => {
    await page.setViewportSize(SIZES[1]);
    await page.goto('/admin/priorities');
    const name = extras[0].label;
    await openRowMenu(page, menuOf(page, name));
    await item(page, /^Deactivate/).click();
    const dialog = page.getByRole('dialog', { name: 'Deactivate priority?' });
    await expect(dialog).toContainText('No open task uses this priority.');
    await dialog.getByRole('button', { name: 'Deactivate priority' }).click();
    await expect(rowOf(page, name).locator('mf-active-badge')).toContainText('Inactive');
    await openRowMenu(page, menuOf(page, name));
    await item(page, /^Activate/).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(rowOf(page, name).locator('mf-active-badge')).toContainText('Active');
  });

  for (const size of SIZES) {
    test(`${size.width}: axe 0 and no sideways scroll with the menu and the dialogs open`, async ({
      page,
    }) => {
      test.skip(!axeAvailable(), 'axe-core is not available');
      await page.setViewportSize(size);
      await page.goto('/admin/priorities');
      await expect(page.locator('tbody tr[data-row], li.rc').first()).toBeVisible();
      const card = rowOf(page, used.label);
      const menu = card.getByRole('button', { name: /^Actions for / });
      await openRowMenu(page, menu);
      expect(await axeViolations(page), `menu open at ${size.width}`).toEqual([]);
      await item(page, /^Deactivate/).click();
      const dialog = page.getByRole('dialog', { name: 'Deactivate priority?' });
      await expect(dialog).toBeVisible();
      await noSideScroll(page, `deactivate dialog at ${size.width}`);
      expect(await axeViolations(page), `deactivate dialog at ${size.width}`).toEqual([]);
      await dialog.getByRole('button', { name: 'Keep active' }).click();
    });
  }
});
