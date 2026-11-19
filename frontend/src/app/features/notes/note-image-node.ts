import { Node, mergeAttributes } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { Node as PmNode } from '@tiptap/pm/model';
import { NodeSelection } from '@tiptap/pm/state';
import { IMAGE_COPY } from './note-image-copy';
import type { LoadedImage } from './note-image-store';
import {
  IMAGE_ALT_MAX,
  IMAGE_DEFAULT_ALT,
  ImageSize,
  SIZE_PRESETS,
  activePreset,
  clampWidth,
  heightFor,
  presetWidth,
  readoutText,
} from './note-image-size';

/** What the image node needs from the editor that hosts it. The same node also serves the read only copies (a linked note, a template preview), with `editable` false. */
export interface NoteImageHost {
  /** The blob URL of an image (or why there is none). */
  load(id: number): Promise<LoadedImage>;
  /** Image Details for the node at this position. */
  details(pos: number): void;
  /** The full-size image in a new tab (read mode). */
  openFull(id: number): void;
}

export const IMAGE_NODE = 'noteImage';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  attrs: Record<string, string> = {},
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

function icon(name: string): HTMLElement {
  return el('i', `pi pi-${name}`, { 'aria-hidden': 'true' });
}

function intAttr(el: HTMLElement, name: string): number | null {
  const v = el.getAttribute(name)?.trim() ?? '';
  return /^\d{1,4}$/.test(v) && Number(v) >= 1 ? Number(v) : null;
}

/**
 * An image of a note as an editor node (epic #1405, #1410; rule D-46d). Stored as `<img data-image-id alt width height>`: no `src`, no URL, in exactly the attribute
 * order the server writes (`RichHtml`, profile Note), so a save does not look like a change. It is a block: between paragraphs, in a list item or in a table cell.
 * The node view shows the bytes through the host (a blob URL), and in an editable editor a selected image gets the outline, the four corner handles, the live size
 * readout and the image bar (Small, Medium, Large, Original, Fit to Width, Alt Text, Remove). Resizing never needs a drag: the bar and Image Details do the same.
 */
export function noteImageNode(host: () => NoteImageHost | null): Node {
  return Node.create({
    name: IMAGE_NODE,
    group: 'block',
    atom: true,
    selectable: true,
    draggable: false,
    addAttributes() {
      // Each one is read from the stored attribute here (not by Tiptap's same-name default, which would keep " " as an alt text and "20" as a string) and written by
      // `renderHTML` below, in the server's order.
      const dims = (node: HTMLElement) => {
        const width = intAttr(node, 'width');
        const height = intAttr(node, 'height');
        return width && height ? { width, height } : null;
      };
      return {
        imageId: {
          default: 0,
          rendered: false,
          parseHTML: (node: HTMLElement) => Number(node.getAttribute('data-image-id')),
        },
        alt: {
          default: IMAGE_DEFAULT_ALT,
          rendered: false,
          parseHTML: (node: HTMLElement) =>
            (node.getAttribute('alt') ?? '').trim().slice(0, IMAGE_ALT_MAX) || IMAGE_DEFAULT_ALT,
        },
        width: {
          default: null,
          rendered: false,
          parseHTML: (node: HTMLElement) => dims(node)?.width ?? null,
        },
        height: {
          default: null,
          rendered: false,
          parseHTML: (node: HTMLElement) => dims(node)?.height ?? null,
        },
      };
    },
    parseHTML() {
      return [
        {
          tag: 'img[data-image-id]',
          getAttrs: (node: HTMLElement | string) => {
            if (typeof node === 'string') return false;
            const id = Number(node.getAttribute('data-image-id'));
            return Number.isInteger(id) && id >= 1 ? {} : false;
          },
        },
      ];
    },
    renderHTML({ node }) {
      const a = node.attrs;
      const out: Record<string, string> = {
        'data-image-id': String(a['imageId']),
        alt: String(a['alt'] || IMAGE_DEFAULT_ALT),
      };
      if (a['width'] && a['height']) {
        out['width'] = String(a['width']);
        out['height'] = String(a['height']);
      }
      return ['img', mergeAttributes(out)];
    },
    addKeyboardShortcuts() {
      return {
        // Enter on a selected image opens Image Details: a key of the editor field while it has focus, not an app shortcut (#420).
        Enter: ({ editor }) => {
          const sel = editor.state.selection;
          if (!editor.isEditable || !(sel instanceof NodeSelection)) return false;
          if (sel.node.type.name !== IMAGE_NODE) return false;
          host()?.details(sel.from);
          return true;
        },
      };
    },
    addNodeView() {
      return ({ node, editor, getPos }) => new ImageView(node, editor, getPos, host);
    },
  });
}

/** Views of one editor, so a switch between edit and read mode can refresh them. */
const views = new WeakMap<HTMLElement, ImageView>();

/** Edit or read mode changed: every image under `root` redraws its tab stop, label and chrome. */
export function refreshImageViews(root: HTMLElement): void {
  for (const dom of Array.from(root.querySelectorAll<HTMLElement>('.ne-img'))) {
    views.get(dom)?.refresh();
  }
}

type Corner = 'nw' | 'ne' | 'sw' | 'se';

class ImageView {
  readonly dom: HTMLElement;
  private readonly frame: HTMLElement;
  private readonly pic: HTMLImageElement;
  private readonly slot: HTMLElement;
  private readonly live: HTMLElement;
  private chrome: { bar: HTMLElement; readout: HTMLElement; handles: HTMLElement[] } | null = null;
  private selected = false;
  private gone = false;
  private loaded: LoadedImage | null = null;
  private shownId = 0;
  private drag: {
    corner: Corner;
    x: number;
    y: number;
    start: number;
    width: number;
  } | null = null;

  constructor(
    private node: PmNode,
    private readonly editor: Editor,
    private readonly getPos: () => number | undefined,
    private readonly host: () => NoteImageHost | null,
  ) {
    this.dom = el('div', 'ne-img', { contenteditable: 'false' });
    this.frame = el('div', 'ne-img__frame');
    this.pic = el('img', 'ne-img__pic', { draggable: 'false' });
    this.slot = el('div', 'ne-img__state');
    this.live = el('span', 'mf-sr-only', { role: 'status', 'aria-live': 'polite' });
    this.frame.append(this.pic, this.slot);
    this.dom.append(this.frame, this.live);
    views.set(this.dom, this);
    this.pic.addEventListener('load', () => this.render());
    this.frame.addEventListener('click', () => this.activate());
    this.frame.addEventListener('keydown', (ev) => {
      if ((ev.key === 'Enter' || ev.key === ' ') && !this.editor.isEditable) {
        ev.preventDefault();
        this.activate();
      }
    });
    this.render();
    this.fetch();
  }

  private get id(): number {
    return Number(this.node.attrs['imageId']);
  }

  /** The natural size: from the decoded picture; before it loads, the stored size. */
  private get natural(): ImageSize {
    const nw = this.pic.naturalWidth;
    const nh = this.pic.naturalHeight;
    if (nw > 0 && nh > 0) return { width: nw, height: nh };
    const w = Number(this.node.attrs['width']) || 480;
    const h = Number(this.node.attrs['height']) || Math.round(w * 0.625);
    return { width: w, height: h };
  }

  /** The room the text leaves: the width of the block that holds the image. */
  private get room(): number {
    const parent = this.dom.parentElement;
    if (!parent) return 0;
    const cs = getComputedStyle(parent);
    const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    return Math.max(0, Math.floor(parent.clientWidth - pad));
  }

  private get width(): number {
    return Number(this.node.attrs['width']) || this.natural.width;
  }

  private fetch(): void {
    const id = this.id;
    this.shownId = id;
    this.loaded = null;
    this.render();
    const h = this.host();
    if (!h) {
      this.loaded = { state: 'error' };
      this.render();
      return;
    }
    void h.load(id).then((res) => {
      if (this.gone || this.shownId !== id) return;
      this.loaded = res;
      if (res.state === 'ok') this.pic.src = res.url;
      this.render();
    });
  }

  private activate(): void {
    if (this.editor.isEditable || this.loaded?.state !== 'ok') return;
    this.host()?.openFull(this.id);
  }

  /** Paints the size, the state (loading, ready, missing, failed) and the read mode attributes. */
  private render(): void {
    const a = this.node.attrs;
    const alt = String(a['alt'] || IMAGE_DEFAULT_ALT);
    const w = this.width;
    const h = Number(a['height']) || heightFor(w, this.natural);
    const state = this.loaded?.state ?? 'loading';
    this.dom.dataset['imageId'] = String(this.id);
    this.dom.dataset['imageState'] = state;
    if (this.pic.naturalWidth > 0) {
      this.dom.dataset['naturalWidth'] = String(this.pic.naturalWidth);
      this.dom.dataset['naturalHeight'] = String(this.pic.naturalHeight);
    }
    this.frame.style.width = `${w}px`;
    this.frame.style.aspectRatio = state === 'ok' || state === 'loading' ? `${w} / ${h}` : '';
    this.frame.classList.toggle('ne-img__frame--loading', state === 'loading');
    this.frame.classList.toggle('ne-img__frame--off', state === 'missing' || state === 'error');
    this.frame.toggleAttribute('aria-busy', state === 'loading');
    this.pic.alt = alt;
    this.pic.hidden = state !== 'ok';
    this.slot.replaceChildren();
    if (state === 'missing' || state === 'error') this.fillOff(state);
    this.refresh();
    if (this.selected) this.paintChrome();
  }

  /** The "missing image" block (R18) or the failed fetch, in the shared state colours. */
  private fillOff(state: 'missing' | 'error'): void {
    const missing = state === 'missing';
    const text = el('div', 'ne-img__off-text');
    const title = el('b');
    title.textContent = missing ? IMAGE_COPY.missingTitle : IMAGE_COPY.loadFailed;
    text.append(title);
    if (missing) {
      const help = el('span');
      help.textContent = IMAGE_COPY.missingHelp;
      text.append(help);
    }
    const act = this.editor.isEditable
      ? this.textButton(missing ? IMAGE_COPY.remove : IMAGE_COPY.retry, () =>
          missing ? this.remove() : this.fetch(),
        )
      : !missing
        ? this.textButton(IMAGE_COPY.retry, () => this.fetch())
        : null;
    if (act) {
      const acts = el('div', 'ne-img__off-acts');
      acts.append(act);
      text.append(acts);
    }
    this.slot.setAttribute('role', 'group');
    this.slot.setAttribute('aria-label', missing ? IMAGE_COPY.missingTitle : IMAGE_COPY.loadFailed);
    this.slot.append(icon(missing ? 'image' : 'exclamation-triangle'), text);
  }

  private textButton(label: string, run: () => void): HTMLButtonElement {
    const b = el('button', 'mf-btn mf-btn--text ne-img__act', { type: 'button' });
    b.textContent = label;
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', (e) => {
      e.preventDefault();
      run();
    });
    return b;
  }

  /** Read mode: the image is a button that opens the original; edit mode: plain, selected by a click. */
  refresh(): void {
    if (this.gone) return;
    const read = !this.editor.isEditable;
    const ok = this.loaded?.state === 'ok';
    const alt = String(this.node.attrs['alt'] || IMAGE_DEFAULT_ALT);
    this.dom.classList.toggle('ne-img--read', read);
    if (read && ok) {
      this.frame.tabIndex = 0;
      this.frame.setAttribute('role', 'button');
      this.frame.setAttribute('aria-label', `${alt}. ${IMAGE_COPY.openFull}`);
      this.frame.title = IMAGE_COPY.openFull;
    } else {
      this.frame.removeAttribute('tabindex');
      this.frame.removeAttribute('role');
      this.frame.removeAttribute('aria-label');
      this.frame.removeAttribute('title');
    }
    if (read && this.chrome) this.dropChrome();
    else if (!read && this.selected && !this.chrome) this.paintChrome();
  }

  // ------------------------------------------------------------ selection chrome

  selectNode(): void {
    this.selected = true;
    this.dom.classList.add('ne-img--sel');
    if (this.editor.isEditable) this.paintChrome();
  }

  deselectNode(): void {
    this.selected = false;
    this.dom.classList.remove('ne-img--sel');
    this.dropChrome();
  }

  private onScroll: (() => void) | null = null;
  private scrollArea: Element | null = null;

  private dropChrome(): void {
    if (this.onScroll) this.scrollArea?.removeEventListener('scroll', this.onScroll);
    this.onScroll = null;
    this.scrollArea = null;
    this.chrome?.bar.remove();
    this.chrome?.readout.remove();
    this.chrome?.handles.forEach((h) => h.remove());
    this.chrome = null;
  }

  private paintChrome(): void {
    if (!this.chrome) {
      const bar = this.buildBar();
      const readout = el('span', 'ne-img__readout');
      readout.setAttribute('aria-hidden', 'true');
      const handles = (['nw', 'ne', 'sw', 'se'] as Corner[]).map((c) => this.buildHandle(c));
      this.frame.append(bar, readout, ...handles);
      this.chrome = { bar, readout, handles };
      requestAnimationFrame(() => this.placeBar());
      const area = this.dom.closest('.ne__area');
      this.onScroll = () => requestAnimationFrame(() => this.placeBar());
      area?.addEventListener('scroll', this.onScroll, { passive: true });
      this.scrollArea = area;
    }
    const missing = this.loaded?.state !== 'ok';
    this.chrome.handles.forEach((h) => (h.hidden = missing));
    this.chrome.readout.hidden = missing;
    if (!missing) this.chrome.readout.textContent = readoutText(this.size(), this.natural);
    this.paintBar();
    requestAnimationFrame(() => this.placeBar());
  }

  private size(width = this.width): ImageSize {
    return { width, height: heightFor(width, this.natural) };
  }

  /**
   * The bar sits above the image and the readout below it. When the text box cuts either off (a tall image in a short window, an image at the top of the box) they
   * move onto the visible part of the image instead, and follow the scroll, so the sizes are always in reach.
   */
  private placeBar(): void {
    const bar = this.chrome?.bar;
    const readout = this.chrome?.readout;
    const area = this.dom.closest('.ne__area');
    if (!bar || !readout || !area) return;
    const f = this.frame.getBoundingClientRect();
    const a = area.getBoundingClientRect();
    const top = f.top - a.top; // the frame's top edge inside the visible box
    const bottom = a.bottom - f.bottom; // room under the frame
    const over = top < 52;
    bar.classList.toggle('ne-img__bar--over', over);
    bar.style.top = over ? `${Math.max(8, Math.min(f.height - 44, 8 - top))}px` : '';
    const inside = bottom < 40;
    readout.classList.toggle('ne-img__readout--in', inside);
    readout.style.top = inside
      ? `${Math.max(8, Math.min(f.height - 34, a.bottom - f.top - 42))}px`
      : '';
  }

  private buildBar(): HTMLElement {
    const bar = el('span', 'ne-img__bar', { role: 'toolbar', 'aria-label': IMAGE_COPY.barLabel });
    const button = (label: string, run: () => void, extra = '', ic = ''): HTMLButtonElement => {
      const b = el('button', `ne-img__b ${extra}`.trim(), { type: 'button', tabindex: '-1' });
      if (ic) b.append(icon(ic));
      b.append(document.createTextNode(label));
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', (e) => {
        e.preventDefault();
        run();
      });
      return b;
    };
    for (const p of SIZE_PRESETS) {
      const b = button(p.label, () => this.setWidth(presetWidth(p.key, this.natural, this.room)));
      b.dataset['preset'] = p.key;
      bar.append(b);
    }
    bar.append(el('span', 'ne-img__dv', { 'aria-hidden': 'true' }));
    const alt = button(IMAGE_COPY.altText, () => this.openDetails(), '', 'pencil');
    alt.dataset['imageAlt'] = '';
    const del = button(IMAGE_COPY.remove, () => this.remove(), 'ne-img__b--danger', 'trash');
    del.dataset['imageRemove'] = '';
    bar.append(alt, del);
    const buttons = Array.from(bar.querySelectorAll('button'));
    buttons[0]?.setAttribute('tabindex', '0');
    bar.addEventListener('keydown', (ev) => {
      const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (i < 0) return;
      let next = -1;
      if (ev.key === 'ArrowRight') next = (i + 1) % buttons.length;
      else if (ev.key === 'ArrowLeft') next = (i - 1 + buttons.length) % buttons.length;
      else if (ev.key === 'Home') next = 0;
      else if (ev.key === 'End') next = buttons.length - 1;
      else if (ev.key === 'Escape') {
        ev.preventDefault();
        this.editor.commands.focus();
        return;
      }
      if (next < 0) return;
      ev.preventDefault();
      buttons.forEach((b, k) => (b.tabIndex = k === next ? 0 : -1));
      buttons[next].focus();
    });
    return bar;
  }

  private paintBar(): void {
    const bar = this.chrome?.bar;
    if (!bar) return;
    const active = activePreset(this.width, this.natural, this.room);
    for (const b of Array.from(bar.querySelectorAll<HTMLButtonElement>('[data-preset]'))) {
      const key = b.dataset['preset'];
      b.setAttribute('aria-pressed', String(key === active));
      b.disabled = this.loaded?.state !== 'ok';
    }
  }

  private buildHandle(corner: Corner): HTMLElement {
    const h = el('span', `ne-img__hd ne-img__hd--${corner}`, { 'data-handle': corner });
    h.addEventListener('pointerdown', (ev) => this.dragStart(ev, corner, h));
    h.addEventListener('pointermove', (ev) => this.dragMove(ev));
    h.addEventListener('pointerup', (ev) => this.dragEnd(ev, h, true));
    h.addEventListener('pointercancel', (ev) => this.dragEnd(ev, h, false));
    h.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && this.drag) this.dragEnd(null, h, false);
    });
    return h;
  }

  // ------------------------------------------------------------ resize

  private dragStart(ev: PointerEvent, corner: Corner, handle: HTMLElement): void {
    if (ev.button !== 0 || !this.editor.isEditable) return;
    ev.preventDefault();
    ev.stopPropagation();
    this.drag = {
      corner,
      x: ev.clientX,
      y: ev.clientY,
      start: this.frame.getBoundingClientRect().width || this.width,
      width: this.width,
    };
    handle.setPointerCapture?.(ev.pointerId);
    this.dom.classList.add('ne-img--drag');
  }

  private dragMove(ev: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    const east = d.corner === 'ne' || d.corner === 'se' ? 1 : -1;
    const south = d.corner === 'sw' || d.corner === 'se' ? 1 : -1;
    const aspect = this.natural.width / (this.natural.height || 1);
    const dx = (ev.clientX - d.x) * east;
    const dy = (ev.clientY - d.y) * south * aspect;
    const delta = Math.abs(dx) >= Math.abs(dy) ? dx : dy;
    const w = clampWidth(d.start + delta, this.natural.width, this.room);
    d.width = w;
    this.frame.style.width = `${w}px`;
    this.frame.style.aspectRatio = `${w} / ${heightFor(w, this.natural)}`;
    if (this.chrome) this.chrome.readout.textContent = readoutText(this.size(w), this.natural);
  }

  private dragEnd(ev: PointerEvent | null, handle: HTMLElement, commit: boolean): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (ev) handle.releasePointerCapture?.(ev.pointerId);
    this.dom.classList.remove('ne-img--drag');
    if (commit && d.width !== this.width) this.setWidth(d.width);
    else this.render();
  }

  /** Writes a new width (and the height that follows) into the node: one undo step. */
  private setWidth(width: number): void {
    const pos = this.getPos();
    if (pos === undefined) return;
    const w = clampWidth(width, this.natural.width, this.room);
    const h = heightFor(w, this.natural);
    if (w === Number(this.node.attrs['width']) && h === Number(this.node.attrs['height'])) {
      this.render();
      return;
    }
    const { view } = this.editor;
    view.dispatch(
      view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, width: w, height: h }),
    );
    this.live.textContent = readoutText({ width: w, height: h }, this.natural);
  }

  private openDetails(): void {
    const pos = this.getPos();
    if (pos !== undefined) this.host()?.details(pos);
  }

  private remove(): void {
    const pos = this.getPos();
    if (pos === undefined) return;
    const { view } = this.editor;
    view.dispatch(view.state.tr.delete(pos, pos + this.node.nodeSize));
    this.editor.commands.focus();
  }

  // ------------------------------------------------------------ ProseMirror node view contract

  update(node: PmNode): boolean {
    if (node.type !== this.node.type) return false;
    const idChanged = node.attrs['imageId'] !== this.node.attrs['imageId'];
    this.node = node;
    if (idChanged) {
      this.pic.removeAttribute('src');
      this.fetch();
    } else this.render();
    return true;
  }

  /** The bar, the handles and the buttons of a missing image take their own events; ProseMirror must not select or drag from them. */
  stopEvent(ev: Event): boolean {
    const t = ev.target as HTMLElement | null;
    return !!t?.closest?.('.ne-img__bar, .ne-img__hd, .ne-img__off-acts');
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    this.gone = true;
    views.delete(this.dom);
  }
}
