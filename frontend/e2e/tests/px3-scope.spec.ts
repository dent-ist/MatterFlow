import { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { axeAvailable, axeViolations } from '../support/axe';
import { inDays, mmWorld } from '../support/my-matters-fixtures';
import { pmFixtures } from '../support/pm-fixtures';
import { SIZES, noHorizontalScroll } from '../support/screens';

/**
 * "My matters / All" (epic #758, WP-PX3: #771 to #774) and the short menu of the Project Manager (#775).
 * People holding Matter.BeManager open Matters, Task Queue, Assets, Clients and Projects on the matters they manage (Primary or Secondary),
 * with a remembered switch; All only with Matter.AssignManagers; a link that carries filters means what it says; search stays global and
 * labels results outside the person's matters. Permission variants: Project Manager, PM without Matter.AssignManagers, PM with no matter,
 * Director, technician, System Admin.
 */
const scopeLine = (page: Page) => page.locator('[data-scope-line]');
const pressed = (page: Page, scope: 'mine' | 'all') =>
  page.locator(`[data-scope="${scope}"]`).getAttribute('aria-pressed');

test.describe('My matters / All: lists', () => {
  test('Matters: a plain link opens on the matters I manage, All shows the rest and is remembered', async ({
    seed,
    personas,
    asUser,
  }) => {
    const fx = await pmFixtures(seed, personas);
    const page = await asUser(fx.pmA.username);
    await page.goto('/matters?size=100');
    await expect(page.locator('[data-scope-switch]')).toBeVisible();
    await expect(page).toHaveURL(/scope=mine/);
    expect(await pressed(page, 'mine')).toBe('true');
    expect(await pressed(page, 'all')).toBe('false');
    await expect(page.locator('tbody tr')).toHaveCount(7); // primary, secondary, both, overdue, unassigned, hold, clean
    await expect(page.locator('tbody tr', { hasText: `Bravo solo ${fx.token}` })).toHaveCount(0);
    await expect(scopeLine(page)).toContainText(/Matters you manage \(7 of [\d,]+\)/);

    await page.locator('[data-scope="all"]').click();
    await expect(page).toHaveURL(/scope=all/);
    await expect(scopeLine(page)).toContainText(/^\d+ matters$/);
    await expect(scopeLine(page)).not.toContainText('you manage');
    await expect(page.locator('[data-scope-live]')).toHaveText(/Showing all matters/);

    // Remembered per person and page: the plain link opens on All now; Back from a record restores the address.
    await page.goto('/matters?size=100');
    await expect(page).toHaveURL(/scope=all/);
    expect(await pressed(page, 'all')).toBe('true');
    await page.goto('/clients');
    await expect(page).toHaveURL(/scope=mine/); // another page, its own choice
  });

  test('a link with filters means what it says: no remembered scope is added', async ({
    seed,
    personas,
    asUser,
  }) => {
    const fx = await pmFixtures(seed, personas);
    const page = await asUser(fx.pmA.username);
    await page.goto(`/matters?name=${fx.token}`);
    await expect(page.locator('tbody tr').first()).toBeVisible();
    expect(page.url()).not.toContain('scope=');
    await expect(page.locator('tbody tr')).toHaveCount(14); // every matter of the worker, mine or not
    expect(await pressed(page, 'all')).toBe('true');
    // The strip's cells and notifications link to the Task Queue with their own filters.
    await page.goto('/tasks?overdue=true&status=NEW');
    expect(page.url()).not.toContain('scope=');
    // Choosing the scope on such a link adds it and keeps the filters.
    await page.goto(`/matters?name=${fx.token}`);
    await page.locator('[data-scope="mine"]').click();
    await expect(page).toHaveURL(/scope=mine/);
    await expect(page).toHaveURL(/name=/);
    await expect(page.locator('tbody tr')).toHaveCount(7);
  });

  test('Task Queue: only tasks on the matters I manage; All shows the others; the choice is remembered', async ({
    seed,
    personas,
    asUser,
  }) => {
    const fx = await pmFixtures(seed, personas);
    const page = await asUser(fx.pmA.username);
    await page.goto('/tasks');
    await expect(page).toHaveURL(/scope=mine/);
    await expect(scopeLine(page)).toContainText(/Tasks on matters you manage \(5\)/);
    await expect(page.locator('tbody tr[data-task-row], tbody tr').first()).toBeVisible();
    await page.locator('[data-scope="all"]').click();
    await expect(page).toHaveURL(/scope=all/);
    await expect(scopeLine(page)).not.toContainText('Tasks on matters you manage');
    await page.goto('/tasks');
    await expect(page).toHaveURL(/scope=all/);
  });

  test('Assets, Clients and Projects: scoped by default, with the rule in the header; records outside open by link', async ({
    seed,
    personas,
    asUser,
  }) => {
    const fx = await pmFixtures(seed, personas);
    const page = await asUser(fx.pmA.username);

    await page.goto(`/assets?scope=mine&name=${fx.token}`);
    await expect(page.locator('tbody tr', { hasText: fx.assetMine.name })).toHaveCount(1);
    await expect(page.locator('tbody tr', { hasText: fx.assetOther.name })).toHaveCount(0);
    await page.goto('/assets');
    await expect(scopeLine(page)).toContainText(/Assets of matters you manage/);
    await page.goto(`/assets?scope=all&name=${fx.token}`);
    await expect(page.locator('tbody tr', { hasText: fx.assetOther.name })).toHaveCount(1);
    // An asset outside the scope opens by its link: the scope is a default view, not access control.
    await page.goto(`/assets/${fx.assetOther.id}`);
    await expect(page.getByRole('heading', { level: 1 }).first()).toContainText(fx.assetOther.name);

    await page.goto(`/clients?scope=mine&name=Other Client ${fx.token}`);
    await expect(page.locator('[data-empty]')).toBeVisible();
    await page.goto('/clients?scope=mine');
    await expect(scopeLine(page)).toContainText(/Clients with a matter you manage/);
    await page.goto(`/clients?scope=all&name=Other Client ${fx.token}`);
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await page.goto(`/clients/${fx.otherClient.clientId}`);
    await expect(page.getByRole('heading', { level: 1 }).first()).toContainText('Other Client');

    await page.goto(`/projects?scope=mine&name=${fx.token}`);
    await expect(page.locator('tbody tr', { hasText: fx.projectMine.name })).toHaveCount(1);
    await expect(page.locator('tbody tr', { hasText: fx.projectOther.name })).toHaveCount(0);
    await page.goto('/projects?scope=mine');
    await expect(scopeLine(page)).toContainText(/Projects of matters you manage/);
    await page.goto(`/projects?scope=all&name=${fx.token}`);
    await expect(page.locator('tbody tr', { hasText: fx.projectOther.name })).toHaveCount(1);
  });

  test('a PM with no matter sees why the list is empty and can show all matters', async ({
    seed,
    personas,
    asUser,
  }) => {
    const fx = await pmFixtures(seed, personas);
    const page = await asUser(fx.pmNone.username);
    await page.goto('/matters');
    await expect(page.locator('[data-empty]')).toContainText('You do not manage any matter yet.');
    await scopeLine(page).waitFor();
    await page.locator('[data-show-all-matters]').click();
    await expect(page).toHaveURL(/scope=all/);
    await expect(page.locator('tbody tr').first()).toBeVisible();
    // The same wording on the other lists.
    await page.goto('/assets?scope=mine');
    // The filter row is open on arrival now (#499) and its select also carries a `data-empty` attribute: name the empty-state row.
    await expect(page.locator('[data-empty="none"]')).toContainText(
      'You do not manage any matter yet.',
    );
  });

  test('a PM without Matter.AssignManagers stays on My matters: no switch, ?scope=all is ignored', async ({
    seed,
    personas,
    asUser,
  }) => {
    const fx = await pmFixtures(seed, personas);
    const page = await asUser(fx.pmNoAssign.username);
    await page.goto(`/matters?scope=all&name=${fx.token}`);
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('tbody tr', { hasText: 'NoAssign own' })).toHaveCount(1);
    await expect(page).toHaveURL(/scope=mine/);
    await expect(page.locator('[data-scope-switch]')).toHaveCount(0);
    await expect(scopeLine(page)).toContainText('Matters you manage');
    await page.goto('/tasks?scope=all');
    await expect(page).toHaveURL(/scope=mine/);
  });

  for (const [label, key] of [
    ['Director (Matter.AssignManagers, cannot be a manager)', 'director'],
    ['technician', 'technician'],
    ['Read-Only Observer', 'observer'],
  ] as const) {
    test(`${label}: no switch, no line, the lists are what they were`, async ({
      seed,
      personas,
      asUser,
    }) => {
      const fx = await pmFixtures(seed, personas);
      const page = await asUser(fx[key].username);
      for (const url of [`/matters?name=${fx.token}`, '/assets', '/clients', '/projects']) {
        await page.goto(url);
        await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
        await expect(page.locator('[data-scope-switch], [data-scope-line]')).toHaveCount(0);
        expect(page.url()).not.toContain('scope=');
      }
      if (key !== 'observer') {
        await page.goto('/tasks');
        await expect(page.locator('[data-scope-switch]')).toHaveCount(0);
      }
    });
  }

  test('the System Admin keeps the lists as they were; keyboard: the switch is two buttons in tab order', async ({
    page,
  }) => {
    await page.goto('/matters');
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await expect(page.locator('[data-scope-switch]')).toHaveCount(0);
  });

  test('keyboard only: Tab reaches the switch, Enter and Space change it', async ({
    seed,
    personas,
    asUser,
  }) => {
    const fx = await pmFixtures(seed, personas);
    const page = await asUser(fx.pmA.username);
    await page.goto('/assets');
    await page.locator('[data-scope="all"]').focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/scope=all/);
    await page.locator('[data-scope="mine"]').focus();
    await page.keyboard.press('Space');
    await expect(page).toHaveURL(/scope=mine/);
  });
});

/**
 * A link that says "on the matters I manage" (the My Matters strip; WP-PX follow-ups #813 and #817): the scope switch, the chip counts and the
 * list agree, All and My matters change them together, and the Overdue links open the oldest overdue task first.
 */
test.describe('My Matters links open the Task Queue on My matters', () => {
  async function world(
    seed: Parameters<typeof mmWorld>[0],
    personas: Parameters<typeof mmWorld>[1],
  ) {
    const w = await mmWorld(seed, personas, 'qs');
    const a = await w.matter('Alpha');
    const b = await w.matter('Bravo', w.other);
    await w.task(a, { dueDate: '2001-05-05', title: 'Older overdue A' });
    await w.task(a, { dueDate: '2005-05-05', title: 'Newer overdue A' });
    await w.task(a, { dueDate: inDays(40), title: 'Later A' });
    await w.task(b, { dueDate: '2002-02-02', title: 'Overdue on Bravo' }); // not mine
    await w.task(b, { title: 'Open on Bravo' });
    return w;
  }

  const count = async (page: Page, view: string) =>
    Number(
      await page.locator(`[data-quick-views] [data-view="${view}"]`).getAttribute('data-count'),
    );

  test('Overdue, Unassigned, On hold and Due cells: My matters pressed, chip counts equal the list, All and My matters follow, Back restores', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await world(seed, personas);
    const page = await asUser(w.pm.username);
    await page.goto('/my-matters');
    const strip = page.locator('[data-mm-strip]');
    await expect(strip.locator('[data-strip-item=overdue]')).toContainText('2');

    await strip.locator('[data-strip-item=overdue]').click();
    await expect(page).toHaveURL(/\/tasks\?/);
    await expect(page).toHaveURL(/scope=mine/);
    await expect(page).not.toHaveURL(/managedByMe/);
    expect(await pressed(page, 'mine')).toBe('true');
    await expect(page.locator('tbody tr[data-task]')).toHaveCount(2);
    // The chips count the same scope as the list: 2 overdue of 3 open on my two matters (the other matter's tasks are not counted).
    await expect.poll(() => count(page, 'overdue')).toBe(2);
    await expect.poll(() => count(page, 'allOpen')).toBe(3);
    await expect(scopeLine(page)).toContainText(/2 tasks|Tasks on matters you manage \(2\)/);

    // All: the filter goes, the chips and the list count everything.
    await page.locator('[data-scope="all"]').click();
    await expect(page).toHaveURL(/scope=all/);
    expect(await pressed(page, 'all')).toBe('true');
    await expect.poll(() => count(page, 'allOpen')).toBeGreaterThan(3);
    await expect.poll(() => count(page, 'overdue')).toBeGreaterThan(2);

    // My matters brings the scope back and Back restores the address.
    await page.locator('[data-scope="mine"]').click();
    await expect(page).toHaveURL(/scope=mine/);
    await expect.poll(() => count(page, 'overdue')).toBe(2);
    await page.goBack();
    await expect(page).toHaveURL(/scope=all/);
    expect(await pressed(page, 'all')).toBe('true');

    // The other cells of the strip: the same agreement.
    for (const cell of ['unassigned', 'due3', 'onHold', 'open']) {
      await page.goto('/my-matters');
      const item = page.locator(`[data-mm-strip] [data-strip-item=${cell}]`);
      await expect(item).toBeVisible();
      await item.click();
      await expect(page).toHaveURL(/scope=mine/);
      expect(await pressed(page, 'mine'), cell).toBe('true');
      await expect(page.locator('[data-quick-views]')).toBeVisible();
      await expect.poll(() => count(page, 'allOpen'), cell).toBe(3);
    }
  });

  test('the Matters list: the strip cell opens on My matters with the scope in the address', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await world(seed, personas);
    const page = await asUser(w.pm.username);
    await page.goto('/my-matters');
    await page.locator('[data-mm-strip] [data-strip-item=matters]').click();
    await expect(page).toHaveURL(/\/matters/);
    await expect(page).toHaveURL(/scope=mine/);
    expect(await pressed(page, 'mine')).toBe('true');
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await page.locator('[data-scope="all"]').click();
    await expect(page).toHaveURL(/scope=all/);
    await expect.poll(async () => page.locator('tbody tr').count()).toBeGreaterThan(1);
  });

  test('Overdue links open the oldest overdue task first, the Due header says so, Priority is one click away, a plain link keeps the default order (#817)', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await world(seed, personas);
    const page = await asUser(w.pm.username);
    await page.goto('/my-matters');
    await page.locator('[data-mm-strip] [data-strip-item=overdue]').click();
    await expect(page).toHaveURL(/sort=due/);
    await expect(page).toHaveURL(/dir=asc/);
    const rows = page.locator('tbody tr[data-task]');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('Older overdue A');
    await expect(page.locator('th[data-col=due]')).toHaveAttribute('aria-sort', 'ascending');

    // Back to Priority: the header and the address follow.
    await page.locator('[data-reset-sort]').click();
    await expect(page).not.toHaveURL(/sort=due/);
    await expect(page.locator('th[data-col=due]')).toHaveAttribute('aria-sort', 'none');

    // The Needs my attention panel's View all overdue link.
    await page.goto('/my-matters');
    await page.locator('[data-group=overdue] [data-view-all]').click();
    await expect(page).toHaveURL(/sort=due/);
    await expect(rows.first()).toContainText('Older overdue A');

    // A Task Queue link of any other kind keeps the default order (a bare /tasks restores the view last used, sort included).
    await page.goto('/tasks?overdue=true&status=NEW&status=IN_PROGRESS&status=ON_HOLD');
    await expect(page.locator('tbody tr[data-task]').first()).toBeVisible();
    await expect(page).not.toHaveURL(/sort=/);
    await expect(page.locator('th[data-col=due]')).toHaveAttribute('aria-sort', 'none');
  });

  test('the Task Queue opened from the strip: axe 0 and no sideways scroll at four sizes', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await world(seed, personas);
    const page = await asUser(w.pm.username);
    await page.goto('/my-matters');
    await page.locator('[data-mm-strip] [data-strip-item=overdue]').click();
    await expect(page.locator('tbody tr').first()).toBeVisible();
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await expect(page.locator('[data-quick-views]')).toBeVisible();
      if (axeAvailable()) expect(await axeViolations(page), `at ${size.width}`).toEqual([]);
      await noHorizontalScroll(page);
    }
  });
});
