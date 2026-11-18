import fs from 'node:fs';
import path from 'node:path';
import { Locator, Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Seeder, uid } from '../support/seed';
import { toasts } from '../support/toasts';

/**
 * The folder tree of Matter > Notes (epic #1405, issue #1408; docs/ux/notes-round-2/README.md section 3, rule D-46c): All Notes, No Folder and nested folders with
 * direct counts; a folder shows only its direct notes; a search covers the folder and its subfolders; New Folder, New Subfolder, Rename, Move to Folder... (picker with
 * greyed targets), Delete Folder (an empty one deletes, one with contents offers "Move Contents Up and Delete"); a note moves by menu and by drag with Undo; a locked
 * note moves; a new note goes into the selected folder; the tree folds to a rail and the choice is remembered (`mf.notes.tree`); read-only people see the tree and no
 * actions. Desktop sizes only (D-82); axe on every changed state. No keyboard shortcut is added (#420): the tree keys are the ARIA tree keys of the control.
 */
const SIZES = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
];

const html = (title: string) => `<h1>${title}</h1><p>${title} paragraph. Lorem ipsum.</p>`;

interface Note {
  noteId: number;
  rowVersion: string;
  folderId?: number;
}
interface Folder {
  noteFolderId: number;
  name: string;
}

async function world(seed: Seeder) {
  const client = await seed.client({ name: `Folder Client ${uid()}` });
  const matter = await seed.matter({ client, name: `Folder Matter ${uid()}` });
  const folder = (name: string, parentFolderId?: number) =>
    seed.admin.post<Folder>('/api/v1/note-folders', {
      matterId: matter.matterId,
      parentFolderId,
      name,
    });
  const note = (title: string, folderId?: number) =>
    seed.admin.post<Note>('/api/v1/notes', {
      matterId: matter.matterId,
      bodyHtml: html(title),
      tagIds: [],
      folderId,
    });
  const get = (noteId: number) => seed.admin.get<Note>(`/api/v1/notes/${noteId}`);
  return { client, matter, folder, note, get };
}

const open = async (page: Page, matterId: number, query = '') => {
  await page.goto(`/matters/${matterId}?tab=notes${query}`);
  await expect(page.locator('[data-notes-tab]')).toBeVisible();
  await expect(page.locator('[data-folder-tree]')).toBeVisible();
  await expect(page.locator('[data-notes-loading]')).toHaveCount(0);
};

const tree = (page: Page) => page.locator('[data-folder-list]');
const treeRow = (page: Page, id: number | 'all' | 'none') =>
  page.locator(`[data-folder-list] [data-key="${id}"]`);
const count = (row: Locator) => row.locator('.ft__count');
const items = (page: Page) => page.locator('[data-note-item] .nt__ti');
const titles = async (page: Page) =>
  (await items(page).allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim()).sort();
const dialog = (page: Page, name: string) => page.getByRole('dialog', { name });

/** Opens a folder of the tree with its chevron (only when it is closed: moving into a folder opens it by itself). */
async function expand(page: Page, id: number) {
  const row = treeRow(page, id);
  if ((await row.getAttribute('aria-expanded')) === 'false') await row.locator('.ft__chev').click();
  await expect(row).toHaveAttribute('aria-expanded', 'true');
}

async function rowMenu(page: Page, id: number, action: string) {
  const row = treeRow(page, id);
  await row.hover();
  await row.locator('[data-overflow]').click();
  await page.locator(`[data-action="${action}"]`).click();
}

async function noViolations(page: Page, include?: string) {
  test.skip(!axeAvailable(), 'axe-core is not available');
  expect(await axeViolations(page, include)).toEqual([]);
}

/** Dismisses the toast host's Undo or info toasts so the next step starts clean. */
const clearToasts = async (page: Page) => {
  for (const b of await page.locator('[data-toast] button[aria-label*="lose"]').all()) {
    await b.click().catch(() => undefined);
  }
};

test.describe('Notes folders (#1408)', () => {
  for (const size of SIZES) {
    test.describe(`at ${size.width}x${size.height}`, () => {
      test.beforeEach(async ({ page }) => {
        await page.setViewportSize(size);
      });

      test('first use: no folders yet, create a top-level folder and a nested one, rename, duplicate names', async ({
        page,
        seed,
      }) => {
        const w = await world(seed);
        await w.note(`Loose ${uid()}`);
        await open(page, w.matter.matterId);
        // the tree says there are no folders; No Folder is hidden
        await expect(page.locator('[data-folder-none]')).toContainText('No folders yet.');
        await expect(treeRow(page, 'none')).toHaveCount(0);
        await expect(treeRow(page, 'all')).toBeVisible();
        await noViolations(page);

        await page.locator('[data-folder-none] button', { hasText: 'New Folder' }).click();
        const dlg = dialog(page, 'New Folder');
        await expect(dlg).toBeVisible();
        await expect(dlg.locator('#nf-name-help')).toContainText('Created at the top level.');
        await noViolations(page);
        // an empty name is refused in the dialog, nothing is created
        await dlg.getByRole('button', { name: 'Create Folder' }).click();
        await expect(dlg.locator('#nf-name-error')).toContainText('Enter a folder name.');
        await dlg.getByLabel('Folder Name').fill('Custodians');
        await dlg.getByRole('button', { name: 'Create Folder' }).click();
        await expect(dlg).toHaveCount(0);
        await expect(toasts(page).filter({ hasText: 'Folder created' })).toBeVisible();
        const custodians = page.locator('[data-folder-list] [role=treeitem]', {
          hasText: 'Custodians',
        });
        await expect(custodians).toHaveCount(1);
        // there are folders now: No Folder shows, with the loose note
        await expect(treeRow(page, 'none')).toBeVisible();
        await expect(count(treeRow(page, 'none'))).toHaveText('1');

        // a subfolder through the selected folder
        await custodians.click();
        await expect(custodians).toHaveAttribute('aria-selected', 'true');
        await page.locator('[data-folder-new]').click();
        await expect(dialog(page, 'New Folder').locator('#nf-name-help')).toContainText(
          'Created in Custodians.',
        );
        await dialog(page, 'New Folder').getByLabel('Folder Name').fill('Finance');
        await dialog(page, 'New Folder').getByRole('button', { name: 'Create Folder' }).click();
        const finance = page.locator('[data-folder-list] [role=treeitem]', {
          hasText: 'Finance',
        });
        await expect(finance).toHaveAttribute('aria-level', '2');
        await expect(custodians).toHaveAttribute('aria-expanded', 'true');
        await noViolations(page);

        // the same name again in the same parent: said under the field, nothing created
        await rowMenu(page, Number(await custodians.getAttribute('data-folder')), 'sub');
        await dialog(page, 'New Folder').getByLabel('Folder Name').fill(' finance ');
        await dialog(page, 'New Folder').getByRole('button', { name: 'Create Folder' }).click();
        await expect(dialog(page, 'New Folder').locator('#nf-name-error')).toContainText(
          'A folder named "finance" already exists in Custodians.',
        );
        await noViolations(page);
        await dialog(page, 'New Folder').getByRole('button', { name: 'Cancel' }).click();
        await expect(dialog(page, 'New Folder')).toHaveCount(0);

        // the same name in another parent is fine; a name with a slash is refused
        await rowMenu(page, Number(await custodians.getAttribute('data-folder')), 'rename');
        const rename = dialog(page, 'Rename Folder');
        await expect(rename.getByLabel('Folder Name')).toHaveValue('Custodians');
        await rename.getByLabel('Folder Name').fill('A/B');
        await rename.getByRole('button', { name: 'Save Changes' }).click();
        await expect(rename.locator('#nf-name-error')).toContainText('cannot contain');
        await rename.getByLabel('Folder Name').fill('People');
        await rename.getByRole('button', { name: 'Save Changes' }).click();
        await expect(rename).toHaveCount(0);
        await expect(toasts(page).filter({ hasText: 'Folder renamed' })).toBeVisible();
        await expect(
          page.locator('[data-folder-list] [role=treeitem]', { hasText: 'People' }),
        ).toHaveCount(1);
      });

      test("a folder shows only its direct notes; counts add up; a search covers subfolders and names each note's folder", async ({
        page,
        seed,
      }) => {
        const w = await world(seed);
        const top = await w.folder('Custodians');
        const sub = await w.folder('Finance', top.noteFolderId);
        const a = `Direct ${uid()}`;
        const b = `Nested ${uid()}`;
        const c = `Loose ${uid()}`;
        await w.note(a, top.noteFolderId);
        await w.note(b, sub.noteFolderId);
        await w.note(c);
        await open(page, w.matter.matterId);

        // All Notes: everything, each row names its folder; counts are direct and add up (1 + 1 + 1 = 3)
        await expect(count(treeRow(page, 'all'))).toHaveText('3');
        await expect(count(treeRow(page, 'none'))).toHaveText('1');
        await expect(count(treeRow(page, top.noteFolderId))).toHaveText('1');
        expect(await titles(page)).toEqual([a, b, c].sort());
        await expect(
          page.locator('[data-note-folder]').filter({ hasText: 'No Folder' }),
        ).toHaveCount(1);
        await expect(
          page.locator('[data-note-folder]').filter({ hasText: 'Custodians > Finance' }),
        ).toHaveCount(1);
        await noViolations(page);

        // the folder: only the direct note, no subfolder notes, no folder lines
        await treeRow(page, top.noteFolderId).click();
        await expect.poll(() => titles(page)).toEqual([a]);
        await expect(page.locator('[data-notes-path]')).toContainText('Custodians');
        await expect(page.locator('[data-note-folder]')).toHaveCount(0);
        await expect(page).toHaveURL(new RegExp(`folder=${top.noteFolderId}`));
        await noViolations(page);

        // the subfolder, then No Folder
        await expand(page, top.noteFolderId);
        await treeRow(page, sub.noteFolderId).click();
        await expect.poll(() => titles(page)).toEqual([b]);
        await treeRow(page, 'none').click();
        await expect.poll(() => titles(page)).toEqual([c]);
        await expect(page).toHaveURL(/folder=none/);

        // a search inside the folder covers its subfolders
        await treeRow(page, top.noteFolderId).click();
        await page.locator('#nt-search').fill('Nested');
        await expect.poll(() => titles(page)).toEqual([b]);
        await expect(page.locator('[data-note-folder]')).toContainText('Custodians > Finance');
        // nothing matches inside the folder: the sentence and the way out
        await page.locator('#nt-search').fill('zzz-no-such-note');
        await expect(page.locator('[data-notes-nomatch]')).toContainText(
          'No results for "zzz-no-such-note" in Custodians.',
        );
        await noViolations(page);
        await page.locator('#nt-search').fill(c.split(' ')[0]);
        await page.locator('#nt-search').fill(c);
        await expect(page.locator('[data-search-all]')).toBeVisible();
        await page.locator('[data-search-all]').click();
        await expect.poll(() => titles(page)).toEqual([c]);
        await expect(treeRow(page, 'all')).toHaveAttribute('aria-selected', 'true');
      });

      test('an empty folder and No Folder say so; the address opens a folder; a wrong id falls back to All Notes', async ({
        page,
        seed,
      }) => {
        const w = await world(seed);
        const empty = await w.folder('Empty One');
        const deep = await w.folder('Deep', empty.noteFolderId);
        await w.note(`Only ${uid()}`, deep.noteFolderId);
        await open(page, w.matter.matterId, `&folder=${empty.noteFolderId}`);
        await expect(treeRow(page, empty.noteFolderId)).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator('[data-notes-empty]')).toContainText(
          'No notes in this folder yet.',
        );
        await expect(page.locator('[data-notes-empty] button')).toContainText('New Note');
        await noViolations(page);
        await treeRow(page, 'none').click();
        await expect(page.locator('[data-notes-empty]')).toContainText(
          'Every note is in a folder.',
        );
        await noViolations(page);
        // the path to a folder given by the address is open
        await open(page, w.matter.matterId, `&folder=${deep.noteFolderId}`);
        await expect(treeRow(page, deep.noteFolderId)).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator('[data-notes-path]')).toContainText('Empty One');
        await open(page, w.matter.matterId, '&folder=999999');
        await expect(treeRow(page, 'all')).toHaveAttribute('aria-selected', 'true');
      });

      test('a new note goes into the selected folder, and into none from All Notes and No Folder', async ({
        page,
        seed,
      }) => {
        const w = await world(seed);
        const f = await w.folder('Drafts');
        await open(page, w.matter.matterId);
        const create = async (text: string) => {
          await page.locator('[data-new-note]').click();
          await page.locator('.ProseMirror').click();
          await page.keyboard.type(text);
          await page.locator('[data-note-save]').click();
          await expect(toasts(page).filter({ hasText: 'Note saved' })).toBeVisible();
          let found: Note | undefined;
          await expect
            .poll(async () => {
              const list = await seed.admin.get<{ items: Note[] }>(
                `/api/v1/notes?matterId=${w.matter.matterId}&q=${encodeURIComponent(text)}`,
              );
              found = list.items[0];
              return found !== undefined;
            })
            .toBe(true);
          return found!;
        };
        await treeRow(page, f.noteFolderId).click();
        await page.locator('[data-new-note]').click();
        await expect(page.locator('[data-note-where]')).toContainText('Drafts');
        await page.locator('[data-note-cancel]').click();
        const inFolder = await create(`Inside ${uid()}`);
        expect(inFolder.folderId).toBe(f.noteFolderId);
        await expect(count(treeRow(page, f.noteFolderId))).toHaveText('1');
        await treeRow(page, 'all').click();
        const atTop = await create(`Top ${uid()}`);
        expect(atTop.folderId ?? null).toBeNull();
        await treeRow(page, 'none').click();
        const noFolder = await create(`None ${uid()}`);
        expect(noFolder.folderId ?? null).toBeNull();
      });

      test('Move to Folder: the picker greys the current place with a reason; a locked note moves; Undo puts it back', async ({
        page,
        seed,
      }) => {
        const w = await world(seed);
        const a = await w.folder('Alpha');
        const b = await w.folder('Beta');
        const title = `Locked ${uid()}`;
        const n = await w.note(title, a.noteFolderId);
        await seed.admin.post(`/api/v1/notes/${n.noteId}/lock`, { rowVersion: n.rowVersion });
        await open(page, w.matter.matterId, `&folder=${a.noteFolderId}`);
        await page.locator('[data-note-item]').first().click();
        await expect(page.locator('[data-note-lock-badge]')).toBeVisible();
        await expect(page.locator('[data-note-edit]')).toHaveAttribute('aria-disabled', 'true');
        await expect(page.locator('[data-note-where]')).toContainText('Alpha');
        await page.locator('[data-note-actions]').click();
        await page.locator('[data-note-move]').click();
        const dlg = dialog(page, 'Move Note');
        await expect(dlg).toBeVisible();
        await expect(dlg.locator('[data-pick="top"]')).toContainText('No Folder');
        await expect(dlg.locator(`[data-pick="${a.noteFolderId}"]`)).toHaveAttribute(
          'aria-disabled',
          'true',
        );
        await expect(dlg.locator(`[data-pick="${a.noteFolderId}"]`)).toContainText('Already here');
        await expect(dlg.locator('[data-panel-primary]')).toHaveAttribute('aria-disabled', 'true');
        await noViolations(page);
        await dlg.locator(`[data-pick="${b.noteFolderId}"]`).click();
        await dlg.getByRole('button', { name: 'Move Note', exact: true }).click();
        await expect(dlg).toHaveCount(0);
        await expect(toasts(page).filter({ hasText: 'Note moved' })).toBeVisible();
        expect((await w.get(n.noteId)).folderId).toBe(b.noteFolderId);
        // the note stays locked; moving did not unlock it
        await expect(count(treeRow(page, a.noteFolderId))).toHaveText('0');
        await expect(count(treeRow(page, b.noteFolderId))).toHaveText('1');
        // Undo
        await toasts(page).filter({ hasText: 'Note moved' }).locator('[data-undo]').click();
        await expect.poll(async () => (await w.get(n.noteId)).folderId).toBe(a.noteFolderId);
        await expect(count(treeRow(page, a.noteFolderId))).toHaveText('1');
      });

      test('drag a note onto a folder and onto No Folder; a greyed folder takes nothing; Undo', async ({
        page,
        seed,
      }) => {
        const w = await world(seed);
        const a = await w.folder('Alpha');
        const b = await w.folder('Beta');
        const title = `Drag ${uid()}`;
        const n = await w.note(title, a.noteFolderId);
        await open(page, w.matter.matterId, `&folder=${a.noteFolderId}`);
        const rowEl = page.locator('[data-note-item]', { hasText: title });
        await expect(rowEl).toHaveAttribute('draggable', 'true');
        // dropping on the folder it is in does nothing
        await rowEl.dragTo(treeRow(page, a.noteFolderId));
        expect((await w.get(n.noteId)).folderId).toBe(a.noteFolderId);
        await rowEl.dragTo(treeRow(page, b.noteFolderId));
        await expect(toasts(page).filter({ hasText: 'Note moved' })).toBeVisible();
        await expect.poll(async () => (await w.get(n.noteId)).folderId).toBe(b.noteFolderId);
        await expect(page.locator('[data-notes-empty]')).toContainText(
          'No notes in this folder yet.',
        );
        await toasts(page).filter({ hasText: 'Note moved' }).locator('[data-undo]').click();
        await expect.poll(async () => (await w.get(n.noteId)).folderId).toBe(a.noteFolderId);
        // to No Folder
        await expect(rowEl).toBeVisible();
        await rowEl.dragTo(treeRow(page, 'none'));
        await expect.poll(async () => (await w.get(n.noteId)).folderId ?? null).toBeNull();
        await noViolations(page);
      });

      test('drag shows the drop target, the label and the dimmed folders (axe on the drag state)', async ({
        page,
        seed,
      }) => {
        const w = await world(seed);
        const a = await w.folder('Alpha');
        const b = await w.folder('Beta');
        await w.note(`Drag ${uid()}`, a.noteFolderId);
        await open(page, w.matter.matterId, `&folder=${a.noteFolderId}`);
        const rowEl = page.locator('[data-note-item]').first();
        const target = treeRow(page, b.noteFolderId);
        await rowEl.hover();
        await page.mouse.down();
        const box = (await target.boundingBox())!;
        await page.mouse.move(box.x + 40, box.y + box.height / 2, { steps: 8 });
        // a real browser repeats dragover while the pointer rests; the test pointer needs one more move
        for (let i = 1; i <= 3; i += 1) {
          await page.mouse.move(box.x + 40 + i * 3, box.y + box.height / 2);
          await page.waitForTimeout(120);
        }
        await expect(treeRow(page, a.noteFolderId)).toHaveClass(/is-dim/);
        await expect(treeRow(page, a.noteFolderId)).toHaveAttribute(
          'title',
          'The note is already in this folder.',
        );
        await expect(target).toHaveClass(/is-drop/);
        await expect(page.locator('.ft__drag')).toContainText('Move to Beta');
        await noViolations(page);
        await page.mouse.up();
        await expect(toasts(page).filter({ hasText: 'Note moved' })).toBeVisible();
      });

      test('drag a folder onto another folder and onto No Folder; never into itself or its own subfolder', async ({
        page,
        seed,
      }) => {
        const w = await world(seed);
        const a = await w.folder('Alpha');
        const a1 = await w.folder('Alpha One', a.noteFolderId);
        const b = await w.folder('Beta');
        await open(page, w.matter.matterId);
        await expand(page, a.noteFolderId);
        await treeRow(page, a1.noteFolderId).dragTo(treeRow(page, b.noteFolderId));
        await expect(toasts(page).filter({ hasText: 'Folder moved' })).toBeVisible();
        await expect
          .poll(async () => {
            const l = await seed.admin.get<{
              folders: { noteFolderId: number; parentFolderId?: number }[];
            }>(`/api/v1/matters/${w.matter.matterId}/note-folders`);
            return (
              l.folders.find((f) => f.noteFolderId === a1.noteFolderId)?.parentFolderId ?? null
            );
          })
          .toBe(b.noteFolderId);
        // into its own parent chain is greyed: Beta onto Alpha One (its own child) does nothing
        await expand(page, b.noteFolderId);
        await treeRow(page, b.noteFolderId).dragTo(treeRow(page, a1.noteFolderId));
        const l = await seed.admin.get<{
          folders: { noteFolderId: number; parentFolderId?: number }[];
        }>(`/api/v1/matters/${w.matter.matterId}/note-folders`);
        expect(
          l.folders.find((f) => f.noteFolderId === b.noteFolderId)?.parentFolderId ?? null,
        ).toBeNull();
        // Undo (wait until it is done), then to the top level through No Folder
        await toasts(page).filter({ hasText: 'Folder moved' }).locator('[data-undo]').click();
        await expect
          .poll(async () => {
            const x = await seed.admin.get<{
              folders: { noteFolderId: number; parentFolderId?: number }[];
            }>(`/api/v1/matters/${w.matter.matterId}/note-folders`);
            return x.folders.find((f) => f.noteFolderId === a1.noteFolderId)?.parentFolderId;
          })
          .toBe(a.noteFolderId);
        await expect(treeRow(page, a1.noteFolderId)).toBeVisible();
        await treeRow(page, a1.noteFolderId).dragTo(treeRow(page, 'none'));
        await expect
          .poll(async () => {
            const x = await seed.admin.get<{
              folders: { noteFolderId: number; parentFolderId?: number }[];
            }>(`/api/v1/matters/${w.matter.matterId}/note-folders`);
            return (
              x.folders.find((f) => f.noteFolderId === a1.noteFolderId)?.parentFolderId ?? null
            );
          })
          .toBeNull();
      });

      test('Move Folder: itself, its subfolders and the too-deep targets are greyed with a reason; the move works', async ({
        page,
        seed,
      }) => {
        const w = await world(seed);
        const a = await w.folder('Alpha');
        const a1 = await w.folder('Alpha One', a.noteFolderId);
        const b = await w.folder('Beta');
        // a chain of five levels: c1 > c2 > c3 > c4 > c5
        let parent: number | undefined;
        const chain: Folder[] = [];
        for (let i = 1; i <= 5; i += 1) {
          const f = await w.folder(`Chain ${i}`, parent);
          chain.push(f);
          parent = f.noteFolderId;
        }
        await open(page, w.matter.matterId);
        await rowMenu(page, a.noteFolderId, 'move');
        const dlg = dialog(page, 'Move Folder');
        await expect(dlg).toBeVisible();
        await expect(dlg.locator(`[data-pick="${a.noteFolderId}"]`)).toContainText('This folder');
        await expect(dlg.locator(`[data-pick="${a1.noteFolderId}"]`)).toContainText('Inside it');
        await expect(dlg.locator('[data-pick="top"]')).toContainText('Already here');
        // Alpha has two levels, so it cannot go under Chain 4 (it would reach level 6) but can go under Chain 3 (level 5)
        await expect(dlg.locator(`[data-pick="${chain[3].noteFolderId}"]`)).toContainText(
          'Too deep',
        );
        await expect(dlg.locator(`[data-pick="${chain[3].noteFolderId}"]`)).toHaveAttribute(
          'title',
          'It would be more than 5 levels deep.',
        );
        await expect(dlg.locator(`[data-pick="${chain[2].noteFolderId}"]`)).not.toHaveAttribute(
          'aria-disabled',
          'true',
        );
        await noViolations(page);
        // a greyed target cannot be chosen
        await dlg.locator(`[data-pick="${a1.noteFolderId}"]`).click({ force: true });
        await expect(dlg.locator('[data-panel-primary]')).toHaveAttribute('aria-disabled', 'true');
        await dlg.locator(`[data-pick="${b.noteFolderId}"]`).click();
        await dlg.getByRole('button', { name: 'Move Folder', exact: true }).click();
        await expect(dlg).toHaveCount(0);
        await expect(toasts(page).filter({ hasText: 'Folder moved' })).toBeVisible();
        await expect(treeRow(page, a.noteFolderId)).toHaveAttribute('aria-level', '2');
      });

      test('Delete Folder: an empty one after a plain confirm; one with contents is refused as it is and offers Move Contents Up and Delete; notes survive', async ({
        page,
        seed,
      }) => {
        const w = await world(seed);
        const top = await w.folder('Productions');
        const empty = await w.folder('Volume 002', top.noteFolderId);
        const full = await w.folder('Volume 001', top.noteFolderId);
        const keep = `Keep ${uid()}`;
        const n = await w.note(keep, full.noteFolderId);
        await seed.admin.post(`/api/v1/notes/${n.noteId}/lock`, { rowVersion: n.rowVersion });
        await open(page, w.matter.matterId, `&folder=${empty.noteFolderId}`);

        await rowMenu(page, empty.noteFolderId, 'delete');
        const plain = dialog(page, 'Delete Folder');
        await expect(plain).toContainText("Volume 002 is empty. This can't be undone.");
        await expect(plain.getByRole('button', { name: 'Delete Folder' })).toBeVisible();
        await noViolations(page);
        await plain.getByRole('button', { name: 'Delete Folder' }).click();
        await expect(plain).toHaveCount(0);
        await expect(toasts(page).filter({ hasText: 'Folder deleted' })).toBeVisible();
        await expect(treeRow(page, empty.noteFolderId)).toHaveCount(0);
        // the selected folder was deleted: the parent is selected
        await expect(treeRow(page, top.noteFolderId)).toHaveAttribute('aria-selected', 'true');

        await rowMenu(page, full.noteFolderId, 'delete');
        const refuse = dialog(page, 'Delete Folder');
        await expect(refuse).toContainText('Volume 001 holds 1 note.');
        await expect(refuse).toContainText("A folder with contents can't be deleted as it is.");
        await expect(refuse).toContainText('Move Contents Up puts them into Productions');
        await expect(refuse).toContainText('No note is deleted.');
        await expect(
          refuse.getByRole('button', { name: 'Move Contents Up and Delete' }),
        ).toBeVisible();
        await noViolations(page);
        await refuse.getByRole('button', { name: 'Move Contents Up and Delete' }).click();
        await expect(refuse).toHaveCount(0);
        await expect(treeRow(page, full.noteFolderId)).toHaveCount(0);
        // the locked note moved up into Productions, unchanged
        await expect.poll(async () => (await w.get(n.noteId)).folderId).toBe(top.noteFolderId);
        await treeRow(page, top.noteFolderId).click();
        await expect.poll(() => titles(page)).toEqual([keep]);
      });

      test('a name clash while moving contents up is refused and nothing moves', async ({
        page,
        seed,
      }) => {
        const w = await world(seed);
        const root = await w.folder('Root');
        const mid = await w.folder('Middle', root.noteFolderId);
        await w.folder('Same', root.noteFolderId);
        await w.folder('Same', mid.noteFolderId);
        await open(page, w.matter.matterId);
        await expand(page, root.noteFolderId);
        await rowMenu(page, mid.noteFolderId, 'delete');
        const dlg = dialog(page, 'Delete Folder');
        await dlg.getByRole('button', { name: 'Move Contents Up and Delete' }).click();
        await expect(dlg.locator('[data-confirm-error]')).toContainText(/name/i);
        await expect(treeRow(page, mid.noteFolderId)).toBeVisible();
        await noViolations(page);
      });

      test('a person with Edit but not Delete cannot delete a folder; a reader sees the tree and no actions', async ({
        page,
        asUser,
        seed,
      }) => {
        const w = await world(seed);
        const f = await w.folder('Visible');
        const t = `Readable ${uid()}`;
        await w.note(t, f.noteFolderId);
        const editRole = await seed.role(
          ['Matter.View', 'Client.View', 'MatterNote.View', 'MatterNote.Edit'],
          'note editor',
        );
        const editor = await seed.user([editRole.name], 'noteeditor');
        const ep = await asUser(editor.username);
        await ep.setViewportSize(size);
        await open(ep, w.matter.matterId);
        await ep.locator(`[data-folder-list] [data-key="${f.noteFolderId}"]`).hover();
        await ep
          .locator(`[data-folder-list] [data-key="${f.noteFolderId}"] [data-overflow]`)
          .click();
        await expect(ep.locator('[data-action="delete"]')).toHaveAttribute('aria-disabled', 'true');
        await expect(ep.locator('[data-action="delete"]')).toHaveAttribute(
          'title',
          'Delete needs the Matter Note Delete permission.',
        );
        await expect(ep.locator('[data-action="rename"]')).not.toHaveAttribute(
          'aria-disabled',
          'true',
        );
        await noViolations(ep);

        const role = await seed.role(
          ['Matter.View', 'Client.View', 'MatterNote.View'],
          'note reader',
        );
        const reader = await seed.user([role.name], 'notereader');
        const rp = await asUser(reader.username);
        await rp.setViewportSize(size);
        await open(rp, w.matter.matterId);
        await expect(rp.locator('[data-notes-readonly]')).toContainText('Read only');
        await expect(rp.locator('[data-folder-new]')).toHaveCount(0);
        await expect(
          count(rp.locator(`[data-folder-list] [data-key="${f.noteFolderId}"]`)),
        ).toHaveText('1');
        await expect(rp.locator('[data-note-item]').first()).not.toHaveAttribute(
          'draggable',
          'true',
        );
        await rp.locator(`[data-folder-list] [data-key="${f.noteFolderId}"]`).hover();
        await rp
          .locator(`[data-folder-list] [data-key="${f.noteFolderId}"] [data-overflow]`)
          .click();
        for (const id of ['sub', 'rename', 'move', 'delete']) {
          await expect(rp.locator(`[data-action="${id}"]`)).toHaveAttribute(
            'aria-disabled',
            'true',
          );
        }
        await expect(rp.locator('[data-action="rename"]')).toHaveAttribute(
          'title',
          "You don't have permission to change folders.",
        );
        await expect(rp.locator('[data-action="link"]')).not.toHaveAttribute(
          'aria-disabled',
          'true',
        );
        await noViolations(rp);
        await rp.keyboard.press('Escape');
        await rp.locator('[data-note-item]').first().click();
        await expect(rp.locator('[data-note-title]')).toContainText(t);
        await rp.locator('[data-note-actions]').click();
        await expect(rp.locator('[data-note-move]')).toHaveAttribute('aria-disabled', 'true');
        await noViolations(rp);
      });

      test('the tree folds to a rail, the choice is remembered per person (mf.notes.tree) and works with blocked storage', async ({
        page,
        seed,
      }) => {
        const w = await world(seed);
        const f = await w.folder('Alpha');
        await w.note(`Rail ${uid()}`, f.noteFolderId);
        await open(page, w.matter.matterId, `&folder=${f.noteFolderId}`);
        const wide = (await page.locator('[data-folder-tree]').boundingBox())!.width;
        expect(wide).toBeGreaterThan(200);
        await page.locator('[data-folder-hide]').click();
        await expect(page.locator('[data-folder-rail]')).toBeVisible();
        await expect(page.locator('[data-folder-show]')).toBeFocused();
        expect((await page.locator('[data-folder-tree]').boundingBox())!.width).toBeLessThan(60);
        expect(await page.evaluate(() => localStorage.getItem('mf.notes.tree'))).toBe('folded');
        await expect(page.locator('[data-folder-rail-current]')).toHaveAttribute(
          'aria-label',
          'Folder: Alpha',
        );
        await noViolations(page);
        // reload: still folded; the list and the note keep working beside the rail
        await page.reload();
        await expect(page.locator('[data-folder-rail]')).toBeVisible();
        await expect(page.locator('[data-note-item]')).toHaveCount(1);
        await page.locator('[data-folder-rail-all]').click();
        await expect(page.locator('[data-notes-path]')).toContainText('All Notes');
        await page.locator('[data-folder-show]').click();
        await expect(tree(page)).toBeVisible();
        expect(await page.evaluate(() => localStorage.getItem('mf.notes.tree'))).toBeNull();
        await page.reload();
        await expect(tree(page)).toBeVisible();
        await noViolations(page);
      });

      test('blocked storage: the tree opens by default and folding holds for the visit', async ({
        page,
        seed,
      }) => {
        const w = await world(seed);
        await w.folder('Alpha');
        await page.addInitScript(() => {
          const block = () => {
            throw new Error('blocked');
          };
          Storage.prototype.getItem = block;
          Storage.prototype.setItem = block;
          Storage.prototype.removeItem = block;
        });
        await open(page, w.matter.matterId);
        await expect(tree(page)).toBeVisible();
        await page.locator('[data-folder-hide]').click();
        await expect(page.locator('[data-folder-rail]')).toBeVisible();
      });

      test('the tree is hidden in the Templates view and returns; the one-page Matter has no tree', async ({
        page,
        seed,
      }) => {
        const w = await world(seed);
        await w.folder('Alpha');
        await open(page, w.matter.matterId);
        await page.locator('[data-view="templates"]').click();
        await expect(page.locator('[data-folder-tree]')).toHaveCount(0);
        await expect(page.locator('[data-notes-path]')).toHaveCount(0);
        await page.locator('[data-view="latest"]').click();
        await expect(page.locator('[data-folder-tree]')).toBeVisible();
        await page.goto(`/matters/${w.matter.matterId}`);
        await expect(page.locator('h1').first()).toBeVisible();
        await expect(page.locator('mf-note-folder-tree')).toHaveCount(0);
      });

      test('keys of the tree: Down, Up, Right, Left, Home, End, Enter; nothing outside the control', async ({
        page,
        seed,
      }) => {
        const w = await world(seed);
        const a = await w.folder('Alpha');
        const a1 = await w.folder('Alpha One', a.noteFolderId);
        await w.folder('Beta');
        await w.note(`Keys ${uid()}`, a1.noteFolderId);
        await open(page, w.matter.matterId);
        await treeRow(page, 'all').focus();
        await page.keyboard.press('ArrowDown');
        await expect(treeRow(page, 'none')).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await expect(treeRow(page, a.noteFolderId)).toBeFocused();
        await page.keyboard.press('ArrowRight');
        await expect(treeRow(page, a.noteFolderId)).toHaveAttribute('aria-expanded', 'true');
        await page.keyboard.press('ArrowRight');
        await expect(treeRow(page, a1.noteFolderId)).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(treeRow(page, a1.noteFolderId)).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator('[data-note-item]')).toHaveCount(1);
        await page.keyboard.press('ArrowLeft');
        await expect(treeRow(page, a.noteFolderId)).toBeFocused();
        await page.keyboard.press('ArrowLeft');
        await expect(treeRow(page, a.noteFolderId)).toHaveAttribute('aria-expanded', 'false');
        await page.keyboard.press('End');
        await expect(page.locator('[data-folder-list] [role=treeitem]').last()).toBeFocused();
        await page.keyboard.press('Home');
        await expect(treeRow(page, 'all')).toBeFocused();
        await noViolations(page);
        // the row menu is reachable by keyboard: Tab from the row, Enter opens it
        await treeRow(page, a.noteFolderId).focus();
        await page.keyboard.press('Tab');
        await page.keyboard.press('Enter');
        await expect(page.locator('[data-action="rename"]')).toBeVisible();
        await noViolations(page);
        await page.keyboard.press('Escape');
      });

      test('search, pin, lock, tags and the By Tag and Latest views keep working inside the selected folder', async ({
        page,
        seed,
      }) => {
        const w = await world(seed);
        const f = await w.folder('Alpha');
        const one = `One ${uid()}`;
        const two = `Two ${uid()}`;
        const n1 = await w.note(one, f.noteFolderId);
        await w.note(two, f.noteFolderId);
        await w.note(`Outside ${uid()}`);
        await seed.admin.post(`/api/v1/notes/${n1.noteId}/lock`, { rowVersion: n1.rowVersion });
        await open(page, w.matter.matterId, `&folder=${f.noteFolderId}`);
        await expect(page.locator('[data-note-item]')).toHaveCount(2);
        await page.locator('[data-view="latest"]').click();
        await expect(page.locator('[data-note-item]')).toHaveCount(2);
        await page.locator('[data-view="tag"]').click();
        await expect(page.locator('[data-group]')).toHaveCount(1);
        // the Locked filter combines with the folder
        await page.locator('[data-view-options]').click();
        await page.locator('[data-filter="_locked"]').click();
        await page.keyboard.press('Escape');
        await expect(page.locator('[data-note-item]')).toHaveCount(1);
        await expect(page.locator('[data-notes-path] mf-count-chip')).toContainText('1');
        await page.locator('[data-filter-chip] button').first().click();
        // pin works inside the folder
        await page.locator('[data-note-item]', { hasText: two }).click();
        await page.locator('[data-note-actions]').click();
        await page.locator('[data-note-pin]').click();
        await expect(toasts(page).filter({ hasText: 'Note pinned' })).toBeVisible();
        await expect(page.locator('[data-note-item]')).toHaveCount(2);
        await noViolations(page);
      });
    });
  }
});

/** Evidence screenshots for the review (owner requirement); only when E2E_SHOTS_DIR is set. JPEGs are committed to the design-evidence branch only. */
test.describe('evidence', () => {
  test('screenshots of every state at both sizes', async ({ page, seed }) => {
    const dir = process.env['E2E_SHOTS_DIR'];
    test.skip(!dir, 'E2E_SHOTS_DIR is not set');
    fs.mkdirSync(dir!, { recursive: true });
    const w = await world(seed);
    const priv = await w.folder('Privilege Review');
    await w.folder('Privilege Log', priv.noteFolderId);
    const cust = await w.folder('Custodians');
    const exec = await w.folder('Executive Team', cust.noteFolderId);
    await w.folder('Finance', cust.noteFolderId);
    const it = await w.folder('IT and Records', cust.noteFolderId);
    const prod = await w.folder('Productions');
    await w.folder('Volume 001', prod.noteFolderId);
    await w.folder('Volume 002', prod.noteFolderId);
    await w.folder('QC Notes');
    const titles = [
      ['Custodian interview: R. Alvarez (CFO)', exec],
      ['Custodian interview: M. Chen (Controller)', exec],
      ['Mobile device collection status', it],
      ['Backup tape inventory', it],
      ['Privilege review protocol', priv],
    ] as const;
    const notes: Note[] = [];
    for (const [t, f] of titles) notes.push(await w.note(t, f.noteFolderId));
    await w.note('Loose note: scope call recap');
    await seed.admin.post(`/api/v1/notes/${notes[4].noteId}/lock`, {
      rowVersion: notes[4].rowVersion,
    });
    const shot = (name: string, size: { width: number; height: number }) =>
      page.screenshot({
        path: path.join(dir!, `${name}-${size.width}.jpg`),
        type: 'jpeg',
        quality: 70,
      });
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await open(page, w.matter.matterId, `&folder=${exec.noteFolderId}`);
      await page.locator('[data-note-item]').first().click();
      await expect(page.locator('[data-note-title]')).toBeVisible();
      await page.mouse.move(5, 400);
      await shot('1-tree-folder', size);
      await treeRow(page, cust.noteFolderId).hover();
      await treeRow(page, cust.noteFolderId).locator('[data-overflow]').click();
      await shot('2-row-menu', size);
      await page.keyboard.press('Escape');
      await rowMenu(page, cust.noteFolderId, 'sub');
      await dialog(page, 'New Folder').getByLabel('Folder Name').fill('Finance');
      await dialog(page, 'New Folder').getByRole('button', { name: 'Create Folder' }).click();
      await expect(dialog(page, 'New Folder').locator('#nf-name-error')).toBeVisible();
      await page.waitForTimeout(500);
      await shot('3-new-folder-error', size);
      await dialog(page, 'New Folder').getByRole('button', { name: 'Cancel' }).click();
      await rowMenu(page, cust.noteFolderId, 'move');
      await expect(dialog(page, 'Move Folder')).toBeVisible();
      await page.waitForTimeout(500);
      await shot('4-move-folder', size);
      await dialog(page, 'Move Folder').getByRole('button', { name: 'Cancel' }).click();
      await page.locator('[data-note-actions]').click();
      await page.locator('[data-note-move]').click();
      await expect(dialog(page, 'Move Note')).toBeVisible();
      await page.waitForTimeout(500);
      await shot('5-move-note', size);
      await dialog(page, 'Move Note').getByRole('button', { name: 'Cancel' }).click();
      await rowMenu(page, prod.noteFolderId, 'delete');
      await expect(dialog(page, 'Delete Folder')).toBeVisible();
      await page.waitForTimeout(500);
      await shot('6-delete-with-contents', size);
      await page.keyboard.press('Escape');
      await page.locator('[data-folder-hide]').click();
      await page.mouse.move(5, 400);
      await shot('7-rail', size);
      await page.locator('[data-folder-show]').click();
      if (size.width === 1366) {
        // the drag state: the drop target, the label near the pointer, the greyed folders
        const src = page.locator('[data-note-item]').first();
        const dest = treeRow(page, it.noteFolderId);
        await expect(dest).toBeVisible();
        await src.hover();
        await page.mouse.down();
        const box = (await dest.boundingBox())!;
        await page.mouse.move(box.x + 40, box.y + box.height / 2, { steps: 8 });
        for (let i = 1; i <= 3; i += 1) {
          await page.mouse.move(box.x + 40 + i * 3, box.y + box.height / 2);
          await page.waitForTimeout(120);
        }
        await shot('8-drag', size);
        await page.mouse.up();
      }
    }
  });
});
