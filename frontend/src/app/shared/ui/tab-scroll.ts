/** Where a tab sits inside the scrolling content of the strip (x of its left and right edge, from the start of the content). */
export interface TabBox {
  start: number;
  end: number;
}

/** Room the scroll cue (fade and chevron) takes at an edge of the strip while that edge has more tabs. */
export const TAB_CUE = 28;

/** Which sides of a strip have more to scroll to. */
export function scrollCues(
  left: number,
  clientWidth: number,
  scrollWidth: number,
): { start: boolean; end: boolean } {
  return { start: left > 1, end: left + clientWidth < scrollWidth - 1 };
}

const clamp = (left: number, clientWidth: number, scrollWidth: number) =>
  Math.min(Math.max(0, left), Math.max(0, scrollWidth - clientWidth));

/**
 * Moves a scroll position so that no tab is cut at the leading edge: when a tab straddles the line where the cue ends, the next tab's start
 * is put on that line instead. Not past `limit` (the tab that must stay in view).
 */
function settle(
  tabs: readonly TabBox[],
  left: number,
  clientWidth: number,
  scrollWidth: number,
  limit: number,
): number {
  if (left <= 1) return left;
  const edge = left + TAB_CUE;
  const cut = tabs.findIndex((t) => t.start < edge - 1 && t.end > edge + 1);
  if (cut < 0 || cut >= limit) return left;
  return clamp(tabs[cut + 1].start - TAB_CUE, clientWidth, scrollWidth);
}

/**
 * The scroll position that brings tab `active` fully into view with room for the cue on the side that has more, and leaves no tab cut at
 * the leading edge. A tab that is already in view moves nothing. Never negative, never past the end.
 */
export function revealLeft(
  tabs: readonly TabBox[],
  active: number,
  left: number,
  clientWidth: number,
  scrollWidth: number,
): number {
  const t = tabs[active];
  if (!t || scrollWidth <= clientWidth + 1) return 0;
  let next = left;
  if (t.start - TAB_CUE < left) next = t.start - TAB_CUE;
  else if (t.end + TAB_CUE > left + clientWidth) next = t.end + TAB_CUE - clientWidth;
  next = clamp(next, clientWidth, scrollWidth);
  return next === left ? left : settle(tabs, next, clientWidth, scrollWidth, active);
}

/**
 * The scroll position of a chevron press: forward puts the first tab that is cut or out of view at the trailing edge on the leading edge;
 * backward puts the first tab that is cut or out of view at the leading edge on the trailing edge.
 */
export function pageLeft(
  tabs: readonly TabBox[],
  direction: 1 | -1,
  left: number,
  clientWidth: number,
  scrollWidth: number,
): number {
  if (direction > 0) {
    const hidden = tabs.find((t) => t.end > left + clientWidth - TAB_CUE + 1);
    return hidden ? clamp(hidden.start - TAB_CUE, clientWidth, scrollWidth) : left;
  }
  let hidden = -1;
  tabs.forEach((t, i) => {
    if (t.start < left + TAB_CUE - 1) hidden = i;
  });
  if (hidden < 0) return 0;
  const to = clamp(tabs[hidden].end + TAB_CUE - clientWidth, clientWidth, scrollWidth);
  return settle(tabs, to, clientWidth, scrollWidth, hidden + 1);
}
