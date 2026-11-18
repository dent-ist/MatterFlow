import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';
import { FolderNode, FolderTree, Moving, TargetState, moveTarget } from './note-folders';

interface PickRow {
  /** The folder id, or null for the top level ("No Folder" / "Top level"). */
  id: number | null;
  name: string;
  level: number;
  icon: string;
  state: TargetState;
}

let nextPicker = 0;

/**
 * The Move picker of "Move Folder" and "Move Note" (D-46c): the whole tree of the matter as radio rows. A target that cannot take the item is greyed with a short
 * reason at the right ("This folder", "Inside it", "Too deep", "Name in use", "Already here") and the sentence as its tooltip, so nobody gets an error after the click.
 * Standard ARIA tree keys inside the control only: Up, Down, Home and End move, Enter or Space picks.
 */
@Component({
  selector: 'mf-note-folder-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './note-folder-tree.scss',
  template: `
    <!-- eslint-disable-next-line @angular-eslint/template/interactive-supports-focus -->
    <div
      class="ft ft--pick"
      role="tree"
      [attr.aria-labelledby]="labelId()"
      data-folder-picker
      (keydown)="onKey($event)"
    >
      @for (r of rows(); track r.id ?? 'top') {
        <!-- eslint-disable-next-line @angular-eslint/template/click-events-have-key-events -->
        <div
          class="ft__row"
          role="treeitem"
          [attr.aria-level]="r.level + 1"
          [attr.aria-selected]="value() === r.id"
          [attr.aria-disabled]="r.state.ok ? null : 'true'"
          [attr.title]="r.state.ok ? null : r.state.tip"
          [attr.tabindex]="r.id === focusId() ? 0 : -1"
          [attr.data-pick]="r.id ?? 'top'"
          [style.--lvl]="r.level"
          (click)="choose(r)"
        >
          <span class="ft__radio" aria-hidden="true"></span>
          <i class="pi ft__icon" [class]="r.icon" aria-hidden="true"></i>
          <span class="ft__name">{{ r.name }}</span>
          @if (!r.state.ok) {
            <span class="ft__why">{{ r.state.reason }}</span>
          }
        </div>
      }
    </div>
  `,
})
export class NoteFolderPicker {
  readonly tree = input.required<FolderTree>();
  readonly moving = input.required<Moving>();
  /** The label of the top-level choice: "No Folder" for a note, "Top level (no parent)" for a folder. */
  readonly topLabel = input('No Folder');
  /** The id of the element that names the picker (a `Move To` label). */
  readonly labelId = input('');
  /** The chosen target (null = the top level); the dialog starts it at where the item is now. */
  readonly value = model<number | null>(null);

  protected readonly uid = nextPicker++;
  protected readonly rows = computed<PickRow[]>(() => {
    const t = this.tree();
    const mv = this.moving();
    const out: PickRow[] = [
      {
        id: null,
        name: this.topLabel(),
        level: 0,
        icon: 'pi-file',
        state: moveTarget(t, mv, null),
      },
    ];
    const walk = (list: readonly FolderNode[]): void => {
      for (const f of list) {
        out.push({
          id: f.id,
          name: f.name,
          level: f.depth,
          icon: f.children.length ? 'pi-folder-open' : 'pi-folder',
          state: moveTarget(t, mv, f.id),
        });
        walk(f.children);
      }
    };
    walk(t.roots);
    return out;
  });
  /** The row that takes the Tab stop: the chosen one, else the first. */
  protected readonly focusId = computed(() => {
    const rows = this.rows();
    return rows.some((r) => r.id === this.value()) ? this.value() : (rows[0]?.id ?? null);
  });

  protected choose(r: PickRow): void {
    if (r.state.ok || r.id === this.value()) this.value.set(r.id);
  }

  protected onKey(e: KeyboardEvent): void {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]');
    if (!el) return;
    const items = Array.from(
      (e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role="treeitem"]'),
    );
    const i = items.indexOf(el);
    const to =
      e.key === 'ArrowDown'
        ? Math.min(items.length - 1, i + 1)
        : e.key === 'ArrowUp'
          ? Math.max(0, i - 1)
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? items.length - 1
              : -1;
    if (to >= 0) {
      e.preventDefault();
      e.stopPropagation();
      items[to].focus();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      const r = this.rows()[i];
      if (r) this.choose(r);
    }
  }
}
