import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { IMAGE_COPY, ImageFailure } from './note-image-copy';

/** One image on its way into the text: a block at the cursor that is not part of the document (undo and redo skip it, the server never sees it). */
export interface UploadSlot {
  readonly id: string;
  /** Where the image goes; the document's steps move it. */
  readonly pos: number;
  /** The paste happened in an empty paragraph: the image takes its place instead of sitting beside it. */
  readonly replaceEmpty: boolean;
  readonly state: 'uploading' | 'failed';
  readonly name: string;
  readonly bytes: number;
  readonly failure: ImageFailure | null;
}

export type UploadMeta =
  | { type: 'add'; slot: UploadSlot }
  | { type: 'state'; id: string; state: 'uploading' | 'failed'; failure: ImageFailure | null }
  | { type: 'remove'; id: string };

export const uploadsKey = new PluginKey<readonly UploadSlot[]>('noteImageUploads');

export interface UploadHandlers {
  retry(id: string): void;
  remove(id: string): void;
}

/** "1.4 MB", "84 KB" for the line under "Adding image...". */
export function sizeText(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  attrs: Record<string, string> = {},
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

function lines(title: string, sub: string): HTMLElement {
  const tx = node('div', 'ne-up__tx');
  const b = node('b');
  b.textContent = title;
  const s = node('span');
  s.textContent = sub;
  tx.append(b, s);
  return tx;
}

/** The placeholder block (mockup scene `image-fail`): a bordered panel with a spinner and a progress bar, or the red failure block with Retry (only when the same bytes can work) and Remove. */
function render(slot: UploadSlot, handlers: UploadHandlers): HTMLElement {
  const root = node('div', `ne-up ne-up--${slot.state}`, {
    contenteditable: 'false',
    'data-image-slot': slot.id,
    'data-slot-state': slot.state,
  });
  if (slot.state === 'uploading') {
    root.setAttribute('role', 'status');
    const i = node('i', 'pi pi-spinner pi-spin', { 'aria-hidden': 'true' });
    const tx = lines(IMAGE_COPY.uploading, `${slot.name} · ${sizeText(slot.bytes)}`);
    const bar = node('div', 'ne-up__prog', {
      role: 'progressbar',
      'aria-label': 'Upload progress',
    });
    bar.append(node('i'));
    tx.append(bar);
    root.append(i, tx);
    return root;
  }
  root.setAttribute('role', 'alert');
  const reason = slot.failure?.reason ?? 'offline';
  const tx = lines(IMAGE_COPY.failTitle, IMAGE_COPY.reasons[reason]);
  const acts = node('div', 'ne-up__acts');
  const button = (label: string, run: () => void, ic = ''): HTMLButtonElement => {
    const b = node('button', 'mf-btn mf-btn--text ne-up__act', { type: 'button' });
    if (ic) b.append(node('i', `pi pi-${ic}`, { 'aria-hidden': 'true' }));
    b.append(document.createTextNode(label));
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', (e) => {
      e.preventDefault();
      run();
    });
    return b;
  };
  if (slot.failure?.retry) {
    const r = button(IMAGE_COPY.retry, () => handlers.retry(slot.id), 'refresh');
    r.dataset['slotRetry'] = '';
    acts.append(r);
  }
  const rm = button(IMAGE_COPY.remove, () => handlers.remove(slot.id));
  rm.dataset['slotRemove'] = '';
  acts.append(rm);
  tx.append(acts);
  root.append(node('i', 'pi pi-exclamation-triangle', { 'aria-hidden': 'true' }), tx);
  return root;
}

/**
 * The placeholders of images being added (design note 4.5). The state lives in the plugin, not in the document: a transaction with `uploadsKey` meta adds, changes or
 * removes a slot, and the slot's position follows the document's steps. The image itself is inserted by the host in the same transaction that removes its slot, so one
 * Undo takes the image out.
 */
export function uploadsPlugin(handlers: UploadHandlers): Plugin<readonly UploadSlot[]> {
  return new Plugin<readonly UploadSlot[]>({
    key: uploadsKey,
    state: {
      init: () => [],
      apply(tr, slots) {
        let next = tr.docChanged ? slots.map((s) => ({ ...s, pos: tr.mapping.map(s.pos) })) : slots;
        const meta = tr.getMeta(uploadsKey) as UploadMeta | undefined;
        if (!meta) return next;
        if (meta.type === 'add') next = [...next, meta.slot];
        else if (meta.type === 'remove') next = next.filter((s) => s.id !== meta.id);
        else
          next = next.map((s) =>
            s.id === meta.id ? { ...s, state: meta.state, failure: meta.failure } : s,
          );
        return next;
      },
    },
    props: {
      decorations(state) {
        const slots = uploadsKey.getState(state) ?? [];
        if (slots.length === 0) return DecorationSet.empty;
        return DecorationSet.create(
          state.doc,
          slots.map((s) =>
            Decoration.widget(Math.min(s.pos, state.doc.content.size), () => render(s, handlers), {
              key: `${s.id}:${s.state}:${s.failure?.reason ?? ''}`,
              side: 1,
              ignoreSelection: true,
              stopEvent: () => true,
            }),
          ),
        );
      },
    },
  });
}
