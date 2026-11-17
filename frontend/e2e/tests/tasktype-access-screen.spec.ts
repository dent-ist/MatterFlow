import { Page } from '@playwright/test';
import { Api, Json } from '../support/api';
import { axeAvailable, axeViolations } from '../support/axe';
import { asDropdown } from '../support/dropdown';
import { expect, test } from '../support/fixtures';
import { showMatterColumns } from '../support/matter-columns';
import { Persona } from '../support/personas';
import { SIZES, shot } from '../support/screens';
import { uid } from '../support/seed';
import { toasts } from '../support/toasts';

/**
 * Task Type access, the Task Types screen (epic #1397, issue #1402): the Access column, filter and sort of the list, the Access tab of the record page (three
 * role lists, linked chips, summary), the Save Access Rules question in each of its variants (people lose view, open to everyone, you lose access yourself,
 * a failed preview that blocks the save), the not-enforced banners, the New Task Type flow, the inline message on Administration > Users > Roles when a role is
 * still listed by a Task Type, and the audit labels. Every changed page and dialog is checked with axe at 1366x768 and 1920x1080.
 *
 * Needs `Features__TaskTypeAccess=true` (run-local.sh switches it on for tasktype-access-*.spec.ts); the banner tests fake the answer "not enforced".
 */
interface Scene {
  tag: string;
  openType: { id: number; name: string };
  secretType: { id: number; name: string };
  roleA: { id: number; name: string };
  roleB: { id: number; name: string };
  roleC: { id: number; name: string };
  manager: Persona;
  enforced: boolean;
}

let scene: Scene;

const roleOf = async (admin: Api, name: string): Promise<number> =>
  (await admin.get<Json[]>('/api/v1/roles')).find((r) => r.name === name)!.roleId;

async function axeClean(page: Page, what: string): Promise<void> {
  expect(axeAvailable(), 'axe-core must be available (set E2E_AXE_PATH)').toBe(true);
  expect(await axeViolations(page), what).toEqual([]);
}

/** The first row of the list for a type: found by its name cell. */
const typeRow = (page: Page, name: string) =>
  page.locator('tbody tr', { has: page.locator(`td[data-row="${name}"]`) });
const field = (page: Page, key: 'canView' | 'canEdit' | 'canAssign') =>
  page.locator(`[data-field="${key}"]`);
const dialog = (page: Page) => page.locator('.p-dialog');

/** Picks roles in a multi-select field (the panel stays open for several; Escape closes it). */
async function pick(page: Page, label: string, ...values: string[]): Promise<void> {
  const trigger = page.getByRole('button', { name: new RegExp(`^${label}:`) });
  await trigger.click();
  for (const value of values)
    await page.locator(`.dd-panel [role="option"][data-value="${value}"]`).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.dd-panel')).toHaveCount(0);
}

test.describe('Task Types screen: Access (#1402)', () => {
  test.describe.configure({ timeout: 240_000, mode: 'serial' });

  test.beforeAll(async ({ admin, seed, personas }) => {
    const tag = uid()
      .replace(/[^a-z0-9]/gi, '')
      .slice(0, 6);
    const world = await seed.world();
    // Roles with exactly one member each, so the preview has people to count.
    const a = await personas.create({
      label: 'tta-a',
      permissions: ['Task.View'],
      displayName: `Access A ${tag}`,
    });
    const b = await personas.create({
      label: 'tta-b',
      permissions: ['Task.View'],
      displayName: `Access B ${tag}`,
    });
    // A role nobody holds: it can be deleted once no Task Type lists it.
    const c = await admin.post('/api/v1/roles', {
      name: `TTA Unused ${tag}`,
      description: null,
      permissionCodes: ['Task.View'],
    });
    const manager = await personas.create({
      label: 'tta-manager',
      permissions: ['TaskType.Manage', 'Workflow.Manage', 'Audit.View', 'Role.Manage', 'Task.View'],
      displayName: `Access Manager ${tag}`,
    });
    const roleA = { id: await roleOf(admin, a.roleNames[0]), name: a.roleNames[0] };
    const roleB = { id: await roleOf(admin, b.roleNames[0]), name: b.roleNames[0] };
    const roleC = { id: c.roleId as number, name: c.name as string };
    const openType = await seed.taskType({ name: `TTA Open ${tag}`, workflows: [world.workflow] });
    const secretType = await seed.taskType({
      name: `TTA Secret ${tag}`,
      workflows: [world.workflow],
    });
    const access = await admin.get<Json>(`/api/v1/task-types/${secretType.id}/access`);
    const saved = await admin.put<Json>(`/api/v1/task-types/${secretType.id}/access`, {
      canView: [roleA.id, roleB.id],
      canEdit: [roleA.id],
      canAssign: [],
      rowVersion: access.rowVersion,
    });
    scene = {
      tag,
      openType,
      secretType,
      roleA,
      roleB,
      roleC,
      manager,
      enforced: saved.enforced === true,
    };
  });

  test.beforeEach(() =>
    test.skip(
      !scene.enforced,
      'The Task Type access rule is off: start the API with Features__TaskTypeAccess=true (run-local.sh does it for tasktype-access-*.spec.ts).',
    ),
  );

  test('the list: Access column after Request Form, Everyone or a Restricted chip with a tooltip, filter, sort, Target hidden by default', async ({
    page,
  }) => {
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto(`/admin/task-types?name=TTA`);
      await expect(typeRow(page, scene.openType.name)).toBeVisible();
      const heads = (await page.locator('thead tr:first-child th').allTextContents()).map((t) =>
        t.replace(/\s+/g, ' ').trim(),
      );
      expect(heads.indexOf('Access')).toBe(heads.indexOf('Request Form') + 1);
      expect(heads).not.toContain('Target (Days)');
      const name = await page.locator('thead th[data-col="name"]').boundingBox();
      expect(name!.width, `Name at ${size.width}`).toBeGreaterThanOrEqual(200);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);

      await expect(typeRow(page, scene.openType.name).locator('[data-access]')).toHaveText(
        'Everyone',
      );
      const chip = typeRow(page, scene.secretType.name).locator('[data-access-chip]');
      await expect(chip).toContainText('Restricted 2');
      await chip.focus();
      await expect(page.locator('[role="tooltip"]')).toContainText(
        `Can View: ${scene.roleA.name}, ${scene.roleB.name}`,
      );
      await expect(page.locator('[role="tooltip"]')).toContainText(`Can Edit: ${scene.roleA.name}`);
      await expect(page.locator('[role="tooltip"]')).toContainText(
        'Can Be Assigned: no extra limit',
      );
      await axeClean(page, `Task Types list at ${size.width}x${size.height}`);
      await shot(page, '01-list-access-column');
    }

    // Filter: Restricted keeps the secret type, Everyone the open one.
    await page.setViewportSize(SIZES[0]);
    const filter = asDropdown(page.getByRole('button', { name: /^Filter by Access/ }));
    await filter.selectOption('restricted');
    await expect(page).toHaveURL(/access=restricted/);
    await expect(typeRow(page, scene.secretType.name)).toBeVisible();
    await expect(typeRow(page, scene.openType.name)).toHaveCount(0);
    await filter.selectOption('everyone');
    await expect(typeRow(page, scene.openType.name)).toBeVisible();
    await expect(typeRow(page, scene.secretType.name)).toHaveCount(0);
    await filter.selectOption('');

    // Sort: the first click on the heading puts Restricted first.
    await page.locator('th[data-col="access"] button').click();
    await expect(page).toHaveURL(/sort=-access/);
    await expect(
      page
        .locator('tbody tr[data-row], tbody tr:has(td[data-row])')
        .first()
        .locator('[data-access-chip]'),
    ).toBeVisible();

    // The strip chip toggles the same filter.
    await page.goto('/admin/task-types?name=TTA');
    await page.locator('[data-strip-item="restricted"]').click();
    await expect(page).toHaveURL(/access=restricted/);

    // Target (Days) is one click away in Columns.
    await page.goto('/admin/task-types?name=TTA');
    await showMatterColumns(page, 'Target (Days)');
    await expect(page.locator('thead th[data-col="target"]')).toBeVisible();

    // The chip opens the Access tab.
    await page.goto('/admin/task-types?name=TTA');
    await typeRow(page, scene.secretType.name).locator('[data-access-chip]').click();
    await expect(page).toHaveURL(
      new RegExp(`/admin/task-types/${scene.secretType.id}\\?tab=access`),
    );
    await expect(page.locator('[data-access-tab]')).toBeVisible();
  });

  test('the Access tab: three lists, linked chips, summary, a save that needs no question, the Restricted chip in the header', async ({
    page,
    admin,
  }) => {
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto(`/admin/task-types/${scene.openType.id}?tab=access`);
      await expect(page.locator('[data-access-tab]')).toBeVisible();
      await expect(page.getByRole('tab', { name: 'Access' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expect(
        page.getByRole('button', { name: 'Can View: Everyone (No Limit)' }),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: 'Can Edit: No Extra Limit' })).toBeVisible();
      await expect(page.locator('[data-access-summary]')).toHaveText('Open to everyone.');
      await axeClean(page, `Access tab at ${size.width}x${size.height}`);
      await shot(page, '02-access-tab-open');
    }
    await page.setViewportSize(SIZES[0]);
    await page.goto(`/admin/task-types/${scene.openType.id}?tab=access`);
    // A role chosen in Can Edit is in Can View at once, as a linked chip that cannot be removed there.
    await pick(page, 'Can Edit', String(scene.roleB.id));
    const linked = field(page, 'canView').locator('[data-linked]');
    await expect(linked).toContainText(scene.roleB.name);
    await expect(linked.locator('button')).toHaveCount(0);
    await expect(page.locator('[data-access-summary]')).toHaveText(
      'Restricted: 1 role can view, 1 can edit, all viewers can be assigned.',
    );
    await axeClean(page, 'Access tab with edits');
    await shot(page, '03-access-tab-linked-chip');
    // An open type that becomes restricted hides it from everyone who does not hold the role: the question says how many.
    await page.locator('[data-save]').click();
    await expect(dialog(page)).toContainText(/This will hide the task type from \d+ people?\./);
    await dialog(page).getByRole('button', { name: 'Save Access Rules' }).click();
    await expect(page.getByText('Access rules saved').first()).toBeVisible();
    await expect(dialog(page)).toHaveCount(0);
    const saved = await admin.get<Json>(`/api/v1/task-types/${scene.openType.id}/access`);
    expect(saved.canView).toEqual([scene.roleB.id]);
    expect(saved.canEdit).toEqual([scene.roleB.id]);
    await expect(page.locator('[data-page-title]')).toContainText('Restricted');
    await page.getByRole('tab', { name: 'Overview' }).click();
    await expect(page.locator('[data-page-title]')).toContainText('Restricted');

    // Back to open for the other tests.
    await page.getByRole('tab', { name: 'Access' }).click();
    await field(page, 'canEdit').locator('[data-remove]').click();
    // The role is in Can View on its own now (saved), so it is removed there too.
    await field(page, 'canView').locator('[data-remove]').click();
    await expect(page.locator('[data-access-summary]')).toHaveText('Open to everyone.');
    await page.locator('[data-save]').click();
    await expect(
      dialog(page).getByText('This makes the task type open to everyone.'),
    ).toBeVisible();
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await axeClean(page, `Open-to-everyone question at ${size.width}x${size.height}`);
    }
    await dialog(page).getByRole('button', { name: 'Save Access Rules' }).click();
    await expect(dialog(page)).toHaveCount(0);
    expect(
      (await admin.get<Json>(`/api/v1/task-types/${scene.openType.id}/access`)).isRestricted,
    ).toBe(false);
  });

  test('the question when people lose view, and Cancel keeps everything as it was', async ({
    page,
    admin,
  }) => {
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto(`/admin/task-types/${scene.secretType.id}?tab=access`);
      // Take roleB out of Can View: its one member loses the type.
      await field(page, 'canView')
        .locator(`[data-chips="canView"] button[data-remove="${scene.roleB.id}"]`)
        .click();
      await page.locator('[data-save]').click();
      await expect(dialog(page)).toContainText('Save Access Rules');
      await expect(dialog(page)).toContainText('This will hide the task type from 1 person.');
      await expect(dialog(page)).toContainText('You can change the access again at any time.');
      await expect(dialog(page).getByRole('button', { name: 'Cancel' })).toBeVisible();
      await expect(dialog(page).locator('.mf-btn--solid')).toHaveCount(0);
      await axeClean(page, `Hide question at ${size.width}x${size.height}`);
      await shot(page, '04-confirm-hide');
      await dialog(page).getByRole('button', { name: 'Cancel' }).click();
      await expect(dialog(page)).toHaveCount(0);
      const kept = await admin.get<Json>(`/api/v1/task-types/${scene.secretType.id}/access`);
      expect(kept.canView).toEqual([scene.roleA.id, scene.roleB.id].sort((x, y) => x - y));
    }
  });

  test('a person who would lose access themselves gets the red question; the sentence says only a System Admin can change it back', async ({
    asUser,
    admin,
  }) => {
    const url = `/api/v1/task-types/${scene.secretType.id}/access`;
    // The manager's own role is in Can View for now, so the type is visible to them; taking it out hides the type from them.
    const managerRole = await roleOf(admin, scene.manager.roleNames[0]);
    const before = await admin.get<Json>(url);
    await admin.put(url, {
      canView: [...(before.canView as number[]), managerRole],
      canEdit: before.canEdit,
      canAssign: before.canAssign,
      rowVersion: before.rowVersion,
    });
    const page = await asUser(scene.manager.username);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto(`/admin/task-types/${scene.secretType.id}?tab=access`);
      await expect(page.locator('[data-access-tab]')).toBeVisible();
      await field(page, 'canView').locator(`[data-remove="${managerRole}"]`).click();
      await page.locator('[data-save]').click();
      await expect(dialog(page)).toContainText('You will lose access yourself.');
      await expect(dialog(page)).toContainText('Only a System Admin can change it back.');
      await expect(dialog(page)).not.toContainText('You can change the access again at any time.');
      await expect(dialog(page).locator('.mf-btn--solid')).toBeVisible();
      await axeClean(page, `You-lose-access question at ${size.width}x${size.height}`);
      await shot(page, '05-confirm-you-lose-access');
      await dialog(page).getByRole('button', { name: 'Cancel' }).click();
    }
    // Cancel changed nothing; put the lists back for the other tests.
    const kept = await admin.get<Json>(url);
    expect(kept.canView).toContain(managerRole);
    await admin.put(url, {
      canView: (kept.canView as number[]).filter((r) => r !== managerRole),
      canEdit: kept.canEdit,
      canAssign: kept.canAssign,
      rowVersion: kept.rowVersion,
    });
  });

  test('a failed preview blocks the save: Cancel and Retry only, and Retry asks again', async ({
    page,
    admin,
  }) => {
    const url = `/api/v1/task-types/${scene.secretType.id}/access`;
    await page.setViewportSize(SIZES[0]);
    await page.goto(`/admin/task-types/${scene.secretType.id}?tab=access`);
    // Adding a role to Can Be Assigned hides nothing from anybody: no question once the check works.
    await pick(page, 'Can Be Assigned', String(scene.roleA.id));
    let failed = false;
    await page.route('**/api/v1/task-types/*/access/preview', async (route) => {
      if (!failed) {
        failed = true;
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: '{"code":"SERVER_ERROR"}',
        });
      } else await route.continue();
    });
    await page.locator('[data-save]').click();
    await expect(dialog(page)).toContainText("Couldn't check who is affected. Nothing was saved.");
    await expect(dialog(page).locator('.mf-dlg__buttons button')).toHaveText(['Cancel', 'Retry']);
    expect((await admin.get<Json>(url)).canAssign).toEqual([]);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await axeClean(page, `Preview-failed dialog at ${size.width}x${size.height}`);
      await shot(page, '06-preview-failed');
    }
    await dialog(page).getByRole('button', { name: 'Retry' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.getByText('Access rules saved').first()).toBeVisible();
    const saved = await admin.get<Json>(url);
    expect(saved.canAssign).toEqual([scene.roleA.id]);
    // Back to the lists the other tests expect.
    await admin.put(url, {
      canView: saved.canView,
      canEdit: saved.canEdit,
      canAssign: [],
      rowVersion: saved.rowVersion,
    });
  });

  test('while the switch is off an amber banner says the rules are not enforced, on the list and on the tab', async ({
    page,
  }) => {
    // The API answers "enforced" for these specs; the banner is checked against the answer of a server with the switch off.
    await page.route('**/api/v1/task-types/*/access', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const response = await route.fetch();
      const body = (await response.json()) as Json;
      await route.fulfill({ response, json: { ...body, enforced: false } });
    });
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto('/admin/task-types?name=TTA');
      const banner = page.locator('[data-not-enforced-banner]');
      await expect(banner).toContainText('Access rules are saved but not enforced yet.');
      await expect(banner).toContainText(
        'still visible to everyone until Task Type Access is switched on',
      );
      await axeClean(page, `List banner at ${size.width}x${size.height}`);
      await shot(page, '07-list-not-enforced-banner');
      await page.goto(`/admin/task-types/${scene.secretType.id}?tab=access`);
      await expect(page.locator('[data-not-enforced-banner]')).toContainText(
        'Access rules are saved but not enforced yet.',
      );
      await axeClean(page, `Tab banner at ${size.width}x${size.height}`);
    }
  });

  test('New Task Type: the Access tab is there and its rules are saved with the type', async ({
    page,
    admin,
  }) => {
    const name = `TTA New ${scene.tag}`;
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto('/admin/task-types/new');
      await page.getByRole('tab', { name: 'Access' }).click();
      await expect(page.locator('[data-access-tab]')).toBeVisible();
      await axeClean(page, `New Task Type, Access tab at ${size.width}x${size.height}`);
    }
    await page.setViewportSize(SIZES[0]);
    await page.getByRole('tab', { name: 'Overview' }).click();
    await page.locator('#tt-name').fill(name);
    await page.getByRole('tab', { name: 'Access' }).click();
    await pick(page, 'Can View', String(scene.roleA.id));
    await page.getByRole('button', { name: 'Create Task Type' }).click();
    await expect(page).toHaveURL(/\/admin\/task-types\/\d+\?tab=workflows/);
    const id = Number(/task-types\/(\d+)/.exec(page.url())![1]);
    expect((await admin.get<Json>(`/api/v1/task-types/${id}/access`)).canView as number[]).toEqual([
      scene.roleA.id,
    ]);
    await expect(page.locator('[data-page-title]')).toContainText('Restricted');
  });

  test('Roles: a role that a Task Type lists is refused inline, with a button per Task Type that opens its Access tab', async ({
    page,
    admin,
  }) => {
    const type = await admin.get<Json>(`/api/v1/task-types/${scene.secretType.id}/access`);
    await admin.put(`/api/v1/task-types/${scene.secretType.id}/access`, {
      canView: [...(type.canView as number[]), scene.roleC.id],
      canEdit: type.canEdit,
      canAssign: type.canAssign,
      rowVersion: type.rowVersion,
    });
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto('/admin/roles');
      await page.locator(`[data-role="${scene.roleC.id}"]`).click();
      await page.getByRole('button', { name: 'Delete Role', exact: true }).click();
      await dialog(page).getByRole('button', { name: 'Delete Role', exact: true }).click();
      await expect(page.locator('[data-error]')).toContainText(
        'This role is used by 1 Task Type. Remove it there first.',
      );
      await expect(toasts(page).filter({ hasText: 'used by' })).toHaveCount(0);
      const open = page.locator('[data-used-by] button', { hasText: scene.secretType.name });
      await expect(open).toBeVisible();
      await axeClean(page, `Roles, role in use at ${size.width}x${size.height}`);
      await shot(page, '08-roles-role-in-use');
    }
    await page.locator('[data-used-by] button', { hasText: scene.secretType.name }).click();
    await expect(page).toHaveURL(
      new RegExp(`/admin/task-types/${scene.secretType.id}\\?tab=access`),
    );
    await expect(page.locator('[data-access-tab]')).toBeVisible();
  });

  test('Audit Logs: the three events are in Configuration Changes and the Event Type list words them', async ({
    page,
  }) => {
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto('/admin/audit');
      await page.locator('[data-quick-views] [data-key="config"]').click();
      await page.getByLabel('Group Events of One Operation').uncheck();
      // The Task Type events of the saves above are configuration changes: they are listed with the server's sentence.
      await expect(
        page
          .locator('tr[data-event]')
          .filter({ hasText: `Task Type '${scene.secretType.name}'` })
          .first(),
      ).toBeVisible();
      await axeClean(page, `Audit Logs at ${size.width}x${size.height}`);
      await shot(page, '09-audit-events');
    }
    const events = asDropdown(page.getByRole('button', { name: /^Event Type:/ }));
    const texts = await events.optionTexts();
    expect(texts).toContain('Task type access changed');
    expect(texts).toContain('Task type restricted');
    expect(texts).toContain('Task type opened to everyone');
    await events.selectOption('TASK_TYPE_RESTRICTED');
    await expect(page).toHaveURL(/eventType=TASK_TYPE_RESTRICTED/);
    await expect(
      page
        .locator('tr[data-event]')
        .filter({ hasText: 'is now restricted to the roles in Can View' })
        .first(),
    ).toBeVisible();
  });
});
