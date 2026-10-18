import { ColumnDef } from './column-prefs';
import { pxToRem } from './column-widths';

/**
 * Drag resize of a column (#204). Pointer events with capture on a handle in the header cell; the pure rules are exported for the unit
 * specs, `startColumnResize` is the DOM side.
 *
 * Which edge carries the handle: the Title is the spring, so the columns left of it (Ref) are resized from their right edge, and the
 * columns right of it from their LEFT edge, which is the edge that really moves with the pointer (a right-hand column's right edge stays
 * at the table's right side while the Title absorbs the change). The border between the Title and its right neighbour is therefore the
 * left handle of that neighbour: dragging it right shrinks the neighbour and widens the Title (the Title is never stored).
 */
export type ResizeSide = 'start' | 'end';

/** Up to this many rendered rows the columns relayout live during the drag (measured: 100 rows cost about 19 ms per frame). */
export const LIVE_ROW_LIMIT = 100;
/** A frame that takes longer (style + layout) switches the rest of the drag to the guide line. */
export const SLOW_FRAME_MS = 24;
/** Below this width the grid is cards/scroll on a phone: no resizing. */
export const RESIZE_MIN_VIEWPORT_PX = 640;

/** The edge a column's handle sits on: null for the Title (fill) and columns that cannot be resized. */
export function resizeSide(def: ColumnDef, shown: readonly ColumnDef[]): ResizeSide | null {
  if (def.fill || def.resizable === false) return null;
  const spring = shown.findIndex((c) => c.fill);
  const at = shown.findIndex((c) => c.key === def.key);
  return spring >= 0 && at > spring ? 'start' : 'end';
}

/** The new width in px: the start width plus the pointer travel (inverted for a left-edge handle), whole pixels, clamped to min and max. */
export function resizedPx(
  startPx: number,
  dx: number,
  side: ResizeSide,
  minPx: number,
  maxPx: number,
): number {
  const raw = startPx + (side === 'end' ? dx : -dx);
  return Math.min(maxPx, Math.max(minPx, Math.round(raw)));
}

/** True when the relayout must not run per frame: many rows, or a frame that was too slow. */
export function useGuideLine(rowCount: number, slowestFrameMs: number): boolean {
  return rowCount > LIVE_ROW_LIMIT || slowestFrameMs > SLOW_FRAME_MS;
}

export interface ColumnResizeOptions {
  handle: HTMLElement;
  event: PointerEvent;
  table: HTMLTableElement;
  def: ColumnDef;
  side: ResizeSide;
  /** The real root font size in px (text-only zoom grows it). */
  rootPx: number;
  /** Called on release with the final width in rem, only when it differs from the start. */
  commit: (rem: number) => void;
}

/**
 * Starts a drag. Returns false when none starts (not the main button, or a viewport below 640 px). Everything is written to the table's
 * `--w-<key>` and `--wt-min` custom properties inside `requestAnimationFrame`; nothing reaches Angular or storage until the pointer is
 * released (`commit`). Escape restores the start width and commits nothing.
 */
export function startColumnResize(o: ColumnResizeOptions): boolean {
  const { handle, event, table, def, side, rootPx } = o;
  if (event.button !== 0 || window.innerWidth < RESIZE_MIN_VIEWPORT_PX) return false;
  const widthVar = `--w-${def.key}`;
  const startVar = table.style.getPropertyValue(widthVar);
  const startMinVar = table.style.getPropertyValue('--wt-min');
  const startRem = parseFloat(startVar);
  const startMinRem = parseFloat(startMinVar);
  if (!Number.isFinite(startRem)) return false;
  const startPx = startRem * rootPx;
  const minPx = pxToRem(def.minWidth) * rootPx;
  const maxPx = pxToRem(def.maxWidth) * rootPx;
  const startX = event.clientX;
  const rowCount = table.querySelectorAll('tbody tr[data-task]').length;
  let guide = useGuideLine(rowCount, 0);
  delete table.dataset['resizeFrameMs'];
  let widthPx = Math.round(startPx);
  let frame = 0;
  let done = false;

  const wrap = table.closest<HTMLElement>('.wt-wrap') ?? table;
  const handleX = handle.getBoundingClientRect().left + handle.getBoundingClientRect().width / 2;
  let line: HTMLElement | null = null;
  let tip: HTMLElement | null = null;

  // During the drag the width goes straight to the <col> and to the table's min-width: a custom property changed on the table would
  // restyle every cell below it (they all inherit it), which costs several times more per frame than moving the column.
  const colEl = table.querySelector<HTMLElement>(`col[data-col="${def.key}"]`);
  const startColWidth = colEl?.style.width ?? '';
  const startMinWidth = table.style.minWidth;
  const apply = (): void => {
    const rem = widthPx / rootPx;
    if (colEl) colEl.style.width = `${rem}rem`;
    if (Number.isFinite(startMinRem)) table.style.minWidth = `${startMinRem + rem - startRem}rem`;
  };
  const restore = (): void => {
    if (colEl) colEl.style.width = startColWidth;
    table.style.minWidth = startMinWidth;
  };
  const drawGuide = (): void => {
    if (!line) {
      line = document.createElement('div');
      line.className = 'wt-resize-guide';
      tip = document.createElement('div');
      tip.className = 'wt-resize-tip';
      document.body.append(line, tip);
    }
    const box = wrap.getBoundingClientRect();
    const x = handleX + (side === 'end' ? 1 : -1) * (widthPx - startPx);
    line.style.cssText = `left:${x}px;top:${box.top}px;height:${box.height}px`;
    if (tip) {
      tip.textContent = `${def.label} ${widthPx} px`;
      tip.style.cssText = `left:${x + 8}px;top:${box.top + 8}px`;
    }
  };
  const render = (): void => {
    frame = 0;
    if (done) return;
    if (guide) {
      drawGuide();
      return;
    }
    const t0 = performance.now();
    apply();
    void table.offsetWidth; // force the relayout so the frame is measured
    const ms = performance.now() - t0;
    // Left on the table for the performance check of the e2e suite (the slowest relayout of the last drag).
    table.dataset['resizeFrameMs'] = String(
      Math.max(ms, Number(table.dataset['resizeFrameMs'] ?? 0)),
    );
    if (useGuideLine(rowCount, ms)) {
      guide = true;
      restore();
      drawGuide();
    }
  };
  const schedule = (): void => {
    if (!frame) frame = requestAnimationFrame(render);
  };

  const finish = (commit: boolean): void => {
    if (done) return;
    done = true;
    if (frame) cancelAnimationFrame(frame);
    handle.removeEventListener('pointermove', onMove);
    handle.removeEventListener('pointerup', onUp);
    handle.removeEventListener('pointercancel', onCancel);
    handle.removeEventListener('lostpointercapture', onCancel);
    document.removeEventListener('keydown', onKey, true);
    document.body.classList.remove('wt-resizing');
    handle.classList.remove('wt-resize--active');
    line?.remove();
    tip?.remove();
    if (guide) table.dataset['resizeMode'] = 'guide';
    else table.dataset['resizeMode'] = 'live';
    try {
      handle.releasePointerCapture(event.pointerId);
    } catch {
      // Already released.
    }
    if (commit && widthPx !== Math.round(startPx)) {
      // The variables first, so the column keeps its new width when the inline overrides go; Angular writes the same values next.
      const rem = widthPx / rootPx;
      table.style.setProperty(widthVar, `${rem}rem`);
      if (Number.isFinite(startMinRem))
        table.style.setProperty('--wt-min', `${startMinRem + rem - startRem}rem`);
      restore();
      o.commit(rem);
    } else {
      restore();
    }
  };
  const onMove = (e: PointerEvent): void => {
    widthPx = resizedPx(startPx, e.clientX - startX, side, minPx, maxPx);
    schedule();
  };
  const onUp = (): void => finish(true);
  const onCancel = (): void => finish(false);
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    finish(false);
  };

  try {
    handle.setPointerCapture(event.pointerId);
  } catch {
    // A synthetic event without an active pointer: the listeners below still follow the handle.
  }
  event.preventDefault();
  handle.classList.add('wt-resize--active');
  document.body.classList.add('wt-resizing');
  handle.addEventListener('pointermove', onMove);
  handle.addEventListener('pointerup', onUp);
  handle.addEventListener('pointercancel', onCancel);
  handle.addEventListener('lostpointercapture', onCancel);
  document.addEventListener('keydown', onKey, true);
  if (guide) schedule();
  return true;
}
