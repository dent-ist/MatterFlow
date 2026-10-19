import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

/**
 * WP-TY3 Task Types list columns: 44 px rows with a Default workflow column, a number of Workflows and a neutral Not usable badge (#371),
 * and the Open tasks column that links to the Task Queue filtered to the type (#373). Screenshots go to E2E_SCREENSHOTS
 * (docs/ux/task-types-review/fixes/ty3-lists).
 */
const OUT = process.env['E2E_SCREENSHOTS'];
const SIZES = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
  { width: 768, height: 1024 },
  { width: 375, height: 812 },
] as const;

async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  const size = page.viewportSize()!;
  await page.screenshot({ path: path.join(OUT, `${name}-${size.width}x${size.height}.png`) });
}

const heads = (page: Page) =>
  page
    .locator('thead tr:first-child th')
    .allInnerTexts()
    .then((t) => t.map((x) => x.replace(/\s+/g, ' ').trim()));

test.describe('Task Types rows and columns (#371)', () => {
  test('rows are exactly 44 px at 1366 and 1920: a default workflow, a number of workflows and a neutral Not usable badge, no red box', async ({
    page,
    seed,
    admin,
  }) => {
    const token = uid();
    const flows = [];
    for (let i = 0; i < 4; i++) {
      flows.push(
        await seed.workflow({
          name: `${token} Cross-border collection, processing and production workflow number ${i}`,
          stepCount: 1,
        }),
      );
    }
    await seed.taskType({
      name: `${token} Cross-border collection, processing, hosting and production for regulators`,
      workflows: flows,
      fields: [{ key: 'note', label: 'Note', control: 'TEXT' }],
    });
    await seed.taskType({ name: `${token} Plain`, workflows: [flows[0]] });
    const bare = await admin.post('/api/v1/task-types', {
      name: `${token} Bare`,
      description: null,
      isActive: true,
      eligibleWorkflowIds: [],
      defaultWorkflowDefinitionId: null,
    });
    expect(bare.id).toBeGreaterThan(0);

    for (const size of [SIZES[0], SIZES[1]]) {
      await page.setViewportSize(size);
      await page.goto(`/admin/task-types?name=${token}`);
      const rows = page.locator('tbody tr[data-row]');
      await expect(rows).toHaveCount(3);
      for (const row of await rows.all()) {
        const box = (await row.boundingBox())!;
        expect(
          box.height,
          `${await row.getAttribute('data-row')} at ${size.width}`,
        ).toBeGreaterThanOrEqual(43);
        expect(box.height).toBeLessThanOrEqual(45);
      }
      // No red box, no chips: the reason is a neutral badge in Status with the text as its description.
      await expect(page.locator('.chip')).toHaveCount(0);
      await expect(page.locator('[data-assoc-chip]')).toHaveCount(0);
      const badge = page.locator(`[data-row="${token} Bare"] [data-not-usable]`);
      await expect(badge).toContainText('Not usable');
      await expect(badge.locator('.pi')).toHaveCount(1);
      const describedBy = await badge.locator('.badge').getAttribute('aria-describedby');
      await expect(page.locator(`#${describedBy}`)).toContainText("users can't create tasks");
      await expect(page.locator(`[data-row="${token} Bare"] [data-default-workflow]`)).toHaveText(
        'No workflow',
      );
      await shot(page, 'p371-task-types');
      if (axeAvailable()) expect(await axeViolations(page), `rows at ${size.width}`).toEqual([]);
    }
    // The long name is clamped to two lines, the full text is the tooltip.
    const long = page.locator('tbody tr[data-row]').first().locator('a.tt-link');
    await expect(long).toHaveAttribute('title', /.+/);
  });

  test('the columns drop in a fixed order: Open tasks below 1280, Workflows below 1100, Request form below 900', async ({
    page,
  }) => {
    const all = [
      'Name',
      'Default workflow',
      'Request form',
      'Workflows',
      'Open tasks',
      'Status',
      'Actions',
    ];
    const expected: [number, string[]][] = [
      [1920, all],
      [1366, all],
      [1280, all],
      [1100, all.filter((h) => h !== 'Open tasks')],
      [1000, all.filter((h) => h !== 'Open tasks' && h !== 'Workflows')],
      [900, all.filter((h) => h !== 'Open tasks' && h !== 'Workflows')],
      [768, ['Name', 'Default workflow', 'Status', 'Actions']],
      [640, ['Name', 'Default workflow', 'Status', 'Actions']],
    ];
    for (const [width, names] of expected) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/admin/task-types');
      await expect(page.locator('tbody tr[data-row]').first()).toBeVisible();
      expect(await heads(page), `at ${width}`).toEqual(names);
    }
  });

  test('Workflows is a number that opens the Workflows tab filtered to the type (plain 0 without one); permissions: without Workflow.Manage it is plain text', async ({
    page,
    seed,
    asUser,
  }) => {
    const token = uid();
    const w1 = await seed.workflow({ name: `${token} A`, stepCount: 1 });
    const w2 = await seed.workflow({ name: `${token} B`, stepCount: 1 });
    const type = await seed.taskType({ name: `${token} Many`, workflows: [w1, w2] });
    await page.setViewportSize(SIZES[0]);
    await page.goto(`/admin/task-types?name=${token}`);
    const link = page.locator(`[data-row="${token} Many"] [data-workflows-link]`);
    await expect(link).toHaveText('2');
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/admin/workflows\\?taskType=${type.id}$`));
    await expect(page.locator('tbody tr[data-row]')).toHaveCount(2);

    const role = await seed.role(['TaskType.Manage', 'Task.View'], 'Type only');
    const tt = await asUser((await seed.user([role.name], 'ty3t-tt')).username);
    await tt.setViewportSize(SIZES[0]);
    await tt.goto(`/admin/task-types?name=${token}`);
    await expect(tt.locator(`[data-row="${token} Many"] [data-workflows]`)).toHaveText('2');
    await expect(tt.locator('[data-workflows-link]')).toHaveCount(0);
  });
});

test.describe('Open tasks (#373)', () => {
  test('the number equals the API, the link opens the Task Queue filtered to the type, the header sorts busiest first', async ({
    page,
    seed,
    admin,
  }) => {
    const token = uid();
    const busy = await seed.world();
    const quiet = await seed.world();
    // Rename the two task types so a name filter finds them together.
    for (const [w, n] of [
      [busy, 'Busy'],
      [quiet, 'Quiet'],
    ] as const) {
      const current = await admin.get(`/api/v1/task-types/${w.taskType.id}`);
      await admin.put(`/api/v1/task-types/${w.taskType.id}`, {
        name: `${token} ${n}`,
        description: null,
        iconKey: current.iconKey,
        isActive: true,
        eligibleWorkflowIds: current.eligibleWorkflowIds,
        defaultWorkflowDefinitionId: current.defaultWorkflowDefinitionId,
        rowVersion: current.rowVersion,
      });
    }
    for (let i = 0; i < 3; i++) await seed.task(busy);
    await seed.task(quiet);
    const apiBusy = (await admin.get(`/api/v1/task-types/${busy.taskType.id}`)).openTaskCount;
    expect(apiBusy).toBe(3);

    await page.setViewportSize(SIZES[0]);
    await page.goto(`/admin/task-types?name=${token}`);
    const cell = (name: string) => page.locator(`[data-row="${token} ${name}"] [data-open-tasks]`);
    await expect(cell('Busy')).toHaveText('3');
    await expect(cell('Quiet')).toHaveText('1');
    await shot(page, 'p373-open-tasks');

    // Sorted by Open tasks: the first click is busiest first, and aria-sort says so.
    const header = page.getByRole('columnheader', { name: 'Open tasks' });
    await header.getByRole('button').click();
    await expect(page).toHaveURL(/sort=-openTasks/);
    await expect(header).toHaveAttribute('aria-sort', 'descending');
    await expect(page.locator('tbody tr[data-row]').first()).toHaveAttribute(
      'data-row',
      `${token} Busy`,
    );
    await header.getByRole('button').click();
    await expect(page).toHaveURL(/sort=openTasks/);
    await expect(page.locator('tbody tr[data-row]').first()).toHaveAttribute(
      'data-row',
      `${token} Quiet`,
    );

    // The link opens the Task Queue with the type filter: the address carries `type=<id>` and the open statuses.
    await cell('Busy').getByRole('link').click();
    await expect(page).toHaveURL(new RegExp(`/tasks\\?.*type=${busy.taskType.id}`));
    await expect(page.getByRole('list', { name: 'Active filters' })).toContainText(`${token} Busy`);
    await expect(page.locator('tbody tr').first()).toBeVisible();
    // The queue lists exactly the three open tasks of the type.
    const queue = await admin.get<{ total: number }>(
      `/api/v1/task-queue?type=${busy.taskType.id}&status=NEW&status=IN_PROGRESS&status=ON_HOLD&pageSize=25`,
    );
    expect(queue.total).toBe(apiBusy);
  });

  test('on a phone the card has an "n open" line that links to the Task Queue', async ({
    page,
    seed,
  }) => {
    const token = uid();
    const w = await seed.world();
    const current = await seed.admin.get(`/api/v1/task-types/${w.taskType.id}`);
    await seed.admin.put(`/api/v1/task-types/${w.taskType.id}`, {
      name: `${token} Counted`,
      description: null,
      iconKey: current.iconKey,
      isActive: true,
      eligibleWorkflowIds: current.eligibleWorkflowIds,
      defaultWorkflowDefinitionId: current.defaultWorkflowDefinitionId,
      rowVersion: current.rowVersion,
    });
    await seed.task(w);
    await seed.task(w);

    await page.setViewportSize(SIZES[3]);
    await page.goto(`/admin/task-types?name=${token}`);
    const card = page.locator('li[data-record-card]').filter({ hasText: `${token} Counted` });
    await expect(card.locator('[data-count="open"]')).toContainText('2 open');
    await expect(card.locator('[data-count="open"] a')).toHaveAttribute(
      'href',
      /\/tasks\?.*type=\d+/,
    );
    if (axeAvailable()) expect(await axeViolations(page), 'card with count').toEqual([]);
    await shot(page, 'p373-card');
  });
});
