import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { pmFixtures } from '../support/pm-fixtures';
import { toasts } from '../support/toasts';

/**
 * Project managers on matters (epic #667, #688 and #689): the Matters list columns, filters, Mine and the bulk "Set project managers", the matter
 * header line with its Change dialog, and the small health strip. A matter without a manager is normal: nothing on these pages warns about it.
 * Permission variants: Project Manager, Director (holds Matter.AssignManagers), Matter.Edit without it, and the Read-Only Observer.
 */
const SIZES: [number, number][] = [
  [1366, 768],
  [1920, 1080],
  [768, 1024],
  [375, 812],
];

const rowOf = (page: Page, name: string) => page.locator('tbody tr', { hasText: name });

async function noSideScroll(page: Page) {
  const wide = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(wide, 'page-level sideways scroll').toBe(false);
}

test.describe('Matters list: project managers', () => {
  test('shows the Primary column, leaves empty cells empty and never warns about a matter without a manager', async ({
    seed,
    personas,
    asUser,
  }) => {
    const fx = await pmFixtures(seed, personas);
    const page = await asUser(fx.pmA.username);
    await page.goto(`/matters?name=${fx.token}`);

    await expect(page.locator('tbody tr')).toHaveCount(12);
    await expect(rowOf(page, 'Alpha primary').locator('[data-primary-manager]')).toContainText(
      'PM Alpha',
    );
    await expect(rowOf(page, 'Alpha both').locator('[data-secondary-manager]')).toContainText(
      'PM Bravo',
    );
    await expect(rowOf(page, 'No manager one').locator('[data-primary-manager]')).toHaveText('');
    await expect(rowOf(page, 'No manager one').locator('[data-secondary-manager]')).toHaveText('');
    await expect(
      page.locator('[data-primary-manager]').filter({ hasText: /unassigned|no manager/i }),
    ).toHaveCount(0);
  });

  test('Mine, the column filters (a person, None) and the sort', async ({
    seed,
    personas,
    asUser,
  }) => {
    const fx = await pmFixtures(seed, personas);
    const page = await asUser(fx.pmA.username);
    await page.goto(`/matters?name=${fx.token}`);

    await page.locator('[data-mine]').click();
    await expect(page).toHaveURL(/mine=true/);
    await expect(page.locator('tbody tr')).toHaveCount(7); // primary, secondary, both, overdue, unassigned, hold, clean
    await expect(rowOf(page, 'Bravo solo')).toHaveCount(0);

    await page.goto(`/matters?name=${fx.token}&primaryManager=none`);
    await expect(page.locator('tbody tr')).toHaveCount(4); // secondary only and the three without a manager
    await page.goto(`/matters?name=${fx.token}&secondaryManager=${fx.pmB.userId}`);
    await expect(page.locator('tbody tr')).toHaveCount(2);
    await page.goto(`/matters?name=${fx.token}&primaryManager=${fx.pmB.userId}`);
    await expect(page.locator('tbody tr')).toHaveCount(2); // secondary (Bravo primary) and solo

    await page.goto(`/matters?name=${fx.token}&sort=primaryManager`);
    const last = page.locator('tbody tr').last();
    await expect(last.locator('[data-primary-manager]')).toHaveText(''); // matters without a Primary come last
  });

  test('a person with Matter.AssignManagers ticks matters and sets the managers in one dialog', async ({
    seed,
    personas,
    asUser,
  }) => {
    const fx = await pmFixtures(seed, personas);
    const page = await asUser(fx.director.username);
    await page.goto(`/matters?name=${fx.token}`);

    await page.locator('[data-select-mode]').click();
    await rowOf(page, 'No manager one').locator('[data-select-row]').check();
    await rowOf(page, 'No manager two').locator('[data-select-row]').check();
    await page.getByRole('button', { name: 'Set project managers' }).click();
    const dialog = page.locator('[data-managers-dialog]');
    await expect(dialog.locator('[data-managers-bulk-note]')).toContainText('2 matters selected');
    await dialog
      .locator('[data-manager-select=primary]')
      .selectOption({ label: `PM Bravo ${fx.token}` });
    await page.locator('[data-confirm-primary]').click();
    await expect(toasts(page).first()).toContainText('Project managers set on 2 matters');
    await expect(rowOf(page, 'No manager two').locator('[data-primary-manager]')).toContainText(
      'PM Bravo',
    );
  });

  for (const [label, key] of [
    ['Read-Only Observer', 'observer'],
    ['Matter.Edit without Matter.AssignManagers', 'editor'],
  ] as const) {
    test(`${label}: no tick boxes, no bulk action, no Mine`, async ({ seed, personas, asUser }) => {
      const fx = await pmFixtures(seed, personas);
      const page = await asUser(fx[key].username);
      await page.goto(`/matters?name=${fx.token}`);
      await expect(page.locator('tbody tr').first()).toBeVisible();
      await expect(
        page.locator('[data-select-mode], [data-select-row], [data-select-all], [data-mine]'),
      ).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Set project managers' })).toHaveCount(0);
    });
  }

  for (const [w, h] of SIZES) {
    test(`axe and no sideways scroll at ${w}x${h}`, async ({ seed, personas, asUser }) => {
      test.skip(!axeAvailable(), 'axe-core is not installed');
      const fx = await pmFixtures(seed, personas);
      const page = await asUser(fx.director.username);
      await page.setViewportSize({ width: w, height: h });
      await page.goto(`/matters?name=${fx.token}`);
      await expect(page.locator('tbody tr, [data-record-card]').first()).toBeVisible();
      expect(await axeViolations(page)).toEqual([]);
      await noSideScroll(page);
    });
  }
});

test.describe('Matter page: project managers', () => {
  test('the header line shows Primary and Secondary; a matter without one shows nothing to a viewer', async ({
    seed,
    personas,
    asUser,
  }) => {
    const fx = await pmFixtures(seed, personas);
    const viewer = await asUser(fx.observer.username);
    await viewer.goto(`/matters/${fx.m.both.matterId}`);
    const line = viewer.locator('[data-managers]');
    await expect(line).toContainText(`PM Alpha ${fx.token}`);
    await expect(line).toContainText('(primary)');
    await expect(line).toContainText(`PM Bravo ${fx.token}`);
    await expect(line).toContainText('(secondary)');
    await expect(viewer.locator('[data-change-managers], [data-add-managers]')).toHaveCount(0);

    await viewer.goto(`/matters/${fx.m.none3.matterId}`);
    await expect(viewer.locator('h1')).toBeVisible();
    await expect(viewer.locator('[data-managers]')).toHaveCount(0);
  });

  test('Change opens the dialog, Escape returns focus to Change, Save audits the change with names', async ({
    seed,
    personas,
    asUser,
    admin,
  }) => {
    const fx = await pmFixtures(seed, personas);
    const page = await asUser(fx.director.username);
    await page.goto(`/matters/${fx.m.clean.matterId}`);

    const change = page.locator('[data-change-managers]');
    await change.focus();
    await change.press('Enter');
    await expect(page.locator('[data-managers-dialog]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-managers-dialog]')).toBeHidden();
    await expect(change).toBeFocused();

    await change.click();
    await page
      .locator('[data-manager-select=secondary]')
      .selectOption({ label: `PM Bravo ${fx.token}` });
    await page.locator('[data-confirm-primary]').click();
    await expect(page.locator('[data-secondary-manager]')).toContainText('PM Bravo');

    const events = await admin.get<{
      items: { eventType: string; fieldKey: string; newValue: string | null }[];
    }>(`/api/v1/audit/events?objectType=Matter&objectId=${fx.m.clean.matterId}&pageSize=50`);
    const changed = events.items.find(
      (e) => e.eventType === 'MATTER_MANAGER_CHANGED' && e.fieldKey === 'SecondaryManager',
    );
    expect(changed?.newValue).toContain('PM Bravo');
  });

  test('an unassigned matter shows Add project manager to a person with the permission only', async ({
    seed,
    personas,
    asUser,
  }) => {
    const fx = await pmFixtures(seed, personas);
    const director = await asUser(fx.director.username);
    await director.goto(`/matters/${fx.m.none3.matterId}`);
    await expect(director.locator('[data-add-managers]')).toHaveText('Add project manager');

    const editor = await asUser(fx.editor.username);
    await editor.goto(`/matters/${fx.m.none3.matterId}`);
    await expect(editor.locator('h1')).toBeVisible();
    await expect(editor.locator('[data-add-managers], [data-managers]')).toHaveCount(0);
  });

  test('the health strip numbers equal the task grid they open; none without Task.View', async ({
    seed,
    personas,
    asUser,
  }) => {
    const fx = await pmFixtures(seed, personas);
    const page = await asUser(fx.pmA.username);
    await page.goto(`/matters/${fx.m.unassigned.matterId}`);
    const strip = page.locator('mf-matter-health-strip');
    await expect(strip.locator('[data-strip-item=unassigned]')).toContainText('2');
    await strip.locator('[data-strip-item=unassigned]').click();
    await expect(page).toHaveURL(/\/tasks\?.*unassigned=true/);
    await expect(page.locator('tbody tr[data-task]')).toHaveCount(2);

    const noTask = await asUser(fx.pmNoTask.username);
    await noTask.goto(`/matters/${fx.m.unassigned.matterId}`);
    await expect(noTask.locator('h1')).toBeVisible();
    await expect(noTask.locator('mf-matter-health-strip [data-strip-item]')).toHaveCount(0);
  });

  for (const [w, h] of SIZES) {
    test(`axe with the dialog open at ${w}x${h}`, async ({ seed, personas, asUser }) => {
      test.skip(!axeAvailable(), 'axe-core is not installed');
      const fx = await pmFixtures(seed, personas);
      const page = await asUser(fx.director.username);
      await page.setViewportSize({ width: w, height: h });
      await page.goto(`/matters/${fx.m.both.matterId}`);
      await page.locator('[data-change-managers]').click();
      await expect(page.locator('[data-managers-dialog]')).toBeVisible();
      expect(await axeViolations(page)).toEqual([]);
      await noSideScroll(page);
    });
  }
});
