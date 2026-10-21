import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { SIZES, noHorizontalScroll, shot } from '../support/screens';
import { uid } from '../support/seed';

/**
 * WP-AD7 (AD-E): the Audit Logs page on the admin list kit. Chrome (#646), the grid and the phone cards (#647), links to the admin pages by
 * permission (#648), friendly filter options (#650), simpler rows (#651), readable details (#652), the loaded count (#653), the quick views
 * (#654), day dividers and the time alone (#655) and the Who filter without User.View (#656). Screenshots go to E2E_SCREENSHOTS
 * (docs/ux/admin-pages-review/fixes/ad7-audit). The axe checks FAIL when axe-core is missing (set E2E_AXE_PATH to axe.min.js).
 */
const crumbs = (page: Page) => page.getByRole('navigation', { name: 'Breadcrumb' }).locator('li');
const rows = (page: Page) => page.locator('tr[data-event], li [data-event]');
/** Any row of the log: an event or a group of one operation (the log groups by default). */
const anyRow = (page: Page) =>
  page.locator('tr[data-event], tr[data-group], li [data-event], li [data-group]');

interface Seeded {
  token: string;
  assetType: { id: number; name: string };
  priority: { id: number; label: string };
  taskNumber: string;
  taskId: number;
}

let s: Seeded;

test.beforeAll(async ({ admin, seed }) => {
  const token = uid();
  const name = `Audited Type ${token}`;
  const type = await admin.post('/api/v1/asset-types', { name, description: null });
  // A rename writes one more event (and a field change for the old and new name).
  await admin.put(`/api/v1/asset-types/${type.assetTypeId}`, {
    name: `${name} v2`,
    description: 'Updated description',
    sortOrder: type.sortOrder,
    isActive: true,
    rowVersion: type.rowVersion,
  });
  const priority = await admin.post('/api/v1/priorities', {
    label: `Rush ${token}`,
    color: 'high',
  });
  const world = await seed.world();
  const task = await seed.task(world, { title: `Audit chrome ${token}` });
  s = {
    token,
    assetType: { id: type.assetTypeId, name: `${name} v2` },
    priority: { id: priority.id, label: priority.label },
    taskNumber: task.taskNumber,
    taskId: task.taskId,
  };
});

function requireAxe(): void {
  expect(axeAvailable(), 'axe-core is required: set E2E_AXE_PATH to the path of axe.min.js').toBe(
    true,
  );
}

/** Opens the log with these filters and, unless `grouped`, one row per event (the log groups the events of one operation by default). */
const filterTo = async (page: Page, query: string, grouped = false) => {
  await page.goto(`/admin/audit?${query}`);
  await expect(anyRow(page).first()).toBeVisible();
  if (!grouped) {
    await page.getByLabel('Group events of one operation').uncheck();
    await expect(rows(page).first()).toBeVisible();
  }
};

test.describe('Audit Logs chrome (#646)', () => {
  test('crumb, title, one-line description, Filters in the header, the filter row open, one Clear', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/admin/audit');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Audit Logs');
    await expect(page).toHaveTitle('Audit Logs - MatterFlow');
    await expect(crumbs(page)).toHaveText([/Administration/, /Audit Logs/]);
    const description = page.locator('[data-page-description]');
    await expect(description).toHaveText('Every recorded change, newest first. Read only.');
    // Not cut off at 1366.
    expect(
      await description.evaluate((el) => (el as HTMLElement).scrollWidth <= el.clientWidth),
    ).toBe(true);

    const header = page.locator('mf-page-header');
    await expect(header.getByRole('button', { name: /^Filters/ })).toBeVisible();
    // The filter row is open from the start (from 640 px) and the grouping is a small toggle above the grid, not a row of its own.
    await expect(page.locator('[data-filter-row]')).toBeVisible();
    await expect(page.getByLabel('Group events of one operation')).toBeVisible();

    // One Clear filters, in the header: it appears with a filter and goes with it.
    await expect(header.getByRole('button', { name: 'Clear filters' })).toHaveCount(0);
    await page.goto(`/admin/audit?objectType=AssetType&objectId=${s.assetType.id}`);
    await expect(header.getByRole('button', { name: 'Clear filters' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clear filters' })).toHaveCount(1);
    await header.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page).toHaveURL(/\/admin\/audit$/);
    await shot(page, 'audit-chrome');
  });

  test('"Skip to table" is the first Tab stop and moves focus to the table', async ({ page }) => {
    await page.goto('/admin/audit');
    await expect(anyRow(page).first()).toBeVisible();
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to table' });
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#audit-table')).toBeFocused();
  });

  test('on a phone the controls are in a sheet behind the Filters button', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/admin/audit');
    await expect(page.locator('[data-filter-row]')).toHaveCount(0);
    await page
      .locator('mf-page-header')
      .getByRole('button', { name: /^Filters/ })
      .click();
    await expect(page.getByRole('dialog')).toBeVisible();
    requireAxe();
    expect(await axeViolations(page), 'filter sheet at 375').toEqual([]);
    await shot(page, 'audit-filter-sheet');
  });
});

test.describe('Audit grid, cards, dividers and counter (#647, #651, #653, #655)', () => {
  test('the grid has five columns from 1100 px, Who joins When at 768, and a day divider with the time alone', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await filterTo(page, `objectType=AssetType&objectId=${s.assetType.id}`);
    await expect(page.locator('#audit-table thead tr').first().locator('th')).toHaveText([
      'Details',
      'When',
      'Who',
      'What happened',
      'Object',
      'Actions',
    ]);
    await expect(page.locator('tr.au-day th').first()).toHaveText('Today');
    await expect(page.locator('tr.au-day th').first()).toHaveAttribute('scope', 'row');
    const time = page.locator('tr[data-event] time').first();
    await expect(time).toHaveText(/^\d{1,2}:\d{2} [AP]M$/);
    // The whole stamp and the zone are the tooltip.
    await expect(time).toHaveAttribute('title', /\d{4}, \d{1,2}:\d{2} [AP]M [A-Z]{2,4}/);
    // The object is two lines at most.
    const object = page.locator('tr[data-event] .au-clamp').first();
    expect((await object.boundingBox())!.height).toBeLessThanOrEqual(40);

    await page.setViewportSize({ width: 768, height: 1024 });
    await expect(page.locator('#audit-table thead th')).toHaveText([
      'Details',
      'When',
      'What happened',
      'Object',
      'Actions',
    ]);
    await expect(page.locator('tr[data-event]').first().locator('.au-sub')).toContainText('kekim', {
      ignoreCase: true,
    });
    await noHorizontalScroll(page);
  });

  test('on a phone the events are cards with the details inside, and nothing scrolls sideways', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await filterTo(page, `objectType=AssetType&objectId=${s.assetType.id}`);
    await expect(page.locator('#audit-table')).toHaveCount(0);
    const card = page.locator('li.rc [data-event]').first();
    await expect(card).toContainText('kekim', { ignoreCase: true });
    await expect(page.locator('h2[data-day]').first()).toHaveText('Today');
    await card.getByRole('button', { name: /^Show details: / }).click();
    await expect(card.locator('[data-sentence]')).toBeVisible();
    await noHorizontalScroll(page);
    await shot(page, 'audit-cards');
  });

  test('"Show only this operation" is in the details, moves focus to the chip, and there is no banner', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    // Saving an asset type writes several events in one operation: they are one group row, which has no button of its own.
    await filterTo(page, `objectType=AssetType&objectId=${s.assetType.id}`, true);
    const group = page.locator('tr[data-group]').first();
    await expect(group).toBeVisible();
    await expect(group.locator('button.mf-btn--text')).toHaveCount(0);
    await group.getByRole('button', { name: /^Show the \d+ events/ }).click();
    await page.locator('tr[data-event] .au-toggle').first().click();
    await page.locator('[data-show-operation]').first().click();
    await expect(page).toHaveURL(/correlationId=/);
    await expect(page.locator('[data-chip="correlationId"] button')).toBeFocused();
    await expect(page.locator('[data-operation-banner]')).toHaveCount(0);
    await expect(
      page.locator('mf-page-header').getByRole('button', { name: 'Clear filters' }),
    ).toHaveCount(1);
  });

  test('the loaded count is a polite status line, next to Load more', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/admin/audit');
    await expect(anyRow(page).first()).toBeVisible();
    const count = page.locator('[data-loaded]');
    await expect(count).toHaveText(/\d+ events? loaded\./);
    await expect(count).toHaveAttribute('aria-live', 'polite');
    await expect(page.locator('[data-many]')).toHaveCount(0);
    const more = page.locator('[data-load-more]');
    if ((await more.count()) > 0) {
      const before = Number(
        (await count.textContent())!.match(/^\s*([\d,]+)/)![1].replace(',', ''),
      );
      await more.click();
      await expect(count).not.toContainText(`${before} events loaded`);
    }
  });
});

test.describe('Object links by permission (#648)', () => {
  test('an AssetType.Manage person opens the asset type from the log; an Audit.View-only person gets plain text', async ({
    personas,
    asUser,
  }) => {
    const query = `objectType=AssetType&objectId=${s.assetType.id}`;
    const manager = await personas.create({
      label: 'audit-assettype',
      permissions: ['Audit.View', 'AssetType.Manage'],
    });
    const page = await asUser(manager.username);
    await filterTo(page, query);
    const link = page.locator('tr[data-event] a.au-linkout').first();
    await expect(link).toHaveText(`Asset type: ${s.assetType.name}`);
    await expect(link).toHaveAttribute('href', `/admin/asset-types/${s.assetType.id}`);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/admin/asset-types/${s.assetType.id}$`));

    const reader = await personas.create({ label: 'audit-only', permissions: ['Audit.View'] });
    const plain = await asUser(reader.username);
    await filterTo(plain, query);
    await expect(plain.locator('a.au-linkout')).toHaveCount(0);
    await expect(plain.locator('tr[data-event]').first()).toContainText(
      `Asset type: ${s.assetType.name}`,
    );
    // The priority goes to the Labels page only with Priority.Manage.
    await filterTo(plain, `objectType=Priority&objectId=${s.priority.id}`);
    await expect(plain.locator('tr[data-event]').first()).toContainText(
      `Priority: ${s.priority.label}`,
    );
    await expect(plain.locator('a.au-linkout')).toHaveCount(0);
  });

  test('a priority event links to the Labels page for Priority.Manage', async ({
    personas,
    asUser,
  }) => {
    const labeler = await personas.create({
      label: 'audit-priority',
      permissions: ['Audit.View', 'Priority.Manage'],
    });
    const page = await asUser(labeler.username);
    await filterTo(page, `objectType=Priority&objectId=${s.priority.id}`);
    await page.locator('tr[data-event] a.au-linkout').first().click();
    await expect(page).toHaveURL(/\/admin\/priorities$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Labels');
  });
});

test.describe('Friendly filters and quick views (#650, #654)', () => {
  test('Event type and Object type read as words; the code is the value in the address', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/admin/audit');
    await expect(anyRow(page).first()).toBeVisible();
    const events = page.getByRole('combobox', { name: 'Filter by Event type' });
    await expect(events.locator('option', { hasText: 'Task created' })).toHaveAttribute(
      'value',
      'TASK_CREATED',
    );
    await expect(events.locator('option', { hasText: /^[A-Z]+_[A-Z_]+$/ })).toHaveCount(0);
    const objects = page.getByRole('combobox', { name: 'Filter by Object type' });
    await expect(objects.locator('option', { hasText: 'Asset type' })).toHaveAttribute(
      'value',
      'AssetType',
    );
    await expect(objects.locator('option', { hasText: 'Configuration changes' })).toHaveCount(1);
    await events.selectOption('TASK_CREATED');
    await expect(page).toHaveURL(/eventType=TASK_CREATED/);
    await expect(events.locator('option:checked')).toHaveText('Task created');
    // On a phone the filter is a chip: it says it in words too.
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/admin/audit?eventType=TASK_CREATED&objectType=AssetType');
    await expect(page.locator('[data-chip="eventType"]')).toContainText('Task created');
    await expect(page.locator('[data-chip="objectType"]')).toContainText('Asset type');
  });

  test('the four quick views set address filters, show the pressed one and clear it', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/admin/audit');
    const view = (key: string) => page.locator(`[data-view="${key}"]`);
    await expect(view('today')).toHaveAttribute('aria-pressed', 'false');

    await view('config').click();
    await expect(page).toHaveURL(/objectType=AssetType/);
    await expect(view('config')).toHaveAttribute('aria-pressed', 'true');
    // Only configuration objects are listed: the asset type created for this spec is, a task is not.
    await expect(page.locator('tr[data-event]').first()).toBeVisible();
    await expect(page.locator('tr[data-event]').filter({ hasText: 'Task:' })).toHaveCount(0);
    await view('config').click();
    await expect(page).toHaveURL(/\/admin\/audit$/);

    await view('access').click();
    await expect(page).toHaveURL(/objectType=User/);
    await expect(view('access')).toHaveAttribute('aria-pressed', 'true');
    await view('today').click();
    await expect(page).toHaveURL(/from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}/);
    await expect(view('today')).toHaveAttribute('aria-pressed', 'true');
    await expect(view('access')).toHaveAttribute('aria-pressed', 'false');
    // Keyboard: Enter on a focused chip presses it.
    await view('last7').focus();
    await page.keyboard.press('Enter');
    await expect(view('last7')).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('Details (#652) and Who without User.View (#656)', () => {
  test('the toggle is named by what happened and who; the details lead with a sentence and the Old -> New pair; technical facts are on request', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await filterTo(
      page,
      `objectType=AssetType&objectId=${s.assetType.id}&eventType=FIELD_CHANGED&q=Description`,
    );
    const row = page.locator('tr[data-event]').first();
    const toggle = row.getByRole('button', { name: /^Show details: .* by / });
    await expect(toggle).toHaveAccessibleName(/^Show details: Description .* by /i);
    await toggle.click();
    const detail = page.locator('tr.au-detail').first();
    await expect(detail.locator('[data-sentence]')).toContainText(/ by .*, [A-Z][a-z]{2} \d/);
    await expect(detail.locator('[data-field]')).toHaveText('Description');
    await expect(detail.locator('[data-old]')).toHaveText('(empty)');
    await expect(detail.locator('[data-new]')).toHaveText('Updated description');
    // The code and the ids are behind "Technical details", a real disclosure.
    await expect(detail.locator('[data-tech]')).toHaveCount(0);
    await expect(detail).not.toContainText('FIELD_CHANGED');
    const tech = detail.getByRole('button', { name: 'Technical details' });
    await expect(tech).toHaveAttribute('aria-expanded', 'false');
    await tech.focus();
    await page.keyboard.press('Enter');
    await expect(tech).toHaveAttribute('aria-expanded', 'true');
    await expect(detail.locator('[data-tech]')).toContainText('FIELD_CHANGED');
    await expect(detail.locator('[data-tech]')).toContainText('Description');
    await shot(page, 'audit-details');
  });

  test('a long value is clamped with Show full', async ({ page, admin }) => {
    const long = `Long ${uid()} ` + 'word '.repeat(80);
    const type = await admin.post('/api/v1/asset-types', {
      name: `Long ${uid()}`,
      description: null,
    });
    await admin.put(`/api/v1/asset-types/${type.assetTypeId}`, {
      name: type.name,
      description: long.slice(0, 480),
      sortOrder: type.sortOrder,
      isActive: true,
      rowVersion: type.rowVersion,
    });
    await page.setViewportSize({ width: 1366, height: 768 });
    await filterTo(
      page,
      `objectType=AssetType&objectId=${type.assetTypeId}&eventType=FIELD_CHANGED&q=Description`,
    );
    await page.locator('tr[data-event] .au-toggle').first().click();
    const value = page.locator('tr.au-detail [data-new]');
    await expect(value).toHaveClass(/au-clamped/);
    await page.getByRole('button', { name: 'Show full' }).click();
    await expect(value).not.toHaveClass(/au-clamped/);
    await expect(page.getByRole('button', { name: 'Show less' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  test('with Audit.View alone the Who filter offers the names in the loaded events, and the address keeps the id', async ({
    personas,
    asUser,
  }) => {
    const reader = await personas.create({ label: 'audit-who', permissions: ['Audit.View'] });
    const page = await asUser(reader.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await filterTo(page, `objectType=AssetType&objectId=${s.assetType.id}`);
    await expect(page.getByLabel('Filter by Who (user id)')).toHaveCount(0);
    const who = page.locator('button[data-filter="actor"]');
    await who.click();
    const option = page
      .getByRole('option', { name: /kekim/i })
      .or(page.getByRole('checkbox', { name: /kekim/i }));
    await expect(option.first()).toBeVisible();
    await option.first().click();
    await expect(page).toHaveURL(/actor=\d+/);
    await expect(page.locator('tr[data-event]').first()).toBeVisible();
  });
});

test.describe('Audit accessibility (#647, #646)', () => {
  test('axe finds nothing at 375, 768, 1366 and 1920 with the list, a row menu and details open; no sideways scroll', async ({
    page,
  }) => {
    requireAxe();
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await filterTo(page, `objectType=AssetType&objectId=${s.assetType.id}`);
      expect(await axeViolations(page), `list at ${size.width}`).toEqual([]);
      await noHorizontalScroll(page);

      const toggle = page
        .locator(size.width < 640 ? 'li.rc button.auc__what' : 'tr[data-event] .au-toggle')
        .first();
      await toggle.click();
      await expect(page.locator('[data-sentence]').first()).toBeVisible();
      expect(await axeViolations(page), `details at ${size.width}`).toEqual([]);

      await page
        .getByRole('button', { name: /^Actions for / })
        .first()
        .click();
      await expect(page.getByRole('menu')).toBeVisible();
      expect(await axeViolations(page), `menu at ${size.width}`).toEqual([]);
      await page.keyboard.press('Escape');
      await noHorizontalScroll(page);
      if (size.width === 1366 || size.width === 375) await shot(page, 'audit-open');
    }
  });
});
