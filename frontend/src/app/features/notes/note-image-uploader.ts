import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';
import { IMAGE_COPY, ImageFailure, failureOf } from './note-image-copy';
import { IMAGE_NODE } from './note-image-node';
import { ImagePrepareError, PreparedImage, prepareImage } from './note-image-prepare';
import { IMAGE_DEFAULT_ALT, IMAGE_MAX_PER_NOTE, pastedSize } from './note-image-size';
import { NoteImageStore } from './note-image-store';
import { UploadMeta, UploadSlot, uploadsKey } from './note-image-upload';

interface Job {
  readonly file: Blob;
  readonly name: string;
  prepared: PreparedImage | null;
  /** True once the person removed the placeholder while the upload ran. */
  cancelled: boolean;
}

type Outcome =
  { ok: true; id: number; width: number; height: number } | { ok: false; why: ImageFailure };

/** How many uploads run at once; the images still go into the text in the order they were pasted. */
const PARALLEL = 2;

/** Where an image pasted at this selection goes: after the paragraph that holds the cursor, or in place of an empty paragraph. */
export function placement(state: EditorState): { pos: number; replaceEmpty: boolean } {
  const sel = state.selection;
  if (sel instanceof NodeSelection) return { pos: sel.to, replaceEmpty: false };
  const $head = sel.$head;
  if ($head.parent.isTextblock && $head.depth > 0) {
    const empty = $head.parent.content.size === 0;
    return { pos: empty ? $head.before() : $head.after(), replaceEmpty: empty };
  }
  return { pos: sel.to, replaceEmpty: false };
}

/** The images of a document, counted by id (the same picture twice counts once, as the server counts). */
export function imageIdsIn(editor: Editor): Set<number> {
  const ids = new Set<number>();
  editor.state.doc.descendants((n) => {
    if (n.type.name === IMAGE_NODE) ids.add(Number(n.attrs['imageId']));
  });
  return ids;
}

/**
 * The paste flow of pictures (design note 4.5, rule D-46d): for each image file a placeholder block is added at the cursor, the browser re-draws the bytes, the
 * server stores them, and the placeholder becomes the image (selected, so its bar shows). A failure turns the placeholder into the red block with Retry and Remove;
 * nothing is inserted until it works. Uploads run two at a time and the images go in in the order pasted. The editor stays the owner of the document: this class only
 * sends transactions (a placeholder is plugin state, the finished image is one ordinary undo step).
 */
export class NoteImageUploader {
  private seq = 0;
  private readonly jobs = new Map<string, Job>();
  private readonly waiting: string[] = [];
  private order: string[] = [];
  private readonly results = new Map<string, Outcome>();
  private running = 0;
  /** The re-draw; the specs replace it (jsdom has no canvas). */
  prepare: (file: Blob, name: string) => Promise<PreparedImage> = (f, n) => prepareImage(f, n);

  constructor(
    private readonly deps: {
      editor: () => Editor | null;
      matterId: () => number | null;
      store: NoteImageStore;
      /** The width the text leaves for an image. */
      room: () => number;
      announce: (text: string) => void;
      changed: () => void;
    },
  ) {}

  /** Placeholders in the document: uploading or failed. */
  slots(): readonly UploadSlot[] {
    const editor = this.deps.editor();
    return (editor && uploadsKey.getState(editor.state)) || [];
  }

  get busy(): boolean {
    return this.slots().length > 0;
  }

  private send(meta: UploadMeta): void {
    const editor = this.deps.editor();
    if (!editor || editor.isDestroyed) return;
    editor.view.dispatch(editor.state.tr.setMeta(uploadsKey, meta));
  }

  /** Adds one placeholder per file, in order, and starts the uploads. */
  add(files: readonly File[]): void {
    const editor = this.deps.editor();
    if (!editor || !this.deps.matterId()) return;
    const at = placement(editor.state);
    let first = true;
    for (const file of files) {
      const id = `u${++this.seq}`;
      const room = IMAGE_MAX_PER_NOTE - imageIdsIn(editor).size - this.uploading();
      const name = file.name || '';
      const slot: UploadSlot = {
        id,
        pos: at.pos,
        replaceEmpty: first && at.replaceEmpty,
        state: room <= 0 ? 'failed' : 'uploading',
        name: name || IMAGE_COPY.pastedName,
        bytes: file.size,
        failure: room <= 0 ? { reason: 'count', retry: false } : null,
      };
      first = false;
      this.jobs.set(id, { file, name, prepared: null, cancelled: false });
      this.send({ type: 'add', slot });
      if (slot.state === 'uploading') this.enqueue(id);
    }
    this.deps.changed();
  }

  private uploading(): number {
    return this.slots().filter((s) => s.state === 'uploading').length;
  }

  private enqueue(id: string): void {
    this.order.push(id);
    this.waiting.push(id);
    this.pump();
  }

  private pump(): void {
    while (this.running < PARALLEL && this.waiting.length > 0) {
      const id = this.waiting.shift() as string;
      this.running++;
      void this.run(id).finally(() => {
        this.running--;
        this.pump();
      });
    }
  }

  private async run(id: string): Promise<void> {
    const job = this.jobs.get(id);
    const matter = this.deps.matterId();
    let outcome: Outcome;
    if (!job || !matter) {
      outcome = { ok: false, why: { reason: 'access', retry: false } };
    } else {
      try {
        job.prepared ??= await this.prepare(job.file, job.name);
        const res = await this.deps.store.upload(matter, job.prepared);
        outcome = { ok: true, id: res.noteImageId, width: res.width, height: res.height };
      } catch (e) {
        outcome =
          e instanceof ImagePrepareError
            ? { ok: false, why: { reason: e.problem, retry: false } }
            : { ok: false, why: failureOf(e) };
      }
    }
    if (job?.cancelled) return;
    this.results.set(id, outcome);
    this.flush();
  }

  /** Settles the finished uploads in the order they were pasted. */
  private flush(): void {
    while (this.order.length > 0 && this.results.has(this.order[0])) {
      const id = this.order.shift() as string;
      const outcome = this.results.get(id) as Outcome;
      this.results.delete(id);
      this.settle(id, outcome);
    }
    this.deps.changed();
  }

  private settle(id: string, outcome: Outcome): void {
    const editor = this.deps.editor();
    if (!editor || editor.isDestroyed) return;
    const slot = this.slots().find((s) => s.id === id);
    const job = this.jobs.get(id);
    if (!slot || job?.cancelled) return; // removed while it ran
    if (!outcome.ok) {
      this.send({ type: 'state', id, state: 'failed', failure: outcome.why });
      this.deps.announce(IMAGE_COPY.liveFailed);
      return;
    }
    this.insert(editor, slot, outcome);
    this.jobs.delete(id);
    this.deps.announce(IMAGE_COPY.liveAdded);
  }

  /** The placeholder becomes the image in ONE transaction, so a single Undo takes the image out. The new image is selected and shows its bar. */
  private insert(
    editor: Editor,
    slot: UploadSlot,
    res: { id: number; width: number; height: number },
  ): void {
    const { state, view } = editor;
    const type = state.schema.nodes[IMAGE_NODE];
    const size = pastedSize({ width: res.width, height: res.height }, this.deps.room());
    const img = type.create({
      imageId: res.id,
      alt: IMAGE_DEFAULT_ALT,
      width: size.width,
      height: size.height,
    });
    const tr = state.tr;
    let pos = Math.min(slot.pos, tr.doc.content.size);
    try {
      const at = tr.doc.nodeAt(pos);
      if (slot.replaceEmpty && at?.isTextblock && at.content.size === 0)
        tr.replaceWith(pos, pos + at.nodeSize, img);
      else tr.insert(pos, img);
    } catch {
      pos = tr.doc.content.size; // the text moved under the placeholder: the end of the note is always valid
      tr.insert(pos, img);
    }
    // A last image needs a paragraph after it, or the caret has nowhere to go.
    const $after = tr.doc.resolve(pos + img.nodeSize);
    if (!$after.nodeAfter && $after.parent.type.name === 'doc') {
      tr.insert(pos + img.nodeSize, state.schema.nodes['paragraph'].create());
    }
    tr.setSelection(NodeSelection.create(tr.doc, pos));
    tr.setMeta(uploadsKey, { type: 'remove', id: slot.id } satisfies UploadMeta);
    view.dispatch(tr.scrollIntoView());
  }

  /** Retry: the same bytes again (the re-draw is kept). */
  retry(id: string): void {
    const slot = this.slots().find((s) => s.id === id);
    if (!slot || slot.state !== 'failed' || !slot.failure?.retry) return;
    const imageCount = imageIdsIn(this.deps.editor() as Editor).size + this.uploading();
    if (imageCount >= IMAGE_MAX_PER_NOTE) {
      this.send({ type: 'state', id, state: 'failed', failure: { reason: 'count', retry: false } });
      return;
    }
    this.send({ type: 'state', id, state: 'uploading', failure: null });
    this.enqueue(id);
    this.deps.changed();
  }

  /** Remove: the placeholder goes; an upload still running is left to finish and the unused image is cleaned up with the session. */
  remove(id: string): void {
    const job = this.jobs.get(id);
    if (job) job.cancelled = true;
    this.jobs.delete(id);
    this.order = this.order.filter((x) => x !== id);
    this.results.delete(id);
    const i = this.waiting.indexOf(id);
    if (i >= 0) this.waiting.splice(i, 1);
    this.send({ type: 'remove', id });
    this.deps.announce(IMAGE_COPY.liveRemoved);
    this.deps.changed();
  }

  /** Another note was loaded: nothing of the old one may be left. */
  reset(): void {
    for (const s of [...this.slots()]) this.remove(s.id);
    this.jobs.clear();
    this.waiting.length = 0;
    this.order = [];
    this.results.clear();
  }
}
