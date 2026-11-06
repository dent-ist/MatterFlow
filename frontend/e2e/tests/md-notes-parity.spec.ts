import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { dropdownByAttr } from '../support/dropdown';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

/**
 * The Notes tab against the approved mockup (MD-27, #1031; docs/ux/matter-detail/notes-parity.md): one card with the header row, notes grouped by tag, a splitter,
 * read mode with an Edit button, edit mode with Cancel left and Save right, the toolbar, the slash menu with the owner's five commands, the tags side panel,
 * the Templates view, the history column, the lock, and axe at the two reference sizes. Typing triggers (/ @ #) and the menu keys are widget keys, not
 * shortcuts (#420).
 */
const html = (title: string, body = '') =>
  `<h1>${title}</h1><p>${body || `${title} body text.`}</p>`;

async function world(seed: import('../support/seed').Seeder) {
  const client = await seed.client({ name: `Notes Client ${uid()}` });
  const matter = await seed.matter({ client, name: `Notes Matter ${uid()}` });
  const tagA = await seed.admin.post('/api/v1/note-tags', {
    name: `Privilege ${uid()}`,
    colourKey: 'red',
  });
  const tagB = await seed.admin.post('/api/v1/note-tags', {
    name: `Hosting ${uid()}`,
    colourKey: 'teal',
  });
  const note = async (title: string, tagIds: number[] = []) =>
    seed.admin.post('/api/v1/notes', { matterId: matter.matterId, bodyHtml: html(title), tagIds });
  return { client, matter, tagA, tagB, note };
}

const open = async (page: Page, matterId: number) => {
  await page.goto(`/matters/${matterId}?tab=notes`);
  await expect(page.locator('[data-notes-tab]')).toBeVisible();
};

test.describe('Notes tab matches the mockup (MD-27)', () => {
  test('the card, the header row, groups by tag with a twin note, and no page scroll', async ({
    page,
    seed,
  }) => {
    const w = await world(seed);
    await w.note(`Two tags ${uid()}`, [w.tagA.noteTagId, w.tagB.noteTagId]);
    await w.note(`No tag ${uid()}`);
    await page.setViewportSize({ width: 1366, height: 768 });
    await open(page, w.matter.matterId);
    // no full-width top row: the controls are two lines in the list pane
    await expect(page.locator('[data-notes-head]')).toHaveCount(0);
    const controls = page.locator('[data-notes-list] [data-notes-controls]');
    await expect(controls.getByRole('searchbox')).toBeVisible();
    await expect(controls.getByRole('button', { name: /View options/ })).toBeVisible();
    for (const v of ['By Tag', 'Latest First', 'Templates'])
      await expect(controls.getByRole('button', { name: v, exact: true })).toBeVisible();
    await expect(controls.locator('[data-new-note]')).toBeVisible();
    // view options: sort, tags filter (as a removable chip) and collapse all
    await controls.getByRole('button', { name: /View options/ }).click();
    const vo = page.locator('[data-view-options-menu]');
    await expect(vo.getByRole('menuitemradio')).toHaveCount(4);
    await vo.getByRole('menuitemcheckbox', { name: /Untagged/ }).click();
    await page.keyboard.press('Escape');
    await expect(controls.locator('[data-filter-chip]')).toHaveCount(1);
    await expect(page.locator('[data-note-item]')).toHaveCount(1);
    await controls.getByRole('button', { name: 'Remove filter Untagged' }).click();
    await expect(page.locator('[data-note-item]')).toHaveCount(3);
    // one group per tag, the twin note is in both, and Untagged comes last
    await expect(page.locator('[data-group]')).toHaveCount(3);
    await expect(page.locator('[data-group]').last()).toContainText('Untagged');
    await expect(page.locator('[data-note-item]')).toHaveCount(3);
    // nothing scrolls on desktop
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight),
    ).toBeLessThanOrEqual(0);
    // the group can be collapsed and expanded again
    const first = page.locator('[data-group]').first();
    await first.locator('h3 button').click();
    await expect(first.locator('h3 button')).toHaveAttribute('aria-expanded', 'false');
    await page.getByRole('button', { name: /View options/ }).click();
    await page.locator('[data-toggle-all]').click();
    await expect(page.locator('[data-group] h3 button[aria-expanded="true"]')).toHaveCount(0);
    await page.getByRole('button', { name: /View options/ }).click();
    await page.locator('[data-toggle-all]').click();
    await expect(page.locator('[data-group] h3 button[aria-expanded="false"]')).toHaveCount(0);
  });

  test('a note opens in read mode; Edit shows Cancel left and Save right; Save returns to read mode', async ({
    page,
    seed,
  }) => {
    const w = await world(seed);
    const title = `Read first ${uid()}`;
    await w.note(title, [w.tagA.noteTagId]);
    await open(page, w.matter.matterId);
    await page.locator('[data-note-item]').first().click();
    await expect(page.locator('[data-note-title]')).toContainText(title);
    await expect(page.locator('[data-note-byline]')).toContainText('Last updated by');
    await expect(page.locator('[data-editor-toolbar]')).toHaveCount(0);
    await page.locator('[data-note-edit]').click();
    await expect(page.locator('[data-editor-toolbar]')).toBeVisible();
    const cancel = await page.locator('[data-note-cancel]').boundingBox();
    const save = await page.locator('[data-note-save]').boundingBox();
    expect(cancel!.x).toBeLessThan(save!.x);
    // Cancel and Save sit side by side, Save at the far right of the header
    expect(save!.x - (cancel!.x + cancel!.width)).toBeLessThan(16);
    const head = await page.locator('[data-note-head]').boundingBox();
    expect(head!.x + head!.width - (save!.x + save!.width)).toBeLessThan(24);
    await expect(page.locator('[data-editing-label]')).toHaveText('Editing');
    await expect(page.locator('[data-note-state]')).toContainText('No changes');
    // Save is off until there is a change
    await expect(page.locator('[data-note-save]')).toBeDisabled();
    await page.locator('.ProseMirror').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' More words.');
    await expect(page.locator('[data-note-state]')).toContainText('Unsaved Changes');
    await expect(page.locator('[data-note-save]')).toBeEnabled();
    await page.locator('[data-note-save]').click();
    await expect(page.locator('[data-editor-toolbar]')).toHaveCount(0);
    await expect(page.locator('[data-note-title]')).toContainText(title);
  });

  test('Cancel with unsaved changes asks before discarding', async ({ page, seed }) => {
    const w = await world(seed);
    await w.note(`Discard ${uid()}`);
    await open(page, w.matter.matterId);
    await page.locator('[data-note-item]').first().click();
    await page.locator('[data-note-edit]').click();
    await page.locator('.ProseMirror').click();
    await page.keyboard.type('x');
    await page.locator('[data-note-cancel]').click();
    const dialog = page.getByRole('dialog', { name: 'Unsaved Changes' });
    await expect(dialog).toContainText('You have unsaved changes. Discard them?');
    await dialog.getByRole('button', { name: 'Keep Editing' }).click();
    await expect(page.locator('[data-editor-toolbar]')).toBeVisible();
    await page.locator('[data-note-cancel]').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Discard Changes' }).click();
    await expect(page.locator('[data-editor-toolbar]')).toHaveCount(0);
  });

  test('the toolbar: style, B I U, lists, quote, link dialog, 3 by 3 table with tools, clear, undo', async ({
    page,
    seed,
  }) => {
    const w = await world(seed);
    await open(page, w.matter.matterId);
    await page.locator('[data-new-note]').click();
    const bar = page.locator('[data-editor-toolbar]');
    for (const name of [
      'Text style: Paragraph',
      'Bold',
      'Italic',
      'Underline',
      'Bulleted List',
      'Numbered List',
      'Quote',
      'Link',
      'Insert table, 3 by 3',
      'Mention a person',
      'Reference an asset',
      'Clear formatting',
      'Undo',
      'Redo',
    ])
      await expect(bar.getByRole('button', { name })).toBeVisible();
    await page.locator('.ProseMirror').click();
    await page.keyboard.type('Title line');
    await page.keyboard.press('Enter');
    await bar.getByRole('button', { name: 'Insert table, 3 by 3' }).click();
    await expect(page.locator('.ProseMirror table tr')).toHaveCount(3);
    await expect(page.locator('.ProseMirror table th')).toHaveCount(3);
    const tools = page.locator('[data-table-tools]');
    await expect(tools).toBeVisible();
    await tools.getByRole('button', { name: 'Add row below' }).click();
    await expect(page.locator('.ProseMirror table tr')).toHaveCount(4);
    await tools.getByRole('button', { name: 'Delete Table' }).click();
    await expect(page.locator('.ProseMirror table')).toHaveCount(0);
    // the link dialog: https or onenote:https only
    await page.keyboard.type('word');
    await bar.getByRole('button', { name: 'Link' }).click();
    const dlg = page.getByRole('dialog', { name: 'Add a link' });
    await dlg.getByLabel('Address').fill('ftp://nope');
    await dlg.getByRole('button', { name: 'Apply' }).click();
    await expect(dlg).toContainText(
      'Enter an address that starts with https:// or onenote:https://',
    );
    await dlg.getByLabel('Address').fill('onenote:https://example.test/notebooks/x');
    await dlg.getByLabel('Text to Show').fill('Notebook');
    await dlg.getByRole('button', { name: 'Apply' }).click();
    await expect(page.locator('.ProseMirror a[href^="onenote:https://"]')).toHaveText('Notebook');
    await bar.getByRole('button', { name: 'Undo' }).click();
    await expect(page.locator('.ProseMirror a')).toHaveCount(0);
  });

  test('the slash menu: six commands, two levels, Esc closes the menu only', async ({
    page,
    seed,
  }) => {
    const w = await world(seed);
    await seed.asset(w.matter, `Slash asset ${uid()}`);
    await open(page, w.matter.matterId);
    await page.locator('[data-new-note]').click();
    await page.locator('.ProseMirror').click();
    await page.keyboard.type('Title');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/');
    const menu = page.locator('[data-suggest-menu]');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('option')).toHaveCount(6);
    for (const c of ['/template', '/asset', '/mention', '/project', '/matter', '/note'])
      await expect(menu).toContainText(c);
    await expect(menu).not.toContainText('/assets');
    await page.keyboard.type('as');
    await expect(menu.getByRole('option')).toHaveCount(1);
    await page.keyboard.press('Enter');
    await expect(menu).toContainText('Asset');
    await expect(menu.getByRole('option').first()).toContainText('Slash asset');
    await page.keyboard.press('Backspace');
    await expect(menu).toContainText('/asset');
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(page.locator('[data-editor-toolbar]')).toBeVisible();
  });

  test('/template lists the templates and inserts the body at the cursor, title untouched', async ({
    page,
    seed,
  }) => {
    const w = await world(seed);
    const name = `SlashTpl ${uid()}`;
    await seed.admin.post('/api/v1/note-templates', {
      scope: 'MATTER',
      matterId: w.matter.matterId,
      name,
      description: 'Inserted by slash',
      bodyHtml: '<h1>Slash title</h1><p>Template body for {{matter}}</p>',
      tagIds: [w.tagA.noteTagId],
    });
    await open(page, w.matter.matterId);
    await page.locator('[data-new-note]').click();
    await page.locator('.ProseMirror').click();
    await page.keyboard.type('/template Slash');
    const menu = page.locator('[data-suggest-menu]');
    await expect(menu.getByRole('option')).toHaveCount(1);
    await expect(menu).toContainText('Inserted by slash');
    await page.keyboard.press('Enter');
    // an empty note: the first line of the template becomes the title, the suggested tags come too
    await expect(page.locator('.ProseMirror h1')).toHaveText('Slash title');
    await expect(page.locator('.ProseMirror')).toContainText('Template body for');
    await expect(page.locator('[data-template-tags]')).toContainText('Template tags');
    // a note with content: inserted at the cursor, the first line stays
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/template Slash');
    await page.keyboard.press('Enter');
    await expect(page.locator('.ProseMirror p', { hasText: 'Template body for' })).toHaveCount(2);
  });

  test('text colour: a named palette menu, stored as data-color, shown in read mode', async ({
    page,
    seed,
  }) => {
    const w = await world(seed);
    await open(page, w.matter.matterId);
    await page.locator('[data-new-note]').click();
    await page.locator('.ProseMirror').click();
    await page.keyboard.type('Colour title');
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Text colour: Default' }).click();
    const menu = page.locator('[data-colour-menu]');
    await expect(menu.getByRole('menuitemradio')).toHaveCount(9);
    for (const n of [
      'Default',
      'Red',
      'Orange',
      'Amber',
      'Green',
      'Teal',
      'Blue',
      'Violet',
      'Grey',
    ])
      await expect(menu.getByRole('menuitemradio', { name: n })).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Text colour: Red' })).toBeVisible();
    await page.keyboard.type('red words');
    await page.locator('[data-note-save]').click();
    const span = page.locator('.ProseMirror [data-color="red"]');
    await expect(span).toHaveText('red words');
    await expect(span).toHaveCSS('color', 'rgb(180, 35, 24)');
    const list = await seed.admin.get<{ items: { noteId: number }[] }>(
      `/api/v1/notes?matterId=${w.matter.matterId}`,
    );
    const saved = await seed.admin.get<{ bodyHtml: string }>(
      `/api/v1/notes/${list.items[0].noteId}`,
    );
    expect(saved.bodyHtml).toContain('<span data-color="red">red words</span>');
    expect(saved.bodyHtml).not.toContain('style=');
  });

  test('editing uses the full width of the note panel at 1675 px', async ({ page, seed }) => {
    const w = await world(seed);
    await page.setViewportSize({ width: 1675, height: 900 });
    await open(page, w.matter.matterId);
    await page.locator('[data-new-note]').click();
    await expect(page.locator('[data-editor-toolbar]')).toBeVisible();
    const panel = await page.locator('[data-note-edit-area]').boundingBox();
    for (const sel of ['[data-note-tag-chips]', '[data-editor-toolbar]', '[data-editor-area]']) {
      const box = await page.locator(sel).boundingBox();
      expect(box!.width).toBeGreaterThan(panel!.width - 40);
    }
  });

  test('tag chips are a light tint with dark text and a coloured dot, from the tag colour', async ({
    page,
    seed,
  }) => {
    const w = await world(seed); // tagA is red, tagB is teal
    await w.note(`Coloured ${uid()}`, [w.tagA.noteTagId, w.tagB.noteTagId]);
    await open(page, w.matter.matterId);
    const red = page.locator('[data-notes-list] mf-note-tag[data-colour="red"]').first();
    const teal = page.locator('[data-notes-list] mf-note-tag[data-colour="teal"]').first();
    await expect(red).toBeVisible();
    await expect(red).toHaveCSS('background-color', 'rgb(251, 218, 214)');
    await expect(red).toHaveCSS('color', 'rgb(122, 27, 18)');
    await expect(red.locator('.ntag__dot')).toHaveCSS('background-color', 'rgb(198, 40, 40)');
    await expect(teal.locator('.ntag__dot')).toHaveCSS('background-color', 'rgb(10, 125, 114)');
    // a tag saved without a colour still gets one
    const bare = await seed.admin.post('/api/v1/note-tags', { name: `Bare ${uid()}` });
    expect(bare.colourKey).toBeTruthy();
  });

  test('a new note enables Save once it has content; on a phone Cancel and Save stay together and visible', async ({
    page,
    seed,
  }) => {
    const w = await world(seed);
    await page.setViewportSize({ width: 375, height: 812 });
    await open(page, w.matter.matterId);
    await page.locator('[data-new-note]').click();
    await expect(page.locator('[data-note-save]')).toBeDisabled();
    const cancel = await page.locator('[data-note-cancel]').boundingBox();
    const save = await page.locator('[data-note-save]').boundingBox();
    expect(save!.x + save!.width).toBeLessThanOrEqual(375);
    expect(Math.abs(save!.y - cancel!.y)).toBeLessThan(4);
    expect(save!.x - (cancel!.x + cancel!.width)).toBeLessThan(16);
    await page.locator('.ProseMirror').click();
    await page.keyboard.type('Some content');
    await expect(page.locator('[data-note-save]')).toBeEnabled();
    expect(await axeViolations(page, '[data-notes-tab]')).toEqual([]);
  });

  test('typing keeps the caret where it is: title line of a new note, an existing note and a template (MD-38)', async ({
    page,
    seed,
  }) => {
    const w = await world(seed);
    const tplName = `Caret ${uid()}`;
    await seed.admin.post('/api/v1/note-templates', {
      scope: 'MATTER',
      matterId: w.matter.matterId,
      name: tplName,
      bodyHtml: '<h1>Heading</h1><p>Body text</p>',
      tagIds: [],
    });
    const existing = await w.note(`Existing ${uid()}`);
    expect(existing.noteId).toBeGreaterThan(0);
    await open(page, w.matter.matterId);
    // a new note: type "ac", step back, type "b": the text must be "abc" (a reset of the text would put the letter elsewhere)
    await page.locator('[data-new-note]').click();
    await page.locator('.ProseMirror').click();
    await page.keyboard.type('ac');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.type('b');
    await expect(page.locator('.ProseMirror p').first()).toHaveText('abc');
    await page.keyboard.type('X');
    await expect(page.locator('.ProseMirror p').first()).toHaveText('abXc');
    await page.locator('[data-note-cancel]').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Discard Changes' }).click();
    // an existing note: the title line (first line) in the middle
    await page.locator('[data-note-item]', { hasText: 'Existing' }).first().click();
    await page.locator('[data-note-edit]').click();
    await page.locator('.ProseMirror').click();
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('Home');
    await page.keyboard.type('12');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.type('-');
    await expect(page.locator('.ProseMirror > :first-child')).toContainText('1-2Existing');
    await page.locator('[data-note-cancel]').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Discard Changes' }).click();
    // a template: the first line inside the editor, and the Name field above it
    await page.getByRole('button', { name: 'Templates', exact: true }).click();
    await page.locator('[data-template-list] li', { hasText: tplName }).getByRole('button').click();
    await page.locator('[data-template-edit]').click();
    await page.locator('.ProseMirror').click();
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('Home');
    await page.keyboard.type('ac');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.type('b');
    await expect(page.locator('.ProseMirror > :first-child')).toContainText('abcHeading');
    await page.keyboard.press('Control+End');
    await page.keyboard.type('!');
    await expect(page.locator('.ProseMirror p', { hasText: 'Body text' })).toHaveText('Body text!');
    const name = page.getByLabel('Name');
    await name.click();
    await name.press('End');
    await name.pressSequentially('xy');
    await name.press('ArrowLeft');
    await name.pressSequentially('-');
    await expect(name).toHaveValue(`${tplName}x-y`);
    await expect(page.locator('[data-note-state]')).toContainText('Unsaved Changes');
  });

  test('tags: a side panel picks up to five, chips show in the editor, Add tag opens the panel', async ({
    page,
    seed,
  }) => {
    const w = await world(seed);
    await w.note(`Tagged ${uid()}`);
    await open(page, w.matter.matterId);
    await page.locator('[data-note-item]').first().click();
    await page.locator('[data-note-edit]').click();
    await page.locator('[data-note-tags]').click();
    const panel = page.locator('[data-tags-panel]');
    await expect(panel).toContainText('0 of 5 selected');
    await panel.getByRole('checkbox').first().click();
    await expect(panel).toContainText('1 of 5 selected');
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.locator('[data-note-tag-chips] mf-note-tag')).toHaveCount(1);
    await page.getByRole('button', { name: /^Remove tag/ }).click();
    await expect(page.locator('[data-note-tag-chips] mf-note-tag')).toHaveCount(0);
  });

  test('lock: badge, disabled Edit with the reason, pin still works, unlock', async ({
    page,
    seed,
  }) => {
    const w = await world(seed);
    const n = await w.note(`Lockable ${uid()}`);
    await open(page, w.matter.matterId);
    await page.locator('[data-note-item]').first().click();
    // the header shows AI, Edit, Actions, full width and Close only: no History, Pin, Lock or Delete buttons
    await expect(page.locator('[data-note-head] [data-note-history]')).toHaveCount(0);
    await page.locator('[data-note-actions]').click();
    const menu = page.locator('[data-actions-menu]');
    for (const g of ['Organise', 'Share and reuse', 'Danger']) await expect(menu).toContainText(g);
    await menu.locator('[data-note-lock]').click();
    await expect(page.locator('[data-note-lock-badge]')).toContainText('Locked by');
    await expect(page.locator('[data-note-lock-icon]')).toBeVisible();
    await expect(page.locator('[data-note-edit]')).toHaveAttribute('aria-disabled', 'true');
    await page.locator('[data-note-actions]').click();
    await expect(page.locator('[data-note-delete]')).toHaveAttribute('aria-disabled', 'true');
    await page.locator('[data-note-pin]').click();
    await expect(page.locator('[data-note-title] .pi-thumbtack')).toBeVisible();
    await page.locator('[data-note-actions]').click();
    await page.locator('[data-note-unlock]').click();
    await expect(page.locator('[data-note-lock-badge]')).toHaveCount(0);
    expect(n.noteId).toBeGreaterThan(0);
  });

  test('history column at 1366 wide: grouped by day, collapses to a rail', async ({
    page,
    seed,
  }) => {
    const w = await world(seed);
    await w.note(`History ${uid()}`);
    await page.setViewportSize({ width: 1600, height: 900 });
    await open(page, w.matter.matterId);
    await page.locator('[data-note-item]').first().click();
    const col = page.locator('[data-history-rail-open]');
    await expect(col).toContainText('History');
    await expect(col).toContainText('Today');
    await expect(col).toContainText('created this note');
    await expect(col).toContainText('History shows who and when only.');
    await page.locator('[data-history-rail]').click();
    await expect(col).toHaveCount(0);
    await expect(page.locator('[data-history-rail]')).toHaveAttribute('aria-expanded', 'false');
  });

  test('References panel on the right next to History: one open at a time, Esc closes, nothing below the note', async ({
    page,
    seed,
  }) => {
    const w = await world(seed);
    const asset = await seed.asset(w.matter, `Ref asset ${uid()}`);
    await seed.admin.post('/api/v1/notes', {
      matterId: w.matter.matterId,
      bodyHtml: `<h1>Refs note</h1><p>See <span data-asset-id="${asset.assetId}">${asset.displayName}</span></p>`,
      tagIds: [],
    });
    await page.setViewportSize({ width: 1600, height: 900 });
    await open(page, w.matter.matterId);
    await page.locator('[data-note-item]').first().click();
    await expect(page.locator('[data-note-title]')).toBeVisible();
    // nothing below the note any more
    await expect(page.locator('.nt__pscroll [data-note-refs]')).toHaveCount(0);
    const refs = page.locator('[data-refs-rail]');
    await expect(refs).toContainText('1');
    await expect(refs).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('[data-history-rail-open]')).toHaveAttribute('data-side', 'history');
    await refs.click();
    const col = page.locator('[data-history-rail-open]');
    await expect(col).toHaveAttribute('data-side', 'refs');
    await expect(col).toContainText(asset.displayName);
    await expect(page.locator('[data-history-rail]')).toHaveAttribute('aria-expanded', 'false');
    expect(await axeViolations(page, '[data-notes-tab]')).toEqual([]);
    await page.locator('[data-history-rail]').click();
    await expect(col).toHaveAttribute('data-side', 'history');
    await page.locator('[data-history-rail]').click();
    await expect(col).toHaveCount(0);
    await refs.click();
    await expect(col).toHaveAttribute('data-side', 'refs');
    await page.keyboard.press('Tab');
    await col.getByRole('button', { name: 'Close the side panel' }).focus();
    await page.keyboard.press('Escape');
    await expect(col).toHaveCount(0);
  });

  test('a template is a note item: a plain row, opened in the note panel, edited and deleted there', async ({
    page,
    seed,
  }) => {
    const w = await world(seed);
    const name = `Tpl ${uid()}`;
    await seed.admin.post('/api/v1/note-templates', {
      scope: 'MATTER',
      matterId: w.matter.matterId,
      name,
      description: 'A test template',
      bodyHtml: '<p>By {{author}} about {{custodian}}</p>',
      tagIds: [],
    });
    await open(page, w.matter.matterId);
    await page.getByRole('button', { name: 'Templates', exact: true }).click();
    const row = page.locator('[data-template-list] li', { hasText: name });
    await expect(row).toContainText('Matter Level');
    await expect(page.getByRole('button', { name: 'New Template' })).toHaveCount(0);
    await expect(row.getByRole('button')).toHaveCount(1); // no Use, Edit, Duplicate or Delete on the row
    await row.getByRole('button').click();
    await expect(page.locator('[data-template-badge]')).toHaveText('Template');
    await expect(page.locator('[data-note-pane]')).toContainText('{{custodian}}');
    await expect(page.getByRole('button', { name: 'Duplicate' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Use', exact: true })).toHaveCount(0);
    // edit in the same panel: Cancel left, Save right, the note editor and toolbar
    await page.locator('[data-template-edit]').click();
    await expect(page.locator('[data-editor-toolbar]')).toBeVisible();
    const cancel = await page.locator('[data-template-cancel]').boundingBox();
    const save = await page.locator('[data-template-save]').boundingBox();
    expect(cancel!.x).toBeLessThan(save!.x);
    expect(save!.x - (cancel!.x + cancel!.width)).toBeLessThan(16);
    await expect(page.locator('[data-template-save]')).toBeDisabled();
    await page.getByLabel('Name').fill(`${name} v2`);
    await expect(page.locator('[data-note-state]')).toContainText('Unsaved Changes');
    await page.locator('[data-template-save]').click();
    await expect(page.locator('[data-note-pane]')).toContainText(`${name} v2`);
    // delete with the same confirmation as a note
    await page.locator('[data-note-actions]').click();
    await page.locator('[data-template-delete]').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete template' }).click();
    await expect(page.locator('[data-template-list] li', { hasText: name })).toHaveCount(0);
  });

  test('templates have a Matter, Client and System Level; the edit form has Name, Description, Tags and Level', async ({
    page,
    seed,
  }) => {
    const w = await world(seed);
    const mk = (n: string, extra: object) =>
      seed.admin.post('/api/v1/note-templates', {
        name: n,
        bodyHtml: `<h1>${n}</h1><p>Body</p>`,
        tagIds: [],
        ...extra,
      });
    const sys = `Sys ${uid()}`;
    const cli = `Cli ${uid()}`;
    const mat = `Mat ${uid()}`;
    await mk(sys, { scope: 'SYSTEM' });
    await mk(cli, { scope: 'CLIENT', clientId: w.client.clientId });
    await mk(mat, { scope: 'MATTER', matterId: w.matter.matterId });
    await open(page, w.matter.matterId);
    await page.getByRole('button', { name: 'Templates', exact: true }).click();
    const groups = page.locator('[data-template-group]');
    await expect(groups).toHaveText([/Matter Level/, /Client Level/, /System Level/]);
    await expect(page.locator('[data-template-list] li', { hasText: cli })).toContainText(
      'Client Level',
    );
    await expect(page.locator('[data-template-list] li', { hasText: sys })).toContainText(
      'System Level',
    );
    // the edit form: no "Title when used"; the tags are one compact picker; a level select
    await page.locator('[data-template-list] li', { hasText: mat }).getByRole('button').click();
    await page.locator('[data-template-edit]').click();
    await expect(page.getByLabel('Title when used')).toHaveCount(0);
    await expect(page.locator('[data-template-help]')).toBeVisible();
    await page.locator('[data-template-tags-button]').click();
    await page
      .getByRole('group', { name: 'Tags the template offers' })
      .getByRole('checkbox')
      .first()
      .check();
    await expect(page.locator('[data-template-tags-button] mf-note-tag')).toHaveCount(1);
    expect(await axeViolations(page, '[data-notes-tab]')).toEqual([]);
    // move it to Client Level
    await dropdownByAttr(page, 'data-template-level-select').selectOption('CLIENT');
    await page.locator('[data-template-save]').click();
    await expect(page.locator('[data-template-list] li', { hasText: mat })).toContainText(
      'Client Level',
    );
  });

  test('a reader sees the Read only pill, the reader banner, no Edit and no New Note', async ({
    asUser,
    seed,
  }) => {
    const w = await world(seed);
    await w.note(`Readable ${uid()}`);
    const role = await seed.role(['Matter.View', 'Client.View', 'MatterNote.View'], 'note reader');
    const reader = await seed.user([role.name], 'notereader');
    const page = await asUser(reader.username);
    await open(page, w.matter.matterId);
    await expect(page.locator('[data-notes-readonly]')).toContainText('Read only');
    await expect(page.locator('[data-new-note]')).toHaveCount(0);
    await page.locator('[data-note-item]').first().click();
    await expect(page.locator('[data-note-title]')).toBeVisible();
    await expect(page.locator('[data-note-edit]')).toHaveCount(0);
    await expect(page.locator('[data-notes-tab]')).toContainText(
      'You can read this note. Editing needs the Matter Note Edit permission.',
    );
  });

  test('a note locked while it is being edited shows the warning and cannot be saved', async ({
    page,
    seed,
  }) => {
    const w = await world(seed);
    const n = await w.note(`Locked under you ${uid()}`);
    await open(page, w.matter.matterId);
    await page.locator('[data-note-item]').first().click();
    await page.locator('[data-note-edit]').click();
    await page.locator('.ProseMirror').click();
    await page.keyboard.type(' mine');
    await seed.admin.post(`/api/v1/notes/${n.noteId}/lock`, { rowVersion: n.rowVersion });
    await page.locator('[data-note-save]').click();
    const warn = page.locator('[data-note-locked-warning]');
    await expect(warn).toContainText('your changes cannot be saved');
    await expect(warn.getByRole('button', { name: 'Copy my text' })).toBeVisible();
    await expect(page.locator('[data-note-save]')).toHaveAttribute('aria-disabled', 'true');
    await warn.getByRole('button', { name: 'Close' }).click();
    await expect(page.locator('[data-editor-toolbar]')).toHaveCount(0);
  });

  test('Save as template and the template tags offer', async ({ page, seed }) => {
    const w = await world(seed);
    const source = `Source ${uid()}`;
    await w.note(source, [w.tagA.noteTagId]);
    await open(page, w.matter.matterId);
    await page.locator('[data-note-item]').first().click();
    await page.locator('[data-note-actions]').click();
    await page.getByRole('menuitem', { name: 'Save as template...' }).click();
    const dlg = page.getByRole('dialog', { name: 'Save as Template' });
    await expect(dlg).toContainText('Level (who can use it)');
    await expect(dlg.getByLabel('Template Name')).not.toHaveValue('');
    await dlg.getByRole('button', { name: 'Save Template' }).click();
    await page.locator('[data-new-note]').click();
    await page.locator('.ProseMirror').click();
    await page.keyboard.type(`/template ${source}`);
    await expect(page.locator('[data-suggest-menu] [role=option]')).toHaveCount(1);
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-template-tags]')).toContainText('Template tags');
    await page.locator('[data-template-tags]').getByRole('button', { name: 'Apply Tags' }).click();
    await expect(page.locator('[data-note-tag-chips] mf-note-tag')).toHaveCount(1);
  });

  test('the empty state and one plain New Note button with the /template hint', async ({
    page,
    seed,
  }) => {
    const w = await world(seed);
    await open(page, w.matter.matterId);
    const empty = page.locator('[data-notes-empty]');
    await expect(empty).toContainText('No notes yet.');
    await expect(empty.getByRole('button', { name: 'New Note' })).toBeVisible();
    // one plain button: no caret, no dropdown, no From template picker
    await expect(page.locator('[data-new-menu]')).toHaveCount(0);
    await page.locator('[data-new-note]').click();
    await expect(page.locator('[data-editor-toolbar]')).toBeVisible();
    await expect(page.locator('[data-editor-empty-hint]')).toContainText(
      'Type / for commands, for example /template to start from a template.',
    );
    await page.locator('.ProseMirror').click();
    await page.keyboard.type('x');
    await expect(page.locator('[data-editor-empty-hint]')).toHaveCount(0);
  });

  test('the AI button says it is not available on a matter that does not allow AI', async ({
    page,
    seed,
  }) => {
    const w = await world(seed);
    await w.note(`AI ${uid()}`);
    await open(page, w.matter.matterId);
    await page.locator('[data-note-item]').first().click();
    await expect(page.locator('[data-note-head]')).toContainText("AI can't be used on this matter");
  });

  for (const [width, height] of [
    [1366, 768],
    [375, 812],
  ] as const) {
    test(`axe is clean and nothing scrolls sideways at ${width}x${height}`, async ({
      page,
      seed,
    }) => {
      test.skip(!axeAvailable(), 'axe-core is not installed');
      const w = await world(seed);
      await w.note(`Axe ${uid()}`, [w.tagA.noteTagId]);
      await page.setViewportSize({ width, height });
      await open(page, w.matter.matterId);
      await expect(page.locator('[data-note-item]').first()).toBeVisible();
      expect(await axeViolations(page, '[data-notes-tab]')).toEqual([]);
      await page.locator('[data-note-item]').first().click();
      await expect(page.locator('[data-note-title]')).toBeVisible();
      expect(await axeViolations(page, '[data-notes-tab]')).toEqual([]);
      await page.locator('[data-note-edit]').click();
      await expect(page.locator('[data-editor-toolbar]')).toBeVisible();
      expect(await axeViolations(page, '[data-notes-tab]')).toEqual([]);
      await page.locator('[data-note-cancel]').click();
      if (width < 760) await page.locator('[data-note-close]').click();
      await page.getByRole('button', { name: 'Templates', exact: true }).click();
      await expect(page.locator('[data-template-list], .nt__thead').first()).toBeVisible();
      await expect(page.locator('[data-template-new]')).toHaveCount(0);
      expect(await axeViolations(page, '[data-notes-tab]')).toEqual([]);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
      ).toBeLessThanOrEqual(0);
    });
  }
});
