import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { TaskDetailPage } from '../pages/task-detail.page';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { TaskApi } from '../support/tasks';

/**
 * Task detail Workflow tab (#666): the step tags and the status are plain text (nothing that is not a control looks like a button), each
 * step shows exactly one status (the current step is "Up next" or "In progress", only later steps are "Pending"), and the step actions are
 * in the step header at the top right, right after the title in tab order. No keyboard shortcut is added or changed (Phase 2, #420).
 * Screenshots go to E2E_SCREENSHOTS when it is set (docs/ux/task-detail-review/fixes/wf-666).
 */
const OUT = process.env['E2E_SCREENSHOTS'];

const SIZES = [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
] as const;

const STEPS = [
  { title: 'Intake', isSkippable: true },
  { title: 'Validate' },
  { title: 'Load' },
  { title: 'Report' },
];

async function check(page: Page, name: string): Promise<void> {
  const width = page.viewportSize()!.width;
  if (axeAvailable()) {
    expect(await axeViolations(page), `${name} at ${width}`).toEqual([]);
  }
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `page-level horizontal scroll at ${width}`).toBeLessThanOrEqual(0);
  if (OUT) {
    fs.mkdirSync(OUT, { recursive: true });
    const size = page.viewportSize()!;
    await page.screenshot({ path: path.join(OUT, `${name}-${size.width}x${size.height}.png`) });
  }
}

test.describe('Task Workflow tab: step status and actions (#666)', () => {
  test('tags and status are plain text, one status per step, the current step is "Up next"; actions at the top right at 375, 768, 1366 and 1920', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await seed.world({ steps: STEPS });
    const task = await seed.task(world);
    const [intake, validate, load, report] = world.workflow.stepTitles;
    const detail = new TaskDetailPage(page);

    for (const size of SIZES) {
      await page.setViewportSize(size);
      await detail.open(task.taskId);
      await expect(page.locator('[data-workflow-tab]')).toBeVisible();

      // One status per step: the current step is "Up next" (nobody started it), later steps are "Pending".
      await expect(detail.step(intake).state).toHaveText('Up next');
      for (const title of [validate, load, report]) {
        await expect(detail.step(title).state).toHaveText('Pending');
      }
      for (const step of await page.locator('[data-step-id]').all()) {
        await expect(step.locator('[data-state]')).toHaveCount(1);
      }
      await expect(detail.step(intake).root.locator('[data-current]')).toHaveText('Current');
      await expect(page.locator('[data-current]')).toHaveCount(1);
      await expect(detail.step(intake).root.locator('[data-tag]')).toHaveText('Skippable');
      await expect(detail.step(validate).root.locator('[data-tag]')).toHaveText('Required');

      // Nothing in the step meta line looks like a button: no border, no fill, no badge.
      const looks = await page.locator('[data-step-id] .step__meta > *').evaluateAll((els) =>
        els.map((el) => {
          const css = getComputedStyle(el);
          return {
            border: css.borderTopWidth,
            background: css.backgroundColor,
            cursor: css.cursor,
          };
        }),
      );
      expect(looks.length).toBeGreaterThan(0);
      for (const l of looks) {
        expect(l.border).toBe('0px');
        expect(l.background).toBe('rgba(0, 0, 0, 0)');
        expect(l.cursor).not.toBe('pointer');
      }
      await expect(page.locator('[data-workflow-tab] mf-badge')).toHaveCount(0);

      // The actions are in the header of the open step, after the title toggle in DOM and tab order, primary last.
      const step = detail.step(intake).root;
      const actions = step.locator('[data-step-actions]');
      await expect(actions.getByRole('button')).toHaveText([
        'Start step',
        'Skip step',
        'Mark complete',
      ]);
      await expect(actions.locator('.mf-btn--primary')).toHaveText('Mark complete');
      await expect(
        step.locator('.step__body [data-complete], .step__body [data-skip]'),
      ).toHaveCount(0);
      const a = (await actions.boundingBox())!;
      const t = (await step.getByRole('heading').boundingBox())!;
      const s = (await step.boundingBox())!;
      if (size.width >= 768) {
        // Top right: on the title's row and at the step's right edge.
        expect(Math.abs(a.y + a.height / 2 - (t.y + t.height / 2))).toBeLessThan(24);
        expect(a.x + a.width).toBeGreaterThan(s.x + s.width - 40);
      } else {
        // Phone: the actions wrap right under the title, inside the header, and never leave the step.
        expect(a.y).toBeGreaterThanOrEqual(t.y + t.height - 1);
        expect(a.y).toBeLessThan(t.y + t.height + 60);
        expect(a.x + a.width).toBeLessThanOrEqual(s.x + s.width + 1);
      }
      // Reachable without scrolling the step body: in view with the title.
      await expect(detail.step(intake).startButton).toBeInViewport();
      await check(page, 'workflow-steps-up-next');
    }
  });

  test('Start step makes the current step "In progress"; the next Tab stop after the title is its first action; Reopen is in the header of a completed step', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await seed.world({ steps: STEPS });
    const task = await seed.task(world);
    const [intake, validate] = world.workflow.stepTitles;
    const detail = new TaskDetailPage(page);
    await page.setViewportSize({ width: 1366, height: 768 });
    await detail.open(task.taskId);

    await detail.step(intake).toggle.focus();
    await page.keyboard.press('Tab');
    await expect(detail.step(intake).startButton).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(detail.step(intake).state).toHaveText('In progress');
    await expect(detail.step(intake).root.locator('[data-current]')).toHaveText('Current');
    await expect(detail.step(intake).startButton).toHaveCount(0);
    await check(page, 'workflow-steps-in-progress');

    await new TaskApi(admin, task.taskId).completeSteps(1);
    await detail.open(task.taskId);
    await expect(detail.step(intake).state).toHaveText('Completed');
    await expect(detail.step(validate).state).toHaveText('Up next');
    await detail.step(intake).expand();
    const reopen = detail.step(intake).root.locator('[data-step-actions] [data-reopen]');
    await expect(reopen).toBeVisible();
    await expect(reopen).toHaveText('Reopen step');
    await expect(reopen).toBeInViewport();
    await check(page, 'workflow-steps-completed-reopen');
  });
});
