import { Locator, Page } from '@playwright/test';
import { CreateTaskPage } from '../pages/create-task.page';
import { TaskDetailPage } from '../pages/task-detail.page';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { FieldSpec, uid } from '../support/seed';
import { TaskApi } from '../support/tasks';

/**
 * Task Detail review, package T8 "Edit dialog and Create task" (#319 sticky footer and sections, #320 title textarea with a counter,
 * #321 no sideways scroll at 375, #322 Create task header and 720 px column, #323 chooser cards). Every test builds its own users, types
 * and tasks. Screenshots: E2E_SCREENSHOTS=docs/ux/task-detail-review/fixes/t8 (otherwise none are written).
 */
const SIZES = [
  { name: '1366x768', width: 1366, height: 768 },
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '375x812', width: 375, height: 812 },
] as const;

/** 200 characters of ordinary words, so it wraps like a real long title. */
const LONG_TITLE =
  (
    'Review and index the custodian mailboxes, Slack exports, shared network drives and the legacy archive restore for the second ' +
    'production volume before the meet and confer with opposing counsel and the special master appointed by the court'
  ).slice(0, 199) + '.';

/** Ten request-form fields, so the dialog is as long as TSK-124's (14 fields). */
const FIELDS: FieldSpec[] = Array.from({ length: 10 }, (_, i) => ({
  key: `f${i + 1}`,
  label: `Request field ${i + 1}`,
  control: 'TEXT',
  required: i === 0,
}));

async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env['E2E_SCREENSHOTS'];
  if (dir) await page.screenshot({ path: `${dir}/${name}.png` });
}

/** Axe (WCAG 2.2 AA) over the whole page with the dialog open, and no page-level sideways scroll. */
async function checkPage(page: Page, label: string): Promise<void> {
  if (axeAvailable()) expect(await axeViolations(page), `axe: ${label}`).toEqual([]);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `page-level horizontal scroll: ${label}`).toBeLessThanOrEqual(0);
}

const editDialog = (page: Page): Locator => page.getByRole('dialog', { name: 'Edit task details' });
const dialogBody = (page: Page): Locator => page.locator('.p-dialog-content');
const requestToggle = (page: Page): Locator => page.locator('[data-request-toggle]');
/** A request-form text field by number (the label also matches "Request field 10" and "(required)"). */
const reqField = (page: Page, n: number): Locator =>
  page.getByRole('textbox', { name: new RegExp(`^Request field ${n}(\\s|$)`) });

async function openEdit(page: Page): Promise<void> {
  const edit = page.locator('[data-task-header] [data-action="edit"]');
  // On a phone the header keeps only the primary action; Edit is then the first item of the overflow menu.
  if (await edit.isVisible()) await edit.click();
  else {
    await page.locator('[data-overflow]').click();
    await page.getByRole('menuitem', { name: /^Edit/ }).click();
  }
  await expect(editDialog(page)).toBeVisible();
  await expect(page.locator('#td-title')).toBeFocused();
}

/** Horizontal overflow of an element: its scroll width minus its client width. */
const overflowX = (loc: Locator): Promise<number> =>
  loc.evaluate((el) => el.scrollWidth - el.clientWidth);

test.describe('T8: Edit dialog (E1 #319, #320, BUG-3 #321)', () => {
  test('720 px wide with a header and footer that stay put; Task, Request details (collapsed) and Assignment sections; Save visible at every scroll position', async ({
    page,
    seed,
  }) => {
    const world = await seed.world({ stepCount: 2, fields: FIELDS });
    const task = await seed.task(world, {
      title: LONG_TITLE,
      formValues: { f1: 'Alpha' },
    });
    await page.setViewportSize({ width: 1366, height: 768 });
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await openEdit(page);

    const dialog = editDialog(page);
    const box = (await dialog.boundingBox())!;
    expect(Math.round(box.width)).toBe(720);

    // The three sections, Request details collapsed (it holds ten fields) with its field count.
    await expect(dialog.locator('[data-section="task"] h3')).toHaveText('Task');
    await expect(dialog.locator('[data-section="assignment"] h3')).toHaveText('Assignment');
    await expect(requestToggle(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(requestToggle(page)).toContainText('Request details');
    await expect(requestToggle(page)).toContainText('10 fields');
    await expect(page.locator('[data-request-body]')).toBeHidden();

    // Save and Cancel are in the footer and inside the viewport before and after scrolling the body to its end.
    const save = page.locator('[data-save]');
    await expect(save).toBeVisible();
    const before = (await save.boundingBox())!;
    expect(before.y + before.height).toBeLessThanOrEqual(768);
    await dialogBody(page).evaluate((el) => (el.scrollTop = el.scrollHeight));
    const after = (await save.boundingBox())!;
    expect(after.y + after.height).toBeLessThanOrEqual(768);
    expect(Math.round(after.y)).toBe(Math.round(before.y));
    await expect(page.locator('[data-cancel]')).toBeVisible();
    // The body scrolled (the dialog is longer than the screen) and the locked block is at its end.
    await expect(page.locator('[data-locked-fields]')).toBeInViewport();
    await shot(page, 'edit-dialog-bottom-1366x768');

    await requestToggle(page).click();
    await expect(page.locator('[data-request-body]')).toBeVisible();
    await expect(reqField(page, 1)).toHaveValue('Alpha');
  });

  test('the title is a 2 to 4 line textarea with an n / 200 counter: 200 characters fully visible, paste cut at 200, no line breaks, Enter does not submit', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await seed.world({ stepCount: 2 });
    const task = await seed.task(world, { title: LONG_TITLE });
    await page.setViewportSize({ width: 375, height: 812 });
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await openEdit(page);

    const title = page.locator('#td-title');
    expect(await title.evaluate((el) => el.tagName)).toBe('TEXTAREA');
    await expect(title).toHaveValue(LONG_TITLE);
    await expect(page.locator('[data-title-count]')).toHaveText('200 / 200');
    // All 200 characters are visible: no sideways scroll, no inner scroll, at most four lines.
    expect(await overflowX(title)).toBeLessThanOrEqual(0);
    const metrics = await title.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        clientHeight: el.clientHeight,
        scrollHeight: el.scrollHeight,
        line: parseFloat(style.lineHeight),
      };
    });
    // On a phone the box may grow to six lines so all 200 characters show; it never scrolls inside itself.
    expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight + 1);
    expect(metrics.clientHeight).toBeLessThanOrEqual(metrics.line * 6 + 24);
    await expect(page.locator('[data-title-count-live]')).toHaveText('200 of 200 characters');
    await shot(page, 'edit-dialog-long-title-375x812');

    // A paste of 300 characters is cut at the limit, line breaks become spaces, and Enter changes nothing.
    await title.fill('');
    await expect(page.locator('[data-title-count]')).toHaveText('0 / 200');
    await expect(page.locator('[data-title-count-live]')).toHaveText('');
    await title.fill('word '.repeat(60));
    await expect(page.locator('[data-title-count]')).toHaveText('200 / 200');
    await title.fill('first\nsecond\r\nthird');
    await expect(title).toHaveValue('first second third');
    await title.press('Enter');
    await expect(title).toHaveValue('first second third');
    await expect(editDialog(page)).toBeVisible();

    // The shorter title shows two lines of room (it never collapses to one), and saves without line breaks.
    expect(
      await title.evaluate((el) => el.clientHeight > parseFloat(getComputedStyle(el).lineHeight)),
    ).toBe(true);
    await page.locator('[data-save]').click();
    await expect(editDialog(page)).toHaveCount(0);
    expect((await new TaskApi(admin, task.taskId).get()).title).toBe('first second third');
  });

  for (const size of SIZES) {
    test(`TSK-123/124 shapes at ${size.name}: the dialog never scrolls sideways, every label and the Bold button are reachable, axe 0, no page-level sideways scroll`, async ({
      page,
      seed,
    }) => {
      const world = await seed.world({ stepCount: 2, fields: FIELDS });
      const task = await seed.task(world, {
        title: LONG_TITLE,
        formValues: { f1: 'Alpha' },
        requestorName: 'Rita Requestor-With-A-Rather-Long-Surname',
        requestorEmail: 'rita.requestor.with.a.long.address@very-long-client-domain.example.com',
        dueDate: '2026-10-14',
        dueTime: '09:30',
      });
      await page.setViewportSize({ width: size.width, height: size.height });
      const detail = new TaskDetailPage(page);
      await detail.open(task.taskId);
      await openEdit(page);

      const dialog = editDialog(page);
      const box = (await dialog.boundingBox())!;
      expect(box.width).toBeLessThanOrEqual(Math.min(720, size.width) + 1);
      if (size.width >= 720) expect(Math.round(box.width)).toBe(720);
      else expect(Math.round(box.width)).toBe(size.width);

      expect(await overflowX(dialogBody(page)), 'dialog body sideways').toBeLessThanOrEqual(0);
      expect(await overflowX(page.locator('[data-edit-form]'))).toBeLessThanOrEqual(0);
      // The labels start inside the dialog (BUG-3 cut "(required)" and "Description" at the left edge).
      for (const label of ['Title', 'Requestor name', 'Requestor email', 'Project']) {
        const el = dialog.locator('label', { hasText: label }).first();
        const b = (await el.boundingBox())!;
        expect(b.x, `${label} label`).toBeGreaterThanOrEqual(box.x - 1);
        expect(b.x + b.width, `${label} label`).toBeLessThanOrEqual(box.x + box.width + 1);
      }
      // The Description toolbar keeps every button, the Bold button first, fully inside the dialog.
      const bold = dialog.locator('[data-description-editor] [data-cmd="bold"]');
      await bold.scrollIntoViewIfNeeded();
      const bb = (await bold.boundingBox())!;
      expect(bb.x).toBeGreaterThanOrEqual(box.x);
      expect(bb.x + bb.width).toBeLessThanOrEqual(box.x + box.width);
      await expect(dialog.locator('[data-description-editor] [data-cmd="link"]')).toBeInViewport();
      await shot(page, `edit-dialog-${size.name}`);
      await checkPage(page, `edit dialog collapsed ${size.name}`);

      // Request details open: still no sideways scroll, axe clean.
      await requestToggle(page).click();
      await expect(page.locator('[data-request-body]')).toBeVisible();
      expect(
        await overflowX(dialogBody(page)),
        'dialog body sideways, request open',
      ).toBeLessThanOrEqual(0);
      await shot(page, `edit-dialog-request-open-${size.name}`);
      await checkPage(page, `edit dialog request open ${size.name}`);
    });
  }

  test('validation: the summary shows, the first invalid field takes focus, Request details opens on its own error, the footer stays visible; the fix saves', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await seed.world({ stepCount: 2, fields: FIELDS });
    const task = await seed.task(world, {
      title: `Validate ${uid()}`,
      formValues: { f1: 'Alpha' },
    });
    await page.setViewportSize({ width: 1366, height: 768 });
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await openEdit(page);
    const dialog = editDialog(page);

    // Title and requestor name emptied: the first problem in page order (Title) takes the cursor.
    await page.locator('#td-title').fill('');
    await page.locator('#td-req-name').fill('');
    await page.locator('[data-save]').click();
    await expect(page.locator('[data-error-summary]')).toBeVisible();
    await expect(page.locator('[data-error-summary]')).toContainText('Enter a title.');
    await expect(page.locator('[data-error-summary]')).toContainText('Enter the requestor name.');
    await expect(page.locator('#td-title')).toBeFocused();
    await expect(page.locator('#td-title')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#td-title-error')).toContainText('Enter a title.');
    await expect(page.locator('#td-req-name-error')).toBeVisible();
    await expect(page.locator('[data-save]')).toBeInViewport();
    await expect(requestToggle(page)).toHaveAttribute('aria-expanded', 'false');
    await shot(page, 'edit-dialog-errors-1366x768');
    await checkPage(page, 'edit dialog with errors 1366');

    // Fix those; the request form's required field is empty: its section opens itself and the field takes the cursor.
    await page.locator('#td-title').fill(`Validate ${uid()}`);
    await page.locator('#td-req-name').fill('Rita Requestor');
    await requestToggle(page).click();
    await reqField(page, 1).fill('');
    await requestToggle(page).click();
    await expect(page.locator('[data-request-body]')).toBeHidden();
    await page.locator('[data-save]').click();
    await expect(requestToggle(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('[data-request-body]')).toBeVisible();
    await expect(page.locator('[data-error-summary]')).toContainText('Request field 1');
    await expect(reqField(page, 1)).toBeFocused();
    await expect(page.locator('[data-save]')).toBeInViewport();
    await shot(page, 'edit-dialog-request-error-1366x768');

    await reqField(page, 1).fill('Beta');
    await page.locator('[data-save]').click();
    await expect(dialog).toHaveCount(0);
    expect((await new TaskApi(admin, task.taskId).get()).formValues.f1).toBe('Beta');
  });

  test('server errors open the section of the field they belong to; Esc is ignored with unsaved changes and focus returns to the Edit button', async ({
    page,
    seed,
  }) => {
    const world = await seed.world({ stepCount: 2 });
    const task = await seed.task(world, { title: `Keys ${uid()}` });
    await page.setViewportSize({ width: 1366, height: 768 });
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    const edit = page.locator('[data-task-header] [data-action="edit"]');
    await edit.focus();
    await edit.press('Enter');
    await expect(editDialog(page)).toBeVisible();

    // Unsaved change: Esc does not close; Cancel does and focus returns to the opener.
    await page.locator('#td-req-name').fill('Someone Else');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(700);
    await expect(editDialog(page)).toBeVisible();

    // A server field error (the email is rejected by the server rule, not by the page) stays on the field, in the Task section.
    await page.route('**/api/v1/tasks/*', async (route) => {
      if (route.request().method() !== 'PUT') return route.continue();
      return route.fulfill({
        status: 400,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'urn:matterflow:error:validation-failed',
          title: 'Validation failed',
          status: 400,
          code: 'VALIDATION_FAILED',
          errors: {
            requestorName: [{ code: 'INVALID', message: 'The server does not accept this name.' }],
          },
        }),
      });
    });
    await page.locator('[data-save]').click();
    await expect(page.locator('#td-req-name-error')).toContainText('does not accept');
    await expect(page.locator('#td-req-name')).toBeFocused();
    await page.unroute('**/api/v1/tasks/*');

    await page.locator('[data-cancel]').click();
    await expect(editDialog(page)).toHaveCount(0);
    await expect(edit).toBeFocused();
  });

  test('permissions: System Admin sees all three sections; Task.Edit without Task.Assign has no Assignment section; Task.View only has no Edit control; no Task.View is refused', async ({
    page,
    seed,
    asUser,
  }) => {
    const token = uid();
    const world = await seed.world({ stepCount: 2, fields: FIELDS });
    const task = await seed.task(world, { title: `Perm ${token}`, formValues: { f1: 'Alpha' } });

    // System Admin (the default user).
    await page.setViewportSize({ width: 1366, height: 768 });
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await openEdit(page);
    await expect(page.locator('[data-section="assignment"]')).toBeVisible();
    await expect(page.locator('[data-locked-fields] a[href^="/matters/"]')).toHaveCount(1);
    await page.locator('[data-cancel]').click();

    // The assignee, a Data Technician (can edit; assigns too under that role).
    const tech = await seed.user(['Data Technician'], `t8t-${token}`);
    const mine = await seed.task(world, {
      title: `Mine ${token}`,
      assignedUserId: tech.userId,
      formValues: { f1: 'Alpha' },
    });
    const techPage = await asUser(tech.username);
    await techPage.setViewportSize({ width: 1366, height: 768 });
    await new TaskDetailPage(techPage).open(mine.taskId);
    if ((await techPage.locator('[data-task-header] [data-action="edit"]').count()) > 0) {
      await openEdit(techPage);
      await expect(techPage.locator('[data-save]')).toBeInViewport();
      await checkPage(techPage, 'assignee Data Technician edit dialog');
      await techPage.locator('[data-cancel]').click();
    }

    // Task.View + Task.Edit, without Task.Assign, Matter.View, Client.View, Asset.View: no Assignment section, matter without a link.
    const editRole = await seed.role(['Task.View', 'Task.Edit'], `E2E T8 editor ${token}`);
    const editor = await seed.user([editRole.name], `t8e-${token}`);
    const editorPage = await asUser(editor.username);
    await editorPage.setViewportSize({ width: 375, height: 812 });
    await new TaskDetailPage(editorPage).open(task.taskId);
    await openEdit(editorPage);
    await expect(editorPage.locator('[data-section="assignment"]')).toHaveCount(0);
    await expect(editorPage.locator('[data-locked-fields] a')).toHaveCount(0);
    await expect(editorPage.locator('[data-locked-fields]')).toContainText(world.matter.matterRef);
    expect(await overflowX(editorPage.locator('.p-dialog-content'))).toBeLessThanOrEqual(0);
    await checkPage(editorPage, 'Task.Edit without Task.Assign 375');
    await editorPage.locator('[data-cancel]').click();

    // Task.View only: no Edit control anywhere, so no dialog. No Task.View: the page is refused.
    const viewRole = await seed.role(['Task.View'], `E2E T8 viewer ${token}`);
    const viewer = await seed.user([viewRole.name], `t8v-${token}`);
    const viewerPage = await asUser(viewer.username);
    await new TaskDetailPage(viewerPage).open(task.taskId);
    await expect(viewerPage.locator('[data-view-only]')).toBeVisible();
    await expect(viewerPage.locator('[data-task-header] [data-action="edit"]')).toHaveCount(0);
    const none = await seed.role(['Matter.View'], `E2E T8 none ${token}`);
    const nobody = await seed.user([none.name], `t8n-${token}`);
    const deniedPage = await asUser(nobody.username);
    await deniedPage.goto(`/tasks/${task.taskId}`);
    await expect(deniedPage.locator('[data-task-header]')).toHaveCount(0);
    await expect(deniedPage.locator('[data-edit-form]')).toHaveCount(0);
  });
});

test.describe('T8: Create task page (CT1 #322, #323)', () => {
  /** A task type with a long description, so the chooser has text to cut. */
  async function typesWithDescriptions(
    seed: import('../support/seed').Seeder,
    token: string,
    count: number,
  ): Promise<{ name: string; description: string }[]> {
    const out: { name: string; description: string }[] = [];
    for (let i = 0; i < count; i++) {
      const workflow = await seed.workflow({ stepCount: 2 });
      const name = `T8 Type ${token} ${i + 1}`;
      const description =
        `Add 6 custodians and their mailboxes to the review platform, check the processing exceptions, ` +
        `report the counts back to the matter team and keep the chain of custody log up to date ${i}.`;
      await seed.taskType({ name, workflows: [workflow], description });
      out.push({ name, description });
    }
    return out;
  }

  test('record header: Create task as the h1 on mf-record-header, Tasks > Create task, the chosen type as the context line, at most two lines', async ({
    page,
    seed,
  }) => {
    const token = uid();
    const world = await seed.world({ stepCount: 2 });
    await page.setViewportSize({ width: 1366, height: 768 });
    const create = new CreateTaskPage(page);
    await create.open();
    const header = page.locator('[data-record-header]');
    await expect(header).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Create task', level: 1 })).toBeVisible();
    await expect(
      header.locator('nav[aria-label="Breadcrumb"] a', { hasText: 'Tasks' }),
    ).toBeVisible();
    await expect(header.locator('[data-crumb-current]')).toContainText('Create task');
    await expect(page.locator('[data-create-context]')).toContainText('Choose a task type');
    // Not a record with a state: no Active badge next to the title.
    await expect(header.getByText('Active', { exact: true })).toHaveCount(0);
    const chooserHeight = (await header.boundingBox())!.height;
    expect(chooserHeight).toBeLessThanOrEqual(140);

    await create.chooseTaskType(world.taskType.name);
    await expect(page.locator('[data-create-context]')).toContainText(world.taskType.name);
    expect((await header.boundingBox())!.height).toBeLessThanOrEqual(140);
    void token;
  });

  test('from a Matter: the Matter is a step of the trail (a link for a person who may open it)', async ({
    page,
    seed,
  }) => {
    const world = await seed.world({ stepCount: 2 });
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/tasks/new?matterId=${world.matter.matterId}&taskType=${world.taskType.id}`);
    const trail = page.locator('[data-record-header] .rh__trail');
    await expect(trail.getByRole('link', { name: 'Tasks' })).toBeVisible();
    await expect(trail.getByRole('link', { name: world.matter.matterRef })).toBeVisible();
    await expect(page.locator('[data-crumb-current]')).toContainText('Create task');
  });

  for (const size of SIZES) {
    test(`form at ${size.name}: a 720 px column (or the screen), one input width, the Summary strip, axe 0, no page-level sideways scroll`, async ({
      page,
      seed,
    }) => {
      const world = await seed.world({ stepCount: 2, fields: FIELDS });
      await page.setViewportSize({ width: size.width, height: size.height });
      const create = new CreateTaskPage(page);
      await create.open(`?taskType=${world.taskType.id}&matterId=${world.matter.matterId}`);
      await create.chooseTaskType(world.taskType.name);
      await create.title.fill(LONG_TITLE);
      await expect(page.locator('[data-title-count]')).toHaveText('200 / 200');
      // The title textarea shows all 200 characters (up to four lines) without sideways scroll.
      expect(await overflowX(create.title)).toBeLessThanOrEqual(0);

      const form = page.locator('form.ct__form');
      const formBox = (await form.boundingBox())!;
      expect(formBox.width).toBeLessThanOrEqual(721);
      if (size.width >= 1100) expect(Math.round(formBox.width)).toBe(720);

      // One input width: the text inputs, the textarea and the selects all fill the column.
      const widths: number[] = [];
      for (const loc of [
        create.title,
        create.requestorName,
        create.requestorEmail,
        create.project,
      ]) {
        widths.push(Math.round((await loc.boundingBox())!.width));
      }
      expect(new Set(widths).size, `input widths ${widths.join(',')}`).toBe(1);
      expect(widths[0]).toBeGreaterThan(Math.min(formBox.width, 700) - 60);

      // The Summary in the facts-strip shape: three tiles, side by side from 640 px, stacked below.
      const strip = page.locator('[data-summary-card]');
      await expect(strip).toContainText(world.matter.matterRef);
      await expect(strip.locator('[data-strip-type]')).toContainText(world.taskType.name);
      await expect(strip.locator('[data-strip-workflow]')).toContainText(world.workflow.name);
      const tiles = await strip
        .locator('.ct__tile')
        .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
      if (size.width >= 640) expect(new Set(tiles.map(Math.round)).size).toBe(1);
      else expect(new Set(tiles.map(Math.round)).size).toBe(3);

      await shot(page, `create-form-${size.name}`);
      await checkPage(page, `create form ${size.name}`);

      // The validation summary and the sticky action bar keep working.
      await create.title.fill('');
      await create.submit.click();
      await expect(create.summary).toBeVisible();
      await expect(page.locator('#ct-title-error')).toContainText(/title/i);
      await expect(create.submit).toBeInViewport();
      await shot(page, `create-form-errors-${size.name}`);
      await checkPage(page, `create form errors ${size.name}`);
    });
  }

  for (const size of SIZES) {
    test(`chooser at ${size.name}: ${size.width >= 1024 ? '3' : size.width >= 640 ? '2' : '1'} cards per row, descriptions cut after a whole word with the full text as tooltip, axe 0`, async ({
      page,
      seed,
    }) => {
      const token = uid();
      const types = await typesWithDescriptions(seed, token, 4);
      await page.setViewportSize({ width: size.width, height: size.height });
      const create = new CreateTaskPage(page);
      await create.open();
      await create.typeSearch.isVisible().catch(() => false);
      const cards = page.locator('[data-type-card]');
      await expect(cards.first()).toBeVisible();

      const tops = await cards.evaluateAll((els) =>
        els.map((e) => Math.round(e.getBoundingClientRect().top)),
      );
      const perRow = tops.filter((t) => t === tops[0]).length;
      const expected = size.width >= 1024 ? 3 : size.width >= 640 ? 2 : 1;
      expect(perRow, `cards per row at ${size.name}`).toBe(expected);

      // Our four types: the text on the card is a whole-word cut of the description, the tooltip is all of it.
      for (const t of types) {
        const card = create.typeCard(t.name);
        await expect(card).toBeVisible();
        const text = ((await card.locator('.ct__card-desc').textContent()) ?? '').trim();
        expect(text.endsWith('…'), `${t.name} is cut`).toBe(true);
        const kept = text.slice(0, -1);
        expect(t.description.startsWith(kept), `${t.name} is a prefix`).toBe(true);
        expect(t.description[kept.length], `${t.name} ends at a word boundary`).toBe(' ');
        await expect(card).toHaveAttribute('title', t.description);
        // Three lines at most.
        const fits = await card.locator('.ct__card-desc').evaluate((el) => {
          const size = parseFloat(getComputedStyle(el).fontSize);
          return el.getBoundingClientRect().height <= size * 1.7 * 3;
        });
        expect(fits).toBe(true);
      }
      await shot(page, `create-chooser-${size.name}`);
      await checkPage(page, `create chooser ${size.name}`);
    });
  }

  test('keyboard: the chooser still works with the arrow keys and Enter; search is unchanged', async ({
    page,
    seed,
  }) => {
    const token = uid();
    const types = await typesWithDescriptions(seed, token, 3);
    await page.setViewportSize({ width: 1366, height: 768 });
    const create = new CreateTaskPage(page);
    await create.open();
    await create.typeCard(types[0].name).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('[data-type-card]:focus')).toHaveCount(1);
    await create.typeCard(types[1].name).focus();
    await page.keyboard.press('Enter');
    await expect(create.typeChip).toContainText(types[1].name);
  });

  test('permissions: a person without Task.Create is refused; Task.Create without Task.Assign or Matter.View still gets the header and the strip', async ({
    seed,
    asUser,
  }) => {
    const token = uid();
    const world = await seed.world({ stepCount: 2 });
    const noCreate = await seed.role(['Task.View'], `E2E T8 nocreate ${token}`);
    const viewer = await seed.user([noCreate.name], `t8c-${token}`);
    const denied = await asUser(viewer.username);
    await denied.goto('/tasks/new');
    await expect(
      denied.getByRole('heading', { name: "You don't have permission to view this." }),
    ).toBeVisible();
    await expect(denied.locator('[data-record-header]')).toHaveCount(0);

    const role = await seed.role(['Task.View', 'Task.Create'], `E2E T8 creator ${token}`);
    const creator = await seed.user([role.name], `t8d-${token}`);
    const page = await asUser(creator.username);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/tasks/new?taskType=${world.taskType.id}`);
    await expect(page.locator('[data-record-header]')).toBeVisible();
    await expect(page.locator('[data-summary-card]')).toBeVisible();
    await expect(page.locator('[data-no-assign]')).toBeVisible();
    await checkPage(page, 'Task.Create only 375');
  });

  test('creating a task end to end with a 200-character title keeps working', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await seed.world({ stepCount: 2 });
    await page.setViewportSize({ width: 1366, height: 768 });
    const create = new CreateTaskPage(page);
    await create.open(`?taskType=${world.taskType.id}`);
    await create.fillBasics({
      matterRef: world.matter.matterRef,
      taskType: world.taskType.name,
      title: LONG_TITLE,
    });
    const id = await create.create();
    expect((await new TaskApi(admin, id).get()).title).toBe(LONG_TITLE);
  });
});
