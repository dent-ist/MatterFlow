import path from 'node:path';
import { Page } from '@playwright/test';
import { CreateTaskPage } from '../pages/create-task.page';
import { TaskDetailPage } from '../pages/task-detail.page';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Seeder } from '../support/seed';

/**
 * Rich text Task description with tables (issue #80, decision R): a table pasted from Outlook is kept (and cleaned) through create, save and
 * reload, hostile HTML is neutralised in the editor and on the server, an email keeps its table, descriptions saved as plain text before the
 * change stay as they are until edited, and the table is accessible and can be edited with the keyboard.
 */

const SAMPLES = path.join(__dirname, '..', 'fixtures', 'email');
const EDITOR = '[data-description-field] [role=textbox]';

/** What Outlook puts on the clipboard for a copied table: styles, classes, mso properties, o:p, conditional comments, fonts. */
const OUTLOOK_TABLE = `<html xmlns:o="urn:schemas-microsoft-com:office:office"><head><meta charset="utf-8">
<style><!-- p.MsoNormal {margin:0in} td {mso-height-source:auto;} --></style>
<!--[if gte mso 9]><xml><o:OfficeDocumentSettings><o:AllowPNG/></o:OfficeDocumentSettings></xml><![endif]--></head>
<body lang=EN-US style='tab-interval:.5in'><!--StartFragment-->
<p class=MsoNormal>Please load these custodians:<o:p></o:p></p>
<table class=MsoTableGrid border=1 cellspacing=0 width=400 style='border-collapse:collapse;mso-yfti-tbllook:1184'>
<tr style='mso-yfti-irow:0;mso-yfti-firstrow:yes'>
<td width=200 valign=top style='border:solid windowtext 1.0pt'><p class=MsoNormal><b><span style='mso-bidi-font-weight:normal'>Custodian<o:p></o:p></span></b></p></td>
<td width=200 valign=top style='border:solid windowtext 1.0pt'><p class=MsoNormal><b>Size (GB)</b><o:p></o:p></p></td></tr>
<tr><td><font face="Calibri" size="3">Anna Weller</font></td><td>14.2</td></tr>
<tr><td colspan=2 style='background:yellow'>Marcus Okafor and Priya Raman (merged)</td></tr>
</table><!--EndFragment--></body></html>`;

const HOSTILE = `<p onclick="window.__pwn=1">Hostile<script>window.__pwn=2</script><img src=x onerror="window.__pwn=3"></p>
<table style="position:fixed;top:0;left:0;width:100%;height:100%"><tr><td onmouseover="window.__pwn=4" colspan="2 onclick=window.__pwn=5"><svg><style><a title="</style><img src onerror=window.__pwn=6>"></svg>cell</td></tr></table>
<a href="javascript:window.__pwn=7">js link</a><iframe srcdoc="<script>window.__pwn=8</script>"></iframe><form action="javascript:1"><input></form>`;

/** Fires a paste event with clipboard HTML and text at an element, like a user's Ctrl+V, and returns whether the page cancelled it. */
async function pasteInto(page: Page, selector: string, html: string, text: string): Promise<void> {
  await page.evaluate(
    ({ selector, html, text }) => {
      const target = document.querySelector<HTMLElement>(selector)!;
      target.focus();
      const data = new DataTransfer();
      data.setData('text/html', html);
      data.setData('text/plain', text);
      target.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      );
    },
    { selector, html, text },
  );
}

const pwned = (page: Page): Promise<unknown> =>
  page.evaluate(() => (window as unknown as { __pwn?: unknown }).__pwn);

async function createWithPaste(page: Page, seed: Seeder, html: string): Promise<CreateTaskPage> {
  const world = await seed.world();
  const create = new CreateTaskPage(page);
  await create.open(`?taskType=${world.taskType.id}`);
  await create.fillBasics({
    matterRef: world.matter.matterRef,
    taskType: world.taskType.name,
    title: 'Pasted table',
  });
  await pasteInto(page, EDITOR, html, 'plain text fallback');
  return create;
}

test.describe('Rich text description with tables (issue #80)', () => {
  test('a table pasted from Outlook is cleaned, saved, and still a table after a reload', async ({
    page,
    seed,
    admin,
  }) => {
    const create = await createWithPaste(page, seed, OUTLOOK_TABLE);
    const editor = page.locator(EDITOR);
    await expect(editor.locator('table')).toHaveCount(1);
    await expect(editor.locator('td, th')).toHaveCount(5);
    await expect(editor.locator('td[colspan="2"]')).toContainText('Marcus Okafor and Priya Raman');
    const pasted = await editor.innerHTML();
    expect(pasted).not.toMatch(/style=|class=|mso|<font|o:p|width=|<!--/i);

    const taskId = await create.create();
    const description = page.locator('[data-description]');
    await expect(description.locator('table')).toBeVisible();
    await expect(description.locator('td, th')).toHaveCount(5);
    await expect(description.locator('b', { hasText: 'Custodian' })).toHaveCount(1);

    await page.reload();
    await expect(page.locator('[data-description] table')).toBeVisible();
    await expect(page.locator('[data-description] td[colspan="2"]')).toContainText('(merged)');

    const task = await admin.get(`/api/v1/tasks/${taskId}`);
    expect(task.descriptionFormat).toBe('HTML');
    expect(task.description).toContain('<table>');
    expect(task.description).toContain('<td colspan="2">');
    expect(task.description).not.toMatch(/Mso|style=|class=|<font|o:p/);
  });

  test('a hostile paste is neutralised in the editor, on the server and on the page', async ({
    page,
    seed,
    admin,
  }) => {
    const dialogs: string[] = [];
    page.on('dialog', (d) => {
      dialogs.push(d.message());
      void d.dismiss();
    });
    const create = await createWithPaste(page, seed, HOSTILE);
    const editor = page.locator(EDITOR);
    await expect(editor).toContainText('Hostile');
    const html = await editor.innerHTML();
    for (const bad of [
      '<script',
      '<img',
      '<svg',
      '<style',
      '<iframe',
      '<form',
      '<input',
      'onclick',
      'onerror',
      'onmouseover',
      'javascript:',
      'style=',
    ]) {
      expect(html, bad).not.toContain(bad);
    }
    expect(await pwned(page)).toBeUndefined();

    const taskId = await create.create();
    const view = page.locator('[data-description]');
    await expect(view).toContainText('Hostile');
    await expect(view.locator('script, img, svg, iframe, form, input')).toHaveCount(0);
    expect(await pwned(page)).toBeUndefined();
    const task = await admin.get(`/api/v1/tasks/${taskId}`);
    expect(task.description).not.toMatch(
      /<script|<img|<svg|<iframe|onclick|onerror|javascript:|style=/i,
    );

    // The server does not trust the browser: the same payload sent straight to the API is cleaned too, and renders as harmless text.
    const direct = await seed.taskWithDescription(await seed.world(), HOSTILE);
    expect(direct.description).not.toMatch(
      /<script|<img|<svg|<iframe|onclick|onerror|javascript:|style=/i,
    );
    await new TaskDetailPage(page).open(direct.taskId);
    await expect(page.locator('[data-description]')).toContainText('Hostile');
    expect(await pwned(page)).toBeUndefined();
    expect(dialogs).toEqual([]);
  });

  test('an email file keeps its table in the description, without its scripts, styles and tracking image', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await seed.world();
    const create = new CreateTaskPage(page);
    await create.open(`?taskType=${world.taskType.id}`);
    await create.showEmailPanel();
    await page
      .getByLabel('Choose an .eml or .msg file')
      .setInputFiles(path.join(SAMPLES, '06-html-table.eml'));
    const review = page.locator('[data-review]');
    await expect(review).toBeVisible();
    const reviewEditor = review.locator('[data-ei-description] [role=textbox]');
    await expect(reviewEditor.locator('table')).toHaveCount(1);
    await expect(reviewEditor.locator('tr')).toHaveCount(3);
    await expect(reviewEditor.locator('img')).toHaveCount(0);
    expect(await pwned(page)).toBeUndefined();
    // The privilege reminder stays.
    await expect(page.locator('[data-privilege-note]')).toContainText('Privilege reminder');
    await page.getByRole('button', { name: 'Fill the task' }).click();

    await create.pickMatter(world.matter.matterRef, world.matter.matterRef);
    await create.requestorName.fill('Linda Cho');
    await expect(create.description.locator('table')).toHaveCount(1);
    const taskId = await create.create();

    await expect(
      page.locator('[data-description] table td', { hasText: 'Anna Weller' }),
    ).toBeVisible();
    const task = await admin.get(`/api/v1/tasks/${taskId}`);
    expect(task.description).toContain('<th scope="col">Custodian</th>');
    expect(task.description).not.toMatch(/<script|<style|<img|onclick|MsoTableGrid|mso-/i);
  });

  test('pasting an Outlook email block with its HTML into the quick fill box keeps the table and drops the header lines', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    const create = new CreateTaskPage(page);
    await create.open(`?taskType=${world.taskType.id}`);
    await create.showEmailPanel();
    const text = [
      'From: Linda Cho <linda.cho@example-firm.test>',
      'Sent: Tuesday, October 13, 2026 9:05 AM',
      'To: Nora Beck',
      'Subject: Load list',
      '',
      'Please load these:',
      'Name\tQty',
      'Disk\t2',
    ].join('\n');
    const html =
      '<p><b>From:</b> Linda Cho &lt;linda.cho@example-firm.test&gt;<br><b>Sent:</b> Tuesday, October 13, 2026 9:05 AM<br><b>To:</b> Nora Beck<br><b>Subject:</b> Load list</p>' +
      '<p>Please load these:</p><table><tr><td>Name</td><td>Qty</td></tr><tr><td>Disk</td><td>2</td></tr></table>';
    await pasteInto(page, '#ei-paste', html, text);
    // The box receives the plain text (the browser does that itself when the paste is not cancelled).
    await create.pasteBox.fill(text);
    await create.fillFromPasted.click();

    const reviewEditor = page.locator('[data-review] [data-ei-description] [role=textbox]');
    await expect(reviewEditor.locator('table')).toHaveCount(1);
    await expect(reviewEditor).toContainText('Please load these:');
    await expect(reviewEditor).not.toContainText('From:');
    await expect(page.locator('#ei-f-title')).toHaveValue('Load list');
  });

  test('a description saved as plain text before this change reads as it was, and stays text until its description is edited', async ({
    page,
    seed,
    admin,
  }) => {
    test.skip(!Seeder.canWriteLegacyText(), 'needs the SQL Server container of run-local.sh');
    const world = await seed.world();
    const task = await seed.legacyTextTask(
      world,
      'Old line 1\nOld line <b>2</b> & more\n\nSecond paragraph',
    );
    expect(task.descriptionFormat).toBe('TEXT');

    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    const view = page.locator('[data-description]');
    await expect(view).toHaveAttribute('data-format', 'TEXT');
    await expect(view.locator('p')).toHaveCount(2);
    await expect(view).toContainText('Old line <b>2</b> & more');
    await expect(view.locator('b')).toHaveCount(0);

    // Editing something else leaves the text alone.
    await page.locator('[data-edit-details]').click();
    const editor = page.locator('[data-edit-form] [data-description-editor] [role=textbox]');
    await expect(editor).toContainText('Old line 1');
    await page.locator('#td-title').fill('Only the title changed');
    await page.locator('[data-save]').click();
    await expect(page.locator('[data-edit-form]')).toHaveCount(0);
    let saved = await admin.get(`/api/v1/tasks/${task.taskId}`);
    expect(saved.descriptionFormat).toBe('TEXT');
    expect(saved.description).toBe('Old line 1\nOld line <b>2</b> & more\n\nSecond paragraph');

    // Editing the description converts it to rich text.
    await page.locator('[data-edit-details]').click();
    await page.locator('[data-edit-form] [data-description-editor] [role=textbox]').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' Added.');
    await page.locator('[data-save]').click();
    await expect(page.locator('[data-edit-form]')).toHaveCount(0);
    saved = await admin.get(`/api/v1/tasks/${task.taskId}`);
    expect(saved.descriptionFormat).toBe('HTML');
    expect(saved.description).toContain('Second paragraph Added.');
    expect(saved.description).toContain('&lt;b&gt;2&lt;/b&gt;');
    await expect(page.locator('[data-description]')).toHaveAttribute('data-format', 'HTML');
  });

  test('the table in the details panel passes axe, scrolls inside its own box and cannot widen the page', async ({
    page,
    seed,
  }) => {
    test.skip(!axeAvailable(), 'axe-core is not installed (npm ci) and E2E_AXE_PATH is not set');
    const world = await seed.world();
    const wide = `<table><thead><tr>${Array.from({ length: 12 }, (_, i) => `<th scope="col">Column ${i + 1}</th>`).join('')}</tr></thead><tbody>${Array.from({ length: 3 }, (_, r) => `<tr>${Array.from({ length: 12 }, (_, c) => `<td>Row ${r + 1} value ${c + 1} with some longer text</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    const task = await seed.taskWithDescription(world, `<p>Intro</p>${wide}<p>After the table</p>`);
    await new TaskDetailPage(page).open(task.taskId);
    await expect(page.locator('[data-description] table')).toBeVisible();

    // Scoped to the description: the rest of the page has violations of its own (the Task information list), which this change does not touch.
    expect(await axeViolations(page, '[data-description]')).toEqual([]);

    const overflow = await page.evaluate(() => {
      const box = document.querySelector<HTMLElement>('[data-description] .mf-rich__scroll')!;
      return {
        tableScrolls: box.scrollWidth > box.clientWidth,
        pageScrolls: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    });
    expect(overflow.tableScrolls).toBe(true);
    expect(overflow.pageScrolls).toBe(false);

    // The box that scrolls can take focus, so the keyboard can scroll it.
    const box = page.locator('[data-description] .mf-rich__scroll');
    await expect(box).toHaveAttribute('tabindex', '0');
    await box.focus();
    await page.keyboard.press('ArrowRight');
    expect(await box.evaluate((e) => e.scrollLeft)).toBeGreaterThan(0);
  });

  test('a table can be inserted, filled and extended with the keyboard alone, and saved from the edit dialog', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await seed.world();
    const task = await seed.task(world, { description: '<p>Start</p>' });
    await new TaskDetailPage(page).open(task.taskId);
    await page.locator('[data-edit-details]').click();
    const dialog = page.locator('[data-edit-form]');
    const editor = dialog.locator('[data-description-editor] [role=textbox]');
    await editor.click();
    await page.keyboard.press('Control+End');

    const toolbar = dialog.getByRole('toolbar', { name: 'Formatting' });
    await toolbar.getByRole('button', { name: 'Insert table' }).focus();
    await page.keyboard.press('Enter');
    const rows = dialog.getByLabel('Rows');
    await expect(rows).toBeFocused();
    await rows.fill('2');
    await dialog.getByLabel('Columns').fill('2');
    await page.keyboard.press('Enter'); // submits the form
    await expect(editor.locator('table')).toHaveCount(1);
    await expect(editor.locator('th')).toHaveCount(2);
    await expect(dialog.locator('[data-rte-live]')).toContainText(
      'Table inserted with 2 rows and 2 columns',
    );

    // The caret is in the first header cell: type, Tab to the next cell, and so on.
    await page.keyboard.type('Name');
    await page.keyboard.press('Tab');
    await page.keyboard.type('Qty');
    await page.keyboard.press('Tab');
    await page.keyboard.type('Disk');
    await page.keyboard.press('Tab');
    await page.keyboard.type('2');
    await expect(dialog.locator('[data-rte-live]')).toContainText('Row 2, column 2');

    // Add a row below with the table toolbar, reached by keyboard.
    await dialog
      .getByRole('toolbar', { name: 'Table' })
      .getByRole('button', { name: 'Row below' })
      .focus();
    await page.keyboard.press('Enter');
    await expect(editor.locator('tr')).toHaveCount(3);
    await expect(dialog.locator('[data-rte-live]')).toContainText('Row added below');
    await page.keyboard.type('Tape');

    // Tab in the last cell of the table carries on to the next field: the editor is no keyboard trap.
    await page.keyboard.press('Tab');
    await expect(page.locator('#td-req-name')).toBeFocused();

    await page.locator('[data-save]').click();
    await expect(page.locator('[data-edit-form]')).toHaveCount(0);
    const cells = page.locator('[data-description] table tr');
    await expect(cells).toHaveCount(3);
    await expect(page.locator('[data-description] th').first()).toHaveText('Name');
    await expect(
      page.locator('[data-description] tbody tr').last().locator('td').last(),
    ).toHaveText('Tape');

    const saved = await admin.get(`/api/v1/tasks/${task.taskId}`);
    expect(saved.description).toContain('<th scope="col">Name</th>');
    expect(saved.description).toContain('<td>Tape</td>');
  });

  test('the editor limits a table to 200 cells and the server answers a larger one with TABLE_TOO_LARGE', async ({
    seed,
    admin,
  }) => {
    const world = await seed.world();
    const cells = (n: number): string =>
      `<table><tbody>${Array.from({ length: Math.ceil(n / 10) }, (_, r) => `<tr>${'<td>x</td>'.repeat(Math.min(10, n - r * 10))}</tr>`).join('')}</tbody></table>`;
    const ok = await seed.taskWithDescription(world, cells(200));
    expect((ok.description.match(/<td>/g) ?? []).length).toBe(200);

    const response = await admin.raw('POST', '/api/v1/tasks', {
      matterId: world.matter.matterId,
      taskTypeId: world.taskType.id,
      workflowDefinitionId: world.workflow.workflowDefinitionId,
      title: 'Too many cells',
      requestorName: 'Rita',
      description: cells(201),
    });
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain('TABLE_TOO_LARGE');
  });

  test('comments accept a pasted table too', async ({ page, seed, admin }) => {
    const world = await seed.world();
    const task = await seed.task(world);
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await detail.showSection('Comments');
    const comments = page.getByRole('region', { name: 'Comments' });
    const editor = comments.getByRole('textbox', { name: 'Add a comment' });
    await editor.click();
    await pasteInto(
      page,
      '[aria-label="Add a comment"]',
      '<table class=MsoTableGrid><tr><td style="x">Disk</td><td onclick="alert(1)">2</td></tr></table>',
      'Disk 2',
    );
    await expect(editor.locator('table')).toHaveCount(1);
    await comments.locator('[data-post]').click();

    const body = comments.locator('[data-comment-id] [data-body]');
    await expect(body.locator('table td')).toHaveCount(2);
    const list = await admin.get(`/api/v1/tasks/${task.taskId}/comments`);
    expect(list.items[0].bodyHtml).toBe(
      '<table><tbody><tr><td>Disk</td><td>2</td></tr></tbody></table>',
    );
  });
});
