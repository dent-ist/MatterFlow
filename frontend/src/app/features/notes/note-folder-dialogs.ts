import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog';
import { FormDialog } from '../../shared/ui/form-dialog';
import { TextField } from '../../shared/ui/text-field';
import { NoteFolderStore } from './note-folder-store';
import { NoteFolderPicker } from './note-folder-picker';
import { Moving, countText, nameError, pathText } from './note-folders';

/**
 * The dialogs of the folder tree (D-46c): New Folder, Rename Folder, Move Folder, Move Note and Delete Folder. They are the shared `mf-form-dialog` and
 * `mf-confirm-dialog`; the request comes from `NoteFolderStore.dialog`, so the tree's row menu and the note's Actions menu both open them. An empty folder deletes after
 * a plain confirm; a folder with contents is refused as it is and offers "Move Contents Up and Delete" (notes are never deleted).
 */
@Component({
  selector: 'mf-note-folder-dialogs',
  imports: [ConfirmDialog, FormDialog, NoteFolderPicker, TextField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-form-dialog
      [title]="req()?.kind === 'rename' ? 'Rename Folder' : 'New Folder'"
      [subtitle]="nameSubtitle()"
      [primaryLabel]="req()?.kind === 'rename' ? 'Save Changes' : 'Create Folder'"
      [busy]="store.busy()"
      [error]="store.dialogError()"
      [canSubmit]="true"
      [visible]="isName()"
      (visibleChange)="!$event && store.closeDialog()"
      (submitted)="submitName()"
    >
      @if (isName()) {
        <form data-folder-name-form novalidate (submit)="onEnter($event)">
          <mf-text-field
            inputId="nf-name"
            label="Folder Name"
            [required]="true"
            [maxLength]="100"
            [help]="nameHelp()"
            [error]="shownNameError()"
            [(value)]="name"
          />
        </form>
      }
    </mf-form-dialog>

    <mf-form-dialog
      [title]="req()?.kind === 'move-folder' ? 'Move Folder' : 'Move Note'"
      [subtitle]="moveSubtitle()"
      [primaryLabel]="req()?.kind === 'move-folder' ? 'Move Folder' : 'Move Note'"
      [busy]="store.busy()"
      busyLabel="Moving..."
      [error]="store.dialogError()"
      [canSubmit]="canMove()"
      [visible]="isMove()"
      (visibleChange)="!$event && store.closeDialog()"
      (submitted)="submitMove()"
    >
      @if (isMove() && moving(); as mv) {
        <div data-folder-move-form>
          <span class="mf-field__label" id="nf-move-l">Move To</span>
          <mf-note-folder-picker
            labelId="nf-move-l"
            [tree]="store.tree()"
            [moving]="mv"
            [topLabel]="mv.kind === 'folder' ? 'Top level (no parent)' : 'No Folder'"
            [(value)]="target"
          />
          <p class="mf-field__help" data-folder-move-help>
            {{
              mv.kind === 'folder'
                ? 'Folders can be nested up to 5 levels. Greyed folders cannot take this one.'
                : 'The note keeps its tags, its pin and its history.'
            }}
          </p>
        </div>
      }
    </mf-form-dialog>

    <mf-confirm-dialog
      title="Delete Folder"
      confirmLabel="Delete Folder"
      [danger]="true"
      [busy]="store.busy()"
      [error]="store.dialogError()"
      [visible]="isDelete() && deleteEmpty()"
      (visibleChange)="!$event && store.closeDialog()"
      (confirmed)="remove(false)"
    >
      <p data-folder-delete-empty>
        <b>{{ deleteName() }}</b> is empty. This can't be undone.
      </p>
    </mf-confirm-dialog>

    <mf-confirm-dialog
      title="Delete Folder"
      confirmLabel="Move Contents Up and Delete"
      size="default"
      [busy]="store.busy()"
      [error]="store.dialogError()"
      [visible]="isDelete() && !deleteEmpty()"
      (visibleChange)="!$event && store.closeDialog()"
      (confirmed)="remove(true)"
    >
      <p data-folder-delete-full>
        <b>{{ deleteName() }}</b> holds {{ contentsText() }}. A folder with contents can't be
        deleted as it is.
      </p>
      <p>
        Move Contents Up puts them into {{ deleteTarget() }}, then deletes the empty folder. No note
        is deleted.
      </p>
    </mf-confirm-dialog>
  `,
})
export class NoteFolderDialogs {
  protected readonly store = inject(NoteFolderStore);

  protected readonly req = computed(() => this.store.dialog());
  protected readonly isName = computed(() => {
    const k = this.req()?.kind;
    return k === 'create' || k === 'rename';
  });
  protected readonly isMove = computed(() => {
    const k = this.req()?.kind;
    return k === 'move-folder' || k === 'move-note';
  });
  protected readonly isDelete = computed(() => this.req()?.kind === 'delete');

  protected readonly name = signal('');
  /** Shown only after a first try, so an empty new dialog does not start with an error. */
  private readonly tried = signal(false);
  protected readonly target = signal<number | null>(null);

  constructor() {
    // A new request resets the fields: the name starts empty (New Folder) or with the current name (Rename); Move starts at where the item is now.
    effect(() => {
      const r = this.req();
      untracked(() => {
        this.tried.set(false);
        if (!r) return;
        if (r.kind === 'rename') this.name.set(this.store.tree().byId.get(r.id)?.name ?? '');
        else if (r.kind === 'create') this.name.set('');
        else if (r.kind === 'move-folder')
          this.target.set(this.store.tree().byId.get(r.id)?.parentId ?? null);
        else if (r.kind === 'move-note') this.target.set(r.folderId);
      });
    });
  }

  protected readonly nameSubtitle = computed(() => {
    const r = this.req();
    return r?.kind === 'rename' ? (this.store.tree().byId.get(r.id)?.name ?? '') : '';
  });

  protected readonly nameHelp = computed(() => {
    const r = this.req();
    if (r?.kind === 'rename') return 'Names are unique inside the same parent folder.';
    if (r?.kind === 'create')
      return r.parentId === null
        ? 'Created at the top level. Use New Subfolder on a folder to create it there.'
        : `Created in ${pathText(this.store.tree().byId, r.parentId)}. Use New Subfolder on another folder to create it there.`;
    return '';
  });

  protected readonly shownNameError = computed(
    () => this.store.nameError() || (this.tried() ? nameError(this.name()) : '') || null,
  );

  protected onEnter(e: Event): void {
    e.preventDefault();
    this.submitName();
  }

  protected submitName(): void {
    const r = this.req();
    if (!r || this.store.busy()) return;
    this.tried.set(true);
    this.store.nameError.set('');
    if (nameError(this.name())) return;
    if (r.kind === 'create') void this.store.create(this.name(), r.parentId);
    else if (r.kind === 'rename') void this.store.rename(r.id, this.name());
  }

  // ---- move
  protected readonly moving = computed<Moving | null>(() => {
    const r = this.req();
    if (r?.kind === 'move-folder') return { kind: 'folder', id: r.id };
    if (r?.kind === 'move-note') return { kind: 'note', folderId: r.folderId };
    return null;
  });

  protected readonly moveSubtitle = computed(() => {
    const r = this.req();
    if (r?.kind === 'move-note') return r.title;
    if (r?.kind === 'move-folder') {
      const n = this.store.tree().byId.get(r.id);
      return n
        ? `${n.name}: ${countText(n.subfolderCount, 'subfolder')}, ${countText(n.noteCount, 'note')}`
        : '';
    }
    return '';
  });

  /** The primary button works once a target other than where the item is now is chosen. */
  protected readonly canMove = computed(() => {
    const r = this.req();
    if (r?.kind === 'move-folder')
      return this.target() !== (this.store.tree().byId.get(r.id)?.parentId ?? null);
    if (r?.kind === 'move-note') return this.target() !== r.folderId;
    return false;
  });

  protected submitMove(): void {
    const r = this.req();
    if (!r || this.store.busy() || !this.canMove()) return;
    if (r.kind === 'move-folder') void this.store.moveFolder(r.id, this.target());
    else if (r.kind === 'move-note') void this.store.moveNote(r.noteId, this.target(), r.title);
  }

  // ---- delete
  private readonly deleting = computed(() => {
    const r = this.req();
    return r?.kind === 'delete' ? (this.store.tree().byId.get(r.id) ?? null) : null;
  });
  protected readonly deleteName = computed(() => this.deleting()?.name ?? '');
  protected readonly deleteEmpty = computed(() => {
    const n = this.deleting();
    return !n || (n.noteCount === 0 && n.subfolderCount === 0);
  });
  protected readonly contentsText = computed(() => {
    const n = this.deleting();
    if (!n) return '';
    const parts = [
      n.noteCount > 0 ? countText(n.noteCount, 'note') : '',
      n.subfolderCount > 0 ? countText(n.subfolderCount, 'subfolder') : '',
    ].filter(Boolean);
    return parts.join(' and ');
  });
  protected readonly deleteTarget = computed(() => {
    const n = this.deleting();
    return n && n.parentId !== null
      ? pathText(this.store.tree().byId, n.parentId)
      : 'the top level (No Folder)';
  });

  protected remove(moveUp: boolean): void {
    const r = this.req();
    if (r?.kind === 'delete' && !this.store.busy()) void this.store.remove(r.id, moveUp);
  }
}
