import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Seeder, uid } from '../support/seed';

/**
 * Pasted images in matter notes (#1410, epic #1405; design note docs/ux/notes-round-2/README.md section 4, rule D-46d; backend #1409): a screenshot or "Copy Image" pasted
 * into a note is re-drawn in the browser, uploaded at once and inserted; it shows a placeholder while it goes up, a red block with Retry and Remove when it fails (Save is
 * off meanwhile), and Cancel deletes what was never saved. A selected image has corner handles, a live size readout and the image bar (Small, Medium, Large, Original,
 * Fit to Width, Alt Text, Remove); the same sizes come from Image Details (alt text, exact width), so dragging is never the only way. A saved image shows again after a
 * reload at its stored size; read-only and locked notes show it without handles; a missing image shows a clear block; an image pasted from a note of another matter is
 * copied. Paste events are simulated with a dispatched ClipboardEvent holding a DataTransfer with a real PNG made in the page (no OS clipboard). No keyboard shortcut is
 * used or added (#420). Desktop sizes only (D-82). Set IMAGES_EVIDENCE_DIR to write the evidence screenshots (they go to the design-evidence branch, never to dev).
 */
const SIZES = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
];

async function world(seed: Seeder) {
  const client = await seed.client({ name: `Image Client ${uid()}` });
  const matter = await seed.matter({ client, name: `Image Matter ${uid()}` });
  return { client, matter };
}

async function newNote(page: Page, matterId: number, title = 'Log batch 3: column mapping check') {
  await page.goto(`/matters/${matterId}?tab=notes`);
  await expect(page.locator('[data-notes-tab]')).toBeVisible();
  await page.locator('[data-new-note]').click();
  const ed = page.locator('.ProseMirror');
  await ed.click();
  await page.keyboard.type(title);
  await page.keyboard.press('Enter');
  await page.keyboard.type('Hannah’s export cuts the privilege basis column short.');
  await page.keyboard.press('Enter');
}

type PasteSpec = {
  name?: string;
  w?: number;
  h?: number;
  type?: string;
  /** `shot`: a drawn spreadsheet screenshot; `noise`: random pixels (does not compress); `garbage`: bytes that are no image. */
  kind?: 'shot' | 'noise' | 'garbage';
};

/** A paste of one picture file as a screenshot puts it on the clipboard: no text, a DataTransfer with a File. The PNG is drawn in the page. */
async function pastePicture(page: Page, spec: PasteSpec = {}) {
  await page.locator('.ProseMirror').evaluate(async (el, s) => {
    const kind = s.kind ?? 'shot';
    const name = s.name ?? 'privilege-log.png';
    const type = s.type ?? 'image/png';
    let blob: Blob;
    if (kind === 'garbage') {
      blob = new Blob([new Uint8Array(4000).map((_v, i) => (i * 37) % 251)], { type });
    } else {
      const c = document.createElement('canvas');
      c.width = s.w ?? 1200;
      c.height = s.h ?? 750;
      const g = c.getContext('2d') as CanvasRenderingContext2D;
      if (kind === 'noise') {
        const px = g.createImageData(c.width, c.height);
        for (let i = 0; i < px.data.length; i += 4) {
          // random black or white per channel: the JPEG of 1600 x 1600 of this is over 2 MB
          px.data[i] = Math.random() < 0.5 ? 0 : 255;
          px.data[i + 1] = Math.random() < 0.5 ? 0 : 255;
          px.data[i + 2] = Math.random() < 0.5 ? 0 : 255;
          px.data[i + 3] = 255;
        }
        g.putImageData(px, 0, 0);
      } else {
        g.fillStyle = '#ffffff';
        g.fillRect(0, 0, c.width, c.height);
        g.fillStyle = '#217346';
        g.fillRect(0, 0, c.width, 68);
        g.fillStyle = '#ffffff';
        g.font = '600 26px sans-serif';
        g.fillText('Privilege Log - Batch 3.xlsx', 24, 44);
        const cols = ['Control No.', 'Date', 'Author', 'Recipients', 'Basis', 'Description'];
        const xs = [0, 150, 290, 430, 700, 800];
        g.font = '22px sans-serif';
        for (let r = 0; r < 12; r++) {
          g.fillStyle = r === 0 ? '#e7edf4' : r === 4 ? '#fff3c4' : '#ffffff';
          g.fillRect(0, 68 + r * 56, c.width, 56);
          g.fillStyle = '#1b1f27';
          cols.forEach((h, i) =>
            g.fillText(
              r === 0 ? h : i === 0 ? `HART-${412 + r}` : `${h} ${r}`,
              xs[i] + 12,
              104 + r * 56,
            ),
          );
          g.fillStyle = '#d0d7de';
          g.fillRect(0, 123 + r * 56, c.width, 1);
        }
      }
      blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b as Blob), 'image/png'));
    }
    const dt = new DataTransfer();
    dt.items.add(new File([blob], name, { type }));
    el.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    );
  }, spec);
}

/** The images of the note as the editor stores them (`<img data-image-id alt width height>`), read from the node views. */
const bodyOf = (page: Page) =>
  page.locator('.ProseMirror').evaluate((el) =>
    Array.from(el.querySelectorAll<HTMLElement>('.ne-img')).map((v) => {
      const frame = v.querySelector<HTMLElement>('.ne-img__frame') as HTMLElement;
      const [w, h] = frame.style.aspectRatio.split('/').map((x) => x.trim());
      const alt = (v.querySelector('img') as HTMLImageElement).alt;
      return `<img data-image-id="${v.dataset['imageId']}" alt="${alt}" width="${w}" height="${h}">`;
    }),
  );

async function shot(page: Page, name: string, size: { width: number; height: number }) {
  const dir = process.env['IMAGES_EVIDENCE_DIR'];
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}-${size.width}x${size.height}.png`) });
}

async function noViolations(page: Page, include = '[data-notes-tab]') {
  test.skip(!axeAvailable(), 'axe-core is not available');
  expect(await axeViolations(page, include)).toEqual([]);
}

const isUpload = (r: import('@playwright/test').Response) =>
  /\/matters\/\d+\/note-images$/.test(r.url()) && r.request().method() === 'POST';

/** Pastes a picture and waits for the upload to be answered; returns the new image id. */
async function addPicture(page: Page, spec: PasteSpec = {}): Promise<number> {
  const answer = page.waitForResponse(isUpload);
  await pastePicture(page, spec);
  const res = await answer;
  expect(res.status()).toBe(201);
  const id = ((await res.json()) as { noteImageId: number }).noteImageId;
  await expect(page.locator(`.ne-img[data-image-id="${id}"][data-image-state="ok"]`)).toBeVisible();
  return id;
}

const saveNote = async (page: Page) => {
  const saved = page.waitForResponse(
    (r) =>
      /\/api\/v1\/notes(\/\d+)?$/.test(r.url()) && ['POST', 'PUT'].includes(r.request().method()),
  );
  await page.locator('[data-note-save]').click();
  const res = await saved;
  expect([200, 201]).toContain(res.status());
  return (await res.json()) as { noteId: number; bodyHtml: string };
};

const widthOf = (page: Page) =>
  page
    .locator('.ne-img__frame')
    .first()
    .evaluate((f) => Math.round(f.getBoundingClientRect().width));

for (const size of SIZES) {
  test.describe(`Note images at ${size.width}x${size.height}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(size);
    });

    test('a pasted screenshot uploads at once, shows a placeholder, then the selected image with handles and the bar; Save keeps it and a reload shows it', async ({
      page,
      seed,
    }) => {
      const w = await world(seed);
      await newNote(page, w.matter.matterId);
      // hold the upload a moment so the placeholder can be seen
      await page.route(/\/matters\/\d+\/note-images$/, async (route) => {
        await new Promise((r) => setTimeout(r, 1200));
        await route.continue();
      });
      const answer = page.waitForResponse(isUpload);
      await pastePicture(page);
      const slot = page.locator('[data-image-slot]');
      await expect(slot).toBeVisible();
      await expect(slot).toContainText('Adding image...');
      await expect(slot).toContainText('privilege-log.png');
      await expect(page.locator('[data-image-why]')).toHaveText(
        'Save is off until the image is added or removed.',
      );
      await expect(page.locator('[data-note-save]')).toBeDisabled();
      await shot(page, 'image-uploading', size);
      await noViolations(page);
      const id = ((await (await answer).json()) as { noteImageId: number }).noteImageId;
      await expect(slot).toHaveCount(0);
      await expect(page.locator('[data-image-why]')).toHaveCount(0);
      const frame = page.locator('.ne-img--sel .ne-img__frame');
      await expect(frame).toBeVisible();
      // inserted at min(natural 1200, 720, editor width), ratio kept, default alt text, selected with the bar showing
      expect(await bodyOf(page)).toEqual([
        `<img data-image-id="${id}" alt="Pasted image" width="720" height="450">`,
      ]);
      await expect(page.locator('.ne-img__hd')).toHaveCount(4);
      await expect(page.locator('.ne-img__readout')).toHaveText('720 x 450 px · 60% of original');
      const bar = page.getByRole('toolbar', { name: 'Image tools' });
      await expect(bar.getByRole('button')).toHaveText([
        'Small',
        'Medium',
        'Large',
        'Original',
        'Fit to Width',
        'Alt Text',
        'Remove',
      ]);
      await expect(bar.getByRole('button', { name: 'Large' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await shot(page, 'image-selected', size);
      await noViolations(page);
      await expect(page.locator('[data-note-save]')).toBeEnabled();
      const saved = await saveNote(page);
      expect(saved.bodyHtml).toContain(
        `<img data-image-id="${id}" alt="Pasted image" width="720" height="450">`,
      );
      // read mode: the stored size, no handles, no bar
      await expect(page.locator('.ne-img--read .ne-img__frame')).toBeVisible();
      await expect(page.locator('.ne-img__hd, .ne-img__bar')).toHaveCount(0);
      await page.reload();
      await expect(page.locator('[data-notes-tab]')).toBeVisible();
      await page.locator('[data-note-item]').first().click();
      const pic = page.locator('.ne-img[data-image-state="ok"] img');
      await expect(pic).toBeVisible();
      // the stored width is 720; the reading pane may be narrower, then the image shrinks with its ratio kept (design note 4.6)
      const room = await page.locator('.ProseMirror').evaluate((el) => el.clientWidth);
      expect(await widthOf(page)).toBe(Math.min(720, room));
      await expect(pic).toHaveAttribute('alt', 'Pasted image');
      await expect(pic).toHaveJSProperty('complete', true);
      expect(await pic.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(1200);
      await shot(page, 'image-read-mode', size);
      await noViolations(page);
      // click opens the original in a new tab, which shows the bytes
      const [tab] = await Promise.all([
        page.context().waitForEvent('page'),
        page.locator('.ne-img__frame').click(),
      ]);
      await tab.waitForLoadState();
      expect(tab.url()).toMatch(/^blob:/);
      await tab.close();
    });

    test('resize by a corner handle (ratio locked, live readout), by the bar presets and by Image Details; sizes are stored', async ({
      page,
      seed,
    }) => {
      const w = await world(seed);
      await newNote(page, w.matter.matterId);
      const id = await addPicture(page);
      const bar = page.getByRole('toolbar', { name: 'Image tools' });
      const readout = page.locator('.ne-img__readout');
      // the corner handle: drag the south east corner left by 240 px (scroll the text box so the corner is in view, as a person would)
      await page.locator('.ne__area').evaluate((a) => (a.scrollTop = a.scrollHeight));
      const hd = page.locator('[data-handle="se"]');
      const box = (await hd.boundingBox()) as {
        x: number;
        y: number;
        width: number;
        height: number;
      };
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx - 120, cy, { steps: 6 });
      await page.mouse.move(cx - 240, cy, { steps: 6 });
      await expect(readout).toContainText('480 x 300 px');
      await expect(readout).toContainText('40% of original');
      await shot(page, 'image-resize-drag', size);
      await page.mouse.up();
      expect(await bodyOf(page)).toEqual([
        `<img data-image-id="${id}" alt="Pasted image" width="480" height="300">`,
      ]);
      await expect(bar.getByRole('button', { name: 'Medium' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      // the minimum is 48 px: a long drag to the left edge of the window stops there
      const hd2 = (await hd.boundingBox()) as typeof box;
      await page.mouse.move(hd2.x + 6, hd2.y + 6);
      await page.mouse.down();
      await page.mouse.move(2, hd2.y + 6, { steps: 8 });
      await page.mouse.up();
      expect(await widthOf(page)).toBe(48);
      // the bar: Small, Large, Original, Fit to Width
      await bar.getByRole('button', { name: 'Small' }).click();
      expect(await widthOf(page)).toBe(240);
      await expect(readout).toHaveText('240 x 150 px · 20% of original');
      await bar.getByRole('button', { name: 'Original' }).click();
      const original = await widthOf(page);
      expect(original).toBeLessThanOrEqual(1200);
      await bar.getByRole('button', { name: 'Fit to Width' }).click();
      const fit = await widthOf(page);
      const room = await page
        .locator('.ProseMirror')
        .evaluate((el) => (el as HTMLElement).clientWidth);
      expect(fit).toBeLessThanOrEqual(room);
      await bar.getByRole('button', { name: 'Medium' }).click();
      // Image Details, without dragging: the Alt Text button of the bar
      await bar.getByRole('button', { name: 'Alt Text' }).click();
      const dlg = page.getByRole('dialog', { name: 'Image Details' });
      await expect(dlg).toBeVisible();
      await expect(dlg.getByLabel('Alt Text')).toHaveValue('Pasted image');
      await expect(dlg).toContainText('Height follows: 300 px. Original is 1200 x 750 px.');
      await expect(dlg.getByRole('group', { name: 'Size' }).getByRole('button')).toHaveText([
        'Small',
        'Medium',
        'Large',
        'Original',
        'Fit to Width',
      ]);
      await dlg.getByLabel('Alt Text').fill('Privilege log, first rows');
      await expect(dlg).toContainText('25 / 200');
      await dlg.getByLabel('Width (px)').fill('20');
      await expect(dlg.getByRole('alert')).toContainText('Enter a width from 48 to');
      await dlg.getByLabel('Width (px)').fill('600');
      await expect(dlg).toContainText('Height follows: 375 px.');
      await shot(page, 'image-details', size);
      await noViolations(page, '[role="dialog"]');
      await dlg.getByRole('button', { name: 'Save Changes' }).click();
      await expect(dlg).toHaveCount(0);
      expect(await bodyOf(page)).toEqual([
        `<img data-image-id="${id}" alt="Privilege log, first rows" width="600" height="375">`,
      ]);
      const saved = await saveNote(page);
      expect(saved.bodyHtml).toContain(
        `<img data-image-id="${id}" alt="Privilege log, first rows" width="600" height="375">`,
      );
      await page.reload();
      await page.locator('[data-note-item]').first().click();
      await expect(page.locator('.ne-img[data-image-state="ok"]')).toBeVisible();
      const readRoom = await page.locator('.ProseMirror').evaluate((el) => el.clientWidth);
      expect(await widthOf(page)).toBe(Math.min(600, readRoom));
      await expect(page.locator('.ne-img img')).toHaveAttribute('alt', 'Privilege log, first rows');
    });

    test('Image Details by keyboard (Enter on the selected image) and Remove Image; the arrow keys do not resize', async ({
      page,
      seed,
    }) => {
      const w = await world(seed);
      await newNote(page, w.matter.matterId);
      await addPicture(page);
      const before = await widthOf(page);
      await page.keyboard.press('ArrowRight');
      expect(await widthOf(page)).toBe(before);
      await page.locator('.ne-img__frame').click();
      await page.keyboard.press('Tab'); // from the text, Tab reaches the image bar
      await expect(page.locator('.ne-img__bar button:focus')).toHaveCount(1);
      await page.keyboard.press('ArrowRight');
      await expect(page.locator('.ne-img__bar [data-preset="medium"]')).toBeFocused();
      await page.keyboard.press('Escape'); // and Esc returns to the text
      await page.locator('.ne-img__frame').click();
      await page.keyboard.press('Enter');
      const dlg = page.getByRole('dialog', { name: 'Image Details' });
      await expect(dlg).toBeVisible();
      await dlg.getByRole('button', { name: 'Remove Image' }).click();
      await expect(page.locator('.ne-img')).toHaveCount(0);
      await expect(page.locator('.ProseMirror')).toContainText('privilege basis column');
    });

    test('a failed upload shows the red block with Retry and Remove, keeps Save off, and Retry sends the same picture again', async ({
      page,
      seed,
    }) => {
      const w = await world(seed);
      await newNote(page, w.matter.matterId, 'Log batch 3: export screenshots');
      let failing = true;
      await page.route(/\/matters\/\d+\/note-images$/, async (route) => {
        if (failing) await route.abort('connectionfailed');
        else await route.continue();
      });
      await pastePicture(page, { name: 'error-banner.png' });
      const slot = page.locator('[data-image-slot]');
      await expect(slot).toHaveAttribute('data-slot-state', 'failed');
      await expect(slot).toContainText("Couldn't add the image.");
      await expect(slot).toContainText(
        "The upload didn't finish. Check your connection and try again.",
      );
      await expect(slot.getByRole('alert')).toHaveCount(0); // the block itself is the alert
      await expect(slot).toHaveAttribute('role', 'alert');
      await expect(slot.getByRole('button', { name: 'Retry' })).toBeVisible();
      await expect(slot.getByRole('button', { name: 'Remove' })).toBeVisible();
      await expect(page.locator('[data-image-why]')).toBeVisible();
      await expect(page.locator('[data-note-save]')).toBeDisabled();
      await expect(page.locator('[data-toast]')).toHaveCount(0); // inline only, no toast (D-51)
      await shot(page, 'image-failed', size);
      await noViolations(page);
      failing = false;
      const answer = page.waitForResponse(isUpload);
      await slot.getByRole('button', { name: 'Retry' }).click();
      expect((await answer).status()).toBe(201);
      await expect(page.locator('[data-image-slot]')).toHaveCount(0);
      await expect(page.locator('.ne-img[data-image-state="ok"]')).toBeVisible();
      await expect(page.locator('[data-note-save]')).toBeEnabled();
      // a refusal that Retry cannot fix: no Retry button; Remove puts Save back on
      await page.unroute(/\/matters\/\d+\/note-images$/);
      await pastePicture(page, { kind: 'garbage', name: 'notes.png' });
      const bad = page.locator('[data-image-slot]');
      await expect(bad).toContainText(
        "This image type isn't supported. Paste a PNG or JPEG, or take a screenshot.",
      );
      await expect(bad.getByRole('button', { name: 'Retry' })).toHaveCount(0);
      await expect(page.locator('[data-note-save]')).toBeDisabled();
      await shot(page, 'image-failed-type', size);
      await noViolations(page);
      await bad.getByRole('button', { name: 'Remove' }).click();
      await expect(page.locator('[data-image-slot]')).toHaveCount(0);
      await expect(page.locator('[data-note-save]')).toBeEnabled();
    });

    test('over 2 MB after shrinking is refused with the reason, and a server refusal (inactive matter) shows its own', async ({
      page,
      seed,
    }) => {
      const w = await world(seed);
      await newNote(page, w.matter.matterId);
      await pastePicture(page, { kind: 'noise', w: 1600, h: 1600, name: 'photo.png' });
      const slot = page.locator('[data-image-slot]');
      await expect(slot).toContainText(
        'It is larger than 2 MB even after shrinking. Crop it or take a smaller screenshot.',
        { timeout: 30_000 },
      );
      await expect(slot.getByRole('button', { name: 'Retry' })).toBeVisible();
      await shot(page, 'image-failed-size', size);
      await noViolations(page);
      await slot.getByRole('button', { name: 'Remove' }).click();
      // the server says the matter is inactive
      await page.route(/\/matters\/\d+\/note-images$/, (route) =>
        route.fulfill({
          status: 409,
          contentType: 'application/problem+json',
          body: JSON.stringify({ status: 409, code: 'MATTER_INACTIVE', title: 'Inactive' }),
        }),
      );
      await pastePicture(page);
      await expect(page.locator('[data-image-slot]')).toContainText(
        "This matter is inactive; notes can't get new images.",
      );
      await expect(page.locator('[data-slot-retry]')).toHaveCount(0);
    });

    test('Cancel deletes an image that was never saved; a saved image stays', async ({
      page,
      seed,
    }) => {
      const w = await world(seed);
      await newNote(page, w.matter.matterId);
      const id = await addPicture(page);
      expect((await page.request.get(`/api/v1/notes/images/${id}`)).status()).toBe(200);
      const deleted = page.waitForResponse(
        (r) => r.url().endsWith(`/note-images/${id}`) && r.request().method() === 'DELETE',
      );
      await page.locator('[data-note-cancel]').click();
      await page.getByRole('button', { name: 'Discard Changes' }).click();
      expect((await deleted).status()).toBe(204);
      expect((await page.request.get(`/api/v1/notes/images/${id}`)).status()).toBe(404);
      // a saved image is not touched by a later Cancel
      await newNote(page, w.matter.matterId);
      const kept = await addPicture(page);
      await saveNote(page);
      await page.locator('[data-note-edit]').click();
      await expect(page.locator('[data-editor-toolbar]')).toBeVisible();
      await page.locator('.ProseMirror').click();
      const again = await addPicture(page);
      const del = page.waitForResponse(
        (r) => r.url().endsWith(`/note-images/${again}`) && r.request().method() === 'DELETE',
      );
      await page.locator('[data-note-cancel]').click();
      await page.getByRole('button', { name: 'Discard Changes' }).click();
      await del;
      expect((await page.request.get(`/api/v1/notes/images/${kept}`)).status()).toBe(200);
      expect((await page.request.get(`/api/v1/notes/images/${again}`)).status()).toBe(404);
    });

    test('a removed image is deleted by the save that drops its last reference', async ({
      page,
      seed,
    }) => {
      const w = await world(seed);
      await newNote(page, w.matter.matterId);
      const id = await addPicture(page);
      await saveNote(page);
      await page.locator('[data-note-edit]').click();
      await page.locator('.ne-img__frame').click();
      await page
        .getByRole('toolbar', { name: 'Image tools' })
        .getByRole('button', { name: 'Remove' })
        .click();
      await saveNote(page);
      expect((await page.request.get(`/api/v1/notes/images/${id}`)).status()).toBe(404);
    });

    test('Undo takes a pasted image out in one step', async ({ page, seed }) => {
      const w = await world(seed);
      await newNote(page, w.matter.matterId);
      await addPicture(page);
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect(page.locator('.ne-img')).toHaveCount(0);
      await page.getByRole('button', { name: 'Redo', exact: true }).click();
      await expect(page.locator('.ne-img[data-image-state="ok"]')).toBeVisible();
    });

    test('a note holds 20 images: the 21st is refused with the reason', async ({ page, seed }) => {
      const w = await world(seed);
      await newNote(page, w.matter.matterId);
      for (let i = 0; i < 20; i++) await addPicture(page, { w: 100, h: 60, name: `s${i}.png` });
      await expect(page.locator('.ne-img')).toHaveCount(20);
      await pastePicture(page, { w: 100, h: 60, name: 'one-too-many.png' });
      await expect(page.locator('[data-image-slot]')).toContainText(
        'A note can hold up to 20 images. Remove one first.',
      );
      await expect(page.locator('[data-slot-retry]')).toHaveCount(0);
      await shot(page, 'image-failed-count', size);
      await noViolations(page);
      // Cancel deletes all twenty uploads (the person never saved them)
      let deleted = 0;
      page.on('response', (r) => {
        if (/\/note-images\/\d+$/.test(r.url()) && r.request().method() === 'DELETE') deleted++;
      });
      await page.locator('[data-note-cancel]').click();
      await page.getByRole('button', { name: 'Discard Changes' }).click();
      await expect.poll(() => deleted).toBe(20);
    });

    test('an image pasted from a note of ANOTHER matter is copied and the id swapped; the note saves', async ({
      page,
      seed,
    }) => {
      const a = await world(seed);
      const b = await world(seed);
      await newNote(page, a.matter.matterId);
      const idA = await addPicture(page);
      await saveNote(page);
      // matter B: paste the html a note of matter A puts on the clipboard
      await newNote(page, b.matter.matterId, 'Copied between matters');
      const copied = page.waitForResponse(
        (r) => /\/note-images\/\d+\/copy$/.test(r.url()) && r.request().method() === 'POST',
      );
      await page.locator('.ProseMirror').evaluate((el, id) => {
        const dt = new DataTransfer();
        dt.setData(
          'text/html',
          `<meta charset="utf-8"><p data-pm-slice="1 1 []">Evidence summary</p><img data-image-id="${id}" alt="Privilege log" width="480" height="300">`,
        );
        dt.setData('text/plain', 'Evidence summary');
        el.dispatchEvent(
          new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
        );
      }, idA);
      const res = await copied;
      expect(res.status()).toBe(201);
      const idB = ((await res.json()) as { noteImageId: number }).noteImageId;
      expect(idB).not.toBe(idA);
      await expect(page.locator(`.ne-img[data-image-id="${idB}"]`)).toBeVisible();
      await expect(page.locator(`.ne-img[data-image-id="${idA}"]`)).toHaveCount(0);
      await expect(page.locator('[data-note-save]')).toBeEnabled();
      const saved = await saveNote(page);
      expect(saved.bodyHtml).toContain(`data-image-id="${idB}"`);
      expect(saved.bodyHtml).not.toContain(`data-image-id="${idA}"`);
      await page.reload();
      await page.locator('[data-note-item]').first().click();
      await expect(page.locator('.ne-img[data-image-state="ok"]')).toBeVisible();
    });

    test('a paste of text with pictures inside (Word, Outlook) still drops them and says so', async ({
      page,
      seed,
    }) => {
      const w = await world(seed);
      await newNote(page, w.matter.matterId);
      await page.locator('.ProseMirror').evaluate((el) => {
        const dt = new DataTransfer();
        dt.setData(
          'text/html',
          '<p>Report with <img src="file:///C:/Users/a/clip_image001.png"> a picture</p><p><img src="cid:image002.png@01D8"></p>',
        );
        dt.setData('text/plain', 'Report with a picture');
        el.dispatchEvent(
          new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
        );
      });
      await expect(page.getByText('Pasted without 2 images')).toBeVisible();
      await expect(page.locator('.ne-img, [data-image-slot]')).toHaveCount(0);
    });

    test('a missing image shows a clear block and the text stays; a save that names a vanished image drops it and saves again', async ({
      page,
      seed,
    }) => {
      const w = await world(seed);
      await newNote(page, w.matter.matterId);
      const id = await addPicture(page);
      const saved = await saveNote(page);
      expect(saved.bodyHtml).toContain(`data-image-id="${id}"`);
      // the image vanishes (another save deleted it): the server answers 404 for the bytes
      await page.route(new RegExp(`/notes/images/${id}$`), (route) =>
        route.fulfill({
          status: 404,
          contentType: 'application/problem+json',
          body: JSON.stringify({ status: 404, code: 'IMAGE_NOT_FOUND', title: 'Not found' }),
        }),
      );
      await page.reload();
      await expect(page.locator('[data-notes-tab]')).toBeVisible();
      await page.locator('[data-note-item]').first().click();
      const off = page.locator('.ne-img[data-image-state="missing"]');
      await expect(off).toBeVisible();
      await expect(off).toContainText('This image is no longer available.');
      await expect(off).toContainText('The text around it is still here.');
      await expect(page.locator('.ProseMirror')).toContainText('privilege basis column');
      await shot(page, 'image-missing-read', size);
      await noViolations(page);
      // editing: the bar offers Remove for the missing image, and the save answer IMAGE_NOT_FOUND drops it
      await page.locator('[data-note-edit]').click();
      await expect(page.locator('.ne-img[data-image-state="missing"]')).toBeVisible();
      await shot(page, 'image-missing-edit', size);
      await noViolations(page);
      let first = true;
      await page.route(/\/api\/v1\/notes\/\d+$/, async (route) => {
        if (route.request().method() === 'PUT' && first) {
          first = false;
          await route.fulfill({
            status: 400,
            contentType: 'application/problem+json',
            body: JSON.stringify({
              status: 400,
              code: 'IMAGE_NOT_FOUND',
              title: 'Image not found',
              meta: { imageIds: [id] },
              errors: {
                bodyHtml: [{ code: 'IMAGE_NOT_FOUND', message: 'An image was not found.' }],
              },
            }),
          });
        } else await route.continue();
      });
      await page.locator('.ProseMirror').click();
      await page.keyboard.press('Control+End');
      await page.keyboard.type(' Edited.');
      await page.locator('[data-note-save]').click();
      await expect(page.getByText('1 image was no longer available')).toBeVisible();
      await expect(page.locator('.ne-img')).toHaveCount(0);
      await expect(page.locator('[data-note-save]')).toHaveCount(0); // saved, back in read mode
      await expect(page.locator('.ProseMirror')).toContainText('Edited.');
    });

    test('a read-only person and a locked note see the image at its stored size, with no handles and no bar', async ({
      page,
      asUser,
      seed,
    }) => {
      const w = await world(seed);
      await newNote(page, w.matter.matterId);
      const id = await addPicture(page);
      const saved = await saveNote(page);
      const role = await seed.role(
        ['Matter.View', 'Client.View', 'MatterNote.View'],
        'image reader',
      );
      const reader = await seed.user([role.name], 'imgreader');
      const rp = await asUser(reader.username);
      await rp.setViewportSize(size);
      await rp.goto(`/matters/${w.matter.matterId}?tab=notes`);
      await rp.locator('[data-note-item]').first().click();
      await expect(rp.locator('[data-notes-readonly]')).toContainText('Read only');
      await expect(
        rp.locator(`.ne-img[data-image-id="${id}"][data-image-state="ok"]`),
      ).toBeVisible();
      await expect(rp.locator('.ne-img__hd, .ne-img__bar')).toHaveCount(0);
      const room = await rp.locator('.ProseMirror').evaluate((el) => el.clientWidth);
      expect(
        await rp
          .locator('.ne-img__frame')
          .evaluate((f) => Math.round(f.getBoundingClientRect().width)),
      ).toBe(Math.min(720, room));
      await shot(rp, 'image-readonly', size);
      await noViolations(rp);
      // locked note: read mode for everybody, the owner too
      const n = await seed.admin.get<{ rowVersion: string }>(`/api/v1/notes/${saved.noteId}`);
      await seed.admin.post(`/api/v1/notes/${saved.noteId}/lock`, { rowVersion: n.rowVersion });
      await page.reload();
      await page.locator('[data-note-item]').first().click();
      await expect(page.locator('[data-note-lock-badge]')).toBeVisible();
      await expect(page.locator('.ne-img--read .ne-img__frame')).toBeVisible();
      await expect(page.locator('.ne-img__hd, .ne-img__bar')).toHaveCount(0);
      await shot(page, 'image-locked', size);
      await noViolations(page);
    });

    test('Save as Template leaves the images out and says how many', async ({ page, seed }) => {
      const w = await world(seed);
      await newNote(page, w.matter.matterId);
      await addPicture(page);
      await saveNote(page);
      await page.locator('[data-note-actions]').click();
      await page.locator('[data-note-save-template]').click();
      const dlg = page.getByRole('dialog', { name: 'Save as Template' });
      await expect(dlg.locator('[data-template-images]')).toHaveText(
        '1 image will be left out of the template.',
      );
      await dlg.getByLabel(/Template Name/).fill(`Image template ${uid()}`);
      await shot(page, 'image-template', size);
      await noViolations(page, '[role="dialog"]');
      await dlg.getByRole('button', { name: 'Save Template' }).click();
      await expect(page.getByText('1 image was left out of the template.')).toBeVisible();
    });
  });
}
