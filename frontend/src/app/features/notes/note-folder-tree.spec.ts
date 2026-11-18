import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import {
  NoteFolderListResponse,
  NoteFolderResponse,
  NoteFoldersClient,
  NotesClient,
} from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { NoteFolderStore } from './note-folder-store';
import { NoteFolderTree } from './note-folder-tree';
import type { FolderScope } from './note-folders';

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
    folder(13, undefined, 'Productions', 0, 0),
  ],
  noFolderNoteCount: 2,
  totalNoteCount: 6,
};

@Component({
  imports: [NoteFolderTree],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-note-folder-tree [narrow]="narrow()" (selected)="picked.push($event)" />`,
})
class Host {
  readonly narrow = signal(false);
  readonly picked: FolderScope[] = [];
}

describe('NoteFolderTree (#1408)', () => {
  let fixture: ComponentFixture<Host>;
  let store: NoteFolderStore;
  let moveNoteFolder: ReturnType<typeof vi.fn>;
  let moveNote: ReturnType<typeof vi.fn>;

  async function setup(
    perms: string[] = ['MatterNote.Edit', 'MatterNote.Delete'],
    list: NoteFolderListResponse = LIST,
  ) {
    moveNoteFolder = vi.fn(() => of(folder(5, undefined, 'x')));
    moveNote = vi.fn(() => of({ noteId: 11, rowVersion: 'n2', folderId: 6 }));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        NoteFolderStore,
        {
          provide: NoteFoldersClient,
          useValue: { listNoteFolders: () => of(list), moveNoteFolder },
        },
        {
          provide: NotesClient,
          useValue: { getNote: () => of({ noteId: 11, rowVersion: 'n1', folderId: 5 }), moveNote },
        },
        { provide: AuthStore, useValue: { has: (p: string) => perms.includes(p) } },
      ],
    });
    store = TestBed.inject(NoteFolderStore);
    await store.load(1);
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const rows = () => Array.from(el().querySelectorAll<HTMLElement>('[role="treeitem"]'));
  const names = () => rows().map((r) => r.querySelector('.ft__name')!.textContent!.trim());
  const row = (key: string) => el().querySelector<HTMLElement>(`[data-key="${key}"]`)!;
  const key = (target: HTMLElement, k: string) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  const flush = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(() => localStorage.clear());

  it('shows All Notes, No Folder and the top-level folders with direct counts', async () => {
    await setup();
    expect(names()).toEqual(['All Notes', 'No Folder', 'Custodians', 'Productions']);
    expect(row('all').querySelector('.ft__count')!.textContent!.trim()).toBe('6');
    expect(row('none').querySelector('.ft__count')!.textContent!.trim()).toBe('2');
    expect(row('4').querySelector('.ft__count')!.textContent!.trim()).toBe('1');
    expect(el().querySelector('[role="tree"]')!.getAttribute('aria-labelledby')).toBe('ft-title');
    expect(row('4').getAttribute('aria-expanded')).toBe('false');
    expect(row('13').getAttribute('aria-expanded')).toBeNull();
    expect(row('4').getAttribute('aria-level')).toBe('1');
  });

  it('shows no folders yet, with New Folder, and hides No Folder, when there are none', async () => {
    await setup(undefined, { folders: [], noFolderNoteCount: 0, totalNoteCount: 4 });
    expect(names()).toEqual(['All Notes']);
    const none = el().querySelector('[data-folder-none]')!;
    expect(none.textContent).toContain('No folders yet.');
    expect(none.textContent).toContain('New Folder');
  });

  it('hides New Folder for a person who cannot edit, and disables the menu items that change things', async () => {
    await setup(['MatterNote.View']);
    expect(el().querySelector('[data-folder-new]')).toBeNull();
    expect(el().querySelector('[data-folder-none] button')).toBeNull();
    expect(row('4').getAttribute('draggable')).toBeNull();
    // open the row menu of Custodians
    row('4').querySelector<HTMLButtonElement>('[data-overflow]')!.click();
    await flush();
    const item = (id: string) => el().querySelector<HTMLElement>(`[data-action="${id}"]`)!;
    expect(item('rename').getAttribute('aria-disabled')).toBe('true');
    expect(item('move').getAttribute('aria-disabled')).toBe('true');
    expect(item('delete').getAttribute('aria-disabled')).toBe('true');
    expect(item('sub').getAttribute('aria-disabled')).toBe('true');
    expect(item('rename').getAttribute('title')).toBe(
      "You don't have permission to change folders.",
    );
    expect(item('link').getAttribute('aria-disabled')).toBeNull();
  });

  it('lets a person with Edit but not Delete do everything except Delete Folder', async () => {
    await setup(['MatterNote.View', 'MatterNote.Edit']);
    row('4').querySelector<HTMLButtonElement>('[data-overflow]')!.click();
    await flush();
    const item = (id: string) => el().querySelector<HTMLElement>(`[data-action="${id}"]`)!;
    expect(item('rename').getAttribute('aria-disabled')).toBeNull();
    expect(item('delete').getAttribute('aria-disabled')).toBe('true');
    expect(item('delete').getAttribute('title')).toBe(
      'Delete needs the Matter Note Delete permission.',
    );
    expect(el().querySelector('[data-folder-new]')).not.toBeNull();
  });

  it('asks for the dialogs from the row menu', async () => {
    await setup();
    row('4').querySelector<HTMLButtonElement>('[data-overflow]')!.click();
    await flush();
    el().querySelector<HTMLElement>('[data-action="rename"]')!.click();
    expect(store.dialog()).toEqual({ kind: 'rename', id: 4 });
  });

  it('emits the chosen row and marks the selected one', async () => {
    await setup();
    row('4').click();
    expect(fixture.componentInstance.picked).toEqual([4]);
    store.select(4);
    await flush();
    expect(row('4').getAttribute('aria-selected')).toBe('true');
    expect(row('all').getAttribute('aria-selected')).toBe('false');
    row('none').click();
    expect(fixture.componentInstance.picked).toEqual([4, 'none']);
  });

  it('opens and closes a folder with the chevron without selecting it', async () => {
    await setup();
    row('4').querySelector<HTMLElement>('.ft__chev')!.click();
    await flush();
    expect(names()).toEqual([
      'All Notes',
      'No Folder',
      'Custodians',
      'Executive Team',
      'Finance',
      'Productions',
    ]);
    expect(fixture.componentInstance.picked).toEqual([]);
    expect(row('5').getAttribute('aria-level')).toBe('2');
  });

  describe('keys of the tree (ARIA)', () => {
    it('moves with Up, Down, Home and End and has one Tab stop', async () => {
      await setup();
      expect(rows().filter((r) => r.tabIndex === 0)).toHaveLength(1);
      row('all').focus();
      key(row('all'), 'ArrowDown');
      await new Promise((r) => setTimeout(r));
      expect(document.activeElement).toBe(row('none'));
      key(row('none'), 'End');
      await new Promise((r) => setTimeout(r));
      expect(document.activeElement).toBe(row('13'));
      key(row('13'), 'Home');
      await new Promise((r) => setTimeout(r));
      expect(document.activeElement).toBe(row('all'));
    });

    it('opens with Right, goes to the first child with Right, back to the parent with Left, closes with Left', async () => {
      await setup();
      row('4').focus();
      key(row('4'), 'ArrowRight');
      await flush();
      expect(row('4').getAttribute('aria-expanded')).toBe('true');
      key(row('4'), 'ArrowRight');
      await new Promise((r) => setTimeout(r));
      expect(document.activeElement).toBe(row('5'));
      key(row('5'), 'ArrowLeft');
      await new Promise((r) => setTimeout(r));
      expect(document.activeElement).toBe(row('4'));
      key(row('4'), 'ArrowLeft');
      await flush();
      expect(row('4').getAttribute('aria-expanded')).toBe('false');
    });

    it('selects with Enter and does not react to keys typed in the row menu', async () => {
      await setup();
      key(row('13'), 'Enter');
      expect(fixture.componentInstance.picked).toEqual([13]);
      const before = fixture.componentInstance.picked.length;
      const btn = row('4').querySelector<HTMLButtonElement>('[data-overflow]')!;
      btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(fixture.componentInstance.picked).toHaveLength(before);
    });
  });

  it('folds to the rail, remembers it, and shows the current folder', async () => {
    await setup();
    el().querySelector<HTMLButtonElement>('[data-folder-hide]')!.click();
    await flush();
    expect(localStorage.getItem('mf.notes.tree')).toBe('folded');
    expect(el().querySelector('[data-folder-rail]')).not.toBeNull();
    expect(el().querySelector('[role="tree"]')).toBeNull();
    store.select(6);
    await flush();
    expect(el().querySelector('[data-folder-rail-current]')!.getAttribute('aria-label')).toBe(
      'Folder: Custodians > Finance',
    );
    el().querySelector<HTMLButtonElement>('[data-folder-show]')!.click();
    await flush();
    expect(localStorage.getItem('mf.notes.tree')).toBeNull();
    expect(el().querySelector('[role="tree"]')).not.toBeNull();
  });

  it('shows the rail when the card is narrow without changing the choice', async () => {
    await setup();
    fixture.componentInstance.narrow.set(true);
    await flush();
    expect(el().querySelector('[data-folder-rail]')).not.toBeNull();
    expect(store.treeOpen()).toBe(true);
  });

  describe('drag and drop', () => {
    const dt = () =>
      ({ dropEffect: '', effectAllowed: '', setData: vi.fn() }) as unknown as DataTransfer;
    const fire = (target: HTMLElement, type: string) => {
      const e = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
      Object.defineProperty(e, 'dataTransfer', { value: dt() });
      Object.defineProperty(e, 'clientX', { value: 10 });
      Object.defineProperty(e, 'clientY', { value: 10 });
      target.dispatchEvent(e);
      return e;
    };

    it('dims the folders that cannot take the note and drops a note onto a folder', async () => {
      await setup();
      store.select(5);
      store.drag.set({ kind: 'note', id: 11, title: 'A note', folderId: 5 });
      await flush();
      expect(row('5').classList.contains('is-dim')).toBe(true);
      expect(row('5').getAttribute('title')).toBe('The note is already in this folder.');
      expect(row('6').classList.contains('is-dim')).toBe(false);
      const over = fire(row('6'), 'dragover');
      expect(over.defaultPrevented).toBe(true);
      await flush();
      expect(row('6').classList.contains('is-drop')).toBe(true);
      expect(el().querySelector('.ft__drag')!.textContent).toContain(
        'Move to Custodians > Finance',
      );
      fire(row('6'), 'drop');
      await flush();
      await new Promise((r) => setTimeout(r));
      expect(moveNote).toHaveBeenCalledWith(11, { folderId: 6, rowVersion: 'n1' });
      expect(store.drag()).toBeNull();
    });

    it('does not accept a drop on a greyed folder or on All Notes', async () => {
      await setup();
      store.select(5);
      store.drag.set({ kind: 'note', id: 11, title: 'A note', folderId: 5 });
      await flush();
      expect(fire(row('5'), 'dragover').defaultPrevented).toBe(false);
      expect(fire(row('all'), 'dragover').defaultPrevented).toBe(false);
      fire(row('5'), 'drop');
      expect(moveNote).not.toHaveBeenCalled();
    });

    it('drops a note on No Folder', async () => {
      await setup();
      store.drag.set({ kind: 'note', id: 11, title: 'A note', folderId: 5 });
      fire(row('none'), 'drop');
      await new Promise((r) => setTimeout(r));
      expect(moveNote).toHaveBeenCalledWith(11, { folderId: undefined, rowVersion: 'n1' });
    });

    it('drags a folder onto another folder or No Folder, never into itself', async () => {
      await setup();
      store.setOpen(4, true);
      await flush();
      fire(row('5'), 'dragstart');
      expect(store.drag()).toMatchObject({ kind: 'folder', id: 5 });
      await flush();
      expect(fire(row('5'), 'dragover').defaultPrevented).toBe(false);
      // Custodians is where it already is
      expect(fire(row('4'), 'dragover').defaultPrevented).toBe(false);
      fire(row('none'), 'drop');
      await new Promise((r) => setTimeout(r));
      expect(moveNoteFolder).toHaveBeenCalledWith(5, {
        parentFolderId: undefined,
        rowVersion: 'rv-5',
      });
    });

    it('opens a collapsed folder after the pointer rests on it', async () => {
      vi.useFakeTimers();
      try {
        await setup();
        store.drag.set({ kind: 'note', id: 11, title: 'A note', folderId: null });
        fire(row('4'), 'dragover');
        expect(store.open().has(4)).toBe(false);
        vi.advanceTimersByTime(650);
        expect(store.open().has(4)).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
