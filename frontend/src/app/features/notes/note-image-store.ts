import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { NoteImageResponse, NoteImagesClient } from '../../api/generated/api-client';
import { ApiError } from '../../core/http/api-error';
import { QuietRequests } from '../../core/http/interceptors';
import { PreparedImage } from './note-image-prepare';

/** What the editor gets for one image id: the blob URL to show, or why there is none. */
export type LoadedImage = { state: 'ok'; url: string } | { state: 'missing' } | { state: 'error' };

/** The most blob URLs kept; the oldest is revoked first (a note holds at most 20 images, so this covers several open notes). */
const CACHE_LIMIT = 80;

/**
 * Note images on the client (epic #1405, #1410; `wiki/How-To/Work-with-Note-Images.md`): uploads, copies into another matter, and the blob URLs the editor shows.
 *
 * - **Showing**: an image is fetched through the API client (so the Dev user header and impersonation travel with it, and a 404 can say "removed") and shown as a blob
 *   URL, with a small cache per id. A failed fetch is not cached, so a second try goes to the server.
 * - **The session**: every image uploaded or copied while a note is open for editing is remembered. A save keeps them (the server deletes what no saved body uses);
 *   Cancel and Discard delete the ones that were never saved (`discardSession`, 404 and 409 ignored).
 */
@Injectable({ providedIn: 'root' })
export class NoteImageStore {
  private readonly api = inject(NoteImagesClient);
  /** Every failure here is shown inline (the failure block, the missing-image block), never as a toast (D-51). */
  private readonly quiet = inject(QuietRequests);
  private readonly cache = new Map<number, Promise<LoadedImage>>();
  private readonly session = new Set<number>();

  /** The blob URL of an image, through the cache. */
  load(id: number): Promise<LoadedImage> {
    const hit = this.cache.get(id);
    if (hit) {
      this.cache.delete(id); // most recently used goes last
      this.cache.set(id, hit);
      return hit;
    }
    const p = this.fetch(id);
    this.remember(id, p);
    // A failure is not kept: the next load asks the server again.
    void p.then((r) => {
      if (r.state !== 'ok' && this.cache.get(id) === p) this.cache.delete(id);
    });
    return p;
  }

  private async fetch(id: number): Promise<LoadedImage> {
    try {
      const res = await this.quiet.run(() => firstValueFrom(this.api.getNoteImage(id)));
      return { state: 'ok', url: URL.createObjectURL(res.data) };
    } catch (e) {
      return e instanceof ApiError && (e.status === 404 || e.status === 403)
        ? { state: 'missing' }
        : { state: 'error' };
    }
  }

  private remember(id: number, p: Promise<LoadedImage>): void {
    this.cache.set(id, p);
    while (this.cache.size > CACHE_LIMIT) {
      const oldest = this.cache.keys().next().value as number;
      const gone = this.cache.get(oldest);
      this.cache.delete(oldest);
      void gone?.then((r) => r.state === 'ok' && URL.revokeObjectURL(r.url));
    }
  }

  /** Uploads prepared bytes to a matter; the new id joins the session. Throws the `ApiError` of a refusal. */
  async upload(matterId: number, image: PreparedImage): Promise<NoteImageResponse> {
    const res = await this.quiet.run(() =>
      firstValueFrom(
        this.api.uploadNoteImage(matterId, { data: image.blob, fileName: image.fileName }),
      ),
    );
    this.session.add(res.noteImageId);
    // The bytes are already here: showing the image needs no second trip.
    this.remember(
      res.noteImageId,
      Promise.resolve({ state: 'ok', url: URL.createObjectURL(image.blob) }),
    );
    return res;
  }

  /** A separate copy of an image of another matter in this one (a note pasted between matters); the copy joins the session. */
  async copy(id: number, targetMatterId: number): Promise<NoteImageResponse> {
    const res = await this.quiet.run(() =>
      firstValueFrom(this.api.copyNoteImage(id, { targetMatterId })),
    );
    this.session.add(res.noteImageId);
    return res;
  }

  /** True for an image uploaded or copied in this editing session and not yet saved. */
  inSession(id: number): boolean {
    return this.session.has(id);
  }

  /** The note was saved: its images are kept (the server removed the ones its body no longer names). */
  keepSession(): void {
    this.session.clear();
  }

  /** Cancel or Discard: deletes every image of the session. A 404 (already gone) or 409 (a saved note uses it) is fine. */
  async discardSession(): Promise<void> {
    const ids = [...this.session];
    this.session.clear();
    await Promise.all(
      ids.map(async (id) => {
        try {
          await this.quiet.run(() => firstValueFrom(this.api.deleteNoteImage(id)));
        } catch {
          // Ignored on purpose: the nightly sweep is the safety net.
        }
        this.cache.delete(id);
      }),
    );
  }
}
