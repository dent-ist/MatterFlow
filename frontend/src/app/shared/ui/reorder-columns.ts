import { DestroyRef, Directive, ElementRef, afterNextRender, inject, output } from '@angular/core';
import { columnKeyOf } from './resizable-columns';

export interface ColumnMove {
  /** The column that was dragged. */
  readonly key: string;
  /** It now sits right before this column; null: at the end. */
  readonly beforeKey: string | null;
}

/**
 * Drag a header to reorder the columns (epic #1001, MD-28, #1032): `<table mfReorder (columnMove)="move($event)">`. The first header row's cells with a
 * key (`data-col`, else `mfSort`, else the text, same as `mfResizable`) become draggable; drop on the left half of another header puts the column before
 * it, on the right half after it. A cell with `data-no-reorder` (the selection and the actions columns) neither moves nor accepts a drop. The directive
 * only REPORTS the move: the grid keeps the order (`grid-prefs.ts`) and draws its columns in that order, so Angular stays the owner of the DOM.
 *
 * The keyboard way is the Columns menu (`mf-grid-columns`: Move left / Move right per column), so nothing here needs a pointer to be reachable.
 */
@Directive({ selector: 'table[mfReorder]' })
export class ReorderColumns {
  private readonly table = inject<ElementRef<HTMLTableElement>>(ElementRef).nativeElement;
  private readonly destroyRef = inject(DestroyRef);
  readonly columnMove = output<ColumnMove>();
  private observer: MutationObserver | null = null;
  private dragging: string | null = null;

  constructor() {
    afterNextRender(() => {
      const head = this.table.tHead;
      if (!head) return;
      this.decorate();
      this.observer = new MutationObserver(() => this.decorate());
      this.observer.observe(head, { childList: true, subtree: true });
    });
    this.destroyRef.onDestroy(() => this.observer?.disconnect());
  }

  private cells(): HTMLTableCellElement[] {
    const row = this.table.tHead?.rows[0];
    return row ? Array.from(row.cells) : [];
  }

  private movable(th: HTMLElement): boolean {
    return !th.hasAttribute('data-no-reorder') && columnKeyOf(th) !== '';
  }

  private decorate(): void {
    for (const th of this.cells()) {
      if (!this.movable(th) || th.dataset['mfReorder'] === '1') continue;
      th.dataset['mfReorder'] = '1';
      th.draggable = true;
      th.addEventListener('dragstart', (e) => {
        this.dragging = columnKeyOf(th);
        e.dataTransfer?.setData('text/plain', this.dragging);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      });
      th.addEventListener('dragend', () => this.clear());
      th.addEventListener('dragover', (e) => {
        if (this.dragging === null || !this.movable(th)) return;
        e.preventDefault();
        this.mark(th, this.leftHalf(th, e));
      });
      th.addEventListener('dragleave', () => th.classList.remove('mf-drop-start', 'mf-drop-end'));
      th.addEventListener('drop', (e) => {
        if (this.dragging === null || !this.movable(th)) return;
        e.preventDefault();
        const key = this.dragging;
        const target = columnKeyOf(th);
        const cells = this.cells().filter((c) => this.movable(c));
        let beforeKey: string | null = target;
        if (!this.leftHalf(th, e)) {
          const next = cells[cells.indexOf(th) + 1];
          beforeKey = next ? columnKeyOf(next) : null;
        }
        this.clear();
        if (beforeKey !== key) this.columnMove.emit({ key, beforeKey });
      });
    }
  }

  private leftHalf(th: HTMLElement, e: DragEvent): boolean {
    const r = th.getBoundingClientRect();
    return e.clientX < r.left + r.width / 2;
  }

  private mark(th: HTMLElement, left: boolean): void {
    for (const c of this.cells()) c.classList.remove('mf-drop-start', 'mf-drop-end');
    th.classList.add(left ? 'mf-drop-start' : 'mf-drop-end');
  }

  private clear(): void {
    this.dragging = null;
    for (const c of this.cells()) c.classList.remove('mf-drop-start', 'mf-drop-end');
  }
}
