import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';
import { toasts } from '../support/toasts';

/**
 * Notes round 2 used together (#1412, epic #1405): one note in a nested folder that holds a pasted Word text and a pasted picture is saved, shown again after a reload, kept
 * when its folders are deleted with "Move Contents Up and Delete", and deleted with its picture; a picture added and then cancelled is gone. The single features are walked
 * in notes-folders, notes-paste and notes-images; this spec only proves they work together. Desktop sizes only. No keyboard shortcut is used (#420).
 */
const SIZES = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
];

const WORD = `<html><body><!--StartFragment--><h1 style='color:#2F5496'>Interview plan</h1><p class=MsoNormal><b>Status.</b> <span style='color:#C00000'>Late</span> <s>struck</s></p>
<p class=MsoNormal style='display:none'>HIDDEN-ROUND2</p><table border=1><tr><td><p>Who</p></td><td><p>When</p></td></tr><tr><td><p>Ann</p></td><td><p>Monday</p></td></tr></table><!--EndFragment--></body></html>`;

interface Folder {
  noteFolderId: number;
}
interface Note {
  noteId: number;
  folderId?: number | null;
  bodyHtml: string;
}

async function pastePicture(page: Page) {
  await page.locator('.ProseMirror').evaluate(async (el) => {
    const c = document.createElement('canvas');
    c.width = 640;
    c.height = 400;
    const g = c.getContext('2d') as CanvasRenderingContext2D;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 640, 400);
    g.fillStyle = '#217346';
    g.fillRect(0, 0, 640, 60);
    const blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b as Blob), 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'shot.png', { type: 'image/png' }));
    el.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    );
  });
}

async function pasteWord(page: Page) {
  await page.locator('.ProseMirror').evaluate((el, html) => {
    const dt = new DataTransfer();
    dt.setData('text/html', html);
    dt.setData('text/plain', 'Interview plan');
    el.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    );
  }, WORD);
}

const isUpload = (r: import('@playwright/test').Response) =>
  /\/matters\/\d+\/note-images$/.test(r.url()) && r.request().method() === 'POST';

const status = async (page: Page, id: number) =>
  (await page.request.get(`/api/v1/notes/images/${id}`)).status();

for (const size of SIZES) {
  test.describe(`Notes folders, images and paste together at ${size.width}x${size.height}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(size);
    });

    test('a note with pasted text and a picture in a nested folder: save, reload, delete the folders, delete the note', async ({
      page,
      seed,
    }) => {
      const client = await seed.client({ name: `R2 Client ${uid()}` });
      const matter = await seed.matter({ client, name: `R2 Matter ${uid()}` });
      const top = await seed.admin.post<Folder>('/api/v1/note-folders', {
        matterId: matter.matterId,
        name: 'Custodians',
      });
      const inner = await seed.admin.post<Folder>('/api/v1/note-folders', {
        matterId: matter.matterId,
        parentFolderId: top.noteFolderId,
        name: 'Interviews',
      });

      // New Note in the selected nested folder, pasted Word text and a pasted picture, Save.
      await page.goto(`/matters/${matter.matterId}?tab=notes&folder=${inner.noteFolderId}`);
      await expect(page.locator('[data-folder-tree]')).toBeVisible();
      await page.locator('[data-new-note]').click();
      await page.locator('.ProseMirror').click();
      await pasteWord(page);
      const ed = page.locator('.ProseMirror');
      await expect(ed.locator('h1')).toHaveText('Interview plan');
      await expect(ed).not.toContainText('HIDDEN-ROUND2');
      const answer = page.waitForResponse(isUpload);
      await pastePicture(page);
      const imageId = ((await (await answer).json()) as { noteImageId: number }).noteImageId;
      await expect(
        page.locator(`.ne-img[data-image-id="${imageId}"][data-image-state="ok"]`),
      ).toBeVisible();
      const saved = page.waitForResponse(
        (r) => /\/api\/v1\/notes$/.test(r.url()) && r.request().method() === 'POST',
      );
      await page.locator('[data-note-save]').click();
      const note = (await (await saved).json()) as Note;
      expect(note.folderId).toBe(inner.noteFolderId);
      expect(note.bodyHtml).toContain('<h1>Interview plan</h1>');
      expect(note.bodyHtml).toContain(`data-image-id="${imageId}"`);
      expect(note.bodyHtml).not.toMatch(/HIDDEN-ROUND2|style=|color/);

      // Reload: the note is in its folder, the text and the picture show.
      await page.reload();
      await expect(page.locator('[data-notes-tab]')).toBeVisible();
      await expect(page.locator('[data-note-item]')).toHaveCount(1);
      await page.locator('[data-note-item]').first().click();
      await expect(
        page.locator(`.ne-img[data-image-id="${imageId}"][data-image-state="ok"]`),
      ).toBeVisible();
      await expect(page.locator('[data-notes-tab] table td', { hasText: 'Monday' })).toBeVisible();
      if (axeAvailable()) expect(await axeViolations(page, '[data-notes-tab]')).toEqual([]);

      // Delete the nested folders with "Move Contents Up and Delete": the note and its picture stay.
      for (const id of [inner.noteFolderId, top.noteFolderId]) {
        const row = page.locator(`[data-folder-list] [data-key="${id}"]`);
        await row.hover();
        await row.locator('[data-overflow]').click();
        await page.locator('[data-action="delete"]').click();
        const dlg = page.getByRole('dialog', { name: 'Delete Folder' });
        await dlg.getByRole('button', { name: 'Move Contents Up and Delete' }).click();
        await expect(dlg).toHaveCount(0);
        await expect(row).toHaveCount(0);
      }
      await expect(toasts(page).filter({ hasText: 'Folder deleted' }).first()).toBeVisible();
      const after = await seed.admin.get<Note>(`/api/v1/notes/${note.noteId}`);
      expect(after.folderId ?? null).toBeNull();
      expect(after.bodyHtml).toContain(`data-image-id="${imageId}"`);
      expect(await status(page, imageId)).toBe(200);

      // Delete the note: its picture goes with it.
      await page.reload();
      await expect(page.locator('[data-note-item]')).toHaveCount(1);
      await page.locator('[data-note-item]').first().click();
      await page.locator('[data-note-actions]').click();
      await page.locator('[data-note-delete]').click();
      await page
        .getByRole('dialog', { name: 'Delete Note' })
        .getByRole('button', { name: 'Delete Note' })
        .click();
      await expect.poll(() => status(page, imageId)).toBe(404);
    });

    test('a picture pasted into a new note and then cancelled is deleted; the note in its folder is untouched', async ({
      page,
      seed,
    }) => {
      const client = await seed.client({ name: `R2 Client ${uid()}` });
      const matter = await seed.matter({ client, name: `R2 Matter ${uid()}` });
      const folder = await seed.admin.post<Folder>('/api/v1/note-folders', {
        matterId: matter.matterId,
        name: 'Drafts',
      });
      await page.goto(`/matters/${matter.matterId}?tab=notes&folder=${folder.noteFolderId}`);
      await expect(page.locator('[data-folder-tree]')).toBeVisible();
      await page.locator('[data-new-note]').click();
      await page.locator('.ProseMirror').click();
      await page.keyboard.type('Draft that will be cancelled');
      const answer = page.waitForResponse(isUpload);
      await pastePicture(page);
      const id = ((await (await answer).json()) as { noteImageId: number }).noteImageId;
      expect(await status(page, id)).toBe(200);
      const deleted = page.waitForResponse(
        (r) => r.url().endsWith(`/note-images/${id}`) && r.request().method() === 'DELETE',
      );
      await page.locator('[data-note-cancel]').click();
      await page.getByRole('button', { name: 'Discard Changes' }).click();
      expect((await deleted).status()).toBe(204);
      expect(await status(page, id)).toBe(404);
      const list = await seed.admin.get<{ items: unknown[] }>(
        `/api/v1/notes?matterId=${matter.matterId}`,
      );
      expect(list.items).toHaveLength(0);
    });
  });
}
