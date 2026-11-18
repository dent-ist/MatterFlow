import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import {
  NoteFolderListResponse,
  NoteFolderResponse,
  NoteFoldersClient,
  NotesClient,
} from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { ApiError } from '../../core/http/api-error';
import { NotificationService } from '../../core/notify/notification.service';
import { UndoService } from '../../core/notify/undo.service';
import { NoteFolderStore } from './note-folder-store';

const folder = (
  id: number,
  parent: number | undefined,
  name: string,
  noteCount = 0,
  subfolderCount = 0,
): NoteFolderResponse => ({
  noteFolderId: id,
  matterId: 1,
  parentFolderId: parent,
  name,
  noteCount,
  subfolderCount,
  rowVersion: `rv-${id}`,
});

const LIST: NoteFolderListResponse = {
  folders: [
    folder(4, undefined, 'Custodians', 1, 2),
    folder(5, 4, 'Executive Team', 3),
    folder(6, 4, 'Finance'),
  ],
  noFolderNoteCount: 2,
  totalNoteCount: 6,
};

const conflict = (code: string, meta?: Record<string, unknown>) =>
  throwError(
    () =>
      new ApiError(
        409,
        code,
        code,
        { code, meta },
        new HttpErrorResponse({ status: 409, statusText: code }),
      ),
  );

describe('NoteFolderStore (#1408)', () => {
  let api: Record<string, ReturnType<typeof vi.fn>>;
  let notes: Record<string, ReturnType<typeof vi.fn>>;

  function create(perms: string[] = ['MatterNote.Edit', 'MatterNote.Delete']): NoteFolderStore {
    api = {
      listNoteFolders: vi.fn(() => of(LIST)),
      createNoteFolder: vi.fn(() => of(folder(9, 4, 'Bank Records'))),
      renameNoteFolder: vi.fn(() => of(folder(6, 4, 'Money'))),
      moveNoteFolder: vi.fn((id: number) =>
        of({ ...folder(id, undefined, 'x'), rowVersion: 'rv-new' }),
      ),
      deleteNoteFolder: vi.fn(() => of(undefined)),
    };
    notes = {
      getNote: vi.fn(() => of({ noteId: 11, rowVersion: 'n1', folderId: 5 })),
      moveNote: vi.fn(() => of({ noteId: 11, rowVersion: 'n2', folderId: 6 })),
    };
    TestBed.configureTestingModule({
      providers: [
        NoteFolderStore,
        { provide: NoteFoldersClient, useValue: api },
        { provide: NotesClient, useValue: notes },
        { provide: AuthStore, useValue: { has: (p: string) => perms.includes(p) } },
      ],
    });
    return TestBed.inject(NoteFolderStore);
  }

  beforeEach(() => localStorage.clear());

  it('loads the folders, the counts and the tree', async () => {
    const s = create();
    await s.load(1);
    expect(s.loaded()).toBe(true);
    expect(s.tree().roots.map((n) => n.name)).toEqual(['Custodians']);
    expect(s.noFolderCount()).toBe(2);
    expect(s.totalCount()).toBe(6);
    expect(s.canEdit()).toBe(true);
  });

  it('follows the permissions', () => {
    const s = create(['MatterNote.View']);
    expect(s.canEdit()).toBe(false);
    expect(s.canDelete()).toBe(false);
  });

  it('opens the path to a selected folder and names the scope', async () => {
    const s = create();
    await s.load(1);
    s.select(5);
    expect(s.open().has(4)).toBe(true);
    expect(s.selectedId()).toBe(5);
    expect(s.scopeName()).toBe('Custodians > Executive Team');
    s.select('none');
    expect(s.selectedId()).toBeNull();
    expect(s.scopeName()).toBe('No Folder');
  });

  it('falls back to All Notes when the selected folder is gone', async () => {
    const s = create();
    s.scope.set(99);
    await s.load(1);
    expect(s.scope()).toBe('all');
  });

  it('opens the path of a folder given by the address once the folders are there', async () => {
    const s = create();
    s.scope.set(6);
    await s.load(1);
    expect(s.scope()).toBe(6);
    expect(s.open().has(4)).toBe(true);
  });

  it('says a name clash before asking the server', async () => {
    const s = create();
    await s.load(1);
    s.ask({ kind: 'create', parentId: 4 });
    expect(await s.create('  finance ', 4)).toBe(false);
    expect(s.nameError()).toBe('A folder named "finance" already exists in Custodians.');
    expect(api['createNoteFolder']).not.toHaveBeenCalled();
    expect(s.dialog()).not.toBeNull();
  });

  it('creates a folder, closes the dialog and toasts', async () => {
    const s = create();
    await s.load(1);
    s.ask({ kind: 'create', parentId: 4 });
    expect(await s.create('Bank Records', 4)).toBe(true);
    expect(api['createNoteFolder']).toHaveBeenCalledWith({
      matterId: 1,
      parentFolderId: 4,
      name: 'Bank Records',
    });
    expect(s.dialog()).toBeNull();
    expect(TestBed.inject(NotificationService).toasts()[0].summary).toBe('Folder created');
  });

  it('shows the server name clash under the field and keeps the dialog', async () => {
    const s = create();
    await s.load(1);
    api['createNoteFolder'].mockReturnValue(conflict('FOLDER_NAME_TAKEN'));
    s.ask({ kind: 'create', parentId: null });
    expect(await s.create('Archive', null)).toBe(false);
    expect(s.nameError()).toContain('"Archive" already exists');
    expect(s.dialog()).not.toBeNull();
    expect(s.busy()).toBe(false);
  });

  it('says other folder errors in the dialog', async () => {
    const s = create();
    await s.load(1);
    api['createNoteFolder'].mockReturnValue(conflict('FOLDER_TOO_DEEP'));
    s.ask({ kind: 'create', parentId: 5 });
    await s.create('Deep', 5);
    expect(s.dialogError()).toContain('5 levels');
  });

  it('renames with the row version', async () => {
    const s = create();
    await s.load(1);
    s.ask({ kind: 'rename', id: 6 });
    expect(await s.rename(6, 'Money')).toBe(true);
    expect(api['renameNoteFolder']).toHaveBeenCalledWith(6, { name: 'Money', rowVersion: 'rv-6' });
  });

  it('moves a folder and offers Undo that moves it back with the new row version', async () => {
    const s = create();
    await s.load(1);
    expect(await s.moveFolder(5, null)).toBe(true);
    expect(api['moveNoteFolder']).toHaveBeenCalledWith(5, {
      parentFolderId: undefined,
      rowVersion: 'rv-5',
    });
    const offer = TestBed.inject(UndoService).current()!;
    expect(offer.message).toBe('Folder moved');
    await offer.undo();
    expect(api['moveNoteFolder']).toHaveBeenLastCalledWith(5, {
      parentFolderId: 4,
      rowVersion: 'rv-new',
    });
  });

  it('moves a note (locked or not), reads the list again and offers Undo', async () => {
    const s = create();
    await s.load(1);
    const before = s.revision();
    expect(await s.moveNote(11, 6, 'A note')).toBe(true);
    expect(notes['moveNote']).toHaveBeenCalledWith(11, { folderId: 6, rowVersion: 'n1' });
    expect(s.revision()).toBe(before + 1);
    const offer = TestBed.inject(UndoService).current()!;
    expect(offer.message).toBe('Note moved');
    expect(offer.detail).toContain('Custodians > Finance');
    await offer.undo();
    expect(notes['moveNote']).toHaveBeenLastCalledWith(11, { folderId: 5, rowVersion: 'n2' });
  });

  it('moves a note to No Folder', async () => {
    const s = create();
    await s.load(1);
    await s.moveNote(11, null, 'A note');
    expect(notes['moveNote']).toHaveBeenCalledWith(11, { folderId: undefined, rowVersion: 'n1' });
  });

  it('deletes a folder with contents only through Move Contents Up and selects the parent', async () => {
    const s = create();
    await s.load(1);
    s.select(5);
    s.ask({ kind: 'delete', id: 5 });
    expect(await s.remove(5, true)).toBe(true);
    expect(api['deleteNoteFolder']).toHaveBeenCalledWith(5, 'rv-5', true);
    expect(s.scope()).toBe(4);
    expect(TestBed.inject(NotificationService).toasts()[0].detail).toContain('3 notes');
  });

  it('asks the delete question again with the real numbers when the folder got contents', async () => {
    const s = create();
    await s.load(1);
    api['deleteNoteFolder'].mockReturnValue(conflict('FOLDER_NOT_EMPTY', { noteCount: 1 }));
    s.ask({ kind: 'delete', id: 6 });
    expect(await s.remove(6, false)).toBe(false);
    expect(s.dialog()).toEqual({ kind: 'delete', id: 6 });
  });

  it('closes the dialog and offers Reload Latest on a concurrency conflict', async () => {
    const s = create();
    await s.load(1);
    api['renameNoteFolder'].mockReturnValue(conflict('CONCURRENCY_CONFLICT'));
    s.ask({ kind: 'rename', id: 6 });
    await s.rename(6, 'Money');
    expect(s.dialog()).toBeNull();
    const toast = TestBed.inject(NotificationService).toasts()[0];
    expect(toast.summary).toBe('This folder was changed by someone else.');
    expect(toast.action?.label).toBe('Reload Latest');
  });

  it('remembers the folded tree per person, in storage', () => {
    const s = create();
    expect(s.treeOpen()).toBe(true);
    s.setTreeOpen(false);
    expect(localStorage.getItem('mf.notes.tree')).toBe('folded');
  });
});
