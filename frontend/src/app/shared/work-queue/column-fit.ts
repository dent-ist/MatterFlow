import { ColumnDef } from './column-prefs';
import { ROOT_PX, pxToRem } from './column-widths';

/**
 * Fit a column to its content (#205). `fitWidth` is the pure rule (used by the double-click on a handle, the header menu and, next, the
 * Columns panel); `fitColumn` is the DOM side: it measures the rows that are on the page in one layout pass.
 */

/** Side padding of a cell when none can be read (`--mf-s2` on both sides). */
export const FIT_PADDING_PX = 16;

/**
 * The width that shows the widest of `contents` (px: the natural width of the header and of each cell's content) plus the cell padding,
 * rounded up to whole px and clamped to the column's min and max. Null for the Title, which fills the space left and has no width of
 * its own. Nothing measured (no usable number): the column's default width.
 */
export function fitWidth(
  def: ColumnDef,
  contents: readonly number[],
  padding = FIT_PADDING_PX,
): number | null {
  if (def.fill || def.resizable === false) return null;
  let widest = 0;
  for (const w of contents) if (Number.isFinite(w) && w > widest) widest = w;
  if (widest <= 0) return def.width;
  return Math.min(def.maxWidth, Math.max(def.minWidth, Math.ceil(widest + padding)));
}

/** Subtrees that take no room in the cell: screen-reader text, hidden things and the drag handle. */
const SKIP = '.mf-sr-only, .wl-sr, [hidden], .wt-resize, script, style';

/** The widest an empty leaf element (an icon, a dot, an avatar) is taken to be; wider ones are layout boxes. */
const ICON_MAX_PX = 48;

/** A 1 px box: what the screen-reader-only classes make of their element (a `display: contents` host reports 0 and is not one). */
const isTiny = (r: DOMRect): boolean =>
  r.width > 0 && r.height > 0 && r.width <= 2 && r.height <= 2;

/**
 * The natural width of what a cell shows: the union of the boxes of its text, its icons and other leaf elements, and its inline-level
 * controls (so a two-line cell counts its widest line, a pill counts its chevron, border and padding, and text that an ellipsis would cut
 * counts in full). Reads only; call it when
 * the layout is current.
 */
export function contentWidth(cell: Element, range: Range): number {
  let left = Infinity;
  let right = -Infinity;
  const take = (r: DOMRect): void => {
    if (r.width <= 0 && r.height <= 0) return;
    if (r.left < left) left = r.left;
    if (r.right > right) right = r.right;
  };
  const walker = document.createTreeWalker(cell, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      if (n.nodeType === Node.TEXT_NODE) {
        return n.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
      const el = n as Element;
      if (el.matches(SKIP)) return NodeFilter.FILTER_REJECT;
      const rect = el.getBoundingClientRect();
      const hasText = !!el.textContent?.trim();
      // Visually hidden text (a 1 px clipped box that holds a sentence for screen readers, whatever its class) takes no room.
      if (hasText && isTiny(rect)) return NodeFilter.FILTER_REJECT;
      const leaf = el.localName === 'svg' || el.childElementCount === 0;
      // Text is measured through its own text nodes, so a block that holds text only repeats the width the cell gave it. What adds to
      // it is a control that sizes to its content (inline-flex trigger with its border, padding and chevron) and a small empty leaf
      // (an icon, a dot); an empty block that stretches across the cell is nothing.
      const sizesToContent = getComputedStyle(el).display.startsWith('inline-');
      const take = leaf && !hasText ? rect.width <= ICON_MAX_PX : sizesToContent;
      return take ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) {
      range.selectNodeContents(n);
      take(range.getBoundingClientRect());
    } else {
      take((n as Element).getBoundingClientRect());
    }
  }
  return right > left ? right - left : 0;
}

/**
 * Measures a column of a work table and returns the fitted width in px at the default zoom (null for the Title). The column is opened to its maximum for
 * one forced layout so nothing is cut, every cell is read in that state (header and the rows on the page: at most 100), and the
 * width goes back before anything is painted: one layout pass, no reads between writes.
 */
export function fitColumn(table: HTMLTableElement, def: ColumnDef, rootPx: number): number | null {
  if (def.fill || def.resizable === false) return null;
  const col = table.querySelector<HTMLElement>(`col[data-col="${def.key}"]`);
  const head = table.querySelector<HTMLElement>(`thead tr:first-child th[data-col="${def.key}"]`);
  if (!col || !head) return null;
  const cells = Array.from(
    table.querySelectorAll<HTMLElement>(`tbody tr[data-task] > td[data-col="${def.key}"]`),
  );
  const t0 = performance.now();
  const before = col.style.width;
  col.style.width = `${pxToRem(def.maxWidth)}rem`;
  void table.offsetWidth; // the one forced layout
  const range = document.createRange();
  const contents = [contentWidth(head, range)];
  for (const cell of cells) contents.push(contentWidth(cell, range));
  const style = getComputedStyle(cells[0] ?? head);
  const pad = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  const headStyle = getComputedStyle(head);
  const headPad = parseFloat(headStyle.paddingLeft) + parseFloat(headStyle.paddingRight);
  col.style.width = before;
  // Left on the table for the performance check of the e2e suite (milliseconds of the last fit).
  table.dataset['fitMs'] = String(performance.now() - t0);
  // Measured in real px; the limits and the store are px at the default zoom (text-only zoom grows the root).
  const scale = rootPx / ROOT_PX;
  const padding = (Math.max(pad || 0, headPad || 0) || FIT_PADDING_PX * scale) / scale;
  return fitWidth(
    def,
    contents.map((w) => w / scale),
    padding,
  );
}
