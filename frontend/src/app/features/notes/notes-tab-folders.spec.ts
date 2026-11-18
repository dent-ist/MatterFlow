import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import {
  AssetsClient,
  MattersClient,
  NoteFolderListResponse,
  NoteFolderResponse,
  NoteFoldersClient,
  NoteListItem,
  NoteTagsClient,
  NoteTemplatesClient,
  NotesClient,
  ProjectsClient,
  UsersLookupClient,
} from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { NotesTab } from './notes-tab';

const folder = (
  id: number,
  parent: number | undefined,
  name: string,
  noteCount = 0,
  subfolderCount = 0,
): NoteFolderResponse => ({
  noteFolderId: id,
  matterId: 7,
  parentFolderId: parent,
  name,
  noteCount,
  subfolderCount,
  rowVersion: `rv-${id}`,
});

const FOLDERS: NoteFolderListResponse = {
  folders: [
    folder(4, undefined, 'Custodians', 1, 2),
    folder(5, 4, 'Executive Team', 2),
    folder(6, 4, 'Finance', 0),
  ],
  noFolderNoteCount: 1,
  totalNoteCount: 4,
};

const note = (id: number, title: string, folderId?: number, locked = false): NoteListItem => ({
  noteId: id,
  matterId: 7,
  folderId,
  title,
  snippet: `${title} text`,
  tags: [],
  isPinned: false,
  isLocked: locked,
  lockedByUserId: undefined,
  lockedByName: locked ? 'Tomas Berg' : undefined,
  lockedAtUtc: undefined,
  updatedAtUtc: '2026-11-17T16:05:00Z',
  updatedByUserId: 1,
  updatedByName: 'Priya Raman',
  createdByUserId: 1,
  createdByName: 'Priya Raman',
});

const NOTES = [
  note(1, 'Alvarez interview', 5),
  note(2, 'Chen mobile device', 5),
  note(3, 'Locked protocol', 4, true),
  note(4, 'Loose note'),
];

describe('Notes tab with folders (#1408)', () => {
  let fixture: ComponentFixture<NotesTab>;
  let listNotes: ReturnType<typeof vi.fn>;
  let createNote: ReturnType<typeof vi.fn>;

  /** The arguments of listNotes: (matterId, tagId, locked, q, folderId, noFolder, page, pageSize, sort). */
  const lastList = () => listNotes.mock.calls[listNotes.mock.calls.length - 1];

  async function setup(
    opts: { perms?: string[]; folderParam?: string; notes?: NoteListItem[] } = {},
  ) {
    const perms = opts.perms ?? ['MatterNote.View', 'MatterNote.Edit', 'MatterNote.Delete'];
    localStorage.clear();
    listNotes = vi.fn(
      (
        _m: number,
        _t: unknown,
        _l: unknown,
        q: string | undefined,
        folderId: number | undefined,
        noFolder: boolean | undefined,
      ) => {
        let items = opts.notes ?? NOTES;
        if (folderId !== undefined) {
          const inside = new Set([folderId, ...(folderId === 4 && q ? [5, 6] : [])]);
          items = items.filter((n) => n.folderId !== undefined && inside.has(n.folderId));
        }
        if (noFolder) items = items.filter((n) => n.folderId === undefined);
        if (q) items = items.filter((n) => n.title.toLowerCase().includes(q.toLowerCase()));
        return of({ items, total: items.length, page: 1, pageSize: 100 });
      },
    );
    createNote = vi.fn(() =>
      of({
        noteId: 99,
        matterId: 7,
        title: 'New',
        bodyHtml: '<h1>New</h1>',
        tags: [],
        rowVersion: 'r',
        references: [],
      }),
    );
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              queryParamMap: convertToParamMap(
                opts.folderParam ? { folder: opts.folderParam } : {},
              ),
            },
          },
        },
        {
          provide: NotesClient,
          useValue: {
            listNotes,
            createNote,
            getNote: () => of({}),
            getNoteHistory: () => of({ items: [] }),
            resolveNoteReferences: () => of({ items: [] }),
          },
        },
        {
          provide: NoteFoldersClient,
          useValue: { listNoteFolders: vi.fn(() => of(FOLDERS)) },
        },
        { provide: NoteTagsClient, useValue: { listNoteTags: () => of([]) } },
        { provide: NoteTemplatesClient, useValue: { listNoteTemplates: () => of([]) } },
        { provide: AssetsClient, useValue: {} },
        { provide: ProjectsClient, useValue: {} },
        { provide: MattersClient, useValue: {} },
        { provide: UsersLookupClient, useValue: {} },
        {
          provide: AuthStore,
          useValue: {
            has: (p: string) => perms.includes(p),
            isSystemAdmin: () => false,
            profile: () => ({ userId: 1 }),
            displayName: () => 'Priya Raman',
          },
        },
      ],
    });
    fixture = TestBed.createComponent(NotesTab);
    fixture.componentRef.setInput('matterId', 7);
    fixture.detectChanges();
    await settle();
  }

  async function settle() {
    for (let i = 0; i < 4; i += 1) {
      await fixture.whenStable();
      fixture.detectChanges();
      await new Promise((r) => setTimeout(r));
    }
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const rowNames = () =>
    Array.from(el().querySelectorAll('[data-note-item] .nt__ti')).map((e) =>
      e.textContent!.replace(/\s+/g, ' ').trim(),
    );
  const treeRow = (key: string) =>
    el().querySelector<HTMLElement>(`[data-folder-list] [data-key="${key}"]`)!;
  const pathText = () =>
    el().querySelector('[data-notes-path]')!.textContent!.replace(/\s+/g, ' ').trim();

  it('shows the tree beside the list, All Notes first, with each note naming its folder', async () => {
    await setup();
    expect(el().querySelector('mf-note-folder-tree')).not.toBeNull();
    expect(
      Array.from(el().querySelectorAll('[data-folder-list] .ft__name')).map((e) =>
        e.textContent!.trim(),
      ),
    ).toEqual(['All Notes', 'No Folder', 'Custodians']);
    expect(lastList().slice(4, 6)).toEqual([undefined, undefined]);
    expect(rowNames()).toHaveLength(4);
    const where = Array.from(el().querySelectorAll('[data-note-folder]')).map((e) =>
      e.textContent!.replace(/\s+/g, ' ').trim(),
    );
    expect(where).toContain('Folder: Custodians > Executive Team');
    expect(where).toContain('Folder: No Folder');
    expect(pathText()).toContain('All Notes');
  });

  it('shows only the direct notes of the selected folder, asks the server by folder id, and says where we are', async () => {
    await setup();
    treeRow('4').click();
    await settle();
    expect(lastList().slice(4, 6)).toEqual([4, undefined]);
    expect(rowNames()).toEqual(['Locked protocol']);
    expect(pathText()).toContain('Custodians');
    // a note in a folder shows no folder line outside All Notes and search
    expect(el().querySelector('[data-note-folder]')).toBeNull();
    // the address carries the folder, replaced not pushed
    expect(el().querySelector('[data-notes-path] b')!.textContent).toContain('Custodians');
  });

  it('asks for No Folder with the noFolder filter', async () => {
    await setup();
    treeRow('none').click();
    await settle();
    expect(lastList().slice(4, 6)).toEqual([undefined, true]);
    expect(rowNames()).toEqual(['Loose note']);
  });

  it('opens a folder from ?folder= and opens the path to it', async () => {
    await setup({ folderParam: '5' });
    expect(lastList().slice(4, 6)).toEqual([5, undefined]);
    expect(rowNames()).toEqual(['Alvarez interview', 'Chen mobile device']);
    expect(treeRow('5')).not.toBeNull();
    expect(treeRow('5').getAttribute('aria-selected')).toBe('true');
    expect(el().querySelector('[data-notes-path]')!.textContent).toContain('Executive Team');
  });

  it('falls back to All Notes for a folder that is not there', async () => {
    await setup({ folderParam: '999' });
    expect(treeRow('all').getAttribute('aria-selected')).toBe('true');
    expect(rowNames()).toHaveLength(4);
  });

  it('says "No notes in this folder yet." with New Note for an empty folder', async () => {
    await setup({ folderParam: '6' });
    const empty = el().querySelector('[data-notes-empty]')!;
    expect(empty.textContent).toContain('No notes in this folder yet.');
    expect(empty.querySelector('button')!.textContent).toContain('New Note');
  });

  it("a search inside a folder covers its subfolders, names each note's folder, and offers Search All Notes when nothing matches", async () => {
    await setup({ folderParam: '4' });
    const search = el().querySelector<HTMLInputElement>('#nt-search')!;
    search.value = 'alvarez';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));
    await settle();
    expect(lastList().slice(3, 6)).toEqual(['alvarez', 4, undefined]);
    expect(rowNames()).toEqual(['Alvarez interview']);
    expect(el().querySelector('[data-note-folder]')!.textContent).toContain(
      'Custodians > Executive Team',
    );

    search.value = 'tablet';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));
    await settle();
    const none = el().querySelector('[data-notes-nomatch]')!;
    expect(none.textContent).toContain('No results for "tablet" in Custodians.');
    el().querySelector<HTMLButtonElement>('[data-search-all]')!.click();
    await settle();
    expect(lastList().slice(3, 6)).toEqual(['tablet', undefined, undefined]);
  });

  it('hides the tree in the Templates view and brings it back', async () => {
    await setup();
    el().querySelector<HTMLButtonElement>('[data-view="templates"]')!.click();
    await settle();
    expect(el().querySelector('mf-note-folder-tree')).toBeNull();
    expect(el().querySelector('[data-notes-path]')).toBeNull();
    el().querySelector<HTMLButtonElement>('[data-view="latest"]')!.click();
    await settle();
    expect(el().querySelector('mf-note-folder-tree')).not.toBeNull();
  });

  it('makes note rows draggable only for a person who can edit', async () => {
    await setup();
    expect(el().querySelector('[data-note-item]')!.getAttribute('draggable')).toBe('true');
    TestBed.resetTestingModule();
    await setup({ perms: ['MatterNote.View'] });
    expect(el().querySelector('[data-note-item]')!.getAttribute('draggable')).toBeNull();
    // the read-only person still sees the tree, with counts, and no New Folder
    expect(el().querySelector('[data-folder-list]')).not.toBeNull();
    expect(el().querySelector('[data-folder-new]')).toBeNull();
  });

  it('starts a drag with the note and drops it through the same move as the menu', async () => {
    await setup();
    const rowEl = el().querySelector<HTMLElement>('[data-note-item]')!;
    const ev = new Event('dragstart', { bubbles: true }) as DragEvent;
    Object.defineProperty(ev, 'dataTransfer', { value: { setData: vi.fn(), effectAllowed: '' } });
    rowEl.dispatchEvent(ev);
    const store = fixture.debugElement.injector.get(
      (await import('./note-folder-store')).NoteFolderStore,
    );
    expect(store.drag()).toMatchObject({ kind: 'note', id: 1, folderId: 5 });
    rowEl.dispatchEvent(new Event('dragend', { bubbles: true }));
    expect(store.drag()).toBeNull();
  });

  it('a new note goes into the selected folder, and into none from All Notes', async () => {
    await setup({ folderParam: '5' });
    el().querySelector<HTMLButtonElement>('[data-new-note]')!.click();
    await settle();
    const cmp = fixture.componentInstance as unknown as {
      onChanged(html: string): void;
      save(): Promise<void>;
      newFolder(): number | null;
    };
    expect(cmp.newFolder()).toBe(5);
    expect(el().querySelector('[data-note-where]')!.textContent).toContain(
      'Custodians > Executive Team',
    );
    cmp.onChanged('<h1>Fresh</h1>');
    await cmp.save();
    expect(createNote).toHaveBeenCalledWith({
      matterId: 7,
      bodyHtml: expect.any(String),
      tagIds: [],
      folderId: 5,
    });
  });

  it('a new note from All Notes has no folder', async () => {
    await setup();
    el().querySelector<HTMLButtonElement>('[data-new-note]')!.click();
    await settle();
    const cmp = fixture.componentInstance as unknown as { newFolder(): number | null };
    expect(cmp.newFolder()).toBeNull();
  });

  it('keeps the tree out of the way when the card is narrow, as the rail', async () => {
    await setup();
    const cmp = fixture.componentInstance as unknown as { cardWidth: { set(n: number): void } };
    cmp.cardWidth.set(900);
    await settle();
    expect(el().querySelector('[data-folder-rail]')).not.toBeNull();
    cmp.cardWidth.set(1114);
    await settle();
    expect(el().querySelector('[data-folder-list]')).not.toBeNull();
  });
});
