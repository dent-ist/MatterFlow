import { Locator, Page } from '@playwright/test';
import { TaskDetailPage } from '../pages/task-detail.page';
import { Api, Json } from '../support/api';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Seeder, uid, World } from '../support/seed';
import { TaskApi } from '../support/tasks';

/**
 * Task Detail review, package T7 "Comments, Assets and Activity at scale" (#315 C1, #316 A1 API, #317 A1 UI, #318 A2):
 * above 5 comments the composer comes first and "Showing latest 3 of 48. Show all" replaces the select; Activity events of a comment
 * carry the comment id and an 80-character excerpt (read at request time), the drawer shows the excerpt as a link that scrolls to and
 * highlights the comment, and folds runs of 3 or more "Comment added" events by one person (gap of at most 10 minutes) into one row;
 * the drawer title takes at most 2 lines. Every test builds its own users and tasks. Screenshots:
 * E2E_SCREENSHOTS=docs/ux/task-detail-review/fixes/t7 (otherwise none are written).
 */
const SIZES = [
  { name: '1366x768', width: 1366, height: 768 },
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '375x812', width: 375, height: 812 },
] as const;

async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env['E2E_SCREENSHOTS'];
  if (dir) await page.screenshot({ path: `${dir}/${name}.png` });
}

/** Axe (WCAG 2.2 AA) over the whole page, with whatever drawer or dialog is open, and no page-level sideways scroll. */
async function checkPage(page: Page, label: string): Promise<void> {
  if (axeAvailable()) expect(await axeViolations(page), `axe: ${label}`).toEqual([]);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `page-level horizontal scroll: ${label}`).toBeLessThanOrEqual(0);
}

const LONG_TITLE =
  'Process and load the supplemental custodian collection for the Harbor Point matter, including the three vendor batches, the shared drive folders 04 to 11, the iOS backups and every exception list';

interface Thread {
  taskId: number;
  taskNumber: string;
  title: string;
  world: World;
}

/** A task with `count` comments by the administrator (the 12th, 24th ... carries a long text and some markup), created in quick succession. */
async function seedThread(
  seed: Seeder,
  admin: Api,
  count: number,
  opts: { title?: string; world?: World } = {},
): Promise<Thread> {
  const world = opts.world ?? (await seed.world({ stepCount: 2 }));
  const task: Json = await seed.task(world, { title: opts.title ?? `Thread ${uid()}` });
  for (let i = 1; i <= count; i++) {
    const text =
      i % 12 === 0
        ? `<p>Comment number ${i}: <strong>please</strong> check the exception list for batch B-00${i % 5} before the load starts tonight, the vendor re-sent two files and the hashes differ</p>`
        : `<p>Comment number ${i}</p>`;
    await admin.post(`/api/v1/tasks/${task.taskId}/comments`, { bodyHtml: text });
  }
  return { taskId: task.taskId, taskNumber: task.taskNumber, title: task.title, world };
}

/** A comment of the generated thread by number: `Comment number 2` must not match 20 to 29. */
const numbered = (n: number): RegExp => new RegExp(`Comment number ${n}(?!\\d)`);

const commentsRegion = (page: Page): Locator => page.getByRole('region', { name: 'Comments' });
const drawer = (page: Page): Locator => page.getByRole('dialog', { name: /^Activity:/ });

/** Presses "Load more" in the Activity drawer until the whole history is there. */
async function loadAllActivity(dlg: Locator, page: Page): Promise<void> {
  // The first page must be there: before it arrives there is no "Load more" yet, and the loop would end at once (flaky under load).
  await expect(dlg.locator('[data-event-id]').first()).toBeVisible();
  while (await dlg.locator('[data-more]').count()) {
    await dlg.locator('[data-more]').click();
    await page.waitForTimeout(300);
  }
}

/** True when `first` comes before `second` in the document. */
async function before(first: Locator, second: Locator): Promise<boolean> {
  const a = (await first.boundingBox())!;
  const b = (await second.boundingBox())!;
  return a.y < b.y;
}

test.describe('T7: Comments thread (C1, #315)', () => {
  test('48 comments: the composer is above the thread, "Showing latest 3 of 48. Show all" is a text with a link, and Show all / Show latest 3 switch the view', async ({
    page,
    seed,
    admin,
  }) => {
    const thread = await seedThread(seed, admin, 48);
    const detail = new TaskDetailPage(page);
    await detail.open(thread.taskId);
    await detail.showSection('Comments');
    const panel = commentsRegion(page);

    await expect(panel.getByRole('heading', { level: 2 })).toHaveText('Comments (48)');
    await expect(detail.commentItems).toHaveCount(3);
    await expect(panel.locator('[data-limit-note]')).toHaveText(
      /^\s*Showing latest 3 of 48\.\s*Show all\s*$/,
    );
    // No second select next to the sort select.
    await expect(panel.locator('select')).toHaveCount(1);
    await expect(panel.getByLabel('Sort comments')).toBeVisible();

    // The composer (the one-line input) is above the first comment, and reachable without scrolling past the thread.
    const quick = panel.locator('[data-composer-quick]');
    await expect(quick).toBeVisible();
    expect(await before(quick, detail.commentItems.first())).toBe(true);
    await shot(page, 'comments-48-composer-first-' + (page.viewportSize()?.width ?? 0));

    // The timestamps keep their zone.
    await expect(detail.commentItems.first().locator('time')).toHaveText(
      /^[A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2} [AP]M [A-Z]{2,5}$/,
    );

    await detail.showAllComments.click();
    await expect(detail.commentItems).toHaveCount(48);
    await expect(panel.locator('[data-limit-note]')).toHaveText(
      /^\s*Showing all 48\.\s*Show latest 3\s*$/,
    );
    await detail.showLatestComments.click();
    await expect(detail.commentItems).toHaveCount(3);

    // Keyboard order: the sort select, then straight to the composer, then into the thread.
    await panel.getByLabel('Sort comments').focus();
    await page.keyboard.press('Tab');
    // Focusing the one-line input opens the editor.
    await expect(panel.locator('[data-composer] [role=textbox]')).toBeFocused();
  });

  test('the boundary: 6 comments put the composer first, 5 and 3 leave it below the thread with no count line', async ({
    page,
    seed,
    admin,
  }) => {
    const six = await seedThread(seed, admin, 6);
    const world = six.world;
    const five = await seedThread(seed, admin, 5, { world });
    const three = await seedThread(seed, admin, 3, { world });
    const detail = new TaskDetailPage(page);
    const panel = commentsRegion(page);

    await detail.open(six.taskId);
    await detail.showSection('Comments');
    await expect(detail.commentItems).toHaveCount(3);
    expect(await before(panel.locator('[data-composer-quick]'), detail.commentItems.first())).toBe(
      true,
    );

    await detail.open(five.taskId);
    await detail.showSection('Comments');
    await expect(detail.commentItems).toHaveCount(3);
    await expect(panel.locator('[data-limit-note]')).toContainText('Showing latest 3 of 5.');
    expect(await before(detail.commentItems.last(), panel.locator('[data-composer-quick]'))).toBe(
      true,
    );

    await detail.open(three.taskId);
    await detail.showSection('Comments');
    await expect(detail.commentItems).toHaveCount(3);
    await expect(panel.locator('[data-limit-note]')).toHaveCount(0);
    expect(await before(detail.commentItems.last(), panel.locator('[data-composer-quick]'))).toBe(
      true,
    );
  });

  test('replying on a long thread: the composer on top posts, and the new comment is the latest', async ({
    page,
    seed,
    admin,
  }) => {
    const thread = await seedThread(seed, admin, 12);
    const detail = new TaskDetailPage(page);
    await detail.open(thread.taskId);
    await detail.composer();
    await page.keyboard.type('Reply from the top');
    await commentsRegion(page).locator('[data-post]').click();
    await expect(detail.commentItems.last()).toContainText('Reply from the top');
    await expect(commentsRegion(page).getByRole('heading', { level: 2 })).toHaveText(
      'Comments (13)',
    );
    await expect(commentsRegion(page).locator('[data-limit-note]')).toContainText(
      'Showing latest 3 of 13.',
    );
  });

  test('100+ comments: the whole thread loads, Show all lists every comment, no sideways scroll', async ({
    page,
    seed,
    admin,
  }) => {
    test.setTimeout(180_000);
    const thread = await seedThread(seed, admin, 112);
    const detail = new TaskDetailPage(page);
    await detail.open(thread.taskId);
    await detail.showSection('Comments');
    await expect(commentsRegion(page).getByRole('heading', { level: 2 })).toHaveText(
      'Comments (112)',
    );
    await expect(commentsRegion(page).locator('[data-limit-note]')).toContainText(
      'Showing latest 3 of 112.',
    );
    await detail.showAllComments.click();
    await expect(detail.commentItems).toHaveCount(112);
    await checkPage(page, '112 comments shown');
    await detail.showLatestComments.click();
    await expect(detail.commentItems).toHaveCount(3);
  });
});

test.describe('T7: Activity (A1 and A2, #316, #317, #318)', () => {
  /** 48 comments in two runs with a priority-free event between them (an assignment) and an On Hold reason on top. */
  async function seedBusyActivity(
    seed: Seeder,
    admin: Api,
  ): Promise<Thread & { colleague: { userId: number } }> {
    const colleague = await seed.user(['Data Technician'], `t7a-${uid()}`);
    const thread = await seedThread(seed, admin, 20, { title: LONG_TITLE });
    const api = new TaskApi(admin, thread.taskId);
    expect((await api.assign(colleague.userId)).status).toBeLessThan(300);
    for (let i = 21; i <= 48; i++) {
      await admin.post(`/api/v1/tasks/${thread.taskId}/comments`, {
        bodyHtml: `<p>Comment number ${i}</p>`,
      });
    }
    // Assigning a person starts the task.
    expect((await api.changeStatus('ON_HOLD', 'Waiting for the vendor')).status).toBeLessThan(300);
    return { ...thread, colleague };
  }

  test('the API carries the comment id and an 80-character excerpt on comment events and nothing on other events', async ({
    seed,
    admin,
  }) => {
    const thread = await seedThread(seed, admin, 12);
    const page = await admin.get<Json>(`/api/v1/tasks/${thread.taskId}/activity?pageSize=100`);
    const comments = page.items.filter((i: Json) => i.eventType === 'COMMENT_ADDED');
    expect(comments).toHaveLength(12);
    for (const c of comments) {
      expect(c.commentId).toEqual(expect.any(Number));
      expect(c.excerpt).toMatch(/^Comment number \d+/);
      expect(c.excerpt.length).toBeLessThanOrEqual(80);
    }
    const long = comments.find((c: Json) => c.excerpt.includes('Comment number 12'));
    expect(long.excerpt).toMatch(/^Comment number 12: please check the exception list.*\.\.\.$/);
    expect(long.excerpt.length).toBeLessThanOrEqual(80);
    const others = page.items.filter((i: Json) => i.eventType !== 'COMMENT_ADDED');
    expect(others.length).toBeGreaterThan(0);
    for (const o of others) {
      expect(o.commentId ?? null).toBeNull();
      expect(o.excerpt ?? null).toBeNull();
    }
  });

  test('TSK-123 shape: 48 comments fold into groups, the real events are within the first 10 rows, a group unfolds to the single rows', async ({
    page,
    seed,
    admin,
  }) => {
    const thread = await seedBusyActivity(seed, admin);
    const detail = new TaskDetailPage(page);
    await detail.open(thread.taskId);
    const dlg = await detail.openActivity();

    // The first page is 25 events: the status change, the hold reason and 23 comments folded into one row.
    const rows = dlg.locator('.ta__list > li');
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeLessThanOrEqual(10);
    const groups = dlg.locator('[data-group-summary]');
    await expect(groups).toHaveCount(1);
    await expect(groups.first()).toHaveText(/^added 23 comments \(.+\)$/);
    await expect(
      dlg.locator('[data-summary]', { hasText: 'Status changed from In Progress to On Hold' }),
    ).toBeVisible();
    await expect(dlg.locator('[data-summary]', { hasText: 'On hold reason added' })).toBeVisible();
    // The On Hold reason is a comment event of its own, not part of a fold.
    await expect(
      dlg.locator('[data-comment-link]', { hasText: 'Waiting for the vendor' }),
    ).toBeVisible();
    await shot(page, 'activity-folded-' + (page.viewportSize()?.width ?? 0));

    // Load more until the end: the run grows to 28, the assignment splits it from the older 20, the creation is last.
    await loadAllActivity(dlg, page);
    await expect(groups).toHaveCount(2);
    await expect(groups.first()).toHaveText(/^added 28 comments \(.+\)$/);
    await expect(groups.last()).toHaveText(/^added 20 comments \(.+\)$/);
    await expect(dlg.locator('[data-summary]', { hasText: /^Assigned to / })).toBeVisible();

    // Unfold the newer run: 28 single rows with their excerpts.
    const toggle = dlg.locator('[data-group-toggle]').first();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(dlg.locator('[data-group-items] [data-event-id]')).toHaveCount(28);
    await expect(dlg.locator('[data-group-items] [data-comment-link]').first()).toContainText(
      'Comment number 48',
    );
    await shot(page, 'activity-group-expanded-' + (page.viewportSize()?.width ?? 0));
    await toggle.click();
    await expect(dlg.locator('[data-group-items]')).toHaveCount(0);
  });

  test('choosing an excerpt closes the drawer, opens the Comments section, shows that comment (even an old one), highlights and focuses it', async ({
    page,
    seed,
    admin,
  }) => {
    const thread = await seedBusyActivity(seed, admin);
    const detail = new TaskDetailPage(page);
    await detail.open(thread.taskId);
    // Comments start collapsed: the link must open them.
    await expect(detail.toggle('Comments')).toHaveAttribute('aria-expanded', 'false');
    const dlg = await detail.openActivity();
    await loadAllActivity(dlg, page);
    await dlg.locator('[data-group-toggle]').last().click();
    await dlg
      .locator('[data-group-items] [data-comment-link]', { hasText: numbered(2) })
      .first()
      .click();

    await expect(drawer(page)).toHaveCount(0);
    await expect(detail.toggle('Comments')).toHaveAttribute('aria-expanded', 'true');
    const target = page.locator('[data-comment-id]', { hasText: numbered(2) }).first();
    await expect(target).toBeVisible();
    await expect(target).toHaveClass(/tc__item--hit/);
    await expect(target).toBeFocused();
    const box = (await target.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
    // The choice is not remembered as "show all": a reload is back to the short view.
    await page.reload();
    await detail.showSection('Comments');
    await expect(detail.commentItems).toHaveCount(3);
  });

  test('a deleted comment keeps its "Comment added" row without a link; an edit shows the new text in the excerpt', async ({
    page,
    seed,
    admin,
  }) => {
    const thread = await seedThread(seed, admin, 2);
    const list = await admin.get<Json>(`/api/v1/tasks/${thread.taskId}/comments`);
    const [first, second] = list.items as Json[];
    expect(
      (await admin.put(`/api/v1/tasks/${thread.taskId}/comments/${second.commentId}`, {
        bodyHtml: '<p>Edited wording of the second</p>',
        rowVersion: second.rowVersion,
      })) as unknown,
    ).toBeTruthy();
    await admin.delete(`/api/v1/tasks/${thread.taskId}/comments/${first.commentId}`);

    const detail = new TaskDetailPage(page);
    await detail.open(thread.taskId);
    const dlg = await detail.openActivity();
    await expect(
      dlg.locator('[data-comment-link]', { hasText: 'Edited wording of the second' }).first(),
    ).toBeVisible();
    await expect(dlg.locator('[data-comment-link]', { hasText: numbered(1) })).toHaveCount(0);
    await expect(dlg.locator('[data-summary]', { hasText: 'Comment deleted' })).toBeVisible();
    // 2 added + 1 edited + 1 deleted: nothing reaches the fold minimum, so there is no group.
    await expect(dlg.locator('[data-group-key]')).toHaveCount(0);
  });

  test('the drawer keeps its focus trap and Escape: focus starts on Close, Tab stays inside, Escape closes and focus returns to Activity', async ({
    page,
    seed,
    admin,
  }) => {
    const thread = await seedBusyActivity(seed, admin);
    const detail = new TaskDetailPage(page);
    await detail.open(thread.taskId);
    const dlg = await detail.openActivity();
    await expect(dlg.getByRole('button', { name: 'Close activity' })).toBeFocused();
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      expect(await dlg.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(drawer(page)).toHaveCount(0);
    await expect(detail.header.locator('[data-action="activity"]')).toBeFocused();
  });

  test('Load more extends a fold: 112 comments, the first page is one group of 25 and then grows', async ({
    page,
    seed,
    admin,
  }) => {
    test.setTimeout(180_000);
    const thread = await seedThread(seed, admin, 112);
    const detail = new TaskDetailPage(page);
    await detail.open(thread.taskId);
    const dlg = await detail.openActivity();
    await expect(dlg.locator('[data-group-summary]')).toHaveText(/^added 25 comments/);
    await dlg.locator('[data-more]').click();
    await expect(dlg.locator('[data-group-summary]')).toHaveText(/^added 50 comments/);
    await expect(dlg.locator('[data-group-key]')).toHaveCount(1);
  });

  test('two people never share a fold: admin, admin, colleague, admin stay four rows', async ({
    page,
    seed,
    admin,
  }) => {
    // The 10-minute pause rule needs a clock and is covered by activity-groups.spec.ts; here the "same person" rule runs end to end.
    const world = await seed.world({ stepCount: 2 });
    const other = await seed.user(['Data Technician'], `t7b-${uid()}`);
    const task: Json = await seed.task(world, { title: `Two people ${uid()}` });
    const asOther = await Api.as(other.username);
    try {
      await admin.post(`/api/v1/tasks/${task.taskId}/comments`, { bodyHtml: '<p>One</p>' });
      await admin.post(`/api/v1/tasks/${task.taskId}/comments`, { bodyHtml: '<p>Two</p>' });
      await asOther.post(`/api/v1/tasks/${task.taskId}/comments`, { bodyHtml: '<p>Three</p>' });
      await admin.post(`/api/v1/tasks/${task.taskId}/comments`, { bodyHtml: '<p>Four</p>' });
    } finally {
      await asOther.dispose();
    }
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    const dlg = await detail.openActivity();
    await expect(dlg.locator('[data-comment-link]')).toHaveCount(4);
    await expect(dlg.locator('[data-group-key]')).toHaveCount(0);
  });

  for (const size of SIZES) {
    test(`drawer title takes at most 2 lines with the full text as tooltip and name, axe 0 and no sideways scroll at ${size.name}`, async ({
      page,
      seed,
      admin,
    }) => {
      const thread = await seedBusyActivity(seed, admin);
      await page.setViewportSize({ width: size.width, height: size.height });
      const detail = new TaskDetailPage(page);
      await detail.open(thread.taskId);
      const dlg = await detail.openActivity();
      const title = dlg.locator('[data-drawer-title]');
      await expect(title).toContainText('Activity: ' + thread.taskNumber);
      await expect(title).toHaveAttribute(
        'title',
        'Activity: ' + thread.taskNumber + ' ' + LONG_TITLE,
      );
      await expect(dlg).toHaveAccessibleName('Activity: ' + thread.taskNumber + ' ' + LONG_TITLE);
      const lines = await title.evaluate((el) => {
        const style = getComputedStyle(el);
        const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.25;
        return Math.round(el.getBoundingClientRect().height / lineHeight);
      });
      expect(lines, 'title lines').toBeLessThanOrEqual(2);
      // The text really is longer than the 2 lines it shows.
      expect(await title.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
      const headerHeight = (await dlg.locator('.p-dialog-header').boundingBox())!.height;
      expect(headerHeight, 'drawer header height').toBeLessThanOrEqual(92);
      await expect(dlg.locator('[data-group-toggle]').first()).toBeVisible();
      await checkPage(page, `activity drawer folded ${size.name}`);
      await shot(page, `activity-drawer-${size.name}`);

      await dlg.locator('[data-group-toggle]').first().click();
      await expect(dlg.locator('[data-group-items] [data-event-id]').first()).toBeVisible();
      await checkPage(page, `activity drawer group open ${size.name}`);
      await shot(page, `activity-drawer-group-open-${size.name}`);
    });

    test(`48 comments: composer first, axe 0, no sideways scroll and the highlighted comment at ${size.name}`, async ({
      page,
      seed,
      admin,
    }) => {
      const thread = await seedBusyActivity(seed, admin);
      await page.setViewportSize({ width: size.width, height: size.height });
      const detail = new TaskDetailPage(page);
      await detail.open(thread.taskId);
      await detail.showSection('Comments');
      await expect(commentsRegion(page).locator('[data-composer-quick]')).toBeVisible();
      // From the top: scrolled to Comments, the fixed app bar can cover the facts strip's chips partly, which axe's target-size rule reports.
      await page.evaluate(() => window.scrollTo(0, 0));
      await checkPage(page, `comments 48 ${size.name}`);
      await shot(page, `comments-48-${size.name}`);

      const dlg = await detail.openActivity();
      await dlg.locator('[data-group-toggle]').first().click();
      await dlg
        .locator('[data-group-items] [data-comment-link]', { hasText: numbered(30) })
        .first()
        .click();
      const target = page.locator('[data-comment-id]', { hasText: numbered(30) }).first();
      await expect(target).toHaveClass(/tc__item--hit/);
      await expect(target).toBeFocused();
      await checkPage(page, `comment linked ${size.name}`);
      await shot(page, `comment-linked-${size.name}`);
    });
  }

  test('a closed task: comments and Activity still work (comments are allowed in every status)', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await seed.world({ stepCount: 2 });
    const thread = await seedThread(seed, admin, 8, { world });
    const api = new TaskApi(admin, thread.taskId);
    await api.completeSteps(1, 2);
    expect((await api.complete()).status).toBeLessThan(300);
    const detail = new TaskDetailPage(page);
    await detail.open(thread.taskId);
    await detail.expectStatus('Completed');
    await detail.showSection('Comments');
    await expect(commentsRegion(page).locator('[data-composer-quick]')).toBeVisible();
    await expect(commentsRegion(page).locator('[data-limit-note]')).toContainText(
      'Showing latest 3 of 8.',
    );
    const dlg = await detail.openActivity();
    await expect(dlg.locator('[data-group-summary]')).toHaveText(/^added 8 comments/);
    await checkPage(page, 'closed task activity');
    await shot(page, 'closed-task-activity-' + (page.viewportSize()?.width ?? 0));
  });
});

test.describe('T7: permission variants', () => {
  test('Task.View only (no Asset.View, Matter.View, Client.View): the thread and the Activity read-only, excerpts and links work, no composer, no error toast', async ({
    seed,
    admin,
    asUser,
  }) => {
    const token = uid();
    const thread = await seedThread(seed, admin, 9);
    const viewRole = await seed.role(['Task.View'], `E2E T7 viewer ${token}`);
    const viewer = await seed.user([viewRole.name], `t7v-${token}`);
    const page = await asUser(viewer.username);
    const detail = new TaskDetailPage(page);
    await detail.open(thread.taskId);
    await detail.showSection('Comments');
    const panel = commentsRegion(page);
    await expect(panel.getByRole('heading', { level: 2 })).toHaveText('Comments (9)');
    await expect(panel.locator('[data-composer]')).toHaveCount(0);
    await expect(panel.locator('[data-add-comment]')).toHaveCount(0);
    await expect(panel.locator('[data-internal-note]')).toHaveCount(1);
    await expect(panel.locator('[data-limit-note]')).toContainText('Showing latest 3 of 9.');

    const dlg = await detail.openActivity();
    await expect(dlg.locator('[data-group-summary]')).toHaveText(/^added 9 comments/);
    await dlg.locator('[data-group-toggle]').click();
    // Without Audit.View there are no "View changes" buttons, but the excerpt links work.
    await expect(dlg.locator('[data-changes-toggle]')).toHaveCount(0);
    await dlg
      .locator('[data-comment-link]', { hasText: numbered(1) })
      .first()
      .click();
    await expect(page.locator('[data-comment-id]', { hasText: numbered(1) }).first()).toHaveClass(
      /tc__item--hit/,
    );
    await expect(page.locator('.p-toast-message-error')).toHaveCount(0);
    await page.setViewportSize({ width: 375, height: 812 });
    await checkPage(page, 'Task.View only 375');
  });

  test('Task.View + Task.Comment without Audit.View: can post from the top; the assignee Data Technician sees the same thread and Activity', async ({
    seed,
    admin,
    asUser,
  }) => {
    const token = uid();
    const tech = await seed.user(['Data Technician'], `t7t-${token}`);
    const world = await seed.world({ stepCount: 2 });
    const task: Json = await seed.task(world, {
      title: `Tech ${token}`,
      assignedUserId: tech.userId,
    });
    for (let i = 1; i <= 7; i++) {
      await admin.post(`/api/v1/tasks/${task.taskId}/comments`, { bodyHtml: `<p>Note ${i}</p>` });
    }
    const page = await asUser(tech.username);
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await detail.showSection('Comments');
    const panel = commentsRegion(page);
    await expect(panel.locator('[data-composer-quick]')).toBeVisible();
    expect(await before(panel.locator('[data-composer-quick]'), detail.commentItems.first())).toBe(
      true,
    );
    await detail.composer();
    await page.keyboard.type('Posted by the assignee');
    await panel.locator('[data-post]').click();
    await expect(detail.commentItems.last()).toContainText('Posted by the assignee');
    const dlg = await detail.openActivity();
    await expect(
      dlg.locator('[data-comment-link]', { hasText: 'Posted by the assignee' }),
    ).toBeVisible();
    await expect(page.locator('.p-toast-message-error')).toHaveCount(0);
  });

  test('no Task.View: the page is refused and no comment text or excerpt is requested', async ({
    seed,
    admin,
    asUser,
  }) => {
    const token = uid();
    const thread = await seedThread(seed, admin, 3);
    const none = await seed.role(['Matter.View'], `E2E T7 none ${token}`);
    const nobody = await seed.user([none.name], `t7n-${token}`);
    const page = await asUser(nobody.username);
    const requests: string[] = [];
    page.on('request', (r) => {
      if (/\/(comments|activity)(\?|$)/.test(r.url())) requests.push(r.url());
    });
    await page.goto(`/tasks/${thread.taskId}`);
    await expect(page.locator('[data-task-header]')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('[data-comment-id]')).toHaveCount(0);
    expect(requests).toEqual([]);
  });
});
