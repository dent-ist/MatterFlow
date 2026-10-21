import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { PodWorkPage } from '../pages/queues.pages';
import { axeAvailable, axeBestPractice } from '../support/axe';
import { expect, test } from '../support/fixtures';

/**
 * Pod Work, assign flow (epic #546, package WP-PW6): W13 (#572), the cross-pod assignment rule of UAT-S04-4. The finding: the assignee
 * picker on Pod Work lists this pod's members only, while UAT-S04-4 says cross-pod assignment is allowed and not being a member is only
 * information. Findings, decided by the PM and recorded here and in the docs (#576):
 *   1. The server allows it: assigning a pod's task to a user outside the pod succeeds, the task keeps its pod, the answer carries the
 *      warning USER_NOT_IN_POD and the audit entry is written (integration test `Assigning_a_pod_task_to_someone_outside_the_pod_...`,
 *      TaskEditApiTests, and the API check below).
 *   2. Pod Work's picker stays pod-members-first and members-only in this phase (the shared picker is not changed in this epic). People
 *      outside the pod are reached through the Task Queue, whose picker offers every active user.
 * This spec documents the picker's behaviour (a member is offered, a person outside the pod is not, even when searched for) and the server
 * rule. Screenshots go to `E2E_SCREENSHOTS_PW_ASSIGN` when set (docs/ux/pod-work-review/fixes/pw6-assign).
 */
const OUT = process.env['E2E_SCREENSHOTS_PW_ASSIGN'];

async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

const SIZES = [
  { name: '1366x768', width: 1366, height: 768 },
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '375x812', width: 375, height: 812 },
] as const;

test.describe('Pod Work assign flow', () => {
  test('axe is available (the audits below really run)', () => {
    expect(axeAvailable(), 'set E2E_AXE_PATH to axe.min.js').toBe(true);
  });

  test.describe('#572 W13: the cross-pod assignment rule', () => {
    for (const size of SIZES) {
      test(`${size.name}: the picker offers the pod's members, not a person outside the pod, even when searched; axe 0 with the menu open`, async ({
        seed,
        personas,
        asUser,
      }) => {
        const pod = await seed.pod(undefined, []);
        const lead = await personas.create({ label: 'pw-pick', roles: ['Pod Lead'] });
        const member = await personas.create({ label: 'pw-member', roles: ['Data Technician'] });
        const outsider = await personas.create({ label: 'pw-outside', roles: ['Data Technician'] });
        await seed.admin.post(`/api/v1/pods/${pod.podId}/members`, {
          userIds: [lead.userId, member.userId],
        });
        const world = await seed.world();
        const task = await seed.task(world, {
          title: `Picker ${pod.podId}`,
          assignedPodId: pod.podId,
        });

        const page = await asUser(lead.username);
        await page.setViewportSize({ width: size.width, height: size.height });
        const pw = new PodWorkPage(page);
        await page.goto(`/pods/work?podId=${pod.podId}`);
        await expect(
          pw
            .row(task.taskNumber)
            .or(page.locator(`li[data-task="${task.taskNumber}"]`))
            .first(),
        ).toBeVisible();
        await page
          .getByRole('button', { name: new RegExp(`change assignee of ${task.taskNumber}`) })
          .click();
        const menu = page.locator('.im-pop');
        await expect(menu.getByRole('menuitemradio', { name: member.username })).toBeVisible();
        await expect(menu.getByRole('menuitemradio', { name: outsider.username })).toHaveCount(0);

        // Searching for the outsider by name finds nobody: the list is the pod's members.
        await menu.getByRole('textbox', { name: 'Search people' }).fill(outsider.username);
        await expect(menu.getByRole('menuitemradio', { name: outsider.username })).toHaveCount(0);
        await menu.getByRole('textbox', { name: 'Search people' }).fill('');
        await shot(page, `picker-members-only-${size.name}`);

        const found = await axeBestPractice(page);
        expect(
          found.filter((v) => !['skip-link', 'region'].includes(v.id)),
          `axe with the menu open at ${size.name}`,
        ).toEqual([]);
      });
    }

    test('the server allows the assignment the picker does not offer: a person outside the pod gets the task, with the warning, and the task keeps its pod', async ({
      seed,
      personas,
    }) => {
      const pod = await seed.pod(undefined, []);
      const outsider = await personas.create({ label: 'pw-cross', roles: ['Data Technician'] });
      const world = await seed.world();
      const task = await seed.task(world, {
        title: `Cross ${pod.podId}`,
        assignedPodId: pod.podId,
      });

      const assigned = await seed.admin.post(`/api/v1/tasks/${task.taskId}/assignment`, {
        podId: pod.podId,
        userId: outsider.userId,
        rowVersion: task.rowVersion,
      });
      expect(assigned.assignedUser.userId).toBe(outsider.userId);
      expect(assigned.assignedPod.podId).toBe(pod.podId);
      expect(assigned.warnings).toContain('USER_NOT_IN_POD');
    });
  });
});
