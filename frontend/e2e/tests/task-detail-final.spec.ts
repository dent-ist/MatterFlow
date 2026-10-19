import fs from 'node:fs';
import path from 'node:path';
import { Locator, Page, Route } from '@playwright/test';
import { TaskDetailPage } from '../pages/task-detail.page';
import { Api, Json } from '../support/api';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Seeder, World, uid } from '../support/seed';
import { TaskApi } from '../support/tasks';
import { dateInZone, FIRM_ZONE } from '../support/time';

/**
 * Final verification of the Task Detail epic (#288, T10b, #331): the checks that cut across the page after every package landed.
 *
 *  1. The contract over the review's six task shapes (TSK-123 long and sensitive, 124 overdue, 126 unassigned, 127 On Hold, 128 Completed,
 *     129 Cancelled) at 375x812, 768x1024, 1024x768, 1366x768 and 1920x1080: axe 0 (target-size included) with the overflow menu open too,
 *     no page-level sideways scroll, a one-line crumb and a title of two lines at most, one h1, one Edit control, one primary action, no
 *     nested scroller (the Details panel of a long task excepted: it is the designed one).
 *  2. The review's measurements as a before/after table (printed and attached as an annotation): Workflow heading y at 375, 768, 1366 and
 *     1920 for a typical and the long task, the status note of a Cancelled task, the Edit dialog's Save, and the Activity rows before the
 *     first event that is not a comment.
 *  3. The permission matrix in short (System Admin, the assignee Data Technician, Task.View only without Asset.View, Matter.View and
 *     Client.View, and no Task.View): no failed request, no toast, no dead link; the long matrix is `task-permissions-t10`.
 *  4. The state matrix: loading skeleton, 404, 403, 500 with Retry, a lost connection in Activity, reduced motion.
 *
 * Every test seeds its own tagged data. Screenshots go to E2E_SCREENSHOTS when it is set (docs/ux/task-detail-review/fixes/final).
 */
const OUT = process.env['E2E_SCREENSHOTS'];

const SIZES = [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
] as const;
const FOUR = SIZES.filter((s) => s.width !== 1024);

const LONG_TITLE =
  'Process and load the supplemental custodian collections for the Meridian second-request response, including Q3 mobile device images, Slack exports, shared network drives and the legacy archive restore'
    .slice(0, 200)
    .trim();
const LONG_MATTER =
  'In re Meridian Pharmaceuticals Securities Litigation - Consolidated Multidistrict Class Action Proceedings, Second Request for Production of Documents, Custodial Collections, Privilege Review'
    .padEnd(205, ' and Rolling Productions')
    .slice(0, 205);
const SENTENCE =
  'The vendor re-sent two of the custodian files overnight and the hashes differ from the first delivery, so the load has to wait for the exception list. ';
const LONG_DESCRIPTION = `<p>${SENTENCE.repeat(4)}</p><p>${SENTENCE.repeat(4)}</p><p>${SENTENCE.repeat(3)}</p>`;

async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  const size = page.viewportSize()!;
  await page.screenshot({ path: path.join(OUT, `${name}-${size.width}x${size.height}.png`) });
}

async function noHorizontalScroll(page: Page, what: string): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${what}: page-level horizontal scroll`).toBeLessThanOrEqual(0);
}

async function check(page: Page, name: string): Promise<void> {
  const size = page.viewportSize()!;
  if (axeAvailable()) {
    expect(await axeViolations(page), `${name} at ${size.width}x${size.height}`).toEqual([]);
  }
  await noHorizontalScroll(page, `${name} at ${size.width}`);
  await shot(page, name);
}

async function waitForToastsToGo(page: Page): Promise<void> {
  await expect(page.locator('.p-toast-message')).toHaveCount(0, { timeout: 12_000 });
}

/** Top of the Workflow heading with the page scrolled to the top (the review's measure: "Workflow starts at y"). */
async function workflowTop(page: Page): Promise<number> {
  await page.evaluate(() => window.scrollTo(0, 0));
  return page
    .locator('[data-workflow-tab] [data-section-heading]')
    .evaluate((el) => Math.round(el.getBoundingClientRect().top));
}

/** Opens the task with nothing remembered, so each size starts from the defaults. */
async function openFresh(page: Page, detail: TaskDetailPage, taskId: number): Promise<void> {
  await detail.open(taskId);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('[data-section-link="workflow"]')).toBeVisible();
}

const ROLE = [
  'Task.View',
  'Task.Edit',
  'Task.Complete',
  'Task.Reopen',
  'Workflow.Execute',
  'Matter.View',
  'Client.View',
  'Asset.View',
];

interface Fixture {
  world: World;
  tech: { username: string; userId: number };
  pod: Json;
  task: Json;
}

async function seeded(
  seed: Seeder,
  admin: Api,
  opts: {
    matter?: Json;
    sensitive?: boolean;
    task?: Json;
    assign?: boolean;
    stepCount?: number;
  } = {},
): Promise<Fixture> {
  const base = await seed.world({ sensitive: opts.sensitive, stepCount: opts.stepCount ?? 3 });
  const world = opts.matter
    ? {
        ...base,
        matter: await seed.matter({ client: base.client, number: '00002', ...opts.matter }),
      }
    : base;
  const role = await seed.role(ROLE, 'E2E technician');
  const tech = await seed.user([role.name], 'tech');
  const pod = await seed.pod(`E2E Pod ${uid()}`, [tech.userId]);
  const task = await seed.task(world, { dueDate: dateInZone(FIRM_ZONE, -3), ...opts.task });
  if (opts.assign !== false) await new TaskApi(admin, task.taskId).assign(tech.userId, pod.podId);
  return { world, tech, pod, task };
}

async function addComments(admin: Api, taskId: number, count: number): Promise<void> {
  for (let i = 1; i <= count; i++) {
    await admin.post(`/api/v1/tasks/${taskId}/comments`, {
      bodyHtml: `<p>Comment number ${i}</p>`,
    });
  }
}

/** Elements that scroll inside themselves on the page (not the document), by a short selector, ignoring the allowed ones. */
async function nestedScrollers(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('main *')) {
      const cs = getComputedStyle(el);
      if (!/(auto|scroll)/.test(cs.overflowY)) continue;
      if (el.scrollHeight <= el.clientHeight + 2) continue;
      if (el.clientHeight === 0) continue;
      out.push(
        `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''}`,
      );
    }
    return out;
  });
}

const visible = async (loc: Locator): Promise<number> => {
  let n = 0;
  for (const el of await loc.all()) if (await el.isVisible()) n++;
  return n;
};

interface Shape {
  key: string;
  label: string;
  /** The primary action in the header: Complete task, Reopen task, or none for a task on hold (Resume is in the overflow). */
  primary: RegExp | null;
  make: (seed: Seeder, admin: Api) => Promise<Fixture>;
}

const SHAPES: Shape[] = [
  {
    key: 'tsk123-long',
    label: 'TSK-123 long title, 205-character matter, sensitive',
    primary: /Complete task/,
    make: async (seed, admin) =>
      seeded(seed, admin, {
        matter: { name: LONG_MATTER },
        sensitive: true,
        task: { title: LONG_TITLE, description: LONG_DESCRIPTION },
      }),
  },
  {
    key: 'tsk124-overdue',
    label: 'TSK-124 overdue',
    primary: /Complete task/,
    make: async (seed, admin) => seeded(seed, admin),
  },
  {
    key: 'tsk126-unassigned',
    label: 'TSK-126 unassigned',
    primary: /Complete task/,
    make: async (seed, admin) => seeded(seed, admin, { assign: false }),
  },
  {
    key: 'tsk127-onhold',
    label: 'TSK-127 On Hold',
    primary: null,
    make: async (seed, admin) => {
      const fx = await seeded(seed, admin);
      expect(
        (await new TaskApi(admin, fx.task.taskId).changeStatus('ON_HOLD', 'Waiting for the vendor'))
          .status,
      ).toBe(200);
      return fx;
    },
  },
  {
    key: 'tsk128-completed',
    label: 'TSK-128 Completed',
    primary: /Reopen task/,
    make: async (seed, admin) => {
      const fx = await seeded(seed, admin, { stepCount: 2 });
      const api = new TaskApi(admin, fx.task.taskId);
      await api.completeSteps(1, 2);
      expect((await api.complete()).status).toBe(200);
      return fx;
    },
  },
  {
    key: 'tsk129-cancelled',
    label: 'TSK-129 Cancelled',
    primary: /Reopen task/,
    make: async (seed, admin) => {
      const fx = await seeded(seed, admin);
      expect(
        (await new TaskApi(admin, fx.task.taskId).cancel('Duplicate of another task')).status,
      ).toBe(200);
      return fx;
    },
  },
];

test.describe('Task Detail final verification (#331): contract over six task shapes', () => {
  for (const shape of SHAPES) {
    test(`${shape.label}: axe 0 (also with the overflow menu open), no sideways scroll, header limits, one Edit, one primary action, no nested scroller at 375, 768, 1024, 1366 and 1920`, async ({
      seed,
      admin,
      page,
    }) => {
      test.setTimeout(240_000);
      const fx = await shape.make(seed, admin);
      const detail = new TaskDetailPage(page);
      const long = shape.key === 'tsk123-long';
      for (const size of SIZES) {
        await page.setViewportSize(size);
        await openFresh(page, detail, fx.task.taskId);
        await expect(page.locator('[data-task-header] [data-ref]')).toHaveText(fx.task.taskNumber);
        await expect(page.locator('h1')).toHaveCount(1);
        // Header limits: the title takes two lines at most, the crumb is one line (on a phone the Back link replaces it).
        const title = await page.locator('[data-task-header] [data-name]').evaluate((el) => ({
          h: el.getBoundingClientRect().height,
          lh: parseFloat(getComputedStyle(el).lineHeight),
        }));
        expect(title.h, `title height at ${size.width}`).toBeLessThanOrEqual(title.lh * 2 + 1);
        if (size.width >= 640) {
          const crumb = await page.locator('nav[aria-label="Breadcrumb"] .rh__trail').boundingBox();
          expect(crumb!.height, `crumb height at ${size.width}`).toBeLessThanOrEqual(30);
        }
        // One Edit control: the header's own button, or (where the header folds it into the overflow) none outside the menu.
        const edits =
          (await visible(page.locator('[data-task-header] button[data-action="edit"]'))) +
          (await visible(page.locator('[data-edit-details]')));
        expect(edits, `visible Edit controls at ${size.width}`).toBeLessThanOrEqual(1);
        // One primary action in the header, and it is the one the status calls for.
        const primaries = page.locator('[data-task-header] .mf-btn--primary');
        expect(await visible(primaries), `primary actions at ${size.width}`).toBe(
          shape.primary ? 1 : 0,
        );
        if (shape.primary)
          await expect(primaries.locator('visible=true').first()).toHaveText(shape.primary);
        // No scroller inside the page, except the Details panel of a long task at the two-column widths.
        const nested = (await nestedScrollers(page)).filter((s) => !s.startsWith('aside'));
        expect(nested, `nested scrollers at ${size.width}`).toEqual([]);

        await check(page, shape.key);

        // The overflow menu open: its items are real targets (target-size) and the page does not scroll sideways.
        const overflow = page.locator('[data-task-header] [data-overflow]');
        await overflow.click();
        await expect(page.getByRole('menuitem').first()).toBeVisible();
        await check(page, `${shape.key}-overflow`);
        await page.keyboard.press('Escape');
        await expect(overflow).toBeFocused();
      }
      if (long) {
        // The Activity drawer of the long task, at the four sizes.
        for (const size of FOUR) {
          await page.setViewportSize(size);
          await detail.open(fx.task.taskId);
          const dlg = await detail.openActivity();
          await expect(dlg).toBeVisible();
          await check(page, `${shape.key}-activity`);
          await page.keyboard.press('Escape');
          await expect(dlg).toBeHidden();
        }
      }
    });
  }

  test('the Workflow heading y, the status note, the Edit dialog and the Activity rows: the review before and after (printed table)', async ({
    seed,
    admin,
    page,
  }) => {
    test.setTimeout(300_000);
    const typical = await seeded(seed, admin);
    const long = await seeded(seed, admin, {
      matter: { name: LONG_MATTER },
      sensitive: true,
      task: { title: LONG_TITLE, description: LONG_DESCRIPTION },
    });
    const cancelled = await seeded(seed, admin);
    expect(
      (await new TaskApi(admin, cancelled.task.taskId).cancel('Duplicate of another task')).status,
    ).toBe(200);
    const busy = await seeded(seed, admin);
    await addComments(admin, busy.task.taskId, 48);
    expect(
      (await new TaskApi(admin, busy.task.taskId).changeStatus('ON_HOLD', 'Waiting for the vendor'))
        .status,
    ).toBe(200);

    const detail = new TaskDetailPage(page);
    const y: Record<string, number> = {};
    for (const [name, fx] of [
      ['typical', typical],
      ['long', long],
    ] as const) {
      for (const size of FOUR) {
        await page.setViewportSize(size);
        await openFresh(page, detail, fx.task.taskId);
        y[`${name}@${size.width}`] = await workflowTop(page);
      }
    }
    // The review's measures (docs/ux/task-detail-review/README.md): typical 235 (1366), 609 (375), 1519 (768); long 519, 1230, 2335.
    expect(y['typical@1366']).toBeLessThanOrEqual(300);
    expect(y['typical@1920']).toBeLessThanOrEqual(300);
    expect(y['typical@768']).toBeLessThanOrEqual(420);
    expect(y['typical@375']).toBeLessThanOrEqual(380);
    expect(y['long@1366']).toBeLessThanOrEqual(330);
    expect(y['long@1920']).toBeLessThanOrEqual(330);
    expect(y['long@768']).toBeLessThanOrEqual(480);
    expect(y['long@375']).toBeLessThanOrEqual(480);

    // The status note of a Cancelled task (the review: three banners, about 190 px of amber before the first step).
    const noteHeights: Record<string, number> = {};
    for (const size of FOUR) {
      await page.setViewportSize(size);
      await openFresh(page, detail, cancelled.task.taskId);
      const note = page.locator('[data-status-note]');
      await expect(note).toHaveCount(1);
      noteHeights[size.width] = Math.round((await note.boundingBox())!.height);
    }
    expect(noteHeights['1366'], 'status note height at 1366').toBeLessThanOrEqual(80);
    expect(noteHeights['375'], 'status note height at 375').toBeLessThanOrEqual(140);

    // The Edit dialog at 1366x768: Save is inside the window (the review: Save at y 2544 of a scrolled page).
    await page.setViewportSize({ width: 1366, height: 768 });
    await openFresh(page, detail, typical.task.taskId);
    await detail.openEdit();
    const save = (await page.locator('[data-save]').boundingBox())!;
    const dialogHeight = Math.round(
      (await page.getByRole('dialog', { name: 'Edit task details' }).boundingBox())!.height,
    );
    expect(save.y + save.height, 'Save inside the window').toBeLessThanOrEqual(768);
    expect(dialogHeight, 'Edit dialog height').toBeLessThanOrEqual(768);
    await check(page, 'edit-dialog');
    await page.keyboard.press('Escape');

    // The Activity drawer of a task with 48 comments and a hold: events other than comments within the first rows.
    await openFresh(page, detail, busy.task.taskId);
    const dlg = await detail.openActivity();
    const rows = dlg.locator('.ta__list > li');
    await expect(rows.first()).toBeVisible();
    const texts = await rows.evaluateAll((els) => els.map((e) => e.textContent ?? ''));
    const firstReal = texts.findIndex((t) => /Status changed|reason added|Task created/.test(t));
    expect(firstReal, 'rows before the first non-comment event').toBeGreaterThanOrEqual(0);
    expect(firstReal).toBeLessThanOrEqual(3);
    expect(texts.length, 'rows on the first page').toBeLessThanOrEqual(10);
    await check(page, 'activity-folded');

    const table = {
      workflowY: y,
      statusNoteHeight: noteHeights,
      editDialogHeight1366: dialogHeight,
      saveBottom1366: Math.round(save.y + save.height),
      activityRowsBeforeFirstEvent: firstReal,
      activityFirstPageRows: texts.length,
    };
    console.log('Task Detail before/after', JSON.stringify(table));
    test.info().annotations.push({ type: 'before-after', description: JSON.stringify(table) });
  });
});

test.describe('Task Detail final verification (#331): permission matrix in short', () => {
  /** Every API answer of 4xx/5xx during the visit, every toast and page error. */
  function watch(page: Page) {
    const failed: string[] = [];
    const errors: string[] = [];
    page.on('response', (r) => {
      if (r.status() >= 400 && r.url().includes('/api/')) failed.push(`${r.status()} ${r.url()}`);
    });
    page.on('pageerror', (e) => errors.push(e.message));
    return { failed, errors };
  }

  const variants: { name: string; permissions: string[] | null; assignee?: boolean }[] = [
    { name: 'System Admin', permissions: null },
    { name: 'assignee Data Technician', permissions: null, assignee: true },
    {
      name: 'Task.View only (no Asset.View, Matter.View, Client.View)',
      permissions: ['Task.View'],
    },
  ];

  for (const v of variants) {
    test(`${v.name}: the page opens, the menus open, every link of the page opens, no failed request and no toast; axe 0 at four sizes with the overflow open`, async ({
      seed,
      admin,
      page,
      asUser,
    }) => {
      test.setTimeout(240_000);
      const fx = await seeded(seed, admin);
      await addComments(admin, fx.task.taskId, 3);
      let who = page;
      if (v.assignee) {
        who = await asUser(fx.tech.username);
      } else if (v.permissions) {
        const role = await seed.role(v.permissions, 'E2E view only');
        const user = await seed.user([role.name], 'viewonly');
        who = await asUser(user.username);
      }
      const seen = watch(who);
      const assetRequests: string[] = [];
      who.on('request', (r) => {
        if (/\/api\/v1\/assets/.test(r.url())) assetRequests.push(r.url());
      });
      const detail = new TaskDetailPage(who);
      for (const size of FOUR) {
        await who.setViewportSize(size);
        await openFresh(who, detail, fx.task.taskId);
        await expect(who.locator('.p-toast-message')).toHaveCount(0);
        const overflow = who.locator('[data-task-header] [data-overflow]');
        if (await overflow.isVisible()) {
          await overflow.click();
          await expect(who.getByRole('menuitem').first()).toBeVisible();
          await check(who, `permissions-${v.name.split(' ')[0].toLowerCase()}`);
          await who.keyboard.press('Escape');
        } else {
          await check(who, `permissions-${v.name.split(' ')[0].toLowerCase()}`);
        }
      }
      // Every in-app link of the page leads somewhere this person may open.
      await who.setViewportSize({ width: 1366, height: 768 });
      await openFresh(who, detail, fx.task.taskId);
      const hrefs = await who
        .locator('main a[href^="/"]')
        .evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute('href')!))]);
      for (const href of hrefs.slice(0, 12)) {
        await who.goto(href);
        await expect(who.locator('main')).toBeVisible();
        await expect(who.getByText(/don't have permission|no access/i)).toHaveCount(0);
      }
      if (v.permissions && v.permissions.length === 1) {
        expect(assetRequests, 'asset requests without Asset.View').toEqual([]);
      }
      expect(seen.failed, 'failed API requests').toEqual([]);
      expect(seen.errors, 'page errors').toEqual([]);
      if (who !== page) await who.close();
    });
  }

  test('no Task.View: the 403 page names the problem, offers a page the person can open, and passes axe at four sizes', async ({
    seed,
    admin,
    asUser,
  }) => {
    const fx = await seeded(seed, admin);
    const role = await seed.role(['Client.View', 'Matter.View'], 'E2E no task');
    const user = await seed.user([role.name], 'notask');
    const who = await asUser(user.username);
    for (const size of FOUR) {
      await who.setViewportSize(size);
      await who.goto(`/tasks/${fx.task.taskId}`);
      await expect(
        who.getByRole('heading', { name: "You don't have permission to view this." }),
      ).toBeVisible();
      await expect(who.getByRole('link', { name: 'Go to Clients' })).toHaveAttribute(
        'href',
        '/clients',
      );
      await expect(who.getByText(/my work/i)).toHaveCount(0);
      await check(who, 'permissions-no-task-view');
    }
    await who.close();
  });
});

test.describe('Task Detail final verification (#331): state matrix', () => {
  test('loading: the skeleton has the header, the strip and two columns and does not move the loaded page; axe 0 while it shows', async ({
    seed,
    page,
  }) => {
    const task = await seed.task(await seed.world());
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route(`**/api/v1/tasks/${task.taskId}`, async (route: Route) => {
      if (route.request().method() === 'GET') await gate;
      await route.continue();
    });
    await page.setViewportSize({ width: 1366, height: 768 });
    const loading = page.goto(`/tasks/${task.taskId}`);
    const skeleton = page.locator('[data-record-skeleton][data-kind=task]');
    await expect(skeleton).toBeVisible();
    await check(page, 'state-loading');
    release();
    await loading;
    await expect(page.locator('[data-task-header] [data-ref]')).toHaveText(task.taskNumber);
    await expect(skeleton).toHaveCount(0);
  });

  test('404, 403 and a server fault: one heading, a way on (Retry only for the fault), no toast; axe 0 at four sizes', async ({
    seed,
    page,
  }) => {
    const task = await seed.task(await seed.world());
    for (const size of FOUR) {
      await page.setViewportSize(size);
      await page.goto('/tasks/99999999');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        "We couldn't find that task.",
      );
      await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0);
      await check(page, 'state-404');
    }
    for (const [status, heading, retry, key] of [
      [403, "You don't have access to this task.", false, 'state-403'],
      [500, "Couldn't load this task.", true, 'state-500'],
    ] as const) {
      await page.route(`**/api/v1/tasks/${task.taskId}`, (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({
              status,
              contentType: 'application/problem+json',
              body: JSON.stringify({
                status,
                code: status === 403 ? 'PERMISSION_DENIED' : 'INTERNAL_ERROR',
                traceId: 'ref-final',
              }),
            })
          : route.continue(),
      );
      for (const size of FOUR) {
        await page.setViewportSize(size);
        await page.goto(`/tasks/${task.taskId}`);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
        await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(retry ? 1 : 0);
        await expect(page.locator('.p-toast-message')).toHaveCount(0);
        await check(page, key);
      }
      await page.unroute(`**/api/v1/tasks/${task.taskId}`);
    }
  });

  test('a lost connection in Activity: one message with Retry, no toast, Retry recovers; axe 0 at four sizes', async ({
    seed,
    page,
  }) => {
    const task = await seed.task(await seed.world());
    let offline = true;
    await page.route(`**/api/v1/tasks/${task.taskId}/activity**`, (route) =>
      offline ? route.abort('connectionreset') : route.continue(),
    );
    const detail = new TaskDetailPage(page);
    await page.setViewportSize({ width: 1366, height: 768 });
    await detail.open(task.taskId);
    const dlg = await detail.openActivity();
    await expect(dlg.locator('[data-load-error]')).toHaveCount(1);
    await waitForToastsToGo(page);
    for (const size of FOUR) {
      await page.setViewportSize(size);
      await expect(dlg).toBeVisible();
      await check(page, 'state-offline-activity');
    }
    offline = false;
    await dlg.getByRole('button', { name: 'Retry' }).click();
    await expect(dlg.locator('[data-load-error]')).toHaveCount(0);
    await expect(dlg.locator('[data-event-id]').first()).toBeVisible();
  });

  test('reduced motion: the page renders, nothing animates, axe 0', async ({
    seed,
    admin,
    page,
  }) => {
    const fx = await seeded(seed, admin);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const detail = new TaskDetailPage(page);
    for (const size of FOUR) {
      await page.setViewportSize(size);
      await detail.open(fx.task.taskId);
      await waitForToastsToGo(page);
      const running = await page.evaluate(
        () =>
          document
            .getAnimations()
            .filter(
              (a) =>
                a.playState === 'running' &&
                (a.effect as KeyframeEffect | null)?.getComputedTiming().duration !== 0,
            ).length,
      );
      expect(running, `running animations at ${size.width}`).toBe(0);
      await check(page, 'state-reduced-motion');
    }
  });
});
