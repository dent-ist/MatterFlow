import { Locator, Page } from '@playwright/test';
import { Api, Json } from '../support/api';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Seeder, uid } from '../support/seed';

/**
 * Pods is the third tab of the Users page, and the Users grid has a Pods column with an inline editor (docs/ux/users-pods/README.md).
 * Every test creates its own users and pods (unique names), so the tests do not depend on each other or on the seeded pods.
 */

interface Person {
  username: string;
  userId: number;
}

/** Three pods named with one tag, so the popover's search box narrows the checklist to them. */
async function threePods(seed: Seeder): Promise<{ tag: string; names: string[]; ids: number[] }> {
  const tag = uid();
  const names = [`Processing ${tag}`, `Review ${tag}`, `Intake ${tag}`];
  const ids: number[] = [];
  for (const name of names) ids.push((await seed.pod(name, [])).podId);
  return { tag, names, ids };
}

async function gridRow(page: Page, person: Person): Promise<Locator> {
  await page.goto(`/admin/users?status=all&account=${encodeURIComponent(person.username)}`);
  const row = page.locator(`tr[data-user="${person.userId}"]`);
  await expect(row).toBeVisible();
  return row;
}

const trigger = (row: Locator): Locator => row.locator('[data-pods-trigger]');
const chips = (row: Locator): Locator => row.locator('[data-pod-chip]');
const popover = (page: Page): Locator => page.locator('[data-pods-popover]');

/** Opens the editor of a row and narrows the checklist to the pods of one test. */
async function openEditor(page: Page, row: Locator, tag: string): Promise<Locator> {
  await trigger(row).click();
  const pop = popover(page);
  await expect(pop).toBeVisible();
  await pop.getByRole('textbox', { name: 'Search pods' }).fill(tag);
  return pop;
}

async function userPods(admin: Api, userId: number): Promise<Json[]> {
  return admin.get<Json[]>(`/api/v1/users/${userId}/pods?includeInactive=true`);
}

/** The chips are optimistic, so the server state is polled: it is there once the one request has been answered. */
async function expectSaved(
  admin: Api,
  userId: number,
  expected: [number, boolean][],
): Promise<void> {
  await expect
    .poll(async () => (await userPods(admin, userId)).map((p) => [p.podId, p.isPrimary]))
    .toEqual(expected);
}

test.describe('Pods tab on the Users page', () => {
  test('/admin/pods opens the third tab of Users; the Pods menu item is gone and Users stays highlighted', async ({
    page,
    seed,
  }) => {
    const [pod] = (await threePods(seed)).ids;
    await page.goto('/admin/pods');
    await expect(page.getByRole('heading', { name: 'Users', level: 1 })).toBeVisible();
    await expect(page.getByRole('tab')).toHaveText(['Users', 'Roles', 'Pods']);
    await expect(page.getByRole('tab', { name: 'Pods' })).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveTitle(/^Users - Pods/);

    // One menu item for all three tabs, highlighted on each of them.
    const menu = page.getByRole('list', { name: 'Administration' });
    await expect(menu.getByRole('link', { name: 'Pods' })).toHaveCount(0);
    await expect(menu.getByRole('link', { name: /^Users/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    // The Users icon belongs to all three tabs.
    await expect(page.getByRole('heading', { level: 1 }).locator('i[data-page-icon]')).toHaveClass(
      /pi-id-card/,
    );

    await page.getByRole('tab', { name: 'Roles' }).click();
    await expect(page).toHaveURL(/\/admin\/roles$/);
    await expect(menu.getByRole('link', { name: /^Users/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await page.getByRole('tab', { name: 'Roles' }).press('ArrowRight');
    await expect(page).toHaveURL(/\/admin\/pods$/);
    await expect(page.getByRole('tab', { name: 'Pods' })).toBeFocused();
    await page.getByRole('tab', { name: 'Users' }).click();
    await expect(page).toHaveURL(/\/admin\/users$/);
    await expect(page).toHaveTitle(/^Users( |$)/);

    // The deep link of the pod editor keeps working inside the tab.
    await page.goto(`/admin/pods?pod=${pod}`);
    await expect(page.getByRole('tab', { name: 'Pods' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('heading', { name: 'Edit pod' })).toBeVisible();
    await expect(page.locator('#pod-name')).toHaveValue(/^Processing /);
  });

  test('the members editor of the Pods tab still adds a member and sets the primary pod', async ({
    page,
    seed,
  }) => {
    const person = await seed.user(['Data Technician'], 'member');
    const pod = await seed.pod(`Members ${uid()}`, []);
    await page.goto(`/admin/pods?pod=${pod.podId}`);
    await expect(page.getByRole('heading', { name: 'Edit pod' })).toBeVisible();
    await page.getByRole('searchbox', { name: 'Add members' }).fill(person.username.slice(-12));
    await page.locator(`[data-candidate="${person.userId}"]`).check();
    await page.getByRole('button', { name: 'Add selected' }).click();
    const member = page.locator(`[data-member="${person.userId}"]`);
    await expect(member).toBeVisible();
    await member.getByRole('button', { name: /Make primary pod for/ }).click();
    await expect(member.getByRole('button', { name: /Clear primary pod for/ })).toBeVisible();

    // The grid shows the same membership.
    const row = await gridRow(page, person);
    await expect(chips(row)).toHaveCount(1);
    await expect(chips(row).first()).toContainText(`${pod.name} Primary`);
  });
});

test.describe('Pods column of the Users grid', () => {
  test('assigns a user to two pods, picks the primary one, and the chips and the API agree', async ({
    page,
    seed,
    admin,
  }) => {
    const { tag, names, ids } = await threePods(seed);
    const person = await seed.user(['Data Technician'], 'assign');
    const row = await gridRow(page, person);
    await expect(row.locator('[data-no-pod]')).toHaveText('No pod');
    await expect(trigger(row)).toHaveAccessibleName(
      `Pods: none, change pods of ${person.username}`,
    );

    const pop = await openEditor(page, row, tag);
    // The first pod added becomes the primary one.
    await pop.getByRole('checkbox', { name: names[0] }).check();
    await expect(pop.getByRole('radio', { name: `Primary pod: ${names[0]}` })).toBeChecked();
    await pop.getByRole('checkbox', { name: names[1] }).check();
    await expect(pop.getByRole('radio', { name: `Primary pod: ${names[0]}` })).toBeChecked();
    // Choose the second one as the primary pod.
    await pop.getByRole('radio', { name: `Primary pod: ${names[1]}` }).check();
    // Nothing is saved before Apply.
    expect(await userPods(admin, person.userId)).toEqual([]);
    await pop.getByRole('button', { name: 'Apply' }).click();

    await expect(popover(page)).toHaveCount(0);
    await expect(chips(row)).toHaveCount(2);
    await expect(chips(row).nth(0)).toHaveText(names[0]);
    await expect(chips(row).nth(1)).toContainText(`${names[1]} Primary`);
    await expect(chips(row).nth(1).locator('.pi-star-fill')).toBeVisible();
    await expect(trigger(row)).toHaveAccessibleName(
      `Pods: ${names[0]}, ${names[1]} (primary), change pods of ${person.username}`,
    );
    await expect(trigger(row)).toBeFocused();
    await expect(page.locator('[data-undo-message]')).toContainText(`Pods of ${person.username}`);

    await expectSaved(admin, person.userId, [
      [ids[0], false],
      [ids[1], true],
    ]);

    // The assignment is audited with readable text.
    await expect
      .poll(async () => {
        const audit = await admin.get<Json>(
          `/api/v1/audit/search?objectType=Pod&objectId=${ids[1]}`,
        );
        return audit.items.map((e: Json) => e.summary);
      })
      .toEqual(
        expect.arrayContaining([
          `Added ${person.username} to ${names[1]} Pod`,
          `Set ${names[1]} Pod as the primary pod of ${person.username}`,
        ]),
      );
  });

  test('removing the primary pod asks for the new one in the same popover and blocks Apply until it is chosen', async ({
    page,
    seed,
    admin,
  }) => {
    const { tag, names, ids } = await threePods(seed);
    const person = await seed.user(['Data Technician'], 'remove');
    await admin.put(`/api/v1/users/${person.userId}/pods`, {
      podIds: [ids[0], ids[1]],
      primaryPodId: ids[0],
    });
    const row = await gridRow(page, person);
    await expect(chips(row).filter({ hasText: 'Primary' })).toContainText(names[0]);

    const pop = await openEditor(page, row, tag);
    await pop.getByRole('checkbox', { name: names[0] }).uncheck();
    const apply = pop.getByRole('button', { name: 'Apply' });
    await expect(pop.locator('[data-primary-required]')).toContainText('Choose the primary pod');
    // Not promoted silently, and Apply is blocked (it stays focusable and names the reason).
    await expect(pop.getByRole('radio', { name: `Primary pod: ${names[1]}` })).not.toBeChecked();
    await expect(apply).toHaveAttribute('aria-disabled', 'true');
    // Playwright treats aria-disabled as not actionable, so force the click a user could still make.
    await apply.click({ force: true });
    await expect(popover(page)).toBeVisible();
    expect((await userPods(admin, person.userId)).length).toBe(2);

    await pop.getByRole('radio', { name: `Primary pod: ${names[1]}` }).check();
    await expect(apply).not.toHaveAttribute('aria-disabled', 'true');
    await apply.click();
    await expect(chips(row)).toHaveCount(1);
    await expect(chips(row).first()).toContainText(`${names[1]} Primary`);
    await expectSaved(admin, person.userId, [[ids[1], true]]);
  });

  test('Undo restores the previous pods in one step', async ({ page, seed, admin }) => {
    const { tag, names, ids } = await threePods(seed);
    const person = await seed.user(['Data Technician'], 'undo');
    await admin.put(`/api/v1/users/${person.userId}/pods`, {
      podIds: [ids[0]],
      primaryPodId: ids[0],
    });
    const row = await gridRow(page, person);
    const pop = await openEditor(page, row, tag);
    await pop.getByRole('checkbox', { name: names[1] }).check();
    await pop.getByRole('button', { name: 'Apply' }).click();
    await expect(chips(row)).toHaveCount(2);

    await page.locator('[data-undo]').click();
    await expect(chips(row)).toHaveCount(1);
    await expect(chips(row).first()).toContainText(`${names[0]} Primary`);
    await expectSaved(admin, person.userId, [[ids[0], true]]);
  });

  test('a change made by someone else meanwhile is a conflict: the user is told and the row refreshes', async ({
    page,
    seed,
    admin,
  }) => {
    const { tag, names, ids } = await threePods(seed);
    const person = await seed.user(['Data Technician'], 'conflict');
    const row = await gridRow(page, person);
    const pop = await openEditor(page, row, tag);
    await pop.getByRole('checkbox', { name: names[0] }).check();
    // Someone else assigns another pod before Apply.
    await admin.put(`/api/v1/users/${person.userId}/pods`, {
      podIds: [ids[2]],
      primaryPodId: ids[2],
    });
    await pop.getByRole('button', { name: 'Apply' }).click();

    await expect(page.getByText('were changed by someone else', { exact: false })).toBeVisible();
    await expect(chips(row)).toHaveCount(1);
    await expect(chips(row).first()).toContainText(`${names[2]} Primary`);
  });

  test('keyboard: Enter opens the popover, arrows walk the list, Escape closes it and returns focus', async ({
    page,
    seed,
  }) => {
    const { tag, names } = await threePods(seed);
    const person = await seed.user(['Data Technician'], 'keys');
    const row = await gridRow(page, person);
    await trigger(row).focus();
    await page.keyboard.press('Enter');
    const pop = popover(page);
    await expect(pop).toBeVisible();
    const search = pop.getByRole('textbox', { name: 'Search pods' });
    await expect(search).toBeFocused();
    await search.fill(tag);
    await page.keyboard.press('ArrowDown');
    const first = pop.locator('[data-pod-option]').first();
    await expect(first).toBeFocused();
    await page.keyboard.press('Space');
    await expect(first).toBeChecked();
    await page.keyboard.press('ArrowDown');
    await expect(pop.locator('[data-pod-option]').nth(1)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(pop).toHaveCount(0);
    await expect(trigger(row)).toBeFocused();
    // Escape discards: nothing was saved.
    await expect(row.locator('[data-no-pod]')).toBeVisible();
    expect(names.length).toBe(3);
  });

  test('a user who may see users but not assign pods sees chips only', async ({
    seed,
    asUser,
    admin,
  }) => {
    const { names, ids } = await threePods(seed);
    const person = await seed.user(['Data Technician'], 'viewed');
    await admin.put(`/api/v1/users/${person.userId}/pods`, {
      podIds: ids.slice(0, 2),
      primaryPodId: ids[0],
    });
    const auditor = await seed.user(['Compliance Auditor'], 'auditor');
    const page = await asUser(auditor.username);
    const row = await gridRow(page, person);
    await expect(chips(row)).toHaveCount(2);
    await expect(row.locator('[data-pods-readonly]')).toContainText(names[0]);
    await expect(row.locator('[data-pods-trigger]')).toHaveCount(0);
    // No Pods tab either (no Pod.Manage / Pod.ManageMembers).
    await expect(page.getByRole('tab')).toHaveText(['Users']);
  });

  test('a user who may only manage pods lands on the Pods tab from the Users menu item', async ({
    seed,
    asUser,
  }) => {
    const role = await seed.role(['Pod.View', 'Pod.ManageMembers'], 'Pods only');
    const person = await seed.user([], 'podsonly');
    await seed.grantRoles(person.userId, [role.name]);
    const page = await asUser(person.username);
    await page.goto('/dashboard');
    await page
      .getByRole('list', { name: 'Administration' })
      .getByRole('link', { name: 'Users' })
      .click();
    await expect(page).toHaveURL(/\/admin\/pods$/);
    await expect(page.getByRole('tab')).toHaveText(['Pods']);
  });
});

test.describe('Pods column accessibility and layout', () => {
  test.skip(!axeAvailable(), 'axe-core is not installed (npm ci) and E2E_AXE_PATH is not set');

  for (const size of [
    { name: '1366x768', width: 1366, height: 768 },
    { name: '375', width: 375, height: 800 },
  ]) {
    test(`no axe violations on the Users grid with the popover open, and on the Pods tab (${size.name})`, async ({
      page,
      seed,
      admin,
    }) => {
      const { tag, ids } = await threePods(seed);
      const person = await seed.user(['Data Technician'], 'axe');
      await admin.put(`/api/v1/users/${person.userId}/pods`, {
        podIds: ids.slice(0, 2),
        primaryPodId: ids[0],
      });
      await page.setViewportSize({ width: size.width, height: size.height });
      const row = await gridRow(page, person);
      expect(await axeViolations(page)).toEqual([]);

      await openEditor(page, row, tag);
      await expect(popover(page).locator('[data-pod-option]')).toHaveCount(3);
      expect(await axeViolations(page)).toEqual([]);
      // The popover is fully on screen (not clipped by the grid's scroll area).
      const box = (await popover(page).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(size.width);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(size.height);
      await page.keyboard.press('Escape');

      await page.goto('/admin/pods');
      await expect(page.getByRole('tab', { name: 'Pods' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expect(page.locator('table[data-pods]')).toBeVisible();
      expect(await axeViolations(page)).toEqual([]);
    });
  }
});
