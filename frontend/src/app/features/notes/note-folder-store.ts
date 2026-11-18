import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { NoteFolderResponse, NoteFoldersClient, NotesClient } from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { ApiError } from '../../core/http/api-error';
import { NotificationService } from '../../core/notify/notification.service';
import { UndoService } from '../../core/notify/undo.service';
import {
  DragItem,
  FolderScope,
  buildTree,
  clashMessage,
  countText,
  folderErrorText,
  pathOf,
  pathText,
  readTreeOpen,
  writeTreeOpen,
} from './note-folders';

/** A dialog the folder tree or the note's Actions menu asks for; `NoteFolderDialogs` draws it. */
export type FolderDialogRequest =
  | { kind: 'create'; parentId: number | null }
  | { kind: 'rename'; id: number }
  | { kind: 'move-folder'; id: number }
  | { kind: 'move-note'; noteId: number; title: string; folderId: number | null }
  | { kind: 'delete'; id: number };

/**
 * The folders of one matter's notes (epic #1405, issue #1408): the flat list the API sends, the tree built from it, the selected scope, which nodes are open, the
 * open or folded tree, the dialog being asked for and every change (create, rename, move, delete, move a note) with its toast. The Notes tab provides one store for
 * its lifetime so the tree, the dialogs and the list share it. Permissions follow `MatterNote.Edit` and `MatterNote.Delete`; the server repeats them.
 */
@Injectable()
export class NoteFolderStore {
  private readonly api = inject(NoteFoldersClient);
  private readonly notesApi = inject(NotesClient);
  private readonly auth = inject(AuthStore);
  private readonly notify = inject(NotificationService);
  private readonly undo = inject(UndoService);

  readonly matterId = signal(0);
  readonly folders = signal<NoteFolderResponse[]>([]);
  readonly noFolderCount = signal(0);
  readonly totalCount = signal(0);
  readonly loaded = signal(false);
  readonly loadError = signal('');
  readonly tree = computed(() => buildTree(this.folders()));

  /** What the list shows (the address `?folder=` and the tree row say the same). */
  readonly scope = signal<FolderScope>('all');
  /** Folders whose children are shown (in memory only; the path to the selected folder is opened when it is selected). */
  readonly open = signal<ReadonlySet<number>>(new Set());
  /** The tree is open (default) or folded to its rail; remembered per person in browser storage. */
  readonly treeOpen = signal(readTreeOpen());
  /** The dialog being asked for, and the answer of the last attempt. */
  readonly dialog = signal<FolderDialogRequest | null>(null);
  readonly busy = signal(false);
  readonly dialogError = signal('');
  readonly nameError = signal('');
  /** The note or folder being dragged (the tree draws the drop targets from it). */
  readonly drag = signal<DragItem | null>(null);
  /** Counts the changes that move notes between folders, so the list reads again. */
  readonly revision = signal(0);

  readonly canEdit = computed(() => this.auth.has('MatterNote.Edit'));
  readonly canDelete = computed(() => this.auth.has('MatterNote.Delete'));
  /** The selected folder's id, or null for All Notes and No Folder. */
  readonly selectedId = computed(() => {
    const s = this.scope();
    return typeof s === 'number' ? s : null;
  });
  /** "Custodians > Executive Team", "All Notes" or "No Folder". */
  readonly scopeName = computed(() => {
    const s = this.scope();
    return s === 'all' ? 'All Notes' : s === 'none' ? 'No Folder' : pathText(this.tree().byId, s);
  });

  async load(matterId = this.matterId()): Promise<void> {
    this.matterId.set(matterId);
    try {
      const r = await firstValueFrom(this.api.listNoteFolders(matterId));
      if (this.matterId() !== matterId) return;
      this.folders.set(r.folders);
      this.noFolderCount.set(r.noFolderNoteCount);
      this.totalCount.set(r.totalNoteCount);
      this.loadError.set('');
      // A selected folder that is gone (deleted by someone else, a wrong address) falls back to All Notes.
      const s = this.scope();
      if (typeof s === 'number' && !r.folders.some((f) => f.noteFolderId === s)) {
        this.scope.set('all');
      } else if (typeof s === 'number') {
        // The path to the selected folder is open (a link or a reload lands on it).
        const ids = pathOf(this.tree().byId, s)
          .slice(0, -1)
          .map((f) => f.id);
        if (ids.some((id) => !this.open().has(id)))
          this.open.update((o) => new Set([...o, ...ids]));
      }
    } catch {
      this.loadError.set("Couldn't load the folders.");
    } finally {
      this.loaded.set(true);
    }
  }

  /** Selects a scope and opens the path down to it. */
  select(scope: FolderScope): void {
    this.scope.set(scope);
    if (typeof scope === 'number') {
      const ids = pathOf(this.tree().byId, scope)
        .slice(0, -1)
        .map((f) => f.id);
      if (ids.length) this.open.update((o) => new Set([...o, ...ids]));
    }
  }

  toggleOpen(id: number): void {
    this.open.update((o) => {
      const next = new Set(o);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  setOpen(id: number, value: boolean): void {
    if (this.open().has(id) !== value) this.toggleOpen(id);
  }

  setTreeOpen(value: boolean): void {
    this.treeOpen.set(value);
    writeTreeOpen(value);
  }

  ask(request: FolderDialogRequest): void {
    this.dialogError.set('');
    this.nameError.set('');
    this.dialog.set(request);
  }

  closeDialog(): void {
    this.dialog.set(null);
    this.dialogError.set('');
    this.nameError.set('');
  }

  // ------------------------------------------------------------ changes

  async create(name: string, parentId: number | null): Promise<boolean> {
    const clash = this.sibling(parentId, name);
    if (clash) {
      this.nameError.set(clashMessage(name, parentId === null ? null : this.nameOf(parentId)));
      return false;
    }
    return this.run(async () => {
      const f = await firstValueFrom(
        this.api.createNoteFolder({
          matterId: this.matterId(),
          parentFolderId: parentId ?? undefined,
          name: name.trim(),
        }),
      );
      if (parentId !== null) this.open.update((o) => new Set([...o, parentId]));
      await this.load();
      this.notify.success('Folder created', f.name);
    }, name);
  }

  async rename(id: number, name: string): Promise<boolean> {
    const node = this.tree().byId.get(id);
    if (!node) return false;
    if (this.sibling(node.parentId, name, id)) {
      this.nameError.set(
        clashMessage(name, node.parentId === null ? null : this.nameOf(node.parentId)),
      );
      return false;
    }
    return this.run(async () => {
      await firstValueFrom(
        this.api.renameNoteFolder(id, { name: name.trim(), rowVersion: node.rowVersion }),
      );
      await this.load();
      this.revision.update((n) => n + 1);
      this.notify.success('Folder renamed', name.trim());
    }, name);
  }

  async moveFolder(id: number, parentId: number | null): Promise<boolean> {
    const node = this.tree().byId.get(id);
    if (!node) return false;
    const before = node.parentId;
    return this.run(async () => {
      const moved = await firstValueFrom(
        this.api.moveNoteFolder(id, {
          parentFolderId: parentId ?? undefined,
          rowVersion: node.rowVersion,
        }),
      );
      if (parentId !== null) this.open.update((o) => new Set([...o, parentId]));
      await this.load();
      this.revision.update((n) => n + 1);
      this.undo.offer(
        'Folder moved',
        async () => {
          try {
            await firstValueFrom(
              this.api.moveNoteFolder(id, {
                parentFolderId: before ?? undefined,
                rowVersion: moved.rowVersion,
              }),
            );
            await this.load();
            this.revision.update((n) => n + 1);
          } catch (e) {
            this.fail(e, "Couldn't undo the move.");
          }
        },
        {
          detail: `${node.name} is now in ${parentId === null ? 'the top level' : pathText(this.tree().byId, parentId)}.`,
        },
      );
    });
  }

  /** Moves a note (menu or drag); the toast offers Undo. A locked note can be moved. */
  async moveNote(noteId: number, folderId: number | null, title: string): Promise<boolean> {
    return this.run(async () => {
      const note = await firstValueFrom(this.notesApi.getNote(noteId));
      const before = note.folderId ?? null;
      const moved = await firstValueFrom(
        this.notesApi.moveNote(noteId, {
          folderId: folderId ?? undefined,
          rowVersion: note.rowVersion,
        }),
      );
      await this.load();
      this.revision.update((n) => n + 1);
      this.undo.offer(
        'Note moved',
        async () => {
          try {
            await firstValueFrom(
              this.notesApi.moveNote(noteId, {
                folderId: before ?? undefined,
                rowVersion: moved.rowVersion,
              }),
            );
            await this.load();
            this.revision.update((n) => n + 1);
          } catch (e) {
            this.fail(e, "Couldn't undo the move.");
          }
        },
        { detail: `${title} is now in ${pathText(this.tree().byId, folderId)}.` },
      );
    });
  }

  /** Deletes a folder: an empty one as it is; one with contents only with `moveContentsUp` (notes are never deleted). */
  async remove(id: number, moveContentsUp: boolean): Promise<boolean> {
    const node = this.tree().byId.get(id);
    if (!node) return false;
    const parent = node.parentId;
    const inside = (() => {
      const s = this.scope();
      return typeof s === 'number' && pathOf(this.tree().byId, s).some((f) => f.id === id);
    })();
    return this.run(async () => {
      await firstValueFrom(this.api.deleteNoteFolder(id, node.rowVersion, moveContentsUp));
      if (inside) this.scope.set(parent ?? 'all');
      await this.load();
      this.revision.update((n) => n + 1);
      this.notify.success(
        'Folder deleted',
        moveContentsUp && node.noteCount + node.subfolderCount > 0
          ? `${node.name}: ${countText(node.noteCount, 'note')} and ${countText(node.subfolderCount, 'subfolder')} moved up.`
          : node.name,
      );
    });
  }

  private sibling(parentId: number | null, name: string, except?: number): boolean {
    const t = this.tree();
    const list = parentId === null ? t.roots : (t.byId.get(parentId)?.children ?? []);
    const n = name.trim().toLowerCase();
    return list.some((f) => f.id !== except && f.name.trim().toLowerCase() === n);
  }

  private nameOf(id: number): string {
    return this.tree().byId.get(id)?.name ?? '';
  }

  /** Runs a change: busy while it runs, the dialog closes on success, a failure is said in the dialog (or as a toast when no dialog is open). */
  private async run(action: () => Promise<void>, name?: string): Promise<boolean> {
    this.busy.set(true);
    try {
      await action();
      this.closeDialog();
      return true;
    } catch (e) {
      const code = e instanceof ApiError ? e.code : undefined;
      if (code === 'FOLDER_NAME_TAKEN' && name !== undefined) {
        this.nameError.set(`A folder named "${name.trim()}" already exists here.`);
      } else if (code === 'FOLDER_NOT_EMPTY') {
        // The folder got something since the tree was drawn: read it again and ask the question with the real numbers.
        await this.load();
        const d = this.dialog();
        if (d?.kind === 'delete') this.ask({ kind: 'delete', id: d.id });
      } else if (code === 'CONCURRENCY_CONFLICT') {
        this.closeDialog();
        await this.load();
        this.notify.error('This folder was changed by someone else.', undefined, {
          action: { label: 'Reload Latest', run: () => void this.load() },
        });
      } else if (this.dialog()) {
        this.dialogError.set(this.message(e, "Couldn't change the folder."));
      } else {
        this.fail(e, "Couldn't move it.");
      }
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  private message(e: unknown, fallback: string): string {
    if (e instanceof ApiError) {
      const words = folderErrorText(e.code, e.problem?.meta);
      if (words) return words.detail ? `${words.title} ${words.detail}` : words.title;
      return e.message || fallback;
    }
    return fallback;
  }

  private fail(e: unknown, title: string): void {
    const words = e instanceof ApiError ? folderErrorText(e.code, e.problem?.meta) : undefined;
    this.notify.error(
      words ? words.title : title,
      words?.detail ?? (e instanceof ApiError ? e.message : undefined),
    );
    void this.load();
  }
}
