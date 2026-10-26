import { TaskDetailPage } from '../pages/task-detail.page';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { failApi } from '../support/personas';
import { SIZES, atEverySize, noHorizontalScroll, shot } from '../support/screens';
import { uid } from '../support/seed';

/**
 * Assets UX review, package WP-AS2 (docs/ux/assets-review): the asset record page `/assets/:id` (#490), its honest load states (#491),
 * tabs (#492), focus and the way back (#494) and the inbound links (#495).
 * Screenshots: E2E_SCREENSHOTS=docs/ux/assets-review/fixes/as2-record-page.
 */
test.describe('Asset record page (WP-AS2)', () => {
  test.beforeEach(() => {
    expect(axeAvailable(), 'axe-core must be available (set E2E_AXE_PATH)').toBe(true);
  });

  async function assetWithTasks(seed: import('../support/seed').Seeder, linked = 3) {
    const world = await seed.world();
    const token = uid();
    const asset = await seed.asset(world.matter, `Record ${token}`);
    for (let i = 0; i < linked; i++) {
      const task = await seed.task(world);
      await seed.admin.post(`/api/v1/tasks/${task.taskId}/assets`, { assetId: asset.assetId });
    }
    return { world, asset, token };
  }

  test('the header shows the name, type, status and matter, and the heading has focus; the title names the record and tab', async ({
    page,
    seed,
  }) => {
    const { world, asset } = await assetWithTasks(seed);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/assets/${asset.assetId}`);

    const h1 = page.getByRole('heading', { level: 1, name: asset.displayName });
    await expect(h1).toBeVisible();
    await expect(h1).toBeFocused();
    await expect(page).toHaveTitle(new RegExp(`^${asset.displayName}: Details`));
    const header = page.locator('[data-record-header]');
    await expect(header.locator('[data-type-badge]')).toBeVisible();
    await expect(header.locator('mf-active-badge')).toContainText('Active');
    await expect(header.locator('[data-matter]')).toContainText(world.matter.matterRef);
    await expect(header.locator('[data-matter] a')).toHaveAttribute(
      'href',
      `/matters/${world.matter.matterId}`,
    );
    // Edit, Activity and the overflow, in that order; no primary action.
    const order = await page
      .locator('[data-page-actions] > *')
      .evaluateAll((els) =>
        els.map((e) => e.getAttribute('data-action') ?? e.tagName.toLowerCase()),
      );
    expect(order.slice(0, 2)).toEqual(['edit', 'activity']);
    await shot(page, 'as2-record-details');
  });

  test('tabs: Details, Linked tasks (n) and History live in ?tab=, survive a reload, and the count is the number of linked tasks', async ({
    page,
    seed,
  }) => {
    const { asset } = await assetWithTasks(seed, 3);
    await page.goto(`/assets/${asset.assetId}`);
    await expect(page.getByRole('tab', { name: /^Linked tasks/ })).toContainText('(3)');

    await page.getByRole('tab', { name: /^Linked tasks/ }).click();
    await expect(page).toHaveURL(/tab=tasks/);
    await expect(page.locator('[data-tasks-tab] tbody tr')).toHaveCount(3);
    await page.reload();
    await expect(page.getByRole('tab', { name: /^Linked tasks/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    // Arrow keys move between tabs, as on the other record pages.
    await page.getByRole('tab', { name: /^Linked tasks/ }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'History' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page).toHaveURL(/tab=history/);
    await page.getByRole('tab', { name: 'Details' }).click();
    await expect(page).not.toHaveURL(/tab=/);

    // Activity in the header opens History.
    await page.getByRole('button', { name: 'Activity' }).click();
    await expect(page.getByRole('tab', { name: 'History' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('permission variants: Asset.View only sees no actions and no History; without Task.View the tab has no count; Edit and Audit.View add Edit, the overflow and Activity', async ({
    seed,
    personas,
    asUser,
  }) => {
    const { asset } = await assetWithTasks(seed, 2);
    const viewer = await personas.create({ label: 'assetview', permissions: ['Asset.View'] });
    const editor = await personas.create({
      label: 'assetedit',
      permissions: ['Asset.View', 'Asset.Edit', 'Audit.View', 'Task.View', 'Matter.View'],
    });

    const page = await asUser(viewer.username);
    await page.goto(`/assets/${asset.assetId}`);
    await expect(page.getByRole('heading', { level: 1, name: asset.displayName })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Activity' })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'History' })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Linked tasks', exact: true })).toBeVisible(); // no count without Task.View
    await expect(page.locator('[data-matter] a')).toHaveCount(0); // no Matter.View: plain text
    await page.goto(`/assets/${asset.assetId}?tab=history`);
    await expect(page.getByRole('tab', { name: 'Details' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.goto(`/assets/${asset.assetId}?tab=tasks`);
    await expect(page.locator('[data-no-access="linked-tasks"]')).toContainText(
      "You don't have permission to view tasks.",
    );

    const edit = await asUser(editor.username);
    await edit.goto(`/assets/${asset.assetId}`);
    await expect(edit.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
    await expect(edit.getByRole('button', { name: 'Activity' })).toBeVisible();
    await expect(edit.getByRole('button', { name: 'More actions' })).toBeVisible();
    await expect(edit.getByRole('tab', { name: /^Linked tasks/ })).toContainText('(2)');
  });

  test('Set inactive from the overflow asks, then updates the page in place; an inactive asset has no Edit and offers Set active', async ({
    page,
    seed,
  }) => {
    const { asset } = await assetWithTasks(seed, 1);
    await page.goto(`/assets/${asset.assetId}`);
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Set inactive' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(`Set ${asset.displayName} inactive?`);
    await dialog.getByRole('button', { name: 'Set inactive' }).click();
    await expect(page.getByText('This asset is inactive')).toBeVisible();
    await expect(page.locator('[data-record-header] mf-active-badge')).toContainText('Inactive');
    await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Set active' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Set active' }).click();
    await expect(page.getByText('This asset is inactive')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
  });

  test('states: 404 has a link back and no Retry, 403 says no access, a server fault has the reference and a Retry that recovers', async ({
    page,
    seed,
  }) => {
    const { asset } = await assetWithTasks(seed, 0);

    await page.goto('/assets/999999999');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      "We couldn't find that asset.",
    );
    await expect(page.getByRole('link', { name: 'Go to assets' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0);
    await expect(page).toHaveTitle(/^Asset not found/);
    await shot(page, 'as2-record-404');

    const unroute = await failApi(page, `**/api/v1/assets/${asset.assetId}`, 403);
    await page.goto(`/assets/${asset.assetId}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      "You don't have access to this asset.",
    );
    await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0);
    await unroute();

    await failApi(page, `**/api/v1/assets/${asset.assetId}`, 500, { times: 1 });
    await page.goto(`/assets/${asset.assetId}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText("Couldn't load this asset.");
    await expect(page.locator('[data-record-error]')).toContainText('e2e-500-trace');
    await expect(page.getByRole('alert').filter({ hasText: 'Something went wrong' })).toBeVisible();
    await shot(page, 'as2-record-error');
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByRole('heading', { level: 1, name: asset.displayName })).toBeFocused();
  });

  test('inbound links: the Matter Assets tab and the Task page open the record page, and Back returns to where you were', async ({
    page,
    seed,
  }) => {
    const { world, asset } = await assetWithTasks(seed, 1);
    await page.goto(`/matters/${world.matter.matterId}?tab=assets`);
    await page.getByRole('link', { name: asset.displayName }).click();
    await expect(page).toHaveURL(new RegExp(`/assets/${asset.assetId}$`));
    await expect(page.getByRole('heading', { level: 1, name: asset.displayName })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/matters/${world.matter.matterId}\\?tab=assets`));

    await page.goto(`/assets/${asset.assetId}?tab=tasks`);
    await page.locator('[data-tasks-tab] tbody a').first().click();
    await expect(page).toHaveURL(/\/tasks\/\d+/);
  });

  test('Details: the Asset and "<Type> fields (n)" sections; no schema request that must fail without Task.View; the matter link follows Matter.View', async ({
    page,
    seed,
    admin,
    personas,
    asUser,
  }) => {
    const token = uid();
    const world = await seed.world();
    const type = await admin.post('/api/v1/asset-types', {
      name: `Fields ${token}`,
      description: null,
      sortOrder: 6100,
    });
    const definition = await admin.get(
      `/api/v1/forms/by-owner?ownerKind=AssetType&ownerId=${type.assetTypeId}`,
    );
    await seed.publishForm(definition.formDefinitionId, [
      { key: 'workspace', label: 'Workspace id', control: 'TEXT', required: true },
      { key: 'notes', label: 'Handling notes', control: 'TEXT' },
    ]);
    const asset = await admin.post('/api/v1/assets', {
      matterId: world.matter.matterId,
      assetTypeId: type.assetTypeId,
      displayName: `Typed ${token}`,
      externalReference: 'https://dms.example/folders/42',
      description: 'First batch',
      formValues: { workspace: 'WS-8841', notes: 'check later' },
    });

    // Admin: both sections, the values, the matter link; axe and no sideways scroll at four sizes.
    await page.goto(`/assets/${asset.assetId}`);
    await expect(page.locator('[data-section="asset"]')).toContainText('First batch');
    await expect(page.locator('[data-type-fields-title]')).toContainText(
      `Fields ${token} fields (2)`,
    );
    await expect(page.locator('[data-type-fields]')).toContainText('WS-8841');
    await expect(page.locator('[data-details] [data-matter] a')).toHaveAttribute(
      'href',
      `/matters/${world.matter.matterId}`,
    );
    await atEverySize(page, 'as2-record-details-fields', async () => {
      await expect(page.locator('[data-type-fields]')).toContainText('WS-8841');
    });

    // At 1366 the two sections sit side by side; at 768 they are one column.
    await page.setViewportSize({ width: 1366, height: 768 });
    const a = (await page.locator('[data-section="asset"]').boundingBox())!;
    const f = (await page.locator('[data-section="fields"]').boundingBox())!;
    expect(f.x).toBeGreaterThan(a.x + a.width - 2);
    await page.setViewportSize({ width: 768, height: 1024 });
    const a2 = (await page.locator('[data-section="asset"]').boundingBox())!;
    const f2 = (await page.locator('[data-section="fields"]').boundingBox())!;
    expect(f2.y).toBeGreaterThan(a2.y + a2.height - 2);

    // Asset.View only: no request to the schema endpoint, no console error, one muted sentence, the matter number as text.
    const viewer = await personas.create({ label: 'assetview', permissions: ['Asset.View'] });
    const plain = await asUser(viewer.username);
    const requests: string[] = [];
    const errors: string[] = [];
    plain.on('request', (r) => requests.push(r.url()));
    plain.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await plain.goto(`/assets/${asset.assetId}`);
    await expect(plain.locator('[data-fields-unavailable]')).toContainText(
      'Type fields are not available with your access.',
    );
    await expect(plain.locator('[data-matter] a')).toHaveCount(0);
    expect(requests.filter((u) => /\/forms\/versions\//.test(u))).toEqual([]);
    expect(errors).toEqual([]);

    // Task.View reads the schema.
    const withTasks = await personas.create({
      label: 'assettask',
      permissions: ['Asset.View', 'Matter.View', 'Client.View', 'Task.View'],
    });
    const full = await asUser(withTasks.username);
    await full.goto(`/assets/${asset.assetId}`);
    await expect(full.locator('[data-type-fields]')).toContainText('WS-8841');
    await expect(full.locator('[data-details] [data-matter] a')).toBeVisible();
    await shot(full, 'as2-record-details-fields');
  });

  test('inbound link: the asset name on the Task page opens the record page', async ({
    page,
    seed,
  }) => {
    const { asset } = await assetWithTasks(seed, 0);
    const world = await seed.world();
    const other = await seed.asset(world.matter, `Task link ${uid()}`);
    const task = await seed.task(world);
    await seed.admin.post(`/api/v1/tasks/${task.taskId}/assets`, { assetId: other.assetId });
    expect(asset.assetId).not.toBe(other.assetId);
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await detail.showSection('Assets');
    await page.locator(`li[data-asset-id="${other.assetId}"] [data-asset-link]`).click();
    await expect(page).toHaveURL(new RegExp(`/assets/${other.assetId}$`));
    await expect(page.getByRole('heading', { level: 1, name: other.displayName })).toBeVisible();
  });

  test('Back from the record page returns to page 2 of a filtered, sorted list with the row focused', async ({
    page,
    seed,
  }) => {
    const token = uid();
    const matter = await seed.matter();
    for (let from = 0; from < 30; from += 6) {
      await Promise.all(
        Array.from({ length: 6 }, (_, i) => seed.asset(matter, `Page ${token} ${from + i + 100}`)),
      );
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    const address = `/assets?name=${token}&sort=displayName&page=2&size=25`;
    await page.goto(address);
    const rows = page.locator('tbody tr[data-asset-id] a.mf-name');
    await expect(rows).toHaveCount(5);
    const name = (await rows.nth(2).textContent())!.trim();
    await rows.nth(2).click();
    await expect(page.getByRole('heading', { level: 1, name })).toBeFocused();

    await page
      .getByRole('navigation', { name: 'Breadcrumb' })
      .getByRole('link', { name: 'Assets' })
      .click();
    await expect(page).toHaveURL(new RegExp(`name=${token}&sort=displayName&page=2&size=25`));
    await expect(page.getByRole('link', { name, exact: true })).toBeFocused();

    await page.getByRole('link', { name, exact: true }).click();
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`page=2`));
    await expect(page.getByRole('link', { name, exact: true })).toBeFocused();
  });

  test('axe finds nothing and nothing scrolls sideways at four sizes, also with the overflow menu and the dialog open', async ({
    page,
    seed,
  }) => {
    const { asset } = await assetWithTasks(seed, 3);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto(`/assets/${asset.assetId}`);
      await expect(page.getByRole('heading', { level: 1, name: asset.displayName })).toBeVisible();
      expect(await axeViolations(page), `details at ${size.width}`).toEqual([]);
      await noHorizontalScroll(page);

      await page.getByRole('tab', { name: /^Linked tasks/ }).click();
      await expect(
        size.width < 640
          ? page.locator('[data-tasks-tab] li.rc')
          : page.locator('[data-tasks-tab] tbody tr'),
      ).toHaveCount(3);
      expect(await axeViolations(page), `tasks at ${size.width}`).toEqual([]);
      await noHorizontalScroll(page);
      if (size.width === 1366 || size.width === 375) await shot(page, 'as2-record-tasks');

      await page.getByRole('tab', { name: 'Details' }).click();
      await page.getByRole('button', { name: 'More actions' }).click();
      await expect(page.getByRole('menu')).toBeVisible();
      expect(await axeViolations(page), `menu at ${size.width}`).toEqual([]);
      await page.getByRole('menuitem', { name: 'Set inactive' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      expect(await axeViolations(page), `dialog at ${size.width}`).toEqual([]);
      await noHorizontalScroll(page);
      if (size.width === 1366 || size.width === 375) await shot(page, 'as2-record-dialog');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'More actions' })).toBeFocused();
    }
  });
});
