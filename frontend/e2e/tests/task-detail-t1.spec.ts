import fs from 'node:fs';
import path from 'node:path';
import { Page, Route } from '@playwright/test';
import { TaskDetailPage } from '../pages/task-detail.page';
import { CreateTaskPage } from '../pages/create-task.page';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Json } from '../support/api';
import { uid } from '../support/seed';

/**
 * Task Detail T1 "Bugs and states" (#289 to #295): no Asset request and no toast for a person without Asset.View (BUG-1), the shared 404 /
 * 403 / failure states and their document titles (S2, #290), the 403 link (BUG-4, #291), the page skeleton (S1, #292), calendar dates in the
 * Activity drawer (BUG-5, #293), one message for a failed Activity load (BUG-8, #294) and the document title (X3, #295).
 * Every test seeds its own records. Screenshots go to E2E_SCREENSHOTS when it is set (docs/ux/task-detail-review/fixes/t1).
 */
const OUT = process.env['E2E_SCREENSHOTS'];

const SIZES = [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
] as const;

async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  const size = page.viewportSize()!;
  await page.screenshot({ path: path.join(OUT, `${name}-${size.width}x${size.height}.png`) });
}

async function noHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'page-level horizontal scroll').toBeLessThanOrEqual(0);
}

/** The page at every size: axe finds nothing, the page does not scroll sideways, and a screenshot is kept. */
async function atEverySize(page: Page, name: string, settle?: () => Promise<void>): Promise<void> {
  for (const size of SIZES) {
    await page.setViewportSize(size);
    if (settle) await settle();
    if (axeAvailable()) expect(await axeViolations(page), `${name} at ${size.width}`).toEqual([]);
    await noHorizontalScroll(page);
    await shot(page, name);
  }
}

/** No toast, now and after the hold-back time the error handler uses. */
async function expectNoToast(page: Page): Promise<void> {
  await page.waitForTimeout(700);
  await expect(page.locator('[data-toast]')).toHaveCount(0);
}

/** The requests to the Asset API itself (`/api/v1/assets`, `/api/v1/assets/9`, `/api/v1/assets/lookup`), not a task's `/tasks/1/assets`. */
function trackAssetRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (r) => {
    if (/\/api\/v1\/assets(\/|\?|$)/.test(new URL(r.url()).pathname + new URL(r.url()).search))
      seen.push(`${r.method()} ${r.url()}`);
  });
  return seen;
}

const ASSET_FIELDS = [
  { key: 'related_asset', label: 'Related asset', control: 'ASSET_REF' },
  { key: 'second_asset', label: 'Second asset', control: 'ASSET_REF' },
];

const LONG_TITLE = 'Quarterly filing review for the Hartwell custodians and their mailboxes '
  .repeat(4)
  .slice(0, 200)
  .trim();

test.describe('Task detail T1: Asset references without Asset.View (BUG-1, #289)', () => {
  async function assetTask(seed: import('../support/seed').Seeder): Promise<{
    task: Json;
    first: Json;
    second: Json;
    world: Json;
  }> {
    const world = await seed.world({ fields: ASSET_FIELDS });
    const first = await seed.asset(world.matter, `Contract bundle ${uid()}`);
    const second = await seed.asset(world.matter, `Mailbox archive ${uid()}`);
    const task = await seed.task(world, {
      formValues: { related_asset: first.assetId, second_asset: second.assetId },
    });
    return { task, first, second, world };
  }

  test('Task.View only: no request to the Asset API, no toast, each reference reads "not available"', async ({
    seed,
    asUser,
  }) => {
    const { task, first, second } = await assetTask(seed);
    const role = await seed.role(['Task.View', 'Matter.View', 'Client.View'], 'E2E view only');
    const user = await seed.user([role.name], 'viewonly');
    const page = await asUser(user.username);
    const assetRequests = trackAssetRequests(page);
    await page.setViewportSize({ width: 1366, height: 768 });

    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    const form = page.locator('[data-request-form]');
    await expect(form).toContainText(`Asset ${first.assetId} (not available)`);
    await expect(form).toContainText(`Asset ${second.assetId} (not available)`);
    await expectNoToast(page);
    expect(assetRequests, 'requests to /api/v1/assets').toEqual([]);

    await atEverySize(page, 'asset-ref-view-only');
    expect(assetRequests, 'requests to /api/v1/assets').toEqual([]);
  });

  test('System Admin still sees the asset names as links; several references behave the same', async ({
    seed,
    page,
  }) => {
    const { task, first, second } = await assetTask(seed);
    await page.setViewportSize({ width: 1366, height: 768 });
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    const form = page.locator('[data-request-form]');
    await expect(form.getByRole('link', { name: first.displayName })).toHaveAttribute(
      'href',
      `/assets?selected=${first.assetId}`,
    );
    await expect(form.getByRole('link', { name: second.displayName })).toBeVisible();
    await expectNoToast(page);
    await atEverySize(page, 'asset-ref-admin');
  });

  test('an assignee with Asset.View (Data Technician) sees the names and no toast', async ({
    seed,
    asUser,
  }) => {
    const { task, first } = await assetTask(seed);
    const role = await seed.role(
      ['Task.View', 'Task.Edit', 'Workflow.Execute', 'Asset.View', 'Matter.View', 'Client.View'],
      'E2E technician',
    );
    const user = await seed.user([role.name], 'tech');
    const page = await asUser(user.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await expect(page.locator('[data-request-form]')).toContainText(first.displayName);
    await expectNoToast(page);
  });

  test('a lookup that still fails (asset removed or no matter rights) is quiet and reads "not available"', async ({
    seed,
    page,
  }) => {
    const { task, first } = await assetTask(seed);
    await page.route(`**/api/v1/assets/${first.assetId}`, (route: Route) =>
      route.fulfill({
        status: 403,
        contentType: 'application/problem+json',
        body: JSON.stringify({ status: 403, code: 'PERMISSION_DENIED' }),
      }),
    );
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await expect(page.locator('[data-request-form]')).toContainText(
      `Asset ${first.assetId} (not available)`,
    );
    await expectNoToast(page);
  });

  test('Create task: the Asset field of a person without Asset.View asks the Asset API for nothing and shows no toast', async ({
    seed,
    asUser,
  }) => {
    const world = await seed.world({ fields: ASSET_FIELDS });
    const role = await seed.role(
      ['Task.View', 'Task.Create', 'Matter.View', 'Client.View'],
      'E2E creator',
    );
    const user = await seed.user([role.name], 'creator');
    const page = await asUser(user.username);
    const assetRequests = trackAssetRequests(page);
    await page.setViewportSize({ width: 1366, height: 900 });

    const create = new CreateTaskPage(page);
    await create.open();
    await create.chooseTaskType(world.taskType.name);
    await create.pickMatter(world.matter.matterRef, world.matter.matterRef);
    const field = create.field('related_asset');
    await expect(field).toBeVisible();
    await field.getByRole('combobox').focus();
    await field.getByRole('combobox').fill('con');
    await expectNoToast(page);
    expect(assetRequests, 'requests to /api/v1/assets').toEqual([]);
    await atEverySize(page, 'create-asset-field-no-asset-view');
  });
});

test.describe('Task detail T1: load states (S2 #290, BUG-4 #291)', () => {
  const NOT_FOUND = "We couldn't find that task.";

  test('an unknown number and a bad address say "not found", in the tab title too, with a way back and no Retry', async ({
    page,
  }) => {
    for (const id of ['99999999', 'abc']) {
      await page.goto(`/tasks/${id}`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(NOT_FOUND);
      await expect(page).toHaveTitle('Task not found - MatterFlow');
      await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0);
      await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible();
      await expect(page.locator('[data-toast]')).toHaveCount(0);
    }
    await page.goto('/tasks/99999999');
    await expect(page.getByRole('link', { name: 'Go to Task Queue' })).toHaveAttribute(
      'href',
      '/tasks',
    );
    await atEverySize(page, 'state-404');
    await page.getByRole('link', { name: 'Go to Task Queue' }).click();
    await expect(page).toHaveURL(/\/tasks$/);
  });

  test('a 403 answer says access, in the tab title too, without Retry and with a link the person can open', async ({
    page,
    seed,
  }) => {
    const task = await seed.task(await seed.world());
    await page.route(`**/api/v1/tasks/${task.taskId}`, (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 403,
            contentType: 'application/problem+json',
            body: JSON.stringify({ status: 403, code: 'PERMISSION_DENIED' }),
          })
        : route.continue(),
    );
    await page.goto(`/tasks/${task.taskId}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      "You don't have access to this task.",
    );
    await expect(page).toHaveTitle('No access to this task - MatterFlow');
    await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Go to Task Queue' })).toBeVisible();
    await expect(page.locator('[data-toast]')).toHaveCount(0);
    await atEverySize(page, 'state-403');
  });

  test('a server fault shows the reference and Retry; Retry keeps focus while it fails and recovers the page', async ({
    page,
    seed,
  }) => {
    const task = await seed.task(await seed.world());
    const reference = `ref-${uid()}`;
    let failing = true;
    await page.route(`**/api/v1/tasks/${task.taskId}`, (route) =>
      failing && route.request().method() === 'GET'
        ? route.fulfill({
            status: 500,
            contentType: 'application/problem+json',
            body: JSON.stringify({ status: 500, code: 'INTERNAL_ERROR', traceId: reference }),
          })
        : route.continue(),
    );
    await page.goto(`/tasks/${task.taskId}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText("Couldn't load this task.");
    await expect(page.locator('[data-error-reference]')).toContainText(reference);
    await expect(page).toHaveTitle('Task could not be loaded - MatterFlow');
    await expect(page.locator('[data-toast]')).toHaveCount(0);
    await atEverySize(page, 'state-500');

    await page.setViewportSize({ width: 1366, height: 768 });
    const retry = page.getByRole('button', { name: 'Retry' });
    await retry.focus();
    await retry.click();
    await expect(retry).toBeFocused();

    failing = false;
    await retry.click();
    await expect(page.locator('[data-task-header] [data-ref]')).toHaveText(task.taskNumber);
    await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0);
    await expect(page.locator('[data-page-title]')).toBeFocused();
    await expect(page.locator('[data-record-live]')).toHaveText('Loaded');
  });

  test('a person without Task.View is not offered "my work" but a page they can open', async ({
    seed,
    asUser,
  }) => {
    const task = await seed.task(await seed.world());
    const role = await seed.role(['Client.View', 'Matter.View'], 'E2E no task');
    const user = await seed.user([role.name], 'notask');
    const page = await asUser(user.username);
    await page.goto(`/tasks/${task.taskId}`);
    await expect(
      page.getByRole('heading', { name: "You don't have permission to view this." }),
    ).toBeVisible();
    await expect(page.getByText(/my work/i)).toHaveCount(0);
    const link = page.getByRole('link', { name: 'Go to Clients' });
    await expect(link).toHaveAttribute('href', '/clients');
    await atEverySize(page, 'state-403-no-task-view');
    await link.click();
    await expect(page).toHaveURL(/\/clients/);
  });

  test('a person whose role opens no page at all gets text and no link', async ({
    seed,
    asUser,
  }) => {
    const task = await seed.task(await seed.world());
    const role = await seed.role(['Task.Comment'], 'E2E nothing');
    const user = await seed.user([role.name], 'nothing');
    const page = await asUser(user.username);
    await page.goto(`/tasks/${task.taskId}`);
    await expect(
      page.getByRole('heading', { name: "You don't have permission to view this." }),
    ).toBeVisible();
    await expect(page.locator('main a, [data-back-link]')).toHaveCount(0);
  });
});

test.describe('Task detail T1: page skeleton (S1, #292)', () => {
  test('shows the page as it will look while the task loads, then replaces it without a jump (CLS under 0.02)', async ({
    page,
    seed,
  }) => {
    const task = await seed.task(await seed.world(), { title: LONG_TITLE });
    await page.addInitScript(() => {
      const w = window as unknown as { __cls: number };
      w.__cls = 0;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as unknown as {
          value: number;
          hadRecentInput: boolean;
        }[]) {
          if (!e.hadRecentInput) w.__cls += e.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
    });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    await page.route(`**/api/v1/tasks/${task.taskId}`, async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      await gate;
      return route.continue();
    });

    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto(`/tasks/${task.taskId}?from=task-queue`, { waitUntil: 'commit' });
      const skeleton = page.locator('[data-record-skeleton][data-kind=task]');
      await expect(skeleton).toBeVisible();
      await expect(page.getByRole('status').filter({ hasText: 'Loading task' })).toHaveCount(1);
      await expect(page.locator('[data-loading]', { hasText: 'Loading the task' })).toHaveCount(0);
      if (axeAvailable())
        expect(await axeViolations(page), `skeleton at ${size.width}`).toEqual([]);
      await noHorizontalScroll(page);
      await shot(page, 'state-loading');
    }

    // Release the answer: the skeleton goes, the page arrives, and nothing visible moved.
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/tasks/${task.taskId}?from=task-queue`, { waitUntil: 'commit' });
    await expect(page.locator('[data-record-skeleton]')).toBeVisible();
    release();
    await expect(page.locator('[data-task-header] [data-ref]')).toHaveText(task.taskNumber);
    await expect(page.locator('[data-record-skeleton]')).toHaveCount(0);
    await page.waitForTimeout(500);
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    expect(cls, 'cumulative layout shift').toBeLessThan(0.02);
  });

  test('honours prefers-reduced-motion: the bars do not pulse', async ({ page, seed }) => {
    const task = await seed.task(await seed.world());
    await page.emulateMedia({ reducedMotion: 'reduce' });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    await page.route(`**/api/v1/tasks/${task.taskId}`, async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      await gate;
      return route.continue();
    });
    await page.goto(`/tasks/${task.taskId}`, { waitUntil: 'commit' });
    const bar = page.locator('[data-record-skeleton] .rk__bar').first();
    await expect(bar).toBeVisible();
    expect(await bar.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
    release();
    await expect(page.locator('[data-task-header] [data-ref]')).toBeVisible();
  });
});

test.describe('Task detail T1: Activity drawer (BUG-5 #293, BUG-8 #294) and document title (X3 #295)', () => {
  test('a due date change reads "Oct 15, 2026 to Oct 14, 2026" in the sentence and in View changes', async ({
    seed,
    admin,
    page,
  }) => {
    const world = await seed.world();
    const task = await seed.task(world, { dueDate: '2026-10-15' });
    await admin.put(`/api/v1/tasks/${task.taskId}`, {
      rowVersion: task.rowVersion,
      title: task.title,
      requestorName: task.requestorName ?? 'Rita Requestor',
      dueDate: '2026-10-14',
    });
    await page.setViewportSize({ width: 1366, height: 768 });
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    const drawer = await detail.openActivity();
    const summary = drawer.locator('[data-summary]', { hasText: 'Due date changed' });
    await expect(summary).toHaveText('Due date changed from Oct 15, 2026 to Oct 14, 2026');
    await expect(drawer).not.toContainText('2026-10-1');
    await drawer.locator('[data-changes-toggle]').first().click();
    await expect(drawer.locator('[data-changes]').first()).toContainText('Oct 15, 2026');
    await atEverySize(page, 'activity-dates', async () => {
      await expect(drawer).toBeVisible();
    });
  });

  test('a failed Activity load shows one message with Retry and no toast; Retry recovers', async ({
    seed,
    page,
  }) => {
    const task = await seed.task(await seed.world());
    let offline = true;
    await page.route(`**/api/v1/tasks/${task.taskId}/activity**`, (route) =>
      offline ? route.abort('connectionreset') : route.continue(),
    );
    await page.setViewportSize({ width: 1366, height: 768 });
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    const drawer = await detail.openActivity();
    await expect(drawer.locator('[data-load-error]')).toHaveCount(1);
    await expect(drawer.locator('[data-load-error]')).toContainText(
      'Something went wrong. Try again.',
    );
    await expectNoToast(page);
    await expect(page.getByText('Something went wrong. Try again.')).toHaveCount(1);
    await atEverySize(page, 'state-offline-activity', async () => {
      await expect(drawer).toBeVisible();
    });

    offline = false;
    await drawer.getByRole('button', { name: 'Retry' }).click();
    await expect(drawer.locator('[data-load-error]')).toHaveCount(0);
    await expect(drawer.locator('[data-event-id]').first()).toBeVisible();
  });

  test('the tab title is TSK-n and the title cut at 60 characters; the open Activity drawer names itself', async ({
    seed,
    page,
  }) => {
    const task = await seed.task(await seed.world(), { title: LONG_TITLE });
    const cut = `${task.taskNumber} ${LONG_TITLE.slice(0, 60).trimEnd()}…`;
    await page.setViewportSize({ width: 1366, height: 768 });
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await expect(page).toHaveTitle(`${cut} - MatterFlow`);
    expect((await page.title()).length).toBeLessThanOrEqual(
      60 + task.taskNumber.length + 1 + ' - MatterFlow'.length + 1,
    );

    const drawer = await detail.openActivity();
    await expect(page).toHaveTitle(`Activity - ${cut} - MatterFlow`);
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(page).toHaveTitle(`${cut} - MatterFlow`);

    // The old link that opens the drawer: closing it removes ?tab=activity, and the title stays right.
    await page.goto(`/tasks/${task.taskId}?tab=activity`);
    await expect(page).toHaveTitle(`Activity - ${cut} - MatterFlow`);
    await page.keyboard.press('Escape');
    await expect(page).toHaveTitle(`${cut} - MatterFlow`);
  });

  test('a short title is not cut', async ({ seed, page }) => {
    const task = await seed.task(await seed.world(), { title: 'Load Jones mailbox' });
    await page.goto(`/tasks/${task.taskId}`);
    await expect(page).toHaveTitle(`${task.taskNumber} Load Jones mailbox - MatterFlow`);
  });
});
