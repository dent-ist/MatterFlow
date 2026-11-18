import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { NotificationService } from '../../core/notify/notification.service';
import { ActionMenu, MenuAction } from '../../shared/ui/action-menu';
import { Tip } from '../../shared/ui/tip';
import { NoteFolderStore } from './note-folder-store';
import {
  FolderNode,
  FolderScope,
  canCreateIn,
  countText,
  dragMoving,
  moveTarget,
  pathText,
  visibleFolders,
} from './note-folders';

interface TreeRow {
  key: string;
  scope: FolderScope;
  /** The folder id a drop on this row targets (null = the top level, which is the No Folder row); undefined = the row takes no drop (All Notes). */
  dropTarget: number | null | undefined;
  name: string;
  icon: string;
  count: number | null;
  level: number;
  /** null: no children (no chevron); else open or closed. */
  expanded: boolean | null;
  node: FolderNode | null;
  first: boolean;
  menu: readonly MenuAction[];
}

const NO_EDIT = "You don't have permission to change folders.";
const OPEN_ON_HOVER_MS = 600;

/**
 * The folder tree of the Notes tab (D-46c; epic #1405, issue #1408): All Notes, No Folder and the folders of the matter, with their direct counts. A folder shows only
 * its direct notes. A row's "..." menu has New Subfolder, Rename, Move to Folder..., Copy Link and Delete Folder (disabled with the reason when the person may not).
 * The tree folds to an icon strip (remembered per person, `mf.notes.tree`). A note row or a folder row can be dragged onto a row; "Move to Folder..." does the same
 * and is the way without a pointer. Keys are the ARIA tree keys of the control itself (Up, Down, Left, Right, Home, End, Enter); no app shortcut (#420).
 */
@Component({
  selector: 'mf-note-folder-tree',
  imports: [ActionMenu, Tip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './note-folder-tree.scss',
  host: {
    class: 'ft-host',
    '[class.ft-host--rail]': 'rail()',
    '[attr.data-folder-tree]': 'rail() ? "rail" : "open"',
  },
  template: `
    @if (rail()) {
      <div class="ft__rail" role="group" aria-label="Folders, folded" data-folder-rail>
        <button
          type="button"
          class="mf-btn mf-btn--icon"
          data-folder-show
          aria-label="Show Folders"
          [mfTip]="'Show Folders'"
          (click)="show()"
        >
          <i class="pi pi-angle-double-right" aria-hidden="true"></i>
        </button>
        <button
          type="button"
          class="mf-btn mf-btn--icon mf-btn--toggle"
          data-folder-rail-all
          aria-label="All Notes"
          [attr.aria-pressed]="store.scope() === 'all'"
          [mfTip]="'All Notes'"
          (click)="selected.emit('all')"
        >
          <i class="pi pi-list" aria-hidden="true"></i>
        </button>
        @if (store.scope() !== 'all') {
          <button
            type="button"
            class="mf-btn mf-btn--icon mf-btn--toggle"
            data-folder-rail-current
            [attr.aria-label]="'Folder: ' + store.scopeName()"
            aria-pressed="true"
            [mfTip]="store.scopeName()"
            (click)="show()"
          >
            <i
              class="pi"
              [class]="store.scope() === 'none' ? 'pi-file' : 'pi-folder-open'"
              aria-hidden="true"
            ></i>
          </button>
        }
      </div>
    } @else {
      <div class="ft__head">
        <h2 id="ft-title">Folders</h2>
        @if (store.canEdit()) {
          <button
            type="button"
            class="mf-btn mf-btn--icon"
            data-folder-new
            aria-label="New Folder"
            [attr.aria-disabled]="createState().ok ? null : 'true'"
            [mfTip]="createState().ok ? 'New Folder' : createState().tip"
            (click)="newFolder()"
          >
            <i class="pi pi-folder-plus" aria-hidden="true"></i>
          </button>
        }
        <button
          type="button"
          class="mf-btn mf-btn--icon"
          data-folder-hide
          aria-label="Hide Folders"
          [mfTip]="'Hide Folders'"
          (click)="hide()"
        >
          <i class="pi pi-angle-double-left" aria-hidden="true"></i>
        </button>
      </div>
      <div class="ft__body">
        <!-- eslint-disable-next-line @angular-eslint/template/interactive-supports-focus -->
        <div
          class="ft"
          role="tree"
          aria-labelledby="ft-title"
          data-folder-list
          (keydown)="onKey($event)"
        >
          @for (r of rows(); track r.key) {
            <!-- eslint-disable-next-line @angular-eslint/template/click-events-have-key-events -->
            <div
              class="ft__row"
              role="treeitem"
              [class.is-first]="r.first"
              [class.is-drop]="dropKey() === r.key"
              [class.is-dim]="dimmed(r)"
              [class.is-dragging]="isDragging(r)"
              [attr.aria-level]="r.level + 1"
              [attr.aria-expanded]="r.expanded"
              [attr.aria-selected]="isSelected(r)"
              [attr.aria-disabled]="dimmed(r) ? 'true' : null"
              [attr.tabindex]="r.key === tabKey() ? 0 : -1"
              [attr.data-key]="r.key"
              [attr.data-folder]="r.node ? r.node.id : null"
              [attr.title]="rowTitle(r)"
              [attr.draggable]="r.node && store.canEdit() ? 'true' : null"
              [style.--lvl]="r.level"
              (click)="pick(r)"
              (focus)="focusKey.set(r.key)"
              (dragstart)="onDragStart($event, r)"
              (dragend)="onDragEnd()"
              (dragover)="onDragOver($event, r)"
              (dragleave)="onDragLeave($event, r)"
              (drop)="onDrop($event, r)"
            >
              <span
                class="ft__chev"
                [class.is-none]="r.expanded === null"
                aria-hidden="true"
                (click)="toggle($event, r)"
              >
                @if (r.expanded !== null) {
                  <i class="pi" [class]="r.expanded ? 'pi-chevron-down' : 'pi-chevron-right'"></i>
                }
              </span>
              <i class="pi ft__icon" [class]="r.icon" aria-hidden="true"></i>
              <span class="ft__name">{{ r.name }}</span>
              @if (r.count !== null) {
                <span class="ft__count" [attr.aria-label]="countLabel(r.count)">{{ r.count }}</span>
              }
              @if (r.node) {
                <!-- eslint-disable-next-line @angular-eslint/template/interactive-supports-focus, @angular-eslint/template/click-events-have-key-events -->
                <span class="ft__more" (click)="$event.stopPropagation()">
                  <mf-action-menu
                    data-row-actions
                    [floating]="true"
                    [label]="'Actions for ' + r.name"
                    [items]="r.menu"
                  />
                </span>
              }
            </div>
          }
        </div>
        @if (store.loaded() && store.folders().length === 0 && !store.loadError()) {
          <p class="ft__none" data-folder-none>
            <span>No folders yet.</span>
            @if (store.canEdit()) {
              <button type="button" class="mf-btn mf-btn--text" (click)="newFolder()">
                <i class="pi pi-folder-plus" aria-hidden="true"></i>New Folder
              </button>
            }
          </p>
        }
        @if (store.loadError(); as err) {
          <p class="ft__none" role="alert" data-folder-error>
            <span>{{ err }}</span>
            <button type="button" class="mf-btn mf-btn--text" (click)="store.load()">Retry</button>
          </p>
        }
      </div>
    }
    @if (store.drag() && dragLabel(); as l) {
      <div class="ft__drag" aria-hidden="true" [style.left.px]="l.x" [style.top.px]="l.y">
        {{ l.text }}
      </div>
    }
  `,
})
export class NoteFolderTree {
  protected readonly store = inject(NoteFolderStore);
  private readonly router = inject(Router);
  private readonly notify = inject(NotificationService);

  /** The card is too narrow for the open tree: it shows as the rail without changing the remembered choice. */
  readonly narrow = input(false);
  /** A row was chosen: the Notes tab asks about unsaved changes first, then selects it. */
  readonly selected = output<FolderScope>();

  protected readonly rail = computed(() => this.narrow() || !this.store.treeOpen());
  protected readonly focusKey = signal<string | null>(null);
  protected readonly dropKey = signal<string | null>(null);
  protected readonly dragLabel = signal<{ text: string; x: number; y: number } | null>(null);
  private hoverTimer: ReturnType<typeof setTimeout> | null = null;
  private hoverKey = '';

  protected readonly createState = computed(() => {
    const t = this.store.tree();
    return canCreateIn(t, this.store.selectedId());
  });

  protected readonly rows = computed<TreeRow[]>(() => {
    const t = this.store.tree();
    const has = t.byId.size > 0;
    const open = this.store.open();
    const out: TreeRow[] = [
      {
        key: 'all',
        scope: 'all',
        dropTarget: undefined,
        name: 'All Notes',
        icon: 'pi-list',
        count: this.store.loaded() ? this.store.totalCount() : null,
        level: 0,
        expanded: null,
        node: null,
        first: false,
        menu: [],
      },
    ];
    if (has) {
      out.push({
        key: 'none',
        scope: 'none',
        dropTarget: null,
        name: 'No Folder',
        icon: 'pi-file',
        count: this.store.noFolderCount(),
        level: 0,
        expanded: null,
        node: null,
        first: false,
        menu: [],
      });
    }
    let firstFolder = true;
    for (const f of visibleFolders(t.roots, open)) {
      out.push({
        key: String(f.id),
        scope: f.id,
        dropTarget: f.id,
        name: f.name,
        icon: f.children.length > 0 && open.has(f.id) ? 'pi-folder-open' : 'pi-folder',
        count: f.noteCount,
        level: f.depth - 1,
        expanded: f.children.length > 0 ? open.has(f.id) : null,
        node: f,
        first: firstFolder,
        menu: this.menuFor(f),
      });
      firstFolder = false;
    }
    return out;
  });

  /** The row that takes the Tab stop: the one with the focus, else the selected one, else the first. */
  protected readonly tabKey = computed(() => {
    const keys = this.rows().map((r) => r.key);
    const f = this.focusKey();
    if (f && keys.includes(f)) return f;
    const s = String(this.store.scope());
    return keys.includes(s) ? s : (keys[0] ?? '');
  });

  protected countLabel(n: number): string {
    return countText(n, 'note');
  }

  protected isSelected(r: TreeRow): boolean {
    return String(this.store.scope()) === r.key;
  }

  protected rowTitle(r: TreeRow): string | null {
    const item = this.store.drag();
    if (item && r.dropTarget !== undefined) {
      const s = moveTarget(this.store.tree(), dragMoving(item), r.dropTarget);
      if (!s.ok) return s.tip;
    }
    return r.node ? r.name : r.key === 'none' ? 'Notes that are not in a folder' : null;
  }

  protected dimmed(r: TreeRow): boolean {
    const item = this.store.drag();
    if (!item || r.dropTarget === undefined) return false;
    return !moveTarget(this.store.tree(), dragMoving(item), r.dropTarget).ok;
  }

  protected isDragging(r: TreeRow): boolean {
    const d = this.store.drag();
    return d?.kind === 'folder' && r.node?.id === d.id;
  }

  private menuFor(f: FolderNode): MenuAction[] {
    const edit = this.store.canEdit();
    const sub = canCreateIn(this.store.tree(), f.id);
    const del = this.store.canDelete();
    return [
      {
        id: 'sub',
        label: 'New Subfolder',
        icon: 'pi-folder-plus',
        disabled: !edit || !sub.ok,
        reason: !edit ? NO_EDIT : sub.tip,
        run: () => this.store.ask({ kind: 'create', parentId: f.id }),
      },
      {
        id: 'rename',
        label: 'Rename',
        icon: 'pi-pencil',
        disabled: !edit,
        reason: NO_EDIT,
        run: () => this.store.ask({ kind: 'rename', id: f.id }),
      },
      {
        id: 'move',
        label: 'Move to Folder...',
        icon: 'pi-arrow-right-arrow-left',
        disabled: !edit,
        reason: NO_EDIT,
        run: () => this.store.ask({ kind: 'move-folder', id: f.id }),
      },
      {
        id: 'link',
        label: 'Copy Link',
        icon: 'pi-link',
        run: () => void this.copyLink(f),
      },
      {
        id: 'delete',
        label: 'Delete Folder',
        icon: 'pi-trash',
        danger: true,
        separated: true,
        disabled: !del,
        reason: 'Delete needs the Matter Note Delete permission.',
        run: () => this.store.ask({ kind: 'delete', id: f.id }),
      },
    ];
  }

  protected newFolder(): void {
    const s = this.createState();
    if (!s.ok) {
      this.notify.info(s.tip);
      return;
    }
    this.store.ask({ kind: 'create', parentId: this.store.selectedId() });
  }

  protected hide(): void {
    this.store.setTreeOpen(false);
    setTimeout(() => document.querySelector<HTMLElement>('[data-folder-show]')?.focus(), 0);
  }

  protected show(): void {
    this.store.setTreeOpen(true);
    setTimeout(
      () => document.querySelector<HTMLElement>('[data-folder-tree] [tabindex="0"]')?.focus(),
      0,
    );
  }

  protected pick(r: TreeRow): void {
    this.focusKey.set(r.key);
    if (!this.isSelected(r)) this.selected.emit(r.scope);
  }

  protected toggle(e: Event, r: TreeRow): void {
    e.stopPropagation();
    if (r.node && r.expanded !== null) this.store.toggleOpen(r.node.id);
  }

  private async copyLink(f: FolderNode): Promise<void> {
    const url = new URL(
      this.router.serializeUrl(
        this.router.createUrlTree(['/matters', this.store.matterId()], {
          queryParams: { tab: 'notes', folder: f.id },
        }),
      ),
      window.location.origin,
    ).toString();
    try {
      await navigator.clipboard.writeText(url);
      this.notify.success('Link copied');
    } catch {
      this.notify.warn(
        "Couldn't copy the link.",
        'Copying is not allowed here. Copy the address from the browser.',
      );
    }
  }

  // ------------------------------------------------------------ keys (ARIA tree, inside the control)

  protected onKey(e: KeyboardEvent): void {
    const el = e.target as HTMLElement;
    if (el.getAttribute('role') !== 'treeitem' || e.ctrlKey || e.metaKey || e.altKey) return;
    const rows = this.rows();
    const i = rows.findIndex((r) => r.key === el.dataset['key']);
    if (i < 0) return;
    const r = rows[i];
    let to = -1;
    switch (e.key) {
      case 'ArrowDown':
        to = Math.min(rows.length - 1, i + 1);
        break;
      case 'ArrowUp':
        to = Math.max(0, i - 1);
        break;
      case 'Home':
        to = 0;
        break;
      case 'End':
        to = rows.length - 1;
        break;
      case 'ArrowRight':
        if (r.node && r.expanded === false) this.store.setOpen(r.node.id, true);
        else if (r.expanded === true) to = i + 1;
        else return;
        break;
      case 'ArrowLeft':
        if (r.node && r.expanded === true) this.store.setOpen(r.node.id, false);
        else if (r.node && r.node.parentId !== null) {
          to = rows.findIndex((x) => x.node?.id === r.node!.parentId);
        } else return;
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        e.stopPropagation();
        this.pick(r);
        return;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (to >= 0 && rows[to]) {
      this.focusKey.set(rows[to].key);
      setTimeout(
        () =>
          document
            .querySelector<HTMLElement>(`[data-folder-list] [data-key="${rows[to].key}"]`)
            ?.focus(),
        0,
      );
    }
  }

  // ------------------------------------------------------------ drag and drop (a shortcut for "Move to Folder...")

  protected onDragStart(e: DragEvent, r: TreeRow): void {
    if (!r.node || !this.store.canEdit()) return;
    e.dataTransfer?.setData('text/plain', r.node.name);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    this.store.drag.set({ kind: 'folder', id: r.node.id, title: r.node.name });
  }

  protected onDragEnd(): void {
    this.store.drag.set(null);
    this.endHover();
  }

  protected onDragOver(e: DragEvent, r: TreeRow): void {
    const item = this.store.drag();
    if (!item || r.dropTarget === undefined) return;
    const state = moveTarget(this.store.tree(), dragMoving(item), r.dropTarget);
    if (!state.ok) {
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
      this.dropKey.set(null);
      this.dragLabel.set(null);
      return;
    }
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    this.dropKey.set(r.key);
    this.dragLabel.set({
      text: `Move to ${r.dropTarget === null ? 'No Folder' : pathText(this.store.tree().byId, r.dropTarget)}`,
      x: e.clientX + 16,
      y: e.clientY + 18,
    });
    // A collapsed folder opens after the pointer rests on it.
    if (r.expanded === false && r.node && this.hoverKey !== r.key) {
      this.endHover();
      this.hoverKey = r.key;
      const id = r.node.id;
      this.hoverTimer = setTimeout(() => this.store.setOpen(id, true), OPEN_ON_HOVER_MS);
    }
  }

  protected onDragLeave(e: DragEvent, r: TreeRow): void {
    const next = e.relatedTarget as Node | null;
    if (next && (e.currentTarget as HTMLElement).contains(next)) return;
    if (this.dropKey() === r.key) {
      this.dropKey.set(null);
      this.dragLabel.set(null);
    }
    if (this.hoverKey === r.key) this.endHover();
  }

  protected onDrop(e: DragEvent, r: TreeRow): void {
    const item = this.store.drag();
    this.dropKey.set(null);
    this.dragLabel.set(null);
    this.endHover();
    if (!item || r.dropTarget === undefined) return;
    const state = moveTarget(this.store.tree(), dragMoving(item), r.dropTarget);
    if (!state.ok) return;
    e.preventDefault();
    this.store.drag.set(null);
    if (item.kind === 'note') void this.store.moveNote(item.id, r.dropTarget, item.title);
    else void this.store.moveFolder(item.id, r.dropTarget);
  }

  private endHover(): void {
    if (this.hoverTimer) clearTimeout(this.hoverTimer);
    this.hoverTimer = null;
    this.hoverKey = '';
  }
}
