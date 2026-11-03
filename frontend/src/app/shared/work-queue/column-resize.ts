import { ColumnDef } from './column-prefs';
import { ROOT_PX } from './column-widths';

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

/** The Title (the spring) can be widened and narrowed too, between these limits in px (DB-10, #1073). */
export const TITLE_RESIZE_MIN_PX = 96;
export const TITLE_RESIZE_MAX_PX = 1600;

/** Up to this many rendered rows the columns relayout live during the drag (measured: 100 rows cost about 19 ms per frame). */
export const LIVE_ROW_LIMIT = 100;
/** A frame that takes longer (style + layout) switches the rest of the drag to the guide line. */
export const SLOW_FRAME_MS = 24;
/** Below this width the grid is cards/scroll on a phone: no resizing. */
export const RESIZE_MIN_VIEWPORT_PX = 640;

/**
 * The edge a column's handle sits on. Since DB-10 (#1073) every handle is on the RIGHT edge of the column it belongs to, the Title's too: the
 * divider between two columns resizes the column on its left and nothing else. (Before, the columns after the Title had their handle on the
 * LEFT edge and shrank themselves, so in a grid that scrolls sideways the next divider moved instead of the one under the pointer.) Null for a
 * column that cannot be resized; the Title can be dragged although it is not in the menu or the fit.
 */
export function resizeSide(def: ColumnDef): ResizeSide | null {
  if (def.resizable === false && !def.fill) return null;
  return 'end';
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

/**
 * What a drag does, in px (pure, for the specs). `startPx` is the dragged column's width at the start; `titlePx` the Title's rendered width and
 * `fixedPx` the sum of all other columns' widths at the start. The dragged column changes by the pointer travel `dx`; every other column keeps
 * its width, the Title is FROZEN at the width it has (so it does not give way and the divider stays under the pointer, the table grows and
 * scrolls sideways instead). Dragging the Title itself sets the width it keeps. `tableMinPx` is the narrowest the table may be: the grid is
 * never narrower than its window, so a smaller total only gives the room back to the Title.
 */
export function dragLayout(o: {
  isTitle: boolean;
  startPx: number;
  titlePx: number;
  fixedPx: number;
  dx: number;
  minPx: number;
  maxPx: number;
}): { widthPx: number; titleMinPx: number; tableMinPx: number } {
  if (o.isTitle) {
    const titleMinPx = Math.min(
      TITLE_RESIZE_MAX_PX,
      Math.max(TITLE_RESIZE_MIN_PX, Math.round(o.titlePx + o.dx)),
    );
    return { widthPx: titleMinPx, titleMinPx, tableMinPx: o.fixedPx + titleMinPx };
  }
  const widthPx = resizedPx(o.startPx, o.dx, 'end', o.minPx, o.maxPx);
  const titleMinPx = Math.round(o.titlePx);
  return { widthPx, titleMinPx, tableMinPx: o.fixedPx - o.startPx + widthPx + titleMinPx };
}

export interface ColumnResizeOptions {
  handle: HTMLElement;
  event: PointerEvent;
  table: HTMLTableElement;
  def: ColumnDef;
  side: ResizeSide;
  /** The real root font size in px (text-only zoom grows it). */
  rootPx: number;
  /** The key of the Title (the spring), when the grid has one. */
  fillKey?: string | null;
  /** Called on release with the final width in rem, only when it differs from the start. */
  commit: (rem: number) => void;
  /** Called on release with the width the Title keeps (rem), whenever a drag changed anything. */
  commitTitle?: (rem: number) => void;
}

/**
 * Starts a drag. Returns false when none starts (not the main button, or a viewport below 640 px). During the drag the width goes straight to the
 * `<col>` and to the table's `min-width`; nothing reaches Angular or storage until the pointer is released (`commit`). Escape restores the start.
 * Geometry: `dragLayout`.
 */
export function startColumnResize(o: ColumnResizeOptions): boolean {
  const { handle, event, table, def, side, rootPx } = o;
  if (event.button !== 0 || window.innerWidth < RESIZE_MIN_VIEWPORT_PX) return false;
  const isTitle = !!def.fill;
  const heads = Array.from(table.querySelectorAll<HTMLElement>('thead tr:first-child th'));
  const scale = rootPx / ROOT_PX;
  /** A header's rendered width; without layout (a test) the width the table declares, the Title its minimum. */
  const widthOfHead = (h: HTMLElement): number => {
    const measured = h.getBoundingClientRect().width;
    if (measured > 0) return measured;
    const declared = parseFloat(table.style.getPropertyValue(`--w-${h.dataset['col']}`));
    return Number.isFinite(declared)
      ? declared * rootPx
      : h.dataset['col'] === o.fillKey
        ? def.minWidth * scale
        : 0;
  };
  const startPx = widthOfHead(
    heads.find((h) => h.dataset['col'] === def.key) ?? handle.closest('th')!,
  );
  if (!(startPx > 0)) return false;
  const titlePx = o.fillKey
    ? widthOfHead(heads.find((h) => h.dataset['col'] === o.fillKey) ?? heads[0])
    : 0;
  const fixedPx = heads
    .filter((h) => h.dataset['col'] !== o.fillKey)
    .reduce((sum, h) => sum + widthOfHead(h), 0);
  const minPx = (isTitle ? TITLE_RESIZE_MIN_PX : def.minWidth) * scale;
  const maxPx = (isTitle ? TITLE_RESIZE_MAX_PX : def.maxWidth) * scale;
  const startX = event.clientX;
  const rowCount = table.querySelectorAll('tbody tr[data-task]').length;
  let guide = useGuideLine(rowCount, 0);
  delete table.dataset['resizeFrameMs'];
  let layout = dragLayout({ isTitle, startPx, titlePx, fixedPx, dx: 0, minPx, maxPx });
  let frame = 0;
  let done = false;

  const wrap = table.closest<HTMLElement>('.wt-wrap') ?? table;
  const handleX = handle.getBoundingClientRect().left + handle.getBoundingClientRect().width / 2;
  let line: HTMLElement | null = null;
  let tip: HTMLElement | null = null;

  const colEl = isTitle ? null : table.querySelector<HTMLElement>(`col[data-col="${def.key}"]`);
  const startColWidth = colEl?.style.width ?? '';
  const startMinWidth = table.style.minWidth;
  const apply = (): void => {
    if (colEl) colEl.style.width = `${layout.widthPx}px`;
    table.style.minWidth = `${layout.tableMinPx}px`;
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
    const x = handleX + (layout.widthPx - startPx);
    line.style.cssText = `left:${x}px;top:${box.top}px;height:${box.height}px`;
    if (tip) {
      tip.textContent = `${def.label} ${Math.round(layout.widthPx / scale)} px`;
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
    table.dataset['resizeMode'] = guide ? 'guide' : 'live';
    try {
      handle.releasePointerCapture(event.pointerId);
    } catch {
      // Already released.
    }
    const changed = Math.round(layout.widthPx) !== Math.round(startPx);
    if (commit && changed) {
      // The variables first, so the column keeps its new width when the inline overrides go; Angular writes the same values next.
      if (!isTitle) table.style.setProperty(`--w-${def.key}`, `${layout.widthPx / rootPx}rem`);
      restore();
      if (o.fillKey && o.commitTitle) o.commitTitle(layout.titleMinPx / rootPx);
      if (!isTitle) o.commit(layout.widthPx / rootPx);
    } else {
      restore();
    }
  };
  const onMove = (e: PointerEvent): void => {
    layout = dragLayout({
      isTitle,
      startPx,
      titlePx,
      fixedPx,
      dx: e.clientX - startX,
      minPx,
      maxPx,
    });
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
  void side;
  return true;
}
