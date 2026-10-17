import { revealInList } from './dash-tabs';

function rect(left: number, right: number): DOMRect {
  return {
    left,
    right,
    top: 0,
    bottom: 0,
    width: right - left,
    height: 0,
    x: left,
    y: 0,
  } as DOMRect;
}

/** A tab list 100 px wide (from x = 10) holding one tab at the given place; scrollLeft starts at 50. */
function setup(tabLeft: number, tabRight: number) {
  const list = document.createElement('div');
  const tab = document.createElement('button');
  list.appendChild(tab);
  list.scrollLeft = 50;
  vi.spyOn(list, 'getBoundingClientRect').mockReturnValue(rect(10, 110));
  vi.spyOn(tab, 'getBoundingClientRect').mockReturnValue(rect(tabLeft, tabRight));
  return { list, tab };
}

describe('revealInList (the tab list scrolls inside itself, never the page)', () => {
  it('moves right by exactly what hangs over the right edge', () => {
    const { list, tab } = setup(90, 150);
    const scrollIntoView = vi.fn();
    tab.scrollIntoView = scrollIntoView;
    revealInList(tab);
    expect(list.scrollLeft).toBe(90);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('moves left by what hangs over the left edge', () => {
    const { list, tab } = setup(-5, 55);
    revealInList(tab);
    expect(list.scrollLeft).toBe(35);
  });

  it('does nothing for a tab that is fully inside, or for no tab', () => {
    const { list, tab } = setup(20, 80);
    revealInList(tab);
    expect(list.scrollLeft).toBe(50);
    expect(() => revealInList(null)).not.toThrow();
    expect(() => revealInList(document.createElement('button'))).not.toThrow();
  });
});
