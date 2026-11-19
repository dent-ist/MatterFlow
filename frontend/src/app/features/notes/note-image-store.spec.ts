import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { NoteImagesClient } from '../../api/generated/api-client';
import { ApiError } from '../../core/http/api-error';
import { NoteImageStore } from './note-image-store';

const err = (status: number) =>
  new ApiError(status, undefined, 'x', undefined, new HttpErrorResponse({ status }));

describe('NoteImageStore', () => {
  let api: {
    getNoteImage: ReturnType<typeof vi.fn>;
    uploadNoteImage: ReturnType<typeof vi.fn>;
    deleteNoteImage: ReturnType<typeof vi.fn>;
    copyNoteImage: ReturnType<typeof vi.fn>;
  };
  let store: NoteImageStore;

  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => `blob:test/${Math.random()}`);
    URL.revokeObjectURL = vi.fn();
    api = {
      getNoteImage: vi.fn(() => of({ data: new Blob(['a']), status: 200 })),
      uploadNoteImage: vi.fn(() =>
        of({
          noteImageId: 9,
          matterId: 1,
          width: 10,
          height: 5,
          contentType: 'image/png',
          byteSize: 3,
        }),
      ),
      deleteNoteImage: vi.fn(() => of(undefined)),
      copyNoteImage: vi.fn(() => of({ noteImageId: 12, matterId: 2 })),
    };
    TestBed.configureTestingModule({ providers: [{ provide: NoteImagesClient, useValue: api }] });
    store = TestBed.inject(NoteImageStore);
  });

  it('fetches an image once and serves the blob URL from the cache', async () => {
    const a = await store.load(5);
    const b = await store.load(5);
    expect(a.state).toBe('ok');
    expect(b).toEqual(a);
    expect(api.getNoteImage).toHaveBeenCalledTimes(1);
  });

  it('says missing for a 404 and error for the rest, and asks again next time', async () => {
    api.getNoteImage.mockReturnValueOnce(throwError(() => err(404)));
    expect((await store.load(6)).state).toBe('missing');
    api.getNoteImage.mockReturnValueOnce(throwError(() => err(500)));
    expect((await store.load(7)).state).toBe('error');
    expect((await store.load(7)).state).toBe('ok');
    expect(api.getNoteImage).toHaveBeenCalledTimes(3);
  });

  it('uploads as multipart, shows the new image without a second trip and remembers it for the session', async () => {
    const blob = new Blob(['png']);
    const res = await store.upload(1, {
      blob,
      width: 10,
      height: 5,
      contentType: 'image/png',
      fileName: 'a.png',
    });
    expect(res.noteImageId).toBe(9);
    expect(api.uploadNoteImage).toHaveBeenCalledWith(1, { data: blob, fileName: 'a.png' });
    expect((await store.load(9)).state).toBe('ok');
    expect(api.getNoteImage).not.toHaveBeenCalled();
    expect(store.inSession(9)).toBe(true);
  });

  it('Cancel and Discard delete the session images and ignore 404 and 409', async () => {
    await store.upload(1, {
      blob: new Blob(['a']),
      width: 1,
      height: 1,
      contentType: 'image/png',
      fileName: 'a.png',
    });
    await store.copy(3, 1);
    api.deleteNoteImage.mockReturnValueOnce(throwError(() => err(409)));
    await store.discardSession();
    expect(api.deleteNoteImage.mock.calls.map((c) => c[0] as number).sort((a, b) => a - b)).toEqual(
      [9, 12],
    );
    expect(store.inSession(9)).toBe(false);
  });

  it('a save keeps the session images (nothing is deleted)', async () => {
    await store.copy(3, 1);
    store.keepSession();
    await store.discardSession();
    expect(api.deleteNoteImage).not.toHaveBeenCalled();
  });
});
