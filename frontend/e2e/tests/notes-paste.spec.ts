import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

/**
 * Formatted paste into a matter note (#1411, epic #1405; design note docs/ux/notes-round-2/README.md section 5, D-46b): Word text keeps its headings, bold, italic, lists,
 * tables and links and loses its colours, highlight and strikethrough; the Paste Options chip offers Keep Formatting and Paste as Plain Text; tracked deletions and pictures
 * inside the text are left out with a toast; a text-only clipboard (the browser's Ctrl+Shift+V) pastes as plain paragraphs; a saved note keeps what the client kept (the server
 * sanitiser agrees). Paste events are simulated with a dispatched ClipboardEvent and a DataTransfer. No shortcut is used (#420). Desktop sizes only.
 * Set PASTE_EVIDENCE_DIR to write the evidence screenshots (they go to the design-evidence branch, never to dev).
 */
const SIZES = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
];

/** A Word-like clipboard, short: heading, marks, red, highlight and struck-through text, a hidden paragraph, a nested list, a table, a link, two pictures. */
const WORD = `<html xmlns:o="urn:schemas-microsoft-com:office:office"><body><!--StartFragment-->
<h1 style='margin-top:12pt'><span style='font-family:"Calibri Light";color:#2F5496'>Custodian Collection Plan<o:p></o:p></span></h1>
<p class=MsoNormal><b>Status as of Monday.</b> The first wave is <i>complete</i>; <span style='color:#C00000'>the iPhone for M. Chen is late</span> and <s>the Slack export is done</s> <span style='background:yellow;mso-highlight:yellow'>needs a recheck</span>.<o:p></o:p></p>
<p class=MsoNormal style='display:none'>HIDDEN-PARAGRAPH-TEXT</p>
<p class=MsoNormal>Next steps:</p>
<p class=MsoListParagraphCxSpFirst style='text-indent:-.25in;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='mso-list:Ignore'>·<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span></span><![endif]>Image the tablet<o:p></o:p></p>
<p class=MsoListParagraphCxSpMiddle style='text-indent:-.25in;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='mso-list:Ignore'>·<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span></span><![endif]>Confirm retention with IT<o:p></o:p></p>
<p class=MsoListParagraphCxSpLast style='margin-left:1.0in;text-indent:-.25in;mso-list:l0 level2 lfo1'><![if !supportLists]><span style='mso-list:Ignore'>o<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;</span></span><![endif]>Slack: 90 days<o:p></o:p></p>
<table class=MsoTableGrid border=1 cellspacing=0 cellpadding=0 style='border-collapse:collapse'>
<tr><td style='background:#D9E2F3'><p class=MsoNormal><b>Custodian</b></p></td><td style='background:#D9E2F3'><p class=MsoNormal><b>Source</b></p></td><td style='background:#D9E2F3'><p class=MsoNormal><b>Status</b></p></td></tr>
<tr><td><p class=MsoNormal>R. Alvarez</p></td><td><p class=MsoNormal>Laptop, tablet</p></td><td><p class=MsoNormal>Imaged</p></td></tr>
<tr><td><p class=MsoNormal>M. Chen</p></td><td><p class=MsoNormal>iPhone</p></td><td><p class=MsoNormal>Scheduled</p></td></tr></table>
<p class=MsoNormal>Details: <a href="https://nam04.safelinks.protection.outlook.com/?url=https%3A%2F%2Ftracker.example.com%2Fplan&amp;data=05%7C01&amp;reserved=0"><span style='color:#0563C1'>Collection tracker</span></a><o:p></o:p></p>
<p class=MsoNormal><img width=120 height=40 src="file:///C:/Users/author/AppData/Local/Temp/msohtmlclip1/01/clip_image001.png"></p>
<p class=MsoNormal><img width=80 height=20 src="cid:image002.png@01D8A1B2.3C4D5E60"></p>
<!--EndFragment--></body></html>`;

const WORD_PLAIN =
  'Custodian Collection Plan\nStatus as of Monday. The first wave is complete.\nNext steps:\nImage the tablet\nConfirm retention with IT';

const REDLINE = `<p class=MsoNormal>The parties agree to <del style='color:red'>thirty</del><ins style='color:blue'>sixty</ins> days notice.</p>`;

async function world(seed: import('../support/seed').Seeder) {
  const client = await seed.client({ name: `Paste Client ${uid()}` });
  const matter = await seed.matter({ client, name: `Paste Matter ${uid()}` });
  return { client, matter };
}

/** Opens a new note and puts the caret in the empty text. */
async function newNote(page: Page, matterId: number) {
  await page.goto(`/matters/${matterId}?tab=notes`);
  await expect(page.locator('[data-notes-tab]')).toBeVisible();
  await page.locator('[data-new-note]').click();
  await page.locator('.ProseMirror').click();
}

/** A paste as the browser sends it: a cancelable ClipboardEvent on the editable element with a DataTransfer. Nothing is read from the real clipboard. */
async function paste(page: Page, flavours: { html?: string; text?: string }) {
  await page.locator('.ProseMirror').evaluate((el, f) => {
    const dt = new DataTransfer();
    if (f.html) dt.setData('text/html', f.html);
    if (f.text) dt.setData('text/plain', f.text);
    el.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    );
  }, flavours);
}

async function shot(page: Page, name: string, size: { width: number; height: number }) {
  const dir = process.env['PASTE_EVIDENCE_DIR'];
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}-${size.width}x${size.height}.png`) });
}

for (const size of SIZES) {
  test.describe(`Formatted paste into a note at ${size.width}x${size.height}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(size);
    });

    test('Word text keeps its formatting, loses colours and hidden text, and offers Paste Options', async ({
      page,
      seed,
    }) => {
      const w = await world(seed);
      await newNote(page, w.matter.matterId);
      await paste(page, { html: WORD, text: WORD_PLAIN });
      const ed = page.locator('.ProseMirror');
      await expect(ed.locator('h1')).toHaveText('Custodian Collection Plan');
      await expect(ed.locator('strong').first()).toHaveText('Status as of Monday.');
      await expect(ed.locator('em')).toHaveText('complete');
      await expect(ed.locator('ul > li > ul > li')).toHaveText('Slack: 90 days');
      await expect(ed.locator('ul > li')).toHaveCount(3);
      await expect(ed.locator('table tr')).toHaveCount(3);
      await expect(ed.locator('table td')).toHaveCount(9);
      await expect(ed.locator('a[href="https://tracker.example.com/plan"]')).toHaveText(
        'Collection tracker',
      );
      await expect(ed).toContainText('the iPhone for M. Chen is late');
      await expect(ed).toContainText('the Slack export is done');
      await expect(ed).not.toContainText('HIDDEN-PARAGRAPH-TEXT');
      await expect(ed.locator('img')).toHaveCount(0);
      expect(await ed.locator('[style*="color"], s, mark, span[data-color]').count()).toBe(0);
      // the chip, after the text, and the two toasts
      const chip = page.locator('[data-paste-options]');
      await expect(chip).toBeVisible();
      await expect(chip).toContainText('Pasted with formatting');
      await expect(chip.getByRole('button', { name: 'Paste options' })).toHaveAttribute(
        'aria-haspopup',
        'menu',
      );
      await expect(page.getByText('Pasted without 2 images')).toBeVisible();
      await shot(page, 'paste-word-after', size);
      // the menu: Keep Formatting checked, Paste as Plain Text, the tip
      await chip.getByRole('button', { name: 'Paste options' }).click();
      const menu = page.locator('[data-paste-menu]');
      await expect(menu.getByRole('menuitemradio')).toHaveCount(2);
      await expect(menu.getByRole('menuitemradio', { name: /Keep Formatting/ })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      await expect(menu).toContainText('Replaces this paste with its text only, no layout.');
      await expect(menu).toContainText('Ctrl + Shift + V pastes as plain text from the start.');
      await shot(page, 'paste-options-menu', size);
      if (axeAvailable()) expect(await axeViolations(page, '[data-notes-tab]')).toEqual([]);
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      await expect(chip.getByRole('button', { name: 'Paste options' })).toBeFocused();
      if (axeAvailable()) expect(await axeViolations(page, '[data-notes-tab]')).toEqual([]);
    });

    test('Paste as Plain Text replaces the paste with its text, with no clipboard permission and no toolbar button', async ({
      page,
      seed,
    }) => {
      const w = await world(seed);
      await newNote(page, w.matter.matterId);
      await expect(page.locator('[data-editor-toolbar]')).not.toContainText(/paste/i);
      await paste(page, { html: WORD, text: WORD_PLAIN });
      const ed = page.locator('.ProseMirror');
      await expect(ed.locator('h1')).toHaveCount(1);
      await page
        .locator('[data-paste-options]')
        .getByRole('button', { name: 'Paste options' })
        .click();
      await page.locator('[data-paste-plain]').click();
      await expect(ed.locator('h1, table, ul, strong')).toHaveCount(0);
      await expect(ed).toContainText('Custodian Collection Plan');
      await expect(ed).toContainText('Confirm retention with IT');
      await expect(ed.locator('p')).toHaveCount(5);
      await expect(page.locator('[data-paste-options]')).toHaveCount(0);
      await shot(page, 'paste-as-plain-text-after', size);
      // a keyboard path: Tab from the text reaches the chip after a paste
      await paste(page, { html: '<p><b>Again</b> bold</p>', text: 'Again bold' });
      const caret = page.locator('[data-paste-caret]');
      await expect(caret).toBeVisible();
      await page.keyboard.press('Tab');
      await expect(caret).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(page.locator('[data-paste-keep]')).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(page.locator('[data-paste-plain]')).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(ed.locator('strong')).toHaveCount(0);
      await expect(ed).toContainText('Again bold');
    });

    test('a text-only clipboard (the browser Ctrl+Shift+V) pastes as paragraphs with no chip', async ({
      page,
      seed,
    }) => {
      const w = await world(seed);
      await newNote(page, w.matter.matterId);
      await paste(page, { text: 'line one\nline two\nline three' });
      await expect(page.locator('.ProseMirror p')).toHaveCount(3);
      await expect(page.locator('[data-paste-options]')).toHaveCount(0);
    });

    test('tracked changes keep the inserted text and drop the deleted text, and the toast says so', async ({
      page,
      seed,
    }) => {
      const w = await world(seed);
      await newNote(page, w.matter.matterId);
      await paste(page, { html: REDLINE, text: 'The parties agree to thirty sixty days notice.' });
      const ed = page.locator('.ProseMirror');
      await expect(ed).toContainText('The parties agree to sixty days notice.');
      await expect(ed).not.toContainText('thirty');
      const toast = page.getByText('Pasted without tracked deletions');
      await expect(toast).toBeVisible();
      await shot(page, 'paste-tracked-toast', size);
    });

    test('a table over 1,000 cells is refused with the inline message and nothing is inserted', async ({
      page,
      seed,
    }) => {
      const w = await world(seed);
      await newNote(page, w.matter.matterId);
      const cells = Array.from({ length: 124 }, () => `<tr>${'<td>x</td>'.repeat(10)}</tr>`).join(
        '',
      );
      await paste(page, { html: `<table>${cells}</table>`, text: 'x' });
      const msg = page.locator('[data-paste-message]');
      await expect(msg).toHaveText('That table has 1,240 cells; a note holds at most 1,000.');
      await expect(page.locator('.ProseMirror table')).toHaveCount(0);
      await shot(page, 'paste-too-many-cells', size);
      if (axeAvailable()) expect(await axeViolations(page, '[data-notes-tab]')).toEqual([]);
    });

    test('Undo removes the whole paste in one step, and a saved note keeps what the client kept', async ({
      page,
      seed,
    }) => {
      const w = await world(seed);
      await newNote(page, w.matter.matterId);
      await page.keyboard.type('Before');
      await paste(page, { html: WORD, text: WORD_PLAIN });
      const ed = page.locator('.ProseMirror');
      await expect(ed.locator('table')).toHaveCount(1);
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect(ed.locator('table, h1, ul')).toHaveCount(0);
      await expect(ed).toContainText('Before');
      await page.getByRole('button', { name: 'Redo', exact: true }).click();
      await expect(ed.locator('table')).toHaveCount(1);
      // save: the server sanitiser accepts it and read mode shows the same
      await page.locator('[data-note-save]').click();
      await expect(page.locator('[data-editor-toolbar]')).toHaveCount(0);
      await page.reload();
      await expect(page.locator('[data-notes-tab]')).toBeVisible();
      await page.locator('[data-note-item]').first().click();
      const read = page.locator('.ProseMirror');
      await expect(read.locator('table tr')).toHaveCount(3);
      await expect(read.locator('ul > li > ul > li')).toHaveText('Slack: 90 days');
      await expect(read.locator('a[href="https://tracker.example.com/plan"]')).toHaveCount(1);
      await expect(read).not.toContainText('HIDDEN-PARAGRAPH-TEXT');
      await shot(page, 'paste-saved-read-mode', size);
    });
  });
}
