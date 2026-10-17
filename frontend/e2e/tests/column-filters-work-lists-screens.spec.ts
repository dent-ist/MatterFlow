import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';
import { TaskApi } from '../support/tasks';

/**
 * Screenshot run for docs/ux/column-filters (Batch 3 screens; not a test: skipped unless E2E_SCREENSHOTS is set to the output folder):
 *   E2E_SCREENSHOTS=docs/ux/column-filters/screenshots frontend/e2e/run-local.sh -g "column filters work lists screenshots"
 * Task Queue, My Work, Pod Work and the Matter's Tasks at 1366x768 (open, presets, filtered, hidden-column chip, empty, notice) and at
 * 375x812 (closed, the sheet); the Users Availability select that used to clip "Out of office".
 */
const OUT = process.env['E2E_SCREENSHOTS'];

test.describe('column filters work lists screenshots', () => {
  test.skip(!OUT, 'set E2E_SCREENSHOTS to the output folder');

  test('capture', async ({ page, seed, admin, asUser }) => {
    test.setTimeout(900_000);
    const token = uid();
    const me = await seed.user(['Data Technician'], `shot-me-${token}`);
    const colleague = await seed.user(['Data Technician'], `shot-col-${token}`);
    const pod = await seed.pod(`Review ${token}`, [me.userId, colleague.userId]);
    const world = await seed.world();
    const project = await seed.project(world.matter, `Phase ${token}`);
    const priorities = await admin.get<{ id: number; label: string }[]>('/api/v1/priorities');
    const high = priorities.find((p) => p.label === 'High')?.id ?? priorities[0].id;

    const make = (title: string, extra: object = {}) =>
      seed.task(world, { title: `${title} ${token}`, ...extra });
    await make('Collect custodian data', {
      assignedUserId: me.userId,
      assignedPodId: pod.podId,
      priorityId: high,
      dueDate: '2099-01-15',
    });
    await make('Process email archive', { assignedUserId: me.userId, dueDate: '2000-01-03' });
    await make('Quality check production', {
      assignedPodId: pod.podId,
      projectId: project.projectId,
    });
    await make('Deliver the final set', { assignedPodId: pod.podId, priorityId: high });
    const held = await make('Await client approval', {
      assignedUserId: colleague.userId,
      assignedPodId: pod.podId,
    });
    await new TaskApi(admin, held.taskId).changeStatus('ON_HOLD', 'Waiting for the client');
    await make('Prepare privilege log', { assignedUserId: colleague.userId });
    // A user who is out of office: the Availability filter on the Users list names its choices in full.
    const away = await seed.user(['Data Scientist'], `shot-away-${token}`);
    await seed.outOfOffice(away.userId, { note: 'Away' });

    fs.mkdirSync(OUT!, { recursive: true });
    const shot = async (p: Page, name: string) => {
      await p.waitForLoadState('networkidle');
      await p.waitForTimeout(300);
      const size = p.viewportSize()!;
      await p.screenshot({ path: path.join(OUT!, `${name}-${size.width}x${size.height}.png`) });
    };
    const toggle = page.getByRole('button', { name: /^Filters/ });
    const first = page.locator('tr[data-task]').first();

    await page.setViewportSize({ width: 1366, height: 768 });

    // Task Queue
    await page.goto(`/tasks?q=${token}`);
    await expect(first).toBeVisible();
    await shot(page, 'work-queue-filters-open');
    await page.getByRole('button', { name: /^Filter by Priority,/ }).click();
    await shot(page, 'work-queue-priority-multiselect');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /^Filter by Due/ }).click();
    await shot(page, 'work-queue-due-daterange');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'More filters' }).click();
    await shot(page, 'work-queue-more-filters');
    await page.keyboard.press('Escape');

    await page.goto(`/tasks?q=${token}&priority=${high}&matterText=${world.matter.matterRef}`);
    await expect(first).toBeVisible();
    await shot(page, 'work-queue-filters-active');
    await page.goto(
      `/tasks?q=${token}&clientText=${encodeURIComponent(world.client.name)}&updatedFrom=2000-01-01`,
    );
    await expect(first).toBeVisible();
    await shot(page, 'work-queue-hidden-column-chips');
    await toggle.click(); // close the row: the chips show every filter
    await shot(page, 'work-queue-chips-row-closed');
    await toggle.click();

    await page.goto('/tasks');
    await expect(first).toBeVisible();
    await page
      .getByRole('group', { name: 'Quick views' })
      .getByRole('button', { name: 'Overdue' })
      .click();
    await expect(page).toHaveURL(/overdue=true/);
    await shot(page, 'work-queue-quick-view-overdue');
    await page.goto(`/tasks?q=nothing-${token}`);
    await expect(page.locator('tbody td[data-empty="filtered"]')).toBeVisible();
    await shot(page, 'work-queue-empty-filtered');

    await page.goto(`/tasks?q=${token}&priority=${high}`); // remembered by this browser
    await expect(first).toBeVisible();
    await page.goto('/tasks');
    await expect(page.locator('[data-restored-notice]')).toBeVisible();
    await shot(page, 'work-queue-restored-notice');

    // My Work (as the user whose work it is) with Assignee and Creator shown, to see what each tab owns.
    const mine = await asUser(me.username);
    await mine.addInitScript(
      ([keys, value]) => {
        for (const key of keys) localStorage.setItem(key, value);
      },
      [
        ['active', 'dueSoon', 'closed', 'createdByMe'].map(
          (tab) => `mf.work-columns.v2.myWork.${tab}.${me.userId}`,
        ),
        JSON.stringify([
          'ref',
          'title',
          'matter',
          'priority',
          'assignee',
          'creator',
          'due',
          'status',
        ]),
      ] as const,
    );
    await mine.setViewportSize({ width: 1366, height: 768 });
    await mine.goto('/my-work');
    await expect(mine.locator('tr[data-task]').first()).toBeVisible();
    await shot(mine, 'my-work-active');
    await mine.getByRole('tab', { name: /^Created by me/ }).click();
    await expect(mine.getByRole('tab', { name: /^Created by me/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await shot(mine, 'my-work-created-by-me');
    await mine.getByRole('tab', { name: /^Due soon/ }).click();
    await expect(mine.getByRole('tab', { name: /^Due soon/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await shot(mine, 'my-work-due-soon');

    // Pod Work
    await mine.goto(`/pods/work?podId=${pod.podId}`);
    await expect(mine.locator('tr[data-task]').first()).toBeVisible();
    await shot(mine, 'pod-work-unassigned');
    await mine.getByRole('tab', { name: /^By member/ }).click();
    await mine.getByRole('button', { name: `Show tasks of ${colleague.username}` }).click();
    await expect(mine).toHaveURL(/assignee=/);
    await shot(mine, 'pod-work-by-member');

    // Matter and Project tasks
    await page.goto(`/matters/${world.matter.matterId}`);
    await expect(page.locator('mf-scoped-tasks tr[data-task]').first()).toBeVisible();
    await toggle.click();
    await shot(page, 'matter-tasks-filters-open');
    await page.goto(`/matters/${world.matter.matterId}?status=&project=${project.projectId}`);
    await expect(page.locator('mf-scoped-tasks tr[data-task]').first()).toBeVisible();
    await shot(page, 'matter-tasks-filtered');

    // Users: the Availability select shows "Out of office" in full.
    await page.goto(`/admin/users?status=all&account=${token}`);
    await page.goto(`/admin/users?status=all&availability=OUT_OF_OFFICE&name=shot-away-${token}`);
    await expect(page.locator('tbody tr').first()).toBeVisible();
    await shot(page, 'admin-users-availability-select');

    // 375x812
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/tasks');
    await expect(page.getByRole('heading', { name: 'Task Queue', level: 1 })).toBeVisible();
    await shot(page, 'work-queue-closed');
    await toggle.click();
    await expect(page.getByRole('dialog', { name: 'Filters' })).toBeVisible();
    await shot(page, 'work-queue-sheet');
    await page
      .getByRole('dialog', { name: 'Filters' })
      .getByRole('textbox', { name: 'Filter by Title or Ref' })
      .fill(token);
    await expect(page).toHaveURL(/q=/);
    await shot(page, 'work-queue-sheet-filtered');
    await page.getByRole('button', { name: /^Show \d+ result/ }).click();
    await shot(page, 'work-queue-chips');

    await mine.setViewportSize({ width: 375, height: 812 });
    await mine.goto('/my-work');
    await expect(mine.getByRole('heading', { name: 'My Work', level: 1 })).toBeVisible();
    await shot(mine, 'my-work-closed');
    await mine.getByRole('button', { name: /^Filters/ }).click();
    await shot(mine, 'my-work-sheet');
  });
});
