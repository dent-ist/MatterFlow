import fs from 'node:fs';
import path from 'node:path';
import { Api } from '../support/api';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';

/**
 * Default landing (#142, BUG-1 + M2) on the real API (not the stub): `/` sends a user with Task.View and work to My Work, a user with
 * Task.View and no work to the Task Queue, and a user without Task.View never to My Work. Work = an active Pod member, or an open assigned
 * task; tasks created by the user alone do not count. Only the bare `/` is affected: a deep link is untouched.
 * Every scenario owns its users (tagged), so the shared database does not matter.
 */
const SHOTS = process.env['E2E_SCREENSHOTS'];
const TASK_USER = ['Task.View', 'Task.Create', 'Task.Assign', 'Matter.View'];

test.describe('Default landing', () => {
  test('a technician with an open assigned task lands on My Work, and a deep link is untouched', async ({
    seed,
    asUser,
  }) => {
    const world = await seed.world();
    const role = await seed.role(TASK_USER, 'E2E landing tech');
    const tech = await seed.user([role.name], 'landtech');
    await seed.task(world, { assignedUserId: tech.userId });

    const page = await asUser(tech.username);
    await page.goto('/');
    await expect(page).toHaveURL(/\/my-work(\?|$)/);
    await expect(page.getByRole('heading', { name: 'My Work', level: 1 })).toBeVisible();

    await page.goto('/tasks');
    await expect(page).toHaveURL(/\/tasks$/);
    await expect(page.getByRole('heading', { name: 'Task Queue', level: 1 })).toBeVisible();
  });

  test('a Pod member without tasks lands on My Work', async ({ seed, asUser }) => {
    const role = await seed.role(TASK_USER, 'E2E landing pod');
    const member = await seed.user([role.name], 'landpod');
    await seed.pod(undefined, [member.userId]);

    const page = await asUser(member.username);
    await page.goto('/');
    await expect(page).toHaveURL(/\/my-work(\?|$)/);
  });

  test('a user with neither a Pod nor an assignment lands on the Task Queue', async ({
    seed,
    asUser,
  }) => {
    const role = await seed.role(TASK_USER, 'E2E landing none');
    const user = await seed.user([role.name], 'landnone');

    const page = await asUser(user.username);
    await page.goto('/');
    await expect(page).toHaveURL(/\/tasks$/);
    await expect(page.getByRole('heading', { name: 'Task Queue', level: 1 })).toBeVisible();
  });

  test('created-by-me alone does not count: the creator lands on the Task Queue, the assignee on My Work', async ({
    seed,
    asUser,
  }) => {
    const world = await seed.world();
    const role = await seed.role(TASK_USER, 'E2E landing creator');
    const creator = await seed.user([role.name], 'landcreator');
    const assignee = await seed.user([role.name], 'landassignee');
    const as = await Api.as(creator.username);
    try {
      await seed.task(world, { assignedUserId: assignee.userId }, as);
      await seed.task(world, {}, as);
    } finally {
      await as.dispose();
    }

    const creatorPage = await asUser(creator.username);
    await creatorPage.goto('/');
    await expect(creatorPage).toHaveURL(/\/tasks$/);

    const assigneePage = await asUser(assignee.username);
    await assigneePage.goto('/');
    await expect(assigneePage).toHaveURL(/\/my-work(\?|$)/);
  });

  test('without Task.View the landing is never My Work, even with an assigned task or a Pod', async ({
    seed,
    asUser,
  }) => {
    const world = await seed.world();
    const dashRole = await seed.role(
      ['Dashboard.View', 'Dashboard.ViewSummary', 'Matter.View'],
      'E2E landing dash',
    );
    const dash = await seed.user([dashRole.name], 'landdash');
    await seed.task(world, { assignedUserId: dash.userId });
    await seed.pod(undefined, [dash.userId]);

    const dashPage = await asUser(dash.username);
    await dashPage.goto('/');
    await expect(dashPage).toHaveURL(/\/dashboard/);

    const clientRole = await seed.role(['Client.View'], 'E2E landing client');
    const client = await seed.user([clientRole.name], 'landclient');
    await seed.pod(undefined, [client.userId]);
    const clientPage = await asUser(client.username);
    await clientPage.goto('/');
    await expect(clientPage).toHaveURL(/\/clients/);
  });

  test('a user with no role still goes to Access Pending', async ({ seed, asUser }) => {
    const user = await seed.user([], 'landpending');
    const page = await asUser(user.username);
    await page.goto('/');
    await expect(page).toHaveURL(/\/access-pending$/);
  });

  for (const size of [
    { width: 1366, height: 768 },
    { width: 1920, height: 1080 },
    { width: 768, height: 1024 },
    { width: 375, height: 812 },
  ]) {
    test(`axe on the landing page at ${size.width}`, async ({ seed, asUser }) => {
      test.skip(!axeAvailable(), 'axe-core is not available');
      const role = await seed.role(TASK_USER, 'E2E landing axe');
      const member = await seed.user([role.name], 'landaxe');
      await seed.pod(undefined, [member.userId]);
      const page = await asUser(member.username);
      await page.setViewportSize(size);
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'My Work', level: 1 })).toBeVisible();
      expect(await axeViolations(page)).toEqual([]);
    });
  }

  test('screenshots: a user with work on My Work, a user without on the Task Queue', async ({
    seed,
    asUser,
  }) => {
    test.skip(!SHOTS, 'set E2E_SCREENSHOTS to the output folder');
    fs.mkdirSync(SHOTS!, { recursive: true });
    const role = await seed.role(TASK_USER, 'E2E landing shots');
    const member = await seed.user([role.name], 'landshotmember');
    await seed.pod(undefined, [member.userId]);
    const loner = await seed.user([role.name], 'landshotnone');
    const withWork = await asUser(member.username);
    const without = await asUser(loner.username);
    for (const [width, height] of [
      [1366, 768],
      [1920, 1080],
      [768, 1024],
      [375, 812],
    ]) {
      for (const [who, page, heading] of [
        ['with-work-my-work', withWork, 'My Work'],
        ['no-work-task-queue', without, 'Task Queue'],
      ] as const) {
        await page.setViewportSize({ width, height });
        await page.goto('/');
        await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
        await page.waitForTimeout(400);
        await page.screenshot({ path: path.join(SHOTS!, `landing-${who}-${width}x${height}.png`) });
      }
    }
  });
});
