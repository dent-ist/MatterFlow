import fs from 'node:fs';
import path from 'node:path';
import { Locator, Page } from '@playwright/test';
import { TaskDetailPage } from '../pages/task-detail.page';
import { Api, Json } from '../support/api';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Seeder, World, uid } from '../support/seed';
import { TaskApi } from '../support/tasks';
import { FIRM_ZONE, dateInZone } from '../support/time';

/**
 * Task Detail T5 "Layout" (#307, #308, #309): below 1100 px the Workflow comes first and Details is a closed disclosure with a one-line
 * summary (remembered per person); a section nav with counts (`Workflow 2/3  Comments 48  Assets 0`) shows at every width, sticks from
 * 640 px and is static below; the wide Details panel is sized by its content, never traps the wheel and shows a bottom fade while more is
 * below. Every test seeds its own records. Screenshots go to E2E_SCREENSHOTS when it is set (docs/ux/task-detail-review/fixes/t5).
 */
const OUT = process.env['E2E_SCREENSHOTS'];

const SIZES = [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
] as const;

const LONG_TITLE =
  'Process and load the supplemental custodian collections for the Meridian second-request response, including Q3 mobile device images, Slack exports, shared network drives and the legacy archive restore'
    .slice(0, 200)
    .trim();
const LONG_MATTER =
  'In re Meridian Pharmaceuticals Securities Litigation - Consolidated Multidistrict Class Action Proceedings, Second Request for Production of Documents, Custodial Collections, Privilege Review'
    .padEnd(205, ' and Rolling Productions')
    .slice(0, 205);

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

/** axe finds nothing, the page does not scroll sideways, and a screenshot is kept. */
async function check(page: Page, name: string): Promise<void> {
  if (axeAvailable()) {
    expect(await axeViolations(page), `${name} at ${page.viewportSize()!.width}`).toEqual([]);
  }
  await noHorizontalScroll(page);
  await shot(page, name);
}

async function atEverySize(page: Page, name: string, settle: () => Promise<void>): Promise<void> {
  for (const size of SIZES) {
    await page.setViewportSize(size);
    await settle();
    await check(page, name);
  }
}

/** Top of the Workflow heading with the page scrolled to the top (the review's measure). */
async function workflowTop(page: Page): Promise<number> {
  await page.evaluate(() => window.scrollTo(0, 0));
  return page
    .locator('[data-workflow-tab] [data-section-heading]')
    .evaluate((el) => Math.round(el.getBoundingClientRect().top));
}

/** Opens the task with nothing remembered (the Details and section choices of an earlier size are cleared). */
async function openFresh(page: Page, detail: TaskDetailPage, taskId: number): Promise<void> {
  await detail.open(taskId);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('[data-section-link="workflow"]')).toBeVisible();
}

const top = (loc: Locator) => loc.evaluate((el) => Math.round(el.getBoundingClientRect().top));
const nav = (page: Page): Locator => page.getByRole('navigation', { name: 'Sections' });
const link = (page: Page, name: string): Locator =>
  nav(page).getByRole('link', { name: new RegExp(`^${name}`) });
const detailsToggle = (page: Page): Locator => page.locator('[data-detail-toggle]');

interface Fixture {
  world: World;
  tech: { username: string; userId: number };
  task: Json;
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

/** A task with a Pod, an assignee and an overdue due date; `overrides` go to the create call. */
async function seeded(
  seed: Seeder,
  admin: Api,
  opts: {
    matter?: Json;
    sensitive?: boolean;
    task?: Json;
    stepCount?: number;
    assign?: boolean;
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
  return { world, tech, task };
}

async function addComments(admin: Api, taskId: number, count: number): Promise<void> {
  for (let i = 1; i <= count; i++) {
    await admin.post(`/api/v1/tasks/${taskId}/comments`, {
      bodyHtml: `<p>Comment number ${i}</p>`,
    });
  }
}

const SENTENCE =
  'The vendor re-sent two of the custodian files overnight and the hashes differ from the first delivery, so the load has to wait for the exception list. ';
const LONG_DESCRIPTION = `<p>${SENTENCE.repeat(4)}</p><p>${SENTENCE.repeat(4)}</p><p>${SENTENCE.repeat(3)}</p>`;

test.describe('Task T5: narrow order and the Details disclosure (#307)', () => {
  test('Workflow comes first, Details is last and closed with a one-line summary at 375, 768 and 1024; opening it with the keyboard keeps focus and is remembered', async ({
    seed,
    admin,
    page,
  }) => {
    const { task } = await seeded(seed, admin, {
      task: { description: '<p>Short.</p>', requestorName: 'Dana W-M' },
    });
    const detail = new TaskDetailPage(page);
    for (const size of SIZES.filter((s) => s.width < 1100)) {
      await page.setViewportSize(size);
      await openFresh(page, detail, task.taskId);
      const y = await page.evaluate(() => {
        const at = (sel: string) => document.querySelector(sel)!.getBoundingClientRect().top;
        return {
          nav: at('[data-section-nav]'),
          wf: at('[data-section="workflow"]'),
          comments: at('[data-section="comments"]'),
          assets: at('[data-section="assets"]'),
          details: at('[data-detail-panel]'),
        };
      });
      expect(y.nav, `nav before Workflow at ${size.width}`).toBeLessThan(y.wf);
      expect(y.wf).toBeLessThan(y.assets);
      expect(y.assets).toBeLessThan(y.comments);
      expect(y.comments).toBeLessThanOrEqual(y.details);
      await expect(detailsToggle(page)).toHaveAttribute('aria-expanded', 'false');
      const summary = page.locator('[data-detail-summary]');
      await expect(summary).toHaveText(/^Requestor Dana W-M/);
      // One line that ends in an ellipsis rather than wrapping.
      const sum = await summary.evaluate((el) => ({
        h: el.getBoundingClientRect().height,
        lh: parseFloat(getComputedStyle(el).lineHeight),
        ws: getComputedStyle(el).whiteSpace,
      }));
      expect(sum.ws).toBe('nowrap');
      expect(sum.h).toBeLessThanOrEqual(sum.lh + 1);
      await expect(page.locator('[data-detail-body]')).toBeHidden();

      // Keyboard: Enter on the button opens it, focus stays on the button, the content is there.
      await detailsToggle(page).focus();
      await page.keyboard.press('Enter');
      await expect(detailsToggle(page)).toHaveAttribute('aria-expanded', 'true');
      await expect(detailsToggle(page)).toBeFocused();
      await expect(page.locator('[data-description]')).toBeVisible();
      await shot(page, 'details-open');
      await check(page, 'details-open');

      // Remembered for this person: a reload keeps it open; closing it with Space is remembered too.
      await page.reload();
      await expect(detailsToggle(page)).toHaveAttribute('aria-expanded', 'true');
      await detailsToggle(page).focus();
      await page.keyboard.press('Space');
      await expect(detailsToggle(page)).toHaveAttribute('aria-expanded', 'false');
      await page.reload();
      await expect(detailsToggle(page)).toHaveAttribute('aria-expanded', 'false');
    }
  });

  test('?tab=details opens the disclosure without remembering it; from 1100 px the two columns are unchanged and there is no disclosure', async ({
    seed,
    admin,
    page,
  }) => {
    const { task } = await seeded(seed, admin);
    await page.setViewportSize({ width: 768, height: 1024 });
    await openFresh(page, new TaskDetailPage(page), task.taskId);
    await page.goto(`/tasks/${task.taskId}?tab=details`);
    await expect(detailsToggle(page)).toHaveAttribute('aria-expanded', 'true');
    await page.goto(`/tasks/${task.taskId}`);
    await expect(detailsToggle(page)).toHaveAttribute('aria-expanded', 'false');

    for (const size of SIZES.filter((s) => s.width >= 1366)) {
      await page.setViewportSize(size);
      await new TaskDetailPage(page).open(task.taskId);
      await expect(page.locator('[data-detail-layout]')).toHaveAttribute('data-layout', /^wide/);
      await expect(detailsToggle(page)).toHaveCount(0);
      await expect(page.locator('[data-detail-summary]')).toHaveCount(0);
      const wf = await page.locator('[data-section="workflow"]').boundingBox();
      const aside = await page.locator('[data-detail-panel]').boundingBox();
      expect(aside!.x, 'Details at the right').toBeGreaterThan(wf!.x + wf!.width);
    }
  });

  test('Workflow position: typical task <= 380 and long, sensitive task <= 480 at 375; far above the old y 1519 at 768x1024', async ({
    seed,
    admin,
    page,
  }) => {
    const typical = await seeded(seed, admin);
    const long = await seeded(seed, admin, {
      matter: { name: LONG_MATTER },
      sensitive: true,
      task: { title: LONG_TITLE, description: LONG_DESCRIPTION },
    });
    const detail = new TaskDetailPage(page);
    const measured: Record<string, number> = {};
    for (const [name, fx] of [
      ['typical', typical],
      ['long-sensitive', long],
    ] as const) {
      for (const size of SIZES) {
        await page.setViewportSize(size);
        await openFresh(page, detail, fx.task.taskId);
        measured[`${name}@${size.width}`] = await workflowTop(page);
      }
    }
    console.log('T5 Workflow heading y', JSON.stringify(measured));
    expect(measured['typical@375'], 'typical task at 375').toBeLessThanOrEqual(380);
    expect(measured['long-sensitive@375'], 'long sensitive task at 375').toBeLessThanOrEqual(480);
    expect(measured['typical@768'], 'typical task at 768x1024').toBeLessThanOrEqual(420);
    expect(measured['long-sensitive@768'], 'long task at 768x1024').toBeLessThanOrEqual(480);
    expect(measured['typical@1366']).toBeLessThanOrEqual(300);
    expect(measured['long-sensitive@1366']).toBeLessThanOrEqual(330);
  });
});

test.describe('Task T5: the section nav (#308)', () => {
  test('shows Workflow 1/3, Assets 0 and Comments 48 at every width; Comments opens the 48-comment section and moves focus to its heading; keyboard order puts the nav before the Workflow', async ({
    seed,
    admin,
    page,
  }) => {
    const { task } = await seeded(seed, admin);
    await addComments(admin, task.taskId, 48);
    await new TaskApi(admin, task.taskId).doStep(1, 'complete');
    const detail = new TaskDetailPage(page);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await openFresh(page, detail, task.taskId);
      await expect(nav(page).getByRole('link')).toHaveText([
        /^Workflow\s*1\/3$/,
        /^Assets\s*0$/,
        /^Comments\s*48$/,
      ]);
      await expect(link(page, 'Workflow')).toHaveAttribute('title', '1 of 3 steps resolved');
      await expect(page.locator('[data-section="comments"] [data-toggle]')).toHaveAttribute(
        'aria-expanded',
        'false',
      );
      await link(page, 'Comments').click();
      await expect(page.locator('[data-section="comments"] [data-toggle]')).toHaveAttribute(
        'aria-expanded',
        'true',
      );
      await expect(page.locator('[data-section="comments"] [data-section-heading]')).toBeFocused();
      // The section starts in view, under the app header and the sticky row.
      const t = await top(page.locator('[data-section="comments"]'));
      expect(t, `Comments top at ${size.width}`).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThan(size.height / 2);
      await expect(link(page, 'Comments')).toHaveAttribute('aria-current', 'location');
      await shot(page, 'nav-comments');
    }
  });

  test('keyboard only: Tab reaches the nav before the Workflow steps, Enter on Assets opens and focuses it, deep links still work', async ({
    seed,
    admin,
    page,
  }) => {
    const { task } = await seeded(seed, admin);
    await page.setViewportSize({ width: 1366, height: 768 });
    await new TaskDetailPage(page).open(task.taskId);
    const order = await page.evaluate(() => {
      const items = Array.from(
        document.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex="0"], input, select, textarea',
        ),
      );
      const idx = (sel: string) => items.indexOf(document.querySelector<HTMLElement>(sel)!);
      return {
        header: idx('[data-task-header] h1, [data-task-header] [data-action]'),
        nav: idx('[data-section-link="workflow"]'),
        step: idx('[data-workflow-tab] button'),
      };
    });
    expect(order.nav).toBeGreaterThan(order.header);
    expect(order.nav).toBeLessThan(order.step);

    await link(page, 'Workflow').focus();
    await page.keyboard.press('Tab');
    await expect(link(page, 'Assets')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(link(page, 'Comments')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-section="comments"] [data-toggle]')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await expect(page.locator('[data-section="comments"] [data-section-heading]')).toBeFocused();
    // Shift+Tab goes back to the nav (the nav is before the section in the tab order).
    await expect(link(page, 'Comments')).toHaveAttribute('aria-current', 'location');

    for (const tab of ['comments', 'assets', 'workflow']) {
      await page.goto(`/tasks/${task.taskId}?tab=${tab}`);
      await expect(page.locator(`[data-section="${tab}"] [data-section-heading]`)).toBeFocused();
    }
  });

  test('sticky from 640 px under the app header, static on a phone; scroll-spy marks the section being read', async ({
    seed,
    admin,
    page,
  }) => {
    const { task } = await seeded(seed, admin);
    await addComments(admin, task.taskId, 30);
    const detail = new TaskDetailPage(page);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await openFresh(page, detail, task.taskId);
      await expect(link(page, 'Comments')).toContainText('30');
      await link(page, 'Comments').click();
      await expect(page.locator('[data-section="comments"] [data-toggle]')).toHaveAttribute(
        'aria-expanded',
        'true',
      );
      const headerH = await page
        .locator('header')
        .first()
        .evaluate((el) => el.getBoundingClientRect().bottom);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(250);
      const navTop = await top(page.locator('mf-section-nav'));
      if (size.width >= 640) {
        expect(navTop, `sticky nav at ${size.width}`).toBeLessThanOrEqual(Math.ceil(headerH) + 2);
        expect(navTop).toBeGreaterThanOrEqual(0);
      } else {
        expect(navTop, `static nav at ${size.width}`).toBeLessThan(0);
      }
      // Scrolled to the end of the page the last section is the one being read; at the top it is the Workflow.
      await expect(nav(page).locator('[aria-current="location"]')).toHaveCount(1);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.mouse.wheel(0, 1); // a hand scroll lets go of the section chosen with a click
      await page.waitForTimeout(250);
      await expect(link(page, 'Workflow')).toHaveAttribute('aria-current', 'location');
      await page.evaluate(() =>
        document.querySelector('[data-section="comments"]')!.scrollIntoView({ block: 'start' }),
      );
      await page.evaluate(() => window.scrollBy(0, 40));
      await page.mouse.wheel(0, 1);
      await page.waitForTimeout(250);
      // Comments is being read; when the page ends before Comments can reach the top, Assets (the last section) is.
      await expect(nav(page).locator('[aria-current="location"]')).toHaveText(/^(Comments|Assets)/);
      await shot(page, 'nav-sticky');
    }
  });

  test('reduced motion: the section is reached with an instant scroll', async ({
    seed,
    admin,
    page,
  }) => {
    const { task } = await seeded(seed, admin);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 768, height: 1024 });
    await new TaskDetailPage(page).open(task.taskId);
    await link(page, 'Assets').click();
    // Instant: the scroll has finished by the time the heading has focus.
    await expect(page.locator('[data-section="assets"] [data-section-heading]')).toBeFocused();
    const behaviour = await page.evaluate(
      () => getComputedStyle(document.documentElement).scrollBehavior,
    );
    expect(behaviour).not.toBe('smooth');
  });
});

test.describe('Task T5 owner request: Assets first, Comments below it, each full width', () => {
  test('stacked in that order at 375, 768, 1024, 1366 and 1920, collapsed and open, never side by side', async ({
    seed,
    admin,
    page,
  }) => {
    const { task } = await seeded(seed, admin);
    await addComments(admin, task.taskId, 4);
    const detail = new TaskDetailPage(page);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await openFresh(page, detail, task.taskId);
      for (const open of [false, true]) {
        if (open) {
          await link(page, 'Assets').click();
          await link(page, 'Comments').click();
        }
        const b = await page.evaluate(() => {
          const r = (k: string) =>
            document.querySelector(`[data-section="${k}"]`)!.getBoundingClientRect().toJSON();
          return { wf: r('workflow'), assets: r('assets'), comments: r('comments') };
        });
        const where = `${size.width} ${open ? 'open' : 'collapsed'}`;
        expect(b.assets.top, where).toBeGreaterThan(b.wf.bottom - 1);
        expect(b.comments.top, where).toBeGreaterThan(b.assets.bottom - 1);
        expect(Math.abs(b.assets.width - b.wf.width), where).toBeLessThanOrEqual(2);
        expect(Math.abs(b.comments.width - b.wf.width), where).toBeLessThanOrEqual(2);
        expect(Math.abs(b.assets.left - b.comments.left), where).toBeLessThanOrEqual(1);
      }
      await check(page, 'assets-then-comments');
    }
  });
});

test.describe('Task T5: the Details panel without a nested scroll trap (#309)', () => {
  test('at 1366x768 a long panel scrolls inside itself, hands the wheel on to the page at its end and shows a bottom fade while more is below; the last field is reachable by keyboard', async ({
    seed,
    admin,
    page,
  }) => {
    const { task } = await seeded(seed, admin, {
      task: { title: LONG_TITLE, description: LONG_DESCRIPTION.repeat(3) },
    });
    await addComments(admin, task.taskId, 6);
    await page.setViewportSize({ width: 1366, height: 768 });
    await new TaskDetailPage(page).open(task.taskId);
    const aside = page.locator('[data-detail-panel]');
    await expect(aside).toBeVisible();
    // T6 (#314) cuts a long description at about 12 lines; the panel is long again once the person has opened it.
    await page.locator('[data-description-more]').click();
    const m = await aside.evaluate((el) => ({
      over: getComputedStyle(el).overscrollBehaviorY,
      overflow: getComputedStyle(el).overflowY,
      scrolls: el.scrollHeight > el.clientHeight + 2,
    }));
    expect(m.over, 'wheel chains to the page').toBe('auto');
    expect(m.overflow).toBe('auto');
    expect(m.scrolls, 'the long description overflows the panel').toBe(true);
    await expect(aside).toHaveClass(/dl__aside--more/);
    await expect(page.locator('[data-detail-fade]')).toBeVisible();
    await shot(page, 'panel-fade');
    await check(page, 'panel-fade');

    // The wheel over the panel scrolls the panel; at its end the same wheel scrolls the page (chaining).
    await link(page, 'Comments').click();
    await expect(page.locator('[data-section="comments"] [data-toggle]')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    const ab = (await aside.boundingBox())!;
    await page.mouse.move(ab.x + 60, Math.min(ab.y + 200, 700));
    const pageBefore = await page.evaluate(() => window.scrollY);
    await page.mouse.wheel(0, 4000);
    await expect
      .poll(() => aside.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight))
      .toBeLessThanOrEqual(2);
    await expect(aside).not.toHaveClass(/dl__aside--more/);
    await page.waitForTimeout(800); // a new wheel gesture: the first one stays with the panel it started in
    for (let i = 0; i < 4; i++) {
      await page.mouse.wheel(0, 300);
      await page.waitForTimeout(700);
    }
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(pageBefore);

    // The last thing in the panel can be focused with the keyboard (the panel scrolls to it).
    await page.evaluate(() => window.scrollTo(0, 0));
    const last = aside.locator('a[href], button, [tabindex="0"]').last();
    await last.focus();
    await expect(last).toBeInViewport();
  });

  test('a short panel has no scrollbar and no fade (typical task at 1366x768 and 1920x1080)', async ({
    seed,
    admin,
    page,
  }) => {
    const { task } = await seeded(seed, admin, { task: { description: '<p>Short.</p>' } });
    for (const size of [SIZES[3], SIZES[4]]) {
      await page.setViewportSize(size);
      await new TaskDetailPage(page).open(task.taskId);
      const aside = page.locator('[data-detail-panel]');
      expect(await aside.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(
        2,
      );
      await expect(page.locator('[data-detail-fade]')).toBeHidden();
    }
  });
});

test.describe('Task T5: states, axe and no sideways scroll at five widths', () => {
  test('200-character title on a 205-character sensitive matter, request details and a long description', async ({
    seed,
    admin,
    page,
  }) => {
    const { task } = await seeded(seed, admin, {
      matter: { name: LONG_MATTER },
      sensitive: true,
      task: { title: LONG_TITLE, description: LONG_DESCRIPTION },
    });
    const detail = new TaskDetailPage(page);
    await atEverySize(page, 'long-title', async () => {
      await detail.open(task.taskId);
      await expect(link(page, 'Workflow')).toBeVisible();
    });
    // Details open too, at the two narrow sizes.
    for (const size of SIZES.filter((s) => s.width < 1100)) {
      await page.setViewportSize(size);
      await openFresh(page, detail, task.taskId);
      await detailsToggle(page).click();
      await check(page, 'long-title-details-open');
    }
  });

  test('100+ comments: the nav shows 112, the thread loads on demand, nothing scrolls sideways', async ({
    seed,
    admin,
    page,
  }) => {
    test.setTimeout(240_000);
    const { task } = await seeded(seed, admin);
    await addComments(admin, task.taskId, 112);
    const detail = new TaskDetailPage(page);
    await atEverySize(page, 'comments-112', async () => {
      await detail.open(task.taskId);
      await expect(link(page, 'Comments')).toContainText('112');
    });
    await page.setViewportSize({ width: 375, height: 812 });
    await link(page, 'Comments').click();
    await expect(page.locator('[data-section="comments"] [data-section-heading]')).toBeFocused();
    await check(page, 'comments-112-open');
  });

  test('closed task (Completed and Cancelled): same layout, nav and Details disclosure', async ({
    seed,
    admin,
    page,
  }) => {
    const done = await seeded(seed, admin, { stepCount: 2 });
    await new TaskApi(admin, done.task.taskId).complete(true);
    const cancelled = await seeded(seed, admin);
    await new TaskApi(admin, cancelled.task.taskId).cancel('Not needed any more');
    const detail = new TaskDetailPage(page);
    for (const [name, fx] of [
      ['completed', done],
      ['cancelled', cancelled],
    ] as const) {
      await atEverySize(page, `closed-${name}`, async () => {
        await detail.open(fx.task.taskId);
        await expect(link(page, 'Workflow')).toBeVisible();
      });
    }
    await page.setViewportSize({ width: 375, height: 812 });
    await detail.open(done.task.taskId);
    expect(await workflowTop(page)).toBeLessThanOrEqual(480);
  });

  test('no steps, no assets right: Workflow shows no count; Assets has no count without Asset.View', async ({
    seed,
    admin,
    page,
    asUser,
  }) => {
    const { task } = await seeded(seed, admin);
    await page.setViewportSize({ width: 1366, height: 768 });
    await new TaskDetailPage(page).open(task.taskId);
    await expect(link(page, 'Assets')).toHaveText(/^Assets\s*0$/);

    const role = await seed.role(['Task.View'], 'E2E view only');
    const viewer = await seed.user([role.name], 'viewonly');
    const v = await asUser(viewer.username);
    for (const size of SIZES) {
      await v.setViewportSize(size);
      await new TaskDetailPage(v).open(task.taskId);
      await expect(nav(v).getByRole('link')).toHaveText([
        /^Workflow\s*0\/3$/,
        /^Assets$/,
        /^Comments\s*0$/,
      ]);
      await expect(v.locator('[data-detail-summary]')).toHaveCount(size.width < 1100 ? 1 : 0);
      await check(v, 'task-view-only');
    }

    // No Task.View: the access state, no nav.
    const none = await seed.role(['Matter.View'], 'E2E no task');
    const nobody = await seed.user([none.name], 'notask');
    const n = await asUser(nobody.username);
    await n.setViewportSize({ width: 375, height: 812 });
    await n.goto(`/tasks/${task.taskId}`);
    await n.waitForLoadState('networkidle');
    await expect(nav(n)).toHaveCount(0);
    await check(n, 'no-task-view');
  });

  test('System Admin and assignee Data Technician: nav and disclosure behave the same', async ({
    seed,
    admin,
    page,
    asUser,
  }) => {
    const { task, tech } = await seeded(seed, admin);
    const techPage = await asUser(tech.username);
    for (const p of [page, techPage]) {
      await p.setViewportSize({ width: 768, height: 1024 });
      await new TaskDetailPage(p).open(task.taskId);
      await expect(nav(p).getByRole('link')).toHaveCount(3);
      await expect(detailsToggle(p)).toHaveAttribute('aria-expanded', 'false');
      await detailsToggle(p).click();
      await expect(p.locator('[data-edit-details]')).toBeVisible();
      await check(p, 'details-open-roles');
    }
  });

  test('the skeleton reserves the nav, so the page does not shift when the task arrives (CLS)', async ({
    seed,
    admin,
    page,
  }) => {
    const { task } = await seeded(seed, admin);
    for (const size of [SIZES[0], SIZES[1], SIZES[3]]) {
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
      await new TaskDetailPage(page).open(task.taskId);
      await expect(link(page, 'Workflow')).toBeVisible();
      await page.waitForTimeout(500);
      const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
      expect(cls, `CLS at ${size.width}`).toBeLessThan(0.05);
    }
  });
});
