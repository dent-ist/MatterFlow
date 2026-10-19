import fs from 'node:fs';
import path from 'node:path';
import { Locator, Page } from '@playwright/test';
import { TaskDetailPage } from '../pages/task-detail.page';
import { Api, Json } from '../support/api';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { FieldSpec, Seeder, World, uid } from '../support/seed';
import { TaskApi } from '../support/tasks';
import { FIRM_ZONE, dateInZone } from '../support/time';

/**
 * Task Detail T6 "Workflow head and Details" (#310 to #314): the Workflow head is the heading, a one-line mode sentence and, from 6
 * steps, the Show filter; a completed step's number and title stay on one line; the Details heading carries the Edit pencil and every
 * sub-heading starts at the same left edge; Request details is a collapsible section (closed for more than 6 fields, remembered per task
 * type and person); a long Description is cut at about 12 lines with Show more / Show less. Every test seeds its own records.
 * Screenshots go to E2E_SCREENSHOTS when it is set (docs/ux/task-detail-review/fixes/t6).
 */
const OUT = process.env['E2E_SCREENSHOTS'];

const SIZES = [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
] as const;

async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  const size = page.viewportSize()!;
  await page.screenshot({ path: path.join(OUT, `${name}-${size.width}x${size.height}.png`) });
}

/** axe finds nothing, the page does not scroll sideways, and a screenshot is kept. */
async function check(page: Page, name: string): Promise<void> {
  if (axeAvailable()) {
    expect(await axeViolations(page), `${name} at ${page.viewportSize()!.width}`).toEqual([]);
  }
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(
    overflow,
    `page-level horizontal scroll at ${page.viewportSize()!.width}`,
  ).toBeLessThanOrEqual(0);
  await shot(page, name);
}

/** Opens the task with nothing remembered (earlier choices of this browser are cleared). */
async function openFresh(page: Page, taskId: number): Promise<void> {
  await new TaskDetailPage(page).open(taskId);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('[data-workflow-tab]')).toBeVisible();
}

/** Opens the Details disclosure below 1100 px (from 1100 px the panel is always open). */
async function openDetails(page: Page): Promise<void> {
  const toggle = page.locator('[data-detail-toggle]');
  if ((await toggle.count()) > 0 && (await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click();
  }
  await expect(page.locator('[data-detail-body]')).toBeVisible();
}

const rect = (loc: Locator) => loc.evaluate((el) => el.getBoundingClientRect().toJSON());
const requestToggle = (page: Page): Locator =>
  page.locator('[data-request-form] [data-request-toggle]');

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

/** A request form of `n` text fields (`f1` to `fn`). */
const fields = (n: number): FieldSpec[] =>
  Array.from({ length: n }, (_, i) => ({
    key: `f${i + 1}`,
    label: `Request field ${i + 1}`,
    control: 'TEXT',
  }));

/** Values for the fields: short ones, one long sentence and one 180-character unbroken string. */
function values(n: number): Json {
  const out: Json = {};
  for (let i = 1; i <= n; i++) out[`f${i}`] = `Value ${i}`;
  if (n >= 2)
    out['f2'] =
      'The vendor re-sent two of the custodian files overnight and the hashes differ from the first delivery';
  if (n >= 3) out['f3'] = 'X'.repeat(180);
  return out;
}

const SENTENCE =
  'The vendor re-sent two of the custodian files overnight and the hashes differ from the first delivery, so the load has to wait for the exception list. ';
const LONG_DESCRIPTION =
  `<p>${SENTENCE.repeat(3)}</p><p>${SENTENCE.repeat(3)}</p>` +
  `<ul><li>${SENTENCE}</li><li>${SENTENCE}</li><li>Second item with a <a href="https://example.com/exceptions">link to the exception list</a></li></ul>` +
  `<table><tbody><tr><th>Custodian</th><th>Files</th></tr><tr><td>Rivera</td><td>412</td></tr><tr><td>Okafor</td><td>77</td></tr></tbody></table>` +
  `<p>${SENTENCE.repeat(3)}</p><p>${SENTENCE.repeat(3)}</p><p>${SENTENCE.repeat(2)}</p>`;

interface Fixture {
  world: World;
  tech: { username: string; userId: number };
  task: Json;
}

/** A task with a Pod, an assignee and an overdue due date. */
async function seeded(
  seed: Seeder,
  admin: Api,
  opts: {
    stepCount?: number;
    ordered?: boolean;
    fieldCount?: number;
    task?: Json;
    steps?: { title: string }[];
  } = {},
): Promise<Fixture> {
  const n = opts.fieldCount ?? 0;
  const world = await seed.world({
    stepCount: opts.stepCount ?? 3,
    ordered: opts.ordered,
    steps: opts.steps,
    fields: n > 0 ? fields(n) : undefined,
  });
  const role = await seed.role(ROLE, 'E2E technician');
  const tech = await seed.user([role.name], 'tech');
  const pod = await seed.pod(`E2E Pod ${uid()}`, [tech.userId]);
  const task = await seed.task(world, {
    dueDate: dateInZone(FIRM_ZONE, -3),
    ...(n > 0 ? { formValues: values(n) } : {}),
    ...opts.task,
  });
  await new TaskApi(admin, task.taskId).assign(tech.userId, pod.podId);
  return { world, tech, task };
}

test.describe('Task T6: Workflow head (#310)', () => {
  test('the head is one row of at most 56 px at 1366 and 1920 and the first step is in view; no progress bar, no Complete block', async ({
    seed,
    admin,
    page,
  }) => {
    const { task } = await seeded(seed, admin);
    for (const size of SIZES.filter((s) => s.width >= 1024)) {
      await page.setViewportSize(size);
      await openFresh(page, task.taskId);
      const head = await rect(page.locator('.wf__head'));
      expect(head.height, `head height at ${size.width}`).toBeLessThanOrEqual(56);
      await expect(page.locator('[data-workflow-tab] progress')).toHaveCount(0);
      await expect(page.locator('[data-workflow-tab] [data-progress]')).toHaveCount(0);
      await expect(page.locator('[data-filter-group]')).toHaveCount(0);
      const first = await rect(page.locator('[data-step-id]').first().locator('.step__toggle'));
      expect(
        first.bottom,
        `first step row in view at ${size.width}x${size.height}`,
      ).toBeLessThanOrEqual(size.height);
      await expect(page.locator('[data-mode]')).toContainText('Ordered');
      await check(page, 'workflow-head-3-steps');
    }
  });

  test('the Show filter is hidden for 3 and 5 steps, shown from 6 (ordered and unordered, 6 and 8 steps) and filters the unresolved ones', async ({
    seed,
    admin,
    page,
  }) => {
    const three = await seeded(seed, admin, { stepCount: 3 });
    const five = await seeded(seed, admin, { stepCount: 5, ordered: false });
    const six = await seeded(seed, admin, { stepCount: 6 });
    const eight = await seeded(seed, admin, { stepCount: 8 });
    const seven = await seeded(seed, admin, { stepCount: 7, ordered: false });
    await page.setViewportSize({ width: 1366, height: 768 });
    for (const [name, fx, shown] of [
      ['3 ordered', three, false],
      ['5 unordered', five, false],
      ['6 ordered', six, true],
      ['8 ordered', eight, true],
      ['7 unordered', seven, true],
    ] as const) {
      await new TaskDetailPage(page).open(fx.task.taskId);
      await expect(page.locator('[data-workflow-tab]')).toBeVisible();
      await expect(page.locator('[data-filter-group]'), name).toHaveCount(shown ? 1 : 0);
    }

    // 8 steps, 2 completed: Unresolved keeps 6 and All shows 8; the group is a labelled set of toggle buttons.
    const api = new TaskApi(admin, eight.task.taskId);
    await api.completeSteps(1, 2);
    await new TaskDetailPage(page).open(eight.task.taskId);
    const rows = page.locator('ol.wf__steps > li');
    await expect(rows).toHaveCount(8);
    await page.locator('[data-filter="unresolved"]').click();
    await expect(rows).toHaveCount(6);
    await expect(page.locator('[data-filter="unresolved"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.locator('[data-filter="all"]').click();
    await expect(rows).toHaveCount(8);
    const head = await rect(page.locator('.wf__head'));
    expect(head.height, 'head with the filter at 1366').toBeLessThanOrEqual(56);
    const filter = await rect(page.locator('[data-filter-group]'));
    const wf = await rect(page.locator('[data-workflow-tab]'));
    expect(filter.right, 'the filter sits at the right edge of the head').toBeGreaterThan(
      wf.right - 24,
    );

    for (const size of SIZES) {
      await page.setViewportSize(size);
      await new TaskDetailPage(page).open(eight.task.taskId);
      await expect(page.locator('[data-filter-group]')).toBeVisible();
      await check(page, 'workflow-8-steps');
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    await new TaskDetailPage(page).open(seven.task.taskId);
    await page.locator('[data-filter="unresolved"]').click();
    await check(page, 'workflow-7-unordered-filtered');
  });
});

test.describe('Task T6: a completed step keeps its number and title on one line (#311, BUG-7)', () => {
  test('a 140-character title of a completed step 2 shares its first row with "2." at 375, 768, 1366 and 1920', async ({
    seed,
    admin,
    page,
  }) => {
    const long = `Quality check the supplemental custodian load, compare hashes against the first delivery and file the exception list ${uid()}`;
    const { task } = await seeded(seed, admin, {
      steps: [{ title: 'Intake' }, { title: long }, { title: 'Handover' }],
    });
    await new TaskApi(admin, task.taskId).completeSteps(1, 2);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await new TaskDetailPage(page).open(task.taskId);
      const step = page.locator('[data-step-status="COMPLETED"]').nth(1);
      await expect(step).toBeVisible();
      const geometry = await step.evaluate((el) => {
        const no = el.querySelector('.step__no')!.getBoundingClientRect();
        const lines = Array.from(el.querySelector('.step__title')!.getClientRects());
        return {
          noTop: no.top,
          noBottom: no.bottom,
          firstLineTop: lines[0].top,
          firstLineBottom: lines[0].bottom,
        };
      });
      expect(
        Math.abs(geometry.firstLineTop - geometry.noTop),
        `"2." and the first title line share a row at ${size.width}`,
      ).toBeLessThanOrEqual(4);
      expect(geometry.firstLineBottom).toBeGreaterThan(geometry.noTop);
      await check(page, 'completed-step-long-title');
    }
  });
});

test.describe('Task T6: Details heading, alignment and Request details (#312, #313)', () => {
  test('the pencil is on the heading row and Description, Task information and Request details start at one left edge (1366 and 768)', async ({
    seed,
    admin,
    page,
    asUser,
  }) => {
    const { task, tech } = await seeded(seed, admin, {
      fieldCount: 14,
      task: { description: '<p>Short description.</p>' },
    });
    const techPage = await asUser(tech.username);
    for (const p of [page, techPage]) {
      for (const size of [SIZES[3], SIZES[1]]) {
        await p.setViewportSize(size);
        await openFresh(p, task.taskId);
        await openDetails(p);
        const heading = await rect(p.locator('[data-detail-panel] h2'));
        const pencil = await rect(p.locator('[data-edit-details]'));
        expect(
          Math.abs(pencil.top + pencil.height / 2 - (heading.top + heading.height / 2)),
          `pencil and heading share a row at ${size.width}`,
        ).toBeLessThanOrEqual(4);
        expect(pencil.left).toBeGreaterThan(heading.left + 40);
        const description = await rect(p.getByRole('heading', { name: 'Description', level: 3 }));
        expect(
          description.top - heading.bottom,
          'no empty row between the heading and the first sub-heading',
        ).toBeLessThanOrEqual(24);
        const info = await rect(p.getByRole('heading', { name: 'Task information' }));
        const request = await rect(p.locator('[data-request-form] .rs__text'));
        expect(Math.abs(info.left - description.left)).toBeLessThanOrEqual(1);
        expect(
          Math.abs(request.left - description.left),
          'Request details edge',
        ).toBeLessThanOrEqual(1);
        await check(p, 'details-heading');
      }
    }
  });

  test('14 fields start closed, 5 start open; keyboard and aria-expanded work; the choice is kept per task type and person', async ({
    seed,
    admin,
    page,
  }) => {
    const long = await seeded(seed, admin, { fieldCount: 14 });
    const short = await seeded(seed, admin, { fieldCount: 5 });
    await page.setViewportSize({ width: 1366, height: 768 });
    await openFresh(page, long.task.taskId);
    await expect(requestToggle(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(requestToggle(page)).toContainText(
      `Request details (${long.world.taskType.name}, form 1)`,
    );
    await expect(requestToggle(page)).toContainText('14 fields');
    await expect(page.locator('[data-request-form] [data-request-body]')).toBeHidden();
    await shot(page, 'request-details-closed');

    // Keyboard: Enter opens, Space closes, focus stays on the button.
    await requestToggle(page).focus();
    await page.keyboard.press('Enter');
    await expect(requestToggle(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(requestToggle(page)).toBeFocused();
    await expect(page.getByText('Request field 14')).toBeVisible();
    await expect(page.locator('[data-request-form]')).toContainText('X'.repeat(180));
    await shot(page, 'request-details-open-14');
    await page.reload();
    await expect(requestToggle(page)).toHaveAttribute('aria-expanded', 'true'); // remembered for this type
    await requestToggle(page).focus();
    await page.keyboard.press('Space');
    await expect(requestToggle(page)).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Space');
    await expect(requestToggle(page)).toHaveAttribute('aria-expanded', 'true');

    // Another task type keeps its own default and its own choice.
    await new TaskDetailPage(page).open(short.task.taskId);
    await expect(requestToggle(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(requestToggle(page)).toContainText('5 fields');
    await expect(page.getByText('Request field 5')).toBeVisible();
    await requestToggle(page).click();
    await expect(requestToggle(page)).toHaveAttribute('aria-expanded', 'false');
    await page.reload();
    await expect(requestToggle(page)).toHaveAttribute('aria-expanded', 'false');
    await new TaskDetailPage(page).open(long.task.taskId);
    await expect(requestToggle(page)).toHaveAttribute('aria-expanded', 'true');
  });

  test('the Edit dialog uses the same section: 14 fields closed, 5 open, and it opens itself on a request-form error', async ({
    seed,
    admin,
    page,
  }) => {
    const long = await seeded(seed, admin, { fieldCount: 14 });
    const short = await seeded(seed, admin, { fieldCount: 5 });
    await page.setViewportSize({ width: 1366, height: 768 });
    await openFresh(page, long.task.taskId);
    await page.locator('[data-edit-details]').click();
    const dialogToggle = page.locator('[role=dialog] [data-request-toggle]');
    await expect(dialogToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(dialogToggle).toContainText('14 fields');
    await check(page, 'edit-dialog-request-closed');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await new TaskDetailPage(page).open(short.task.taskId);
    await page.locator('[data-edit-details]').click();
    await expect(page.locator('[role=dialog] [data-request-toggle]')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await check(page, 'edit-dialog-request-open');
  });
});

test.describe('Task T6: long Description is cut at about 12 lines (#314)', () => {
  test('a long description is cut with Show more, expands in place keeping focus and keeps its links, list and table; a short one has no button', async ({
    seed,
    admin,
    page,
  }) => {
    const long = await seeded(seed, admin, { task: { description: LONG_DESCRIPTION } });
    const short = await seeded(seed, admin, { task: { description: '<p>Short description.</p>' } });
    for (const size of SIZES.filter((s) => s.width >= 1024)) {
      await page.setViewportSize(size);
      await openFresh(page, long.task.taskId);
      await openDetails(page);
      const box = page.locator('[data-description]');
      const more = page.locator('[data-description-more]');
      await expect(more).toHaveText('Show more');
      await expect(more).toHaveAttribute('aria-expanded', 'false');
      const cut = await box.evaluate((el) => ({
        height: el.getBoundingClientRect().height,
        lines: el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight),
        full: el.scrollHeight,
      }));
      expect(cut.lines, `about 12 lines at ${size.width}`).toBeLessThanOrEqual(12.2);
      expect(cut.full).toBeGreaterThan(cut.height + 40);
      await shot(page, 'description-clamped');

      await more.focus();
      await page.keyboard.press('Enter');
      await expect(more).toHaveText('Show less');
      await expect(more).toHaveAttribute('aria-expanded', 'true');
      await expect(more).toBeFocused();
      const open = await box.evaluate((el) => el.getBoundingClientRect().height);
      expect(open).toBeGreaterThan(cut.height + 40);
      await expect(box.locator('a[href="https://example.com/exceptions"]')).toBeVisible();
      await expect(box.locator('ul li')).toHaveCount(3);
      await expect(box.locator('table td').first()).toHaveText('Rivera');
      await check(page, 'description-expanded');

      await page.keyboard.press('Space');
      await expect(more).toHaveText('Show more');
      await expect(more).toBeFocused();
    }

    await page.setViewportSize({ width: 1366, height: 768 });
    await new TaskDetailPage(page).open(short.task.taskId);
    await expect(page.locator('[data-description]')).toContainText('Short description.');
    await expect(page.locator('[data-description-more]')).toHaveCount(0);

    // Below 1100 px the Details disclosure holds it: the cut works after the panel is opened.
    for (const size of SIZES.filter((s) => s.width < 1024)) {
      await page.setViewportSize(size);
      await openFresh(page, long.task.taskId);
      await openDetails(page);
      await expect(page.locator('[data-description-more]')).toHaveText('Show more');
      await check(page, 'description-clamped-narrow');
    }
  });

  test('nothing shifts when the page loads (CLS under 0.02) and the wide Details panel has no scrollbar with Request details closed (#309)', async ({
    seed,
    admin,
    page,
  }) => {
    const { task } = await seeded(seed, admin, {
      fieldCount: 14,
      task: { description: LONG_DESCRIPTION },
    });
    for (const size of [SIZES[3], SIZES[4]]) {
      await page.setViewportSize(size);
      await page.addInitScript(() => {
        (window as unknown as { __cls: number }).__cls = 0;
        new PerformanceObserver((list) => {
          for (const e of list.getEntries() as unknown as {
            value: number;
            hadRecentInput: boolean;
          }[]) {
            if (!e.hadRecentInput) (window as unknown as { __cls: number }).__cls += e.value;
          }
        }).observe({ type: 'layout-shift', buffered: true });
      });
      await openFresh(page, task.taskId);
      await expect(page.locator('[data-description-more]')).toBeVisible();
      await page.waitForTimeout(500);
      const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
      expect(cls, `CLS at ${size.width}`).toBeLessThan(0.02);

      await expect(requestToggle(page)).toHaveAttribute('aria-expanded', 'false');
      const panel = await page.locator('[data-detail-panel]').evaluate((el) => ({
        scroll: el.scrollHeight,
        client: el.clientHeight,
        more: el.classList.contains('dl__aside--more'),
      }));
      expect(
        panel.scroll,
        `no scrollbar in Details at ${size.width}x${size.height}`,
      ).toBeLessThanOrEqual(panel.client + 1);
      expect(panel.more, 'no fade cue').toBe(false);
      await check(page, 'details-no-scrollbar');
    }
  });
});

test.describe('Task T6: long values and permission variants', () => {
  test('a 200-character title, long field values and a 7-step unordered workflow fit at every width', async ({
    seed,
    admin,
    page,
  }) => {
    const { task } = await seeded(seed, admin, {
      stepCount: 7,
      ordered: false,
      fieldCount: 8,
      task: {
        title:
          'Process and load the supplemental custodian collections for the Meridian second-request response including Q3 mobile device images, Slack exports, shared network drives and the legacy archive restore'.slice(
            0,
            200,
          ),
        description: LONG_DESCRIPTION,
        requestorName: 'Dana Whitfield-Montgomery-Larkspur',
      },
    });
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await openFresh(page, task.taskId);
      await openDetails(page);
      await requestToggle(page).click();
      await expect(requestToggle(page)).toHaveAttribute('aria-expanded', 'true');
      await page.evaluate(() => window.scrollTo(0, 0)); // the sticky section nav would cover steps scrolled under it
      await check(page, 'long-values');
    }
  });

  test('System Admin, assignee Data Technician, Task.View only and no Task.View', async ({
    seed,
    admin,
    page,
    asUser,
  }) => {
    const { task, tech } = await seeded(seed, admin, {
      stepCount: 6,
      fieldCount: 8,
      task: { description: LONG_DESCRIPTION },
    });
    const techPage = await asUser(tech.username);
    const viewRole = await seed.role(['Task.View'], 'E2E view only');
    const viewer = await seed.user([viewRole.name], 'viewonly');
    const viewPage = await asUser(viewer.username);
    const noneRole = await seed.role(['Matter.View'], 'E2E no task');
    const nobody = await seed.user([noneRole.name], 'notask');
    const nonePage = await asUser(nobody.username);

    for (const size of SIZES) {
      for (const [name, p, canEdit] of [
        ['admin', page, true],
        ['technician', techPage, true],
        ['view-only', viewPage, false],
      ] as const) {
        await p.setViewportSize(size);
        await openFresh(p, task.taskId);
        await openDetails(p);
        await expect(p.locator('[data-filter-group]'), `${name} filter`).toBeVisible();
        await expect(p.locator('[data-edit-details]'), `${name} pencil`).toHaveCount(
          canEdit ? 1 : 0,
        );
        await expect(requestToggle(p), `${name} request`).toBeVisible();
        await expect(p.locator('[data-description-more]'), `${name} more`).toBeVisible();
        await check(p, `roles-${name}`);
      }
    }

    // No Task.View: the access state, none of the new parts.
    await nonePage.setViewportSize({ width: 375, height: 812 });
    await nonePage.goto(`/tasks/${task.taskId}`);
    await nonePage.waitForLoadState('networkidle');
    await expect(nonePage.locator('[data-workflow-tab]')).toHaveCount(0);
    await expect(nonePage.locator('[data-request-toggle]')).toHaveCount(0);
    await check(nonePage, 'roles-no-task-view');
  });
});
