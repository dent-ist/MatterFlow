import { Page } from '@playwright/test';
import { CreateTaskPage } from '../pages/create-task.page';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { FieldSpec } from '../support/seed';

/**
 * Create task sections (#349): Task (Matter, Title, Description, Project), Input (requestor, the request-form fields, the workflow) and
 * "Priority, due date and assignment" (collapsed by default, one summary line, opens by itself on an error). Due date and Time sit on one
 * line. Screenshots: E2E_SCREENSHOTS=docs/ux/task-detail-review/fixes/create-sections (otherwise none are written).
 */
const SIZES = [
  { name: '1366x768', width: 1366, height: 768 },
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '375x812', width: 375, height: 812 },
] as const;

const FIELDS: FieldSpec[] = [
  { key: 'alpha', label: 'Alpha request', control: 'TEXT', required: true },
  { key: 'beta', label: 'Beta request', control: 'TEXT' },
  { key: 'gamma', label: 'Gamma request', control: 'TEXT' },
];

async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env['E2E_SCREENSHOTS'];
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}

async function checkPage(page: Page, label: string): Promise<void> {
  // Axe from the top of the page: the sticky action bar would otherwise cover part of whatever the last click scrolled to.
  await page.evaluate(() => window.scrollTo(0, 0));
  if (axeAvailable()) expect(await axeViolations(page), `axe: ${label}`).toEqual([]);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `page-level horizontal scroll: ${label}`).toBeLessThanOrEqual(0);
}

const top = async (loc: ReturnType<Page['locator']>): Promise<number> =>
  (await loc.boundingBox())!.y;

test.describe('Create task sections (#349)', () => {
  for (const size of SIZES) {
    test(`sections and order, collapsed and expanded, Due date and Time aligned at ${size.name}`, async ({
      page,
      seed,
    }) => {
      const world = await seed.world({ stepCount: 2, fields: FIELDS });
      await page.setViewportSize({ width: size.width, height: size.height });
      const create = new CreateTaskPage(page);
      await create.open(`?taskType=${world.taskType.id}&matterId=${world.matter.matterId}`);
      await create.chooseTaskType(world.taskType.name);

      // Exactly three sections, in this order; "More details" is gone.
      await expect(page.locator('form.ct__form h2')).toHaveText([
        'Task',
        'Input',
        /^Priority, due date and assignment/,
      ]);
      await expect(page.getByText('More details')).toHaveCount(0);

      // Task: Matter, Title, Description, Project, in that order.
      const order = [
        await top(page.locator('[data-chosen]').first()),
        await top(create.title),
        await top(create.description),
        await top(create.project),
      ];
      expect([...order].sort((a, b) => a - b)).toEqual(order);
      // Input: requestor, then the form fields in form order (inside the Input section).
      const input = page.locator('[data-section="input"]');
      await expect(input.getByRole('textbox', { name: /^Alpha request/ })).toBeVisible();
      const fieldTops = [
        await top(input.getByRole('textbox', { name: /^Alpha request/ })),
        await top(input.getByRole('textbox', { name: /^Beta request/ })),
        await top(input.getByRole('textbox', { name: /^Gamma request/ })),
      ];
      expect([...fieldTops].sort((a, b) => a - b)).toEqual(fieldTops);
      await expect(page.locator('[data-section="when"]').getByLabel(/Alpha request/)).toHaveCount(
        0,
      );

      // Collapsed by default, with a summary of the values.
      await expect(create.whenToggle).toHaveAttribute('aria-expanded', 'false');
      await expect(create.whenToggle).toHaveAttribute('aria-controls', 'ct-when-body');
      await expect(create.whenSummary).toHaveText(
        /^Normal priority, no due date \(ASAP\), Unassigned$/,
      );
      await expect(page.locator('#ct-when-body')).toBeHidden();
      await shot(page, `collapsed-${size.name}`);
      await checkPage(page, `collapsed ${size.name}`);

      // Expanded: aligned Due date and Time.
      await create.openWhen();
      await expect(page.locator('#ct-when-body')).toBeVisible();
      const d = (await create.dueDate.boundingBox())!;
      const t = (await create.dueTime.boundingBox())!;
      if (size.width >= 640) {
        expect(Math.abs(d.y - t.y), 'top of Due date and Time').toBeLessThanOrEqual(1);
        expect(Math.abs(d.y + d.height - (t.y + t.height)), 'bottom').toBeLessThanOrEqual(1);
        const labels = [
          await top(page.locator('label[for="ct-due-date"]')),
          await top(page.locator('label[for="ct-due-time"]')),
        ];
        expect(Math.abs(labels[0] - labels[1]), 'label baseline').toBeLessThanOrEqual(1);
      } else {
        expect(t.y).toBeGreaterThan(d.y + d.height - 1); // stacked
        // The date control is the text input plus its calendar button: compare the whole control with the time input.
        const whole = (await page.locator('#ct-when-body .di').first().boundingBox())!;
        expect(Math.abs(whole.width - t.width), 'equal widths when stacked').toBeLessThanOrEqual(1);
      }
      await shot(page, `expanded-${size.name}`);
      await checkPage(page, `expanded ${size.name}`);
    });
  }

  test('the summary line follows the values; the header is a button that Enter and Space toggle', async ({
    page,
    seed,
  }) => {
    const world = await seed.world({ stepCount: 2, fields: FIELDS });
    const create = new CreateTaskPage(page);
    await create.open(`?taskType=${world.taskType.id}&matterId=${world.matter.matterId}`);
    await create.whenToggle.focus();
    await page.keyboard.press('Enter');
    await expect(create.whenToggle).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Space');
    await expect(create.whenToggle).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Enter');
    await create.dueDate.fill('Oct 30, 2030');
    await create.dueDate.blur();
    await create.dueTime.fill('17:00');
    await create.priority.selectOption({ label: 'High' });
    await create.whenToggle.focus();
    await page.keyboard.press('Space');
    await expect(create.whenSummary).toHaveText(
      'High priority, due Oct 30, 2030 at 5:00 PM, Unassigned',
    );
    // A new Create task page starts collapsed again.
    await create.open(`?taskType=${world.taskType.id}`);
    await expect(create.whenToggle).toHaveAttribute('aria-expanded', 'false');
  });

  test('keyboard only: a task is created without the mouse', async ({ page, seed }) => {
    const world = await seed.world({ stepCount: 2, fields: FIELDS });
    const create = new CreateTaskPage(page);
    await create.open(`?taskType=${world.taskType.id}`);
    await expect(create.title).toBeVisible();
    await create.matter.focus();
    await page.keyboard.type(world.matter.matterRef);
    await expect(
      page.getByRole('option', { name: new RegExp(`^${world.matter.matterRef}\\b`) }),
    ).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-chosen]').first()).toContainText(world.matter.matterRef);
    await create.title.focus();
    await page.keyboard.type('Keyboard only task');
    await create.requestorName.focus();
    await page.keyboard.type('Kay Board');
    await page.getByRole('textbox', { name: /^Alpha request/ }).focus();
    await page.keyboard.type('needed');
    await create.whenToggle.focus();
    await page.keyboard.press('Enter');
    await create.priority.focus();
    await page.keyboard.press('Tab'); // on to Due date
    await expect(create.dueDate).toBeFocused();
    await create.submit.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/tasks\/\d+$/);
  });

  test('a collapsed section opens by itself when it holds an error, and the fix creates the task', async ({
    page,
    seed,
  }) => {
    const world = await seed.world({ stepCount: 2, fields: FIELDS });
    const create = new CreateTaskPage(page);
    await create.open(`?taskType=${world.taskType.id}&matterId=${world.matter.matterId}`);
    await create.title.fill('Error opens the section');
    await create.requestorName.fill('Rita');
    await page.getByRole('textbox', { name: /^Alpha request/ }).fill('x');
    await create.openWhen();
    await create.dueDate.fill('next tuesday');
    await create.dueDate.blur();
    await create.whenToggle.click(); // collapse again with the bad text in it
    await expect(create.whenToggle).toHaveAttribute('aria-expanded', 'false');
    await create.submit.click();
    await expect(create.summary).toBeVisible();
    await expect(create.whenToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#ct-when-body [role=alert]')).toContainText(/valid date/i);
    await shot(page, 'opened-on-error-1366');
    await checkPage(page, 'opened on error');
    await create.dueDate.fill('Oct 30, 2030');
    await create.dueDate.blur();
    await create.submit.click();
    await expect(page).toHaveURL(/\/tasks\/\d+$/);
  });

  test('a type without request-form fields shows Input with the requestor and the workflow only', async ({
    page,
    seed,
  }) => {
    const world = await seed.world({ stepCount: 2 });
    const create = new CreateTaskPage(page);
    await create.open(`?taskType=${world.taskType.id}&matterId=${world.matter.matterId}`);
    await create.chooseTaskType(world.taskType.name);
    const input = page.locator('[data-section="input"]');
    await expect(input).toBeVisible();
    await expect(input.locator('[data-form-fields]')).toHaveCount(0);
    await expect(create.requestorName).toBeVisible();
    await expect(create.workflows).toBeVisible();
  });

  test('Create without Assign or Set priority: the section explains it and the summary says Unassigned', async ({
    seed,
    asUser,
  }) => {
    const role = await seed.role(
      ['Task.View', 'Task.Create', 'Matter.View', 'Client.View', 'Project.View', 'Pod.View'],
      'E2E create only',
    );
    const user = await seed.user([role.name], 'createonly');
    const world = await seed.world({ stepCount: 2 });
    const page = await asUser(user.username);
    const create = new CreateTaskPage(page);
    await create.open(`?taskType=${world.taskType.id}&matterId=${world.matter.matterId}`);
    await expect(create.whenSummary).toHaveText(
      /^Normal priority, no due date \(ASAP\), Unassigned$/,
    );
    await create.openWhen();
    await expect(page.locator('[data-no-assign]')).toBeVisible();
    await expect(create.priority).toHaveCount(0);
    await expect(create.assignee).toHaveCount(0);
    await checkPage(page, 'create without assign');
    await create.title.fill('Created without assign');
    await create.requestorName.fill('Rita');
    await create.create();
  });
});
