import { TAB_CUE, TabBox, pageLeft, revealLeft, scrollCues } from './tab-scroll';

/** Four tabs of 100 px with 4 px gaps: 412 px of content. */
const tabs: TabBox[] = [0, 1, 2, 3].map((i) => ({ start: i * 104, end: i * 104 + 100 }));
const WIDTH = 343;
const CONTENT = 412;

describe('tab strip scrolling (#279)', () => {
  it('shows a cue only on the side that has more, and none when everything fits', () => {
    expect(scrollCues(0, WIDTH, CONTENT)).toEqual({ start: false, end: true });
    expect(scrollCues(30, WIDTH, CONTENT)).toEqual({ start: true, end: true });
    expect(scrollCues(69, WIDTH, CONTENT)).toEqual({ start: true, end: false });
    expect(scrollCues(0, 500, CONTENT)).toEqual({ start: false, end: false });
  });

  it('does not move when the strip fits or the tab is already whole', () => {
    expect(revealLeft(tabs, 3, 0, 500, CONTENT)).toBe(0);
    expect(revealLeft(tabs, 1, 0, WIDTH, CONTENT)).toBe(0);
  });

  it('brings a tab at the end into view with the last tab complete', () => {
    expect(revealLeft(tabs, 3, 0, WIDTH, CONTENT)).toBe(CONTENT - WIDTH);
  });

  it('leaves no tab cut at the leading edge', () => {
    // Showing tab 3 needs scroll 69 (the end); the leading line is then at 97, inside tab 0 (0-100): tab 1 starts there instead.
    const left = revealLeft(tabs, 3, 0, WIDTH, CONTENT);
    const edge = left + TAB_CUE;
    expect(tabs.some((t) => t.start < edge - 1 && t.end > edge + 1)).toBe(left === CONTENT - WIDTH);
    // A longer strip: scrolling to tab 5 of 6 lands on a tab start, not mid tab.
    const six: TabBox[] = [0, 1, 2, 3, 4, 5].map((i) => ({ start: i * 104, end: i * 104 + 100 }));
    const at = revealLeft(six, 4, 0, 300, 620);
    const line = at + TAB_CUE;
    expect(six.some((t) => t.start < line - 1 && t.end > line + 1)).toBe(false);
    expect(six.some((t) => Math.abs(t.start - line) <= 1)).toBe(true);
    // The chosen tab is whole.
    expect(six[4].start).toBeGreaterThanOrEqual(at + TAB_CUE - 1);
    expect(six[4].end).toBeLessThanOrEqual(at + 300);
  });

  it('goes back to the start for the first tab', () => {
    expect(revealLeft(tabs, 0, 69, WIDTH, CONTENT)).toBe(0);
  });

  it('pages with the chevrons and stops at the ends', () => {
    expect(pageLeft(tabs, 1, 0, WIDTH, CONTENT)).toBeGreaterThan(0);
    expect(pageLeft(tabs, 1, 69, WIDTH, CONTENT)).toBe(69);
    expect(pageLeft(tabs, -1, 69, WIDTH, CONTENT)).toBe(0);
    expect(pageLeft(tabs, -1, 0, WIDTH, CONTENT)).toBe(0);
  });
});
