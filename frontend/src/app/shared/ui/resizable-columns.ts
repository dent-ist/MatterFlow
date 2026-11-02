import {
  DestroyRef,
  Directive,
  ElementRef,
  afterNextRender,
  inject,
  input,
  untracked,
} from '@angular/core';
import { AuthStore } from '../../core/auth/auth.store';
import { contentWidth } from '../work-queue/column-fit';

/** The narrowest a resizable column can get, in px (room for a header word and its sort icon). */
export const RESIZE_MIN_PX = 72;
/** The widest a resizable column can get, in px. */
export const RESIZE_MAX_PX = 720;
/** Arrow key step on a focused handle; Shift makes it the big step. */
export const RESIZE_STEP_PX = 16;
export const RESIZE_BIG_STEP_PX = 64;
/** A column without a stored width (an optional column shown later) starts here once the table runs on stored widths. */
const FALLBACK_PX = 120;
/** Below this viewport width the grids are cards or scroll sideways: no handles, no stored widths. */
const MIN_VIEWPORT_PX = 640;

export type ColumnWidths = Readonly<Record<string, number>>;

/** Pure rule: a width clamped to the limits and rounded to a whole pixel. */
export function clampColumnWidth(px: number, min = RESIZE_MIN_PX, max = RESIZE_MAX_PX): number {
  return Math.min(max, Math.max(min, Math.round(px)));
}

/** Storage key of one grid and one person: `mf.col-widths.v1.<grid>.<userId|anon>`. */
export const columnWidthsKey = (grid: string, userId: number | null | undefined): string =>
  `mf.col-widths.v1.${grid}.${userId ?? 'anon'}`;

/** The stored widths (a sparse map of key to px). Corrupt data, blocked storage and non-numbers give `{}`; nothing throws. */
export function loadColumnWidths(storageKey: string): ColumnWidths {
  try {
    const text = localStorage.getItem(storageKey);
    const raw: unknown = text ? JSON.parse(text) : null;
    const w = (raw as { v?: unknown; w?: unknown } | null)?.w;
    if (!raw || (raw as { v?: unknown }).v !== 1 || !w || typeof w !== 'object') return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(w as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = clampColumnWidth(v);
    }
    return out;
  } catch {
    return {};
  }
}

export function saveColumnWidths(storageKey: string, widths: ColumnWidths): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ v: 1, w: widths }));
  } catch {
    // Blocked or full storage: the widths hold for this visit only.
  }
}

/** The key of a header cell: `data-col`, else the `mfSort` field, else its text. */
export function columnKeyOf(th: HTMLElement): string {
  return (
    th.dataset['col'] ?? th.getAttribute('mfsort') ?? (th.textContent ?? '').trim().toLowerCase()
  );
}

/**
 * Resizable columns, the shared grid capability (epic #1001, MD-21): `<table class="pg-table" mfResizable="matters">`. Each header cell of the first
 * header row gets a handle on its right edge (hover shows the divider, 24 px hit area):
 *
 *  - Drag the handle with the mouse or touch (Esc cancels).
 *  - Keyboard: Tab to the handle (it is a focusable `separator`), Left and Right resize by 16 px (Shift: 64 px), Home sets the minimum, Enter or
 *    a double-click fits the column to its content.
 *  - The widths are remembered per person and per grid in `localStorage` (`mf.col-widths.v1.<grid>.<userId>`), guarded by try/catch.
 *  - No layout shift: before the first change the table is measured and every column is frozen at the width it had (fixed table layout), so
 *    nothing jumps; without a stored or chosen width the table keeps its automatic layout.
 *
 * Opt a header cell out with `data-no-resize` (the select checkbox and the actions column). Give a cell a stable key with `data-col`; without
 * one the `mfSort` field or the header text is used. Not active below 640 px.
 */
@Directive({
  selector: 'table[mfResizable]',
  host: { class: 'mf-rz' },
})
export class ResizableColumns {
  private readonly table = inject<ElementRef<HTMLTableElement>>(ElementRef).nativeElement;
  private readonly auth = inject(AuthStore, { optional: true });
  private readonly destroyRef = inject(DestroyRef);

  /** The grid's name in storage. */
  readonly mfResizable = input.required<string>();
  readonly mfResizeMin = input(RESIZE_MIN_PX);

  private widths: Record<string, number> = {};
  private loaded = false;
  private observer: MutationObserver | null = null;

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

  private get storageKey(): string {
    return columnWidthsKey(
      this.mfResizable(),
      untracked(() => this.auth?.profile()?.userId),
    );
  }

  private headCells(): HTMLTableCellElement[] {
    const row = this.table.tHead?.rows[0];
    return row ? Array.from(row.cells) : [];
  }

  private active(): boolean {
    return window.innerWidth >= MIN_VIEWPORT_PX;
  }

  /** Adds the handles to the header cells that have none and applies the stored widths. Safe to run again. */
  private decorate(): void {
    if (!this.active()) return;
    if (!this.loaded) {
      this.widths = { ...loadColumnWidths(this.storageKey) };
      this.loaded = true;
    }
    const cells = this.headCells();
    const stored = cells.some((th) => this.widths[columnKeyOf(th)] !== undefined);
    if (stored) this.applyWidths(cells, (th) => this.widths[columnKeyOf(th)] ?? FALLBACK_PX);
    cells.forEach((th, i) => {
      if (th.hasAttribute('data-no-resize') || th.querySelector(':scope > .mf-resize')) return;
      th.append(this.createHandle(th, i === cells.length - 1));
    });
  }

  private applyWidths(cells: HTMLTableCellElement[], widthOf: (th: HTMLElement) => number): void {
    let sum = 0;
    for (const th of cells) {
      const w = widthOf(th);
      th.style.width = `${w}px`;
      sum += w;
    }
    this.table.style.width = `${sum}px`;
    this.table.classList.add('mf-rz--fixed');
  }

  /** Freezes every column at the width it has now: the fixed layout then reproduces the current one exactly (no shift). */
  private freeze(): HTMLTableCellElement[] {
    const cells = this.headCells();
    if (!this.table.classList.contains('mf-rz--fixed')) {
      const measured = new Map(cells.map((th) => [th, th.getBoundingClientRect().width]));
      this.applyWidths(cells, (th) => measured.get(th as HTMLTableCellElement) ?? FALLBACK_PX);
    }
    return cells;
  }

  private createHandle(th: HTMLTableCellElement, last: boolean): HTMLElement {
    const label = (th.textContent ?? '').trim() || columnKeyOf(th);
    const handle = document.createElement('span');
    handle.className = 'wt-resize mf-resize';
    handle.dataset['side'] = 'end';
    if (last) handle.style.right = '0';
    handle.tabIndex = 0;
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-orientation', 'vertical');
    handle.setAttribute('aria-label', `Resize ${label} column`);
    handle.title = `Drag to resize ${label}. Double-click to fit.`;
    this.syncAria(handle, th);
    handle.addEventListener('pointerdown', (e) => this.onPointerDown(e, th, handle));
    handle.addEventListener('keydown', (e) => this.onKey(e, th, handle));
    handle.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      this.fit(th, handle);
    });
    // A click on the handle must not sort the column.
    handle.addEventListener('click', (e) => e.stopPropagation());
    return handle;
  }

  private syncAria(handle: HTMLElement, th: HTMLElement): void {
    handle.setAttribute('aria-valuemin', String(this.mfResizeMin()));
    handle.setAttribute('aria-valuemax', String(RESIZE_MAX_PX));
    handle.setAttribute('aria-valuenow', String(Math.round(th.getBoundingClientRect().width)));
  }

  /** Sets one column's width (frozen layout), keeps the table as wide as its columns and remembers it. */
  private setWidth(th: HTMLElement, px: number, persist: boolean): void {
    const cells = this.headCells();
    th.style.width = `${px}px`;
    this.table.style.width = `${cells.reduce((s, c) => s + parseFloat(c.style.width || '0'), 0)}px`;
    if (persist) this.persist(cells);
  }

  private persist(cells: HTMLTableCellElement[]): void {
    for (const c of cells) {
      if (c.hasAttribute('data-no-resize') && !c.style.width) continue;
      this.widths[columnKeyOf(c)] = Math.round(parseFloat(c.style.width) || FALLBACK_PX);
    }
    saveColumnWidths(this.storageKey, this.widths);
  }

  private onPointerDown(e: PointerEvent, th: HTMLTableCellElement, handle: HTMLElement): void {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    this.freeze();
    const startX = e.clientX;
    const startW = th.getBoundingClientRect().width;
    const min = this.mfResizeMin();
    let width = startW;
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      // A synthetic event without an active pointer.
    }
    handle.classList.add('wt-resize--active');
    document.body.classList.add('wt-resizing');
    const move = (ev: PointerEvent): void => {
      width = clampColumnWidth(startW + ev.clientX - startX, min);
      this.setWidth(th, width, false);
    };
    const end = (commit: boolean): void => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', cancel);
      document.removeEventListener('keydown', esc, true);
      handle.classList.remove('wt-resize--active');
      document.body.classList.remove('wt-resizing');
      if (commit) this.setWidth(th, width, true);
      else this.setWidth(th, startW, false);
      this.syncAria(handle, th);
    };
    const up = (): void => end(true);
    const cancel = (): void => end(false);
    const esc = (ev: KeyboardEvent): void => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      ev.stopPropagation();
      end(false);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', cancel);
    document.addEventListener('keydown', esc, true);
  }

  private onKey(e: KeyboardEvent, th: HTMLTableCellElement, handle: HTMLElement): void {
    const step = e.shiftKey ? RESIZE_BIG_STEP_PX : RESIZE_STEP_PX;
    let target: number | null = null;
    const min = this.mfResizeMin();
    this.freeze();
    const current = th.getBoundingClientRect().width;
    if (e.key === 'ArrowRight') target = current + step;
    else if (e.key === 'ArrowLeft') target = current - step;
    else if (e.key === 'Home') target = min;
    else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      this.fit(th, handle);
      return;
    } else return;
    e.preventDefault();
    e.stopPropagation();
    this.setWidth(th, clampColumnWidth(target, min), true);
    this.syncAria(handle, th);
  }

  /** Fits the column to the widest of its header and the rows on the page (at most 100). */
  private fit(th: HTMLTableCellElement, handle: HTMLElement): void {
    this.freeze();
    const index = th.cellIndex;
    const before = th.getBoundingClientRect().width;
    this.setWidth(th, RESIZE_MAX_PX, false);
    void this.table.offsetWidth; // one forced layout with the column open
    const range = document.createRange();
    const cells = Array.from(this.table.tBodies[0]?.rows ?? [])
      .slice(0, 100)
      .map((r) => r.cells[index])
      .filter((c): c is HTMLTableCellElement => !!c && isPlainCell(c));
    const widest = Math.max(
      contentWidth(th, range),
      ...cells.map((c) => contentWidth(c, range)),
      0,
    );
    const style = getComputedStyle(th);
    const pad = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const next =
      widest > 0
        ? clampColumnWidth(Math.ceil(widest + (pad || 16)), this.mfResizeMin())
        : Math.round(before);
    this.setWidth(th, next, true);
    this.syncAria(handle, th);
  }
}

/** A body cell that takes part in the fit: a real cell, not a spanning message row. */
function isPlainCell(c: HTMLTableCellElement): boolean {
  return c.colSpan === 1;
}
