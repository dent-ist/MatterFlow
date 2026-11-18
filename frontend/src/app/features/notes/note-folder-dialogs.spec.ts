import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import {
  NoteFolderListResponse,
  NoteFolderResponse,
  NoteFoldersClient,
  NotesClient,
} from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { NoteFolderDialogs } from './note-folder-dialogs';
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
    folder(13, undefined, 'Productions'),
    folder(15, 13, 'Volume 002'),
  ],
  noFolderNoteCount: 2,
  totalNoteCount: 6,
};

describe('NoteFolderDialogs (#1408)', () => {
  let store: NoteFolderStore;
  let api: Record<string, ReturnType<typeof vi.fn>>;
  const q = (s: string) => document.body.querySelector<HTMLElement>(s);
  const all = (s: string) => Array.from(document.body.querySelectorAll<HTMLElement>(s));
  const footer = () =>
    all('.mf-dlg__buttons button, [data-panel-footer] button').map((b) => b.textContent!.trim());

  async function setup() {
    api = {
      listNoteFolders: vi.fn(() => of(LIST)),
      createNoteFolder: vi.fn(() => of(folder(9, undefined, 'New'))),
      renameNoteFolder: vi.fn(() => of(folder(6, 4, 'Money'))),
      moveNoteFolder: vi.fn(() => of(folder(5, 13, 'Executive Team'))),
      deleteNoteFolder: vi.fn(() => of(undefined)),
    };
    TestBed.configureTestingModule({
      providers: [
        NoteFolderStore,
        { provide: NoteFoldersClient, useValue: api },
        {
          provide: NotesClient,
          useValue: {
            getNote: () => of({ noteId: 11, rowVersion: 'n1', folderId: 5 }),
            moveNote: vi.fn(() => of({ noteId: 11, rowVersion: 'n2' })),
          },
        },
        { provide: AuthStore, useValue: { has: () => true } },
      ],
    });
    store = TestBed.inject(NoteFolderStore);
    await store.load(1);
    const fixture = TestBed.createComponent(NoteFolderDialogs);
    fixture.detectChanges();
    return fixture;
  }
  async function open(fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }
  const host = () => q('[data-panel-primary]')!;
  const primary = () => (host().tagName === 'BUTTON' ? host() : host().querySelector('button')!);

  afterEach(() => {
    TestBed.resetTestingModule();
    document.body.innerHTML = '';
  });

  it('New Folder says where the folder is created and creates it from the typed name', async () => {
    const f = await setup();
    store.ask({ kind: 'create', parentId: 4 });
    await open(f);
    expect(q('[data-folder-name-form]')).not.toBeNull();
    expect(q('#nf-name-help')!.textContent).toContain('Created in Custodians.');
    const input = q('#nf-name') as HTMLInputElement;
    input.value = 'Bank Records';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await open(f);
    primary().click();
    await open(f);
    expect(api['createNoteFolder']).toHaveBeenCalledWith({
      matterId: 1,
      parentFolderId: 4,
      name: 'Bank Records',
    });
  });

  it('asks for a name before it calls the server', async () => {
    const f = await setup();
    store.ask({ kind: 'create', parentId: null });
    await open(f);
    primary().click();
    await open(f);
    expect(q('#nf-name-error')!.textContent).toContain('Enter a folder name.');
    expect(api['createNoteFolder']).not.toHaveBeenCalled();
  });

  it('shows a name clash under the field, in the words of the design', async () => {
    const f = await setup();
    store.ask({ kind: 'create', parentId: 4 });
    await open(f);
    const input = q('#nf-name') as HTMLInputElement;
    input.value = 'Finance';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await open(f);
    primary().click();
    await open(f);
    expect(q('#nf-name-error')!.textContent).toContain(
      'A folder named "Finance" already exists in Custodians.',
    );
    expect(api['createNoteFolder']).not.toHaveBeenCalled();
  });

  it('Rename starts with the current name and saves it with the row version', async () => {
    const f = await setup();
    store.ask({ kind: 'rename', id: 6 });
    await open(f);
    expect((q('#nf-name') as HTMLInputElement).value).toBe('Finance');
    expect(footer()).toContain('Save Changes');
    const input = q('#nf-name') as HTMLInputElement;
    input.value = 'Money';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await open(f);
    primary().click();
    await open(f);
    expect(api['renameNoteFolder']).toHaveBeenCalledWith(6, { name: 'Money', rowVersion: 'rv-6' });
  });

  it('Move Folder greys itself, its subfolders and where it is, each with a reason', async () => {
    const f = await setup();
    store.ask({ kind: 'move-folder', id: 4 });
    await open(f);
    const row = (id: string) => q(`[data-pick="${id}"]`)!;
    expect(row('top').getAttribute('aria-disabled')).toBe('true');
    expect(row('top').textContent).toContain('Already here');
    expect(row('4').textContent).toContain('This folder');
    expect(row('5').textContent).toContain('Inside it');
    expect(row('13').getAttribute('aria-disabled')).toBeNull();
    expect(row('13').textContent).not.toContain('Inside it');
    expect(host().getAttribute('aria-disabled')).toBe('true');
    row('13').click();
    await open(f);
    expect(row('13').getAttribute('aria-selected')).toBe('true');
    expect(host().getAttribute('aria-disabled')).toBeNull();
    primary().click();
    await open(f);
    expect(api['moveNoteFolder']).toHaveBeenCalledWith(4, {
      parentFolderId: 13,
      rowVersion: 'rv-4',
    });
  });

  it('Move Note offers No Folder and every folder; a locked note is no different', async () => {
    const f = await setup();
    store.ask({ kind: 'move-note', noteId: 11, title: 'Locked note', folderId: 5 });
    await open(f);
    expect(q('[data-folder-move-help]')!.textContent).toContain('keeps its tags');
    expect(q('[data-pick="top"]')!.textContent).toContain('No Folder');
    expect(q('[data-pick="5"]')!.textContent).toContain('Already here');
    expect(q('[data-pick="6"]')!.getAttribute('aria-disabled')).toBeNull();
    expect(document.body.textContent).toContain('Locked note');
  });

  it('deletes an empty folder after a plain confirm', async () => {
    const f = await setup();
    store.ask({ kind: 'delete', id: 15 });
    await open(f);
    expect(q('[data-folder-delete-empty]')!.textContent).toContain(
      "Volume 002 is empty. This can't be undone.",
    );
    expect(q('[data-folder-delete-full]')).toBeNull();
    q('[data-confirm-primary] button, button[data-confirm-primary]')!.click();
    await open(f);
    expect(api['deleteNoteFolder']).toHaveBeenCalledWith(15, 'rv-15', false);
  });

  it('refuses the plain delete of a folder with contents and offers Move Contents Up and Delete', async () => {
    const f = await setup();
    store.ask({ kind: 'delete', id: 4 });
    await open(f);
    const text = q('[data-folder-delete-full]')!.textContent!;
    expect(text).toContain('Custodians holds 1 note and 2 subfolders');
    expect(document.body.textContent).toContain('the top level (No Folder)');
    expect(document.body.textContent).toContain('No note is deleted.');
    const primary = q('[data-confirm-primary] button, button[data-confirm-primary]')!;
    expect(primary.textContent).toContain('Move Contents Up and Delete');
    primary.click();
    await open(f);
    expect(api['deleteNoteFolder']).toHaveBeenCalledWith(4, 'rv-4', true);
  });

  it('names the parent when contents move up into a folder', async () => {
    const f = await setup();
    store.ask({ kind: 'delete', id: 5 });
    await open(f);
    expect(document.body.textContent).toContain('Move Contents Up puts them into Custodians');
  });
});
