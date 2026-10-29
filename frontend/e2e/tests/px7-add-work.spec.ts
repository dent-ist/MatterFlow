import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { mmWorld } from '../support/my-matters-fixtures';
import { SIZES, noHorizontalScroll } from '../support/screens';

/**
 * Adding work from the first screen of My Matters (PM experience follow-up #814): a "New task" button in the page header, which uses the matter chosen
 * in the Matter filter when exactly one is chosen and otherwise asks (issue #941; the chooser "Matter: ..." of #900 is gone), and a "Recently used" row of
 * task types in the chooser. The click counts are the ones the review counted (7 clicks and a 2,000 px scroll before).
 */
async function setup(
  seed: Parameters<typeof mmWorld>[0],
  personas: Parameters<typeof mmWorld>[1],
  label: string,
) {
  const w = await mmWorld(seed, personas, label);
  const alpha = await w.matter('Alpha');
  const bravo = await w.matter('Bravo');
  const type = await seed.taskType({
    workflows: [w.world.workflow],
    name: `Add work ${label} ${w.pm.userId}`,
  });
  return { w, alpha, bravo, type };
}

test.describe('Add work from My Matters', () => {
  test('New task and the matter are on the first screen, the chosen type is remembered, and the second task is three clicks', async ({
    seed,
    personas,
    asUser,
  }) => {
    test.setTimeout(180_000);
    const { w, alpha, type } = await setup(seed, personas, 'addwork');
    const page = await asUser(w.pm.username);
    let clicks = 0;
    const click = async (target: ReturnType<Page['locator']>) => {
      clicks++;
      await target.click();
    };

    // The landing page: the control is in the header, on the first screen, no scrolling.
    await page.goto('/my-matters');
    const control = page.locator('[data-header-new-task]');
    await expect(control).toBeVisible();
    const box = (await control.boundingBox())!;
    expect(box.y + box.height, 'New task is on the first screen').toBeLessThan(
      page.viewportSize()!.height,
    );
    // The Matter filter chooses the matter (it limits the page too); New task then uses it.
    await expect(control.getByRole('button', { name: /^New task$/ })).toBeVisible();
    await click(page.locator('#mm-matter'));
    await click(page.locator('#mm-matter-list [role=option]').filter({ hasText: alpha.matterRef }));
    await expect(page).toHaveURL(new RegExp(`matterId=${alpha.matterId}`));
    await click(control.getByRole('button', { name: /^New task for / }));
    await expect(page).toHaveURL(new RegExp(`/tasks/new\\?matterId=${alpha.matterId}`));
    await expect(page.locator('[data-recent-types]')).toHaveCount(0); // nothing used yet
    await click(page.getByRole('radio', { name: new RegExp(type.name) }));
    // The matter is fixed: the Title has the focus.
    await expect(page.getByRole('textbox', { name: 'Title (required)' })).toBeFocused();
    await page.getByRole('textbox', { name: 'Title (required)' }).fill('First task of the type');
    await page.getByRole('textbox', { name: 'Requestor name (required)' }).fill('Jane Doe');
    await click(page.getByRole('button', { name: 'Create task', exact: true }));
    await expect(page).toHaveURL(new RegExp(`/my-matters\\?.*matterId=${alpha.matterId}`)); // the page comes back with the matter still chosen
    // The focus returns to the control.
    await expect(page.locator('[data-new-task-go]')).toBeFocused();
    console.log(`first task: ${clicks} clicks from the landing page`);

    // The second task of the type, the way the review counted it.
    clicks = 0;
    await click(page.locator('[data-new-task-go]'));
    await expect(page).toHaveURL(new RegExp(`/tasks/new\\?matterId=${alpha.matterId}`));
    const recent = page.locator('[data-recent-types]');
    await expect(recent).toBeVisible();
    expect(await recent.locator('[data-recent-type]').count()).toBe(1);
    await click(recent.getByRole('button', { name: new RegExp(type.name) }));
    await page.getByRole('textbox', { name: 'Title (required)' }).fill('Second task of the type');
    await page.getByRole('textbox', { name: 'Requestor name (required)' }).fill('Jane Doe');
    await click(page.getByRole('button', { name: 'Create task', exact: true }));
    await expect(page).toHaveURL(/\/my-matters/);
    console.log(`second task: ${clicks} clicks from the landing page`);
    expect(clicks, 'clicks from the landing page to the created task').toBeLessThanOrEqual(5);
    expect(clicks).toBe(3);

    const made = await seed.admin.get<{ items: { taskId: number; matterId: number }[] }>(
      `/api/v1/tasks?matterId=${alpha.matterId}&q=${encodeURIComponent('Second task of the type')}`,
    );
    expect(made.items.map((t) => t.matterId)).toEqual([alpha.matterId]);
  });

  test('with no matter chosen New task asks for the matter itself (its own search); with one chosen it opens Create task with that matter; Cancel comes back with the focus', async ({
    seed,
    personas,
    asUser,
  }) => {
    const { w, alpha, bravo } = await setup(seed, personas, 'othermatter');
    const page = await asUser(w.pm.username);
    await page.goto('/my-matters');
    // There is no chooser of the matter beside New task any more.
    await expect(page.locator('[data-header-new-task]').getByRole('button')).toHaveCount(1);
    const go = page.locator('[data-new-task-go]');
    await expect(go).toHaveText('New task');
    await expect(go).toHaveAccessibleName('New task');
    await go.click();
    await expect(page).toHaveURL(/\/tasks\/new\?returnTo=/);
    await expect(page).not.toHaveURL(/matterId=/);
    await page.getByRole('radio').first().click(); // Cancel is on the form
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page).toHaveURL(/\/my-matters/);
    await expect(go).toBeFocused();
    // With Bravo chosen in the Matter filter, New task opens Create task with Bravo.
    await page.goto(`/my-matters?matterId=${bravo.matterId}`);
    await expect(go).toHaveAccessibleName(`New task for ${bravo.matterRef} ${bravo.name}`);
    await go.click();
    await expect(page).toHaveURL(new RegExp(`matterId=${bravo.matterId}`));
    expect(alpha.matterId).not.toBe(bravo.matterId);
  });

  test('a person who cannot create tasks, or manages no matter, has no New task control', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'nocontrol');
    // The second Project Manager manages nothing here.
    const page = await asUser(w.other.username);
    await page.goto('/my-matters');
    await expect(page.locator('[data-no-matters]')).toBeVisible();
    await expect(page.locator('[data-header-new-task]')).toHaveCount(0);
  });

  for (const size of SIZES) {
    test(`axe 0 and no sideways scroll at ${size.width}x${size.height}: the control, the Options menu and the chooser of task types`, async ({
      seed,
      personas,
      asUser,
    }) => {
      test.skip(!axeAvailable(), 'axe-core not installed (set E2E_AXE_PATH)');
      const { w, alpha, type } = await setup(seed, personas, `axe${size.width}`);
      const page = await asUser(w.pm.username);
      await page.setViewportSize(size);
      await page.goto(`/my-matters?matterId=${alpha.matterId}`);
      const phone = size.width < 640;
      // A phone has New task in the one Options menu of the title row (issue #922); a wide screen has the button in the title row.
      const trigger = phone
        ? page.locator('[data-header-options] [data-options-trigger]')
        : page.locator('[data-new-task-go]');
      await expect(trigger).toBeVisible();
      const box = (await trigger.boundingBox())!;
      expect(box.y + box.height, 'on the first screen').toBeLessThan(size.height);
      if (phone) expect(box.height).toBeGreaterThanOrEqual(44);
      expect(await axeViolations(page), 'closed').toEqual([]);
      if (phone) {
        await trigger.click();
        await expect(page.locator('[data-new-task-inline]')).toBeVisible();
        expect(await axeViolations(page), 'menu open').toEqual([]);
      }
      await noHorizontalScroll(page);
      if (phone) await page.locator('[data-new-task-inline] [data-new-task-go]').click();
      else await trigger.click();
      await expect(page).toHaveURL(new RegExp(`matterId=${alpha.matterId}`));
      await page.getByRole('radio', { name: new RegExp(type.name) }).click();
      await page.getByRole('textbox', { name: 'Title (required)' }).fill(`Axe ${size.width}`);
      await page.getByRole('textbox', { name: 'Requestor name (required)' }).fill('Rita');
      await page.getByRole('button', { name: 'Create task', exact: true }).click();
      await expect(page).toHaveURL(/\/my-matters/);
      // The chooser with its "Recently used" row.
      await page.goto(`/tasks/new?matterId=${alpha.matterId}`);
      const recent = page.locator('[data-recent-types]');
      await expect(recent).toBeVisible();
      if (size.width < 640) {
        const b = (await recent.locator('button').first().boundingBox())!;
        expect(b.height).toBeGreaterThanOrEqual(44);
      }
      expect(await axeViolations(page), 'chooser with recent types').toEqual([]);
      await noHorizontalScroll(page);
      await recent.locator('button').first().click();
      expect(await axeViolations(page), 'form').toEqual([]);
      await noHorizontalScroll(page);
    });
  }
});
