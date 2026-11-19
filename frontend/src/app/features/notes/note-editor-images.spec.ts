import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiError } from '../../core/http/api-error';
import { NotificationService } from '../../core/notify/notification.service';
import { IMAGE_COPY } from './note-image-copy';
import { NoteEditor } from './note-editor';
import { NoteImageStore } from './note-image-store';

const IMG = (id: number, w = 480, h = 300, alt = 'Pasted image') =>
  `<img data-image-id="${id}" alt="${alt}" width="${w}" height="${h}">`;

/** The pasted-image flow and the image node of the editor (#1410): placeholder, upload, failure, resize, copy between matters, read mode. */
describe('NoteEditor images', () => {
  beforeAll(() => {
    if (!('ClipboardEvent' in globalThis)) {
      (globalThis as unknown as { ClipboardEvent: typeof Event }).ClipboardEvent =
        class extends Event {} as typeof Event;
    }
  });

  let store: {
    load: ReturnType<typeof vi.fn>;
    upload: ReturnType<typeof vi.fn>;
    copy: ReturnType<typeof vi.fn>;
    inSession: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    store = {
      load: vi.fn(async (id: number) => ({ state: 'ok', url: `blob:test/${id}` })),
      upload: vi.fn(async () => ({ noteImageId: 77, matterId: 1, width: 800, height: 400 })),
      copy: vi.fn(async (id: number) => ({ noteImageId: id + 1000 })),
      inSession: vi.fn(() => false),
    };
    TestBed.configureTestingModule({ providers: [{ provide: NoteImageStore, useValue: store }] });
  });

  afterEach(() => TestBed.inject(NotificationService).toasts.set([]));

  async function make(
    html = '<p>Start</p>',
    opts: { editable?: boolean; matter?: number | null } = {},
  ): Promise<ComponentFixture<NoteEditor>> {
    const f = TestBed.createComponent(NoteEditor);
    f.componentRef.setInput('html', html);
    f.componentRef.setInput('contentKey', 'k1');
    f.componentRef.setInput('editable', opts.editable ?? true);
    f.componentRef.setInput('imageMatterId', opts.matter === undefined ? 1 : opts.matter);
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    // The re-draw needs a canvas; the bytes pass through unchanged here.
    const up = (f.componentInstance as unknown as { uploader: { prepare: unknown } }).uploader;
    up.prepare = async (file: Blob) => ({
      blob: file,
      width: 800,
      height: 400,
      contentType: 'image/png',
      fileName: 'a.png',
    });
    return f;
  }

  const root = (f: ComponentFixture<NoteEditor>) => f.nativeElement as HTMLElement;
  const q = (f: ComponentFixture<NoteEditor>, sel: string) =>
    root(f).querySelector<HTMLElement>(sel);
  const ed = (f: ComponentFixture<NoteEditor>) =>
    (
      f.componentInstance as unknown as {
        editor: {
          state: {
            doc: {
              descendants(
                fn: (
                  n: { type: { name: string }; attrs: Record<string, unknown> },
                  pos: number,
                ) => void,
              ): void;
            };
            selection: { from: number };
          };
          commands: {
            setNodeSelection(p: number): boolean;
            undo(): boolean;
            setTextSelection(p: number): boolean;
          };
        };
      }
    ).editor;

  async function settle(f: ComponentFixture<NoteEditor>, ticks = 3) {
    for (let i = 0; i < ticks; i++) {
      await f.whenStable();
      f.detectChanges();
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  function paste(
    f: ComponentFixture<NoteEditor>,
    flavours: Record<string, string>,
    files: File[] = [],
  ): Event {
    const ev = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'clipboardData', {
      value: {
        getData: (t: string) => flavours[t] ?? '',
        files,
        items: [],
        types: Object.keys(flavours),
      },
    });
    q(f, '.ProseMirror')?.dispatchEvent(ev);
    return ev;
  }

  const png = (name = 'shot.png') => new File([new Uint8Array(2000)], name, { type: 'image/png' });
  const imagePos = (f: ComponentFixture<NoteEditor>): number[] => {
    const out: number[] = [];
    ed(f).state.doc.descendants((n, pos) => {
      if (n.type.name === 'noteImage') out.push(pos);
    });
    return out;
  };

  describe('the image node', () => {
    it('keeps `<img data-image-id alt width height>` byte for byte, between paragraphs, in a list item and in a table cell', async () => {
      const bodies = [
        `<p>a</p>${IMG(5)}<p>b</p>`,
        `<ul><li><p>item</p>${IMG(6, 240, 150)}</li></ul>`,
        `<table><tbody><tr><td>${IMG(7, 100, 60, 'Chart')}</td></tr></tbody></table>`,
      ];
      for (const html of bodies) {
        const f = await make(html);
        const out = f.componentInstance.getHtml();
        expect(out.replace(/<p><\/p>/g, '')).toContain(html.match(/<img[^>]*>/)![0]);
        expect(out.match(/<img[^>]*>/)![0]).not.toMatch(/src=|style=|class=/);
        f.destroy();
      }
    });

    it('never stores an address and gives an empty alt the default text', async () => {
      const f = await make(
        '<img src="https://evil.example/x.png" data-image-id="3" alt=" " width="20" height="10"><img src="x.png">',
      );
      expect(f.componentInstance.getHtml()).toBe(
        '<img data-image-id="3" alt="Pasted image" width="20" height="10">',
      );
    });

    it('shows the picture from the blob URL the host gives, at its stored size', async () => {
      const f = await make(`<p>a</p>${IMG(5, 480, 300, 'Log')}`);
      await settle(f);
      const frame = q(f, '.ne-img__frame') as HTMLElement;
      const pic = q(f, '.ne-img__pic') as HTMLImageElement;
      expect(store.load).toHaveBeenCalledWith(5);
      expect(pic.getAttribute('src')).toBe('blob:test/5');
      expect(pic.alt).toBe('Log');
      expect(frame.style.width).toBe('480px');
      expect(q(f, '.ne-img')?.dataset['imageState']).toBe('ok');
    });

    it('shows a clear missing-image block (R18) and keeps the text', async () => {
      store.load.mockResolvedValue({ state: 'missing' });
      const f = await make(`<p>keep me</p>${IMG(5)}`);
      await settle(f);
      expect(q(f, '.ne-img')?.dataset['imageState']).toBe('missing');
      expect(q(f, '.ne-img__state')?.textContent).toContain(IMAGE_COPY.missingTitle);
      expect(q(f, '.ne-img__state')?.textContent).toContain(IMAGE_COPY.missingHelp);
      expect(f.componentInstance.getHtml()).toContain('keep me');
    });

    it('shows no handles and no bar in read mode, and opens the original from the focusable image', async () => {
      const open = vi.spyOn(window, 'open').mockReturnValue(null);
      const f = await make(`${IMG(5)}`, { editable: false });
      await settle(f);
      const frame = q(f, '.ne-img__frame') as HTMLElement;
      expect(frame.getAttribute('role')).toBe('button');
      expect(frame.tabIndex).toBe(0);
      expect(frame.title).toBe('Open full size');
      expect(q(f, '.ne-img__bar')).toBeNull();
      expect(q(f, '.ne-img__hd')).toBeNull();
      frame.click();
      await settle(f);
      expect(open).toHaveBeenCalledWith('blob:test/5', '_blank', 'noopener');
      open.mockRestore();
    });

    it('selecting an image shows the outline, four handles, the readout and the bar', async () => {
      const f = await make(`<p>a</p>${IMG(5)}`);
      await settle(f);
      ed(f).commands.setNodeSelection(imagePos(f)[0]);
      await settle(f);
      expect(q(f, '.ne-img--sel')).not.toBeNull();
      expect(root(f).querySelectorAll('.ne-img__hd').length).toBe(4);
      expect(q(f, '.ne-img__bar')?.getAttribute('role')).toBe('toolbar');
      expect(
        Array.from(root(f).querySelectorAll('.ne-img__bar button')).map((b) =>
          b.textContent?.trim(),
        ),
      ).toEqual(['Small', 'Medium', 'Large', 'Original', 'Fit to Width', 'Alt Text', 'Remove']);
      expect(q(f, '[data-preset="medium"]')?.getAttribute('aria-pressed')).toBe('true');
      expect(q(f, '.ne-img__readout')?.textContent).toContain('480 x 300 px');
    });

    it('resizes by the bar buttons with the aspect ratio kept and one undo step', async () => {
      const f = await make(`<p>a</p>${IMG(5)}`);
      await settle(f);
      ed(f).commands.setNodeSelection(imagePos(f)[0]);
      await settle(f);
      q(f, '[data-preset="small"]')?.click();
      await settle(f);
      expect(f.componentInstance.getHtml()).toContain('width="240" height="150"');
      expect(q(f, '.ne-img__readout')?.textContent).toContain('240 x 150 px');
      ed(f).commands.undo();
      await settle(f);
      expect(f.componentInstance.getHtml()).toContain('width="480" height="300"');
    });

    it('removes the image from the bar, and the text stays', async () => {
      const f = await make(`<p>keep</p>${IMG(5)}`);
      await settle(f);
      ed(f).commands.setNodeSelection(imagePos(f)[0]);
      await settle(f);
      q(f, '[data-image-remove]')?.click();
      await settle(f);
      expect(f.componentInstance.getHtml()).not.toContain('<img');
      expect(f.componentInstance.getHtml()).toContain('keep');
    });

    it('drops the nodes of images the server no longer has', async () => {
      const f = await make(`<p>keep</p>${IMG(5)}${IMG(6)}`);
      expect(f.componentInstance.dropImages([6, 99])).toBe(1);
      expect(f.componentInstance.getHtml()).toContain('data-image-id="5"');
      expect(f.componentInstance.getHtml()).not.toContain('data-image-id="6"');
      expect(f.componentInstance.imageCount()).toBe(1);
    });
  });

  describe('paste of a picture', () => {
    it('adds a placeholder, uploads, then inserts the image selected at its natural size, as one undo step', async () => {
      let release: (v: unknown) => void = () => undefined;
      store.upload.mockImplementation(() => new Promise((r) => (release = r)));
      const busy: boolean[] = [];
      const f = await make();
      f.componentInstance.imagesBusy.subscribe((b) => busy.push(b));
      const ev = paste(f, {}, [png()]);
      await settle(f);
      expect(ev.defaultPrevented).toBe(true);
      expect(q(f, '[data-image-slot]')?.getAttribute('role')).toBe('status');
      expect(q(f, '[data-image-slot]')?.textContent).toContain('Adding image...');
      expect(q(f, '[data-image-slot]')?.textContent).toContain('shot.png');
      expect(q(f, '[data-image-why]')?.textContent).toContain(IMAGE_COPY.saveOff);
      expect(f.componentInstance.getHtml()).not.toContain('<img');
      release({ noteImageId: 77, matterId: 1, width: 800, height: 400 });
      await settle(f);
      expect(q(f, '[data-image-slot]')).toBeNull();
      expect(q(f, '[data-image-why]')).toBeNull();
      expect(f.componentInstance.getHtml()).toContain(
        '<img data-image-id="77" alt="Pasted image" width="720" height="360">',
      );
      expect(q(f, '.ne-img--sel')).not.toBeNull(); // selected: the bar shows
      expect(busy).toEqual([true, false]);
      expect(store.upload).toHaveBeenCalledWith(1, expect.objectContaining({ fileName: 'a.png' }));
      ed(f).commands.undo();
      await settle(f);
      expect(f.componentInstance.getHtml()).not.toContain('<img');
    });

    it('turns a failed upload into the red block with Retry and Remove and keeps Save off', async () => {
      store.upload.mockRejectedValueOnce(
        new ApiError(0, undefined, 'x', undefined, new HttpErrorResponse({ status: 0 })),
      );
      const busy: boolean[] = [];
      const f = await make();
      f.componentInstance.imagesBusy.subscribe((b) => busy.push(b));
      paste(f, {}, [png()]);
      await settle(f);
      const slot = q(f, '[data-image-slot]') as HTMLElement;
      expect(slot.dataset['slotState']).toBe('failed');
      expect(slot.getAttribute('role')).toBe('alert');
      expect(slot.textContent).toContain("Couldn't add the image.");
      expect(slot.textContent).toContain(IMAGE_COPY.reasons.offline);
      expect(q(f, '[data-slot-retry]')).not.toBeNull();
      expect(q(f, '[data-slot-remove]')).not.toBeNull();
      expect(q(f, '[data-image-why]')).not.toBeNull();
      expect(busy).toEqual([true]);
      q(f, '[data-slot-retry]')?.click(); // the second attempt works
      await settle(f);
      expect(q(f, '[data-image-slot]')).toBeNull();
      expect(f.componentInstance.getHtml()).toContain('data-image-id="77"');
      expect(store.upload).toHaveBeenCalledTimes(2);
      expect(busy).toEqual([true, false]);
    });

    it('Remove takes the failed block away and turns Save on again; a refusal that cannot work again has no Retry', async () => {
      store.upload.mockRejectedValueOnce(
        new ApiError(
          415,
          'IMAGE_TYPE_UNSUPPORTED',
          'x',
          undefined,
          new HttpErrorResponse({ status: 415 }),
        ),
      );
      const busy: boolean[] = [];
      const f = await make();
      f.componentInstance.imagesBusy.subscribe((b) => busy.push(b));
      paste(f, {}, [png()]);
      await settle(f);
      expect(q(f, '[data-slot-retry]')).toBeNull();
      expect(q(f, '[data-image-slot]')?.textContent).toContain(IMAGE_COPY.reasons.type);
      q(f, '[data-slot-remove]')?.click();
      await settle(f);
      expect(q(f, '[data-image-slot]')).toBeNull();
      expect(busy).toEqual([true, false]);
      expect(f.componentInstance.getHtml()).not.toContain('<img');
    });

    it('a server too-large refusal shows only Remove and keeps Save off until it is removed', async () => {
      store.upload.mockRejectedValueOnce(
        new ApiError(
          413,
          'IMAGE_TOO_LARGE',
          'x',
          undefined,
          new HttpErrorResponse({ status: 413 }),
        ),
      );
      const busy: boolean[] = [];
      const f = await make();
      f.componentInstance.imagesBusy.subscribe((b) => busy.push(b));
      paste(f, {}, [png()]);
      await settle(f);
      expect(q(f, '[data-image-slot]')?.textContent).toContain(IMAGE_COPY.reasons.size);
      expect(q(f, '[data-slot-retry]')).toBeNull();
      expect(q(f, '[data-slot-remove]')).not.toBeNull();
      expect(busy).toEqual([true]);
      q(f, '[data-slot-remove]')?.click();
      await settle(f);
      expect(busy).toEqual([true, false]);
    });

    it('stops at 20 images with the reason from the table, without uploading', async () => {
      const html = Array.from({ length: 20 }, (_v, i) => IMG(i + 1, 24 * 2, 30)).join('');
      const f = await make(`<p>x</p>${html}`);
      paste(f, {}, [png()]);
      await settle(f);
      expect(q(f, '[data-image-slot]')?.textContent).toContain(IMAGE_COPY.reasons.count);
      expect(q(f, '[data-slot-retry]')).toBeNull();
      expect(store.upload).not.toHaveBeenCalled();
    });

    it('uploads several pictures two at a time and inserts them in the order pasted', async () => {
      const done: ((v: unknown) => void)[] = [];
      let n = 0;
      store.upload.mockImplementation(
        () =>
          new Promise((r) => {
            const id = 100 + n++;
            done.push(() => r({ noteImageId: id, matterId: 1, width: 400, height: 200 }));
          }),
      );
      const f = await make();
      paste(f, {}, [png('a.png'), png('b.png'), png('c.png')]);
      await settle(f);
      expect(store.upload).toHaveBeenCalledTimes(2); // two at a time
      done[1](null); // the second finishes first: nothing goes in before the first
      await settle(f);
      expect(f.componentInstance.getHtml()).not.toContain('<img');
      done[0](null);
      await settle(f);
      done[2](null);
      await settle(f);
      const ids = [...f.componentInstance.getHtml().matchAll(/data-image-id="(\d+)"/g)].map(
        (m) => m[1],
      );
      expect(ids).toEqual(['100', '101', '102']);
    });

    it('uploads the picture file of a "Copy Image" clipboard (an <img> with a web address plus the file) without the toast', async () => {
      const f = await make();
      paste(f, { 'text/html': '<img src="https://example.com/a.png">' }, [png()]);
      await settle(f);
      expect(store.upload).toHaveBeenCalledTimes(1);
      expect(TestBed.inject(NotificationService).toasts().length).toBe(0);
    });

    it('lets the table win when the clipboard has a table and a picture of it (Excel)', async () => {
      const f = await make();
      paste(
        f,
        { 'text/html': '<table><tr><td>A</td><td>B</td></tr></table>', 'text/plain': 'A\tB' },
        [png()],
      );
      await settle(f);
      expect(store.upload).not.toHaveBeenCalled();
      expect(f.componentInstance.getHtml()).toContain('<table');
    });

    it('still drops pictures inside pasted text and says so', async () => {
      const f = await make();
      paste(f, {
        'text/html': '<p>Hello <img src="file:///c:/a.png"> world</p>',
        'text/plain': 'Hello world',
      });
      await settle(f);
      expect(TestBed.inject(NotificationService).toasts()[0]?.summary).toBe(
        'Pasted without 1 image',
      );
      expect(f.componentInstance.getHtml()).not.toContain('<img');
    });

    it('does nothing in a template (no matter): the picture is not pasted', async () => {
      const f = await make('<p>Start</p>', { matter: null });
      const ev = paste(f, {}, [png()]);
      await settle(f);
      expect(ev.defaultPrevented).toBe(true);
      expect(store.upload).not.toHaveBeenCalled();
      expect(q(f, '[data-image-slot]')).toBeNull();
    });

    it('never pastes in read mode', async () => {
      const f = await make('<p>Start</p>', { editable: false });
      paste(f, {}, [png()]);
      await settle(f);
      expect(store.upload).not.toHaveBeenCalled();
    });
  });

  describe('pictures copied from a note', () => {
    const own = (id: number) => `<p>Text</p>${IMG(id)}`;

    it('copies the picture into this matter and swaps the id, keeping Save off meanwhile', async () => {
      let release: (v: unknown) => void = () => undefined;
      store.copy.mockImplementation(() => new Promise((r) => (release = r)));
      const busy: boolean[] = [];
      const f = await make();
      f.componentInstance.imagesBusy.subscribe((b) => busy.push(b));
      paste(f, {
        'text/html': `<div data-pm-slice="1 1 []">${own(5)}</div>`,
        'text/plain': 'Text',
      });
      await settle(f);
      expect(f.componentInstance.getHtml()).toContain('data-image-id="5"');
      expect(busy).toEqual([true]);
      release({ noteImageId: 905 });
      await settle(f);
      expect(store.copy).toHaveBeenCalledWith(5, 1);
      expect(f.componentInstance.getHtml()).toContain('data-image-id="905"');
      expect(f.componentInstance.getHtml()).not.toContain('data-image-id="5"');
      expect(busy).toEqual([true, false]);
    });

    it('takes the picture out and says so when it cannot be copied', async () => {
      store.copy.mockRejectedValue(
        new ApiError(404, undefined, 'x', undefined, new HttpErrorResponse({ status: 404 })),
      );
      const f = await make();
      paste(f, { 'text/html': own(5), 'text/plain': 'Text' });
      await settle(f);
      expect(f.componentInstance.getHtml()).not.toContain('<img');
      expect(f.componentInstance.getHtml()).toContain('Text');
      expect(q(f, '[data-paste-message]')?.textContent).toContain(IMAGE_COPY.copyFailed(1));
    });

    it('does not copy a picture the note already has or uploaded in this session', async () => {
      store.inSession.mockImplementation((id: number) => id === 6);
      const f = await make(`<p>a</p>${IMG(5)}`);
      paste(f, { 'text/html': `<p>x</p>${IMG(5)}${IMG(6)}`, 'text/plain': 'x' });
      await settle(f);
      expect(store.copy).not.toHaveBeenCalled();
    });

    it('drops them in a template', async () => {
      const f = await make('<p>Start</p>', { matter: null });
      paste(f, { 'text/html': own(5), 'text/plain': 'Text' });
      await settle(f);
      expect(f.componentInstance.getHtml()).not.toContain('<img');
      expect(store.copy).not.toHaveBeenCalled();
    });
  });

  describe('Image Details', () => {
    it('opens on Enter for the selected image, with alt text, sizes and the exact width, and saves them', async () => {
      const f = await make(`<p>a</p>${IMG(5, 480, 300, 'Old alt')}`);
      await settle(f);
      ed(f).commands.setNodeSelection(imagePos(f)[0]);
      await settle(f);
      const pm = q(f, '.ProseMirror') as HTMLElement;
      pm.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
      await settle(f);
      const dlg = document.querySelector('[data-image-details]') as HTMLElement;
      expect(dlg).not.toBeNull();
      expect((document.getElementById('ne-img-alt') as HTMLTextAreaElement).value).toBe('Old alt');
      expect((document.getElementById('ne-img-width') as HTMLInputElement).value).toBe('480');
      expect(dlg.textContent).toContain('Height follows: 300 px.');
      expect(dlg.textContent).toContain('Original is');
      const comp = f.componentInstance as unknown as {
        detailAlt: { set(v: string): void };
        detailWidth: { set(v: string): void };
        saveImageDetails(): void;
      };
      comp.detailAlt.set('Privilege log, six rows');
      comp.detailWidth.set('240');
      await settle(f);
      comp.saveImageDetails();
      await settle(f);
      expect(f.componentInstance.getHtml()).toContain(
        '<img data-image-id="5" alt="Privilege log, six rows" width="240" height="150">',
      );
      expect(document.querySelector('[data-image-details]')).toBeNull();
    });

    it('refuses a width outside 48 px and the largest possible, and never leaves the alt text empty', async () => {
      const f = await make(`${IMG(5, 480, 300)}`);
      await settle(f);
      ed(f).commands.setNodeSelection(imagePos(f)[0]);
      const comp = f.componentInstance as unknown as {
        openImageDetails(pos: number): void;
        detailAlt: { set(v: string): void };
        detailWidth: { set(v: string): void };
        detailsValid(): boolean;
        detailWidthError(): string | null;
        saveImageDetails(): void;
      };
      comp.openImageDetails(imagePos(f)[0]);
      comp.detailWidth.set('20');
      expect(comp.detailsValid()).toBe(false);
      expect(comp.detailWidthError()).toMatch(/^Enter a width from 48 to \d+ px\.$/);
      comp.detailWidth.set('480');
      comp.detailAlt.set('   ');
      comp.saveImageDetails();
      expect(f.componentInstance.getHtml()).toContain('alt="Pasted image"');
    });

    it('Remove Image takes the image out', async () => {
      const f = await make(`<p>a</p>${IMG(5)}`);
      const comp = f.componentInstance as unknown as {
        openImageDetails(pos: number): void;
        removeImageFromDetails(): void;
      };
      comp.openImageDetails(imagePos(f)[0]);
      comp.removeImageFromDetails();
      expect(f.componentInstance.getHtml()).not.toContain('<img');
    });
  });
});
