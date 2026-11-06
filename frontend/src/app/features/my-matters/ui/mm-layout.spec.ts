import { MmLayout, SIDE_OPEN_MIN } from './mm-layout';

const KEY = 'mf.mymatters.v2.7';

function layout(win: number, work: number, userId = 7): MmLayout {
  localStorage.removeItem(KEY);
  const l = new MmLayout(userId);
  l.setWidths(win, work);
  return l;
}

describe('MmLayout (tree and side panel take turns)', () => {
  afterEach(() => {
    localStorage.removeItem(KEY);
    localStorage.removeItem('mf.mymatters.v2.8');
  });

  it('at 1920 both are wide', () => {
    const l = layout(1920, 1688);
    expect(l.treeOpen()).toBe(true);
    expect(l.sideOpen()).toBe(true);
  });

  it('at 1366 the first load is tree open and the side panel on its rail', () => {
    const l = layout(1366, 1070);
    expect(l.treeOpen()).toBe(true);
    expect(l.sideOpen()).toBe(false);
  });

  it('under 1500 px the side panel starts collapsed even when there is room, and is open from 1500 (D-44i)', () => {
    const l = new MmLayout(7);
    l.setWidths(1366, 1700);
    l.setBrowsable(false);
    expect(l.sideOpen()).toBe(false);
    expect(layout(SIDE_OPEN_MIN - 1, 1700).sideOpen()).toBe(false);
    expect(layout(SIDE_OPEN_MIN, 1400).sideOpen()).toBe(true);
  });

  it('a person who opened the side panel under 1500 px keeps it open, and the choice is kept per user', () => {
    const l = layout(1366, 1700);
    l.expandSide();
    expect(l.sideOpen()).toBe(true);
    const again = new MmLayout(7);
    again.setWidths(1366, 1700);
    expect(again.sideOpen()).toBe(true);
    const other = new MmLayout(8);
    other.setWidths(1366, 1700);
    expect(other.sideOpen()).toBe(false);
    expect(localStorage.getItem('mf.mymatters.v2.8')).toBeNull();
  });

  it('the side panel follows the window: collapsed by default under 1500, open again when the window grows', () => {
    const l = layout(1400, 1700);
    expect(l.sideOpen()).toBe(false);
    l.setWidths(1600, 1700);
    expect(l.sideOpen()).toBe(true);
    l.setWidths(1400, 1700);
    expect(l.sideOpen()).toBe(false);
  });

  it('choosing a matter keeps the Client and Matters tree open (MM-20, #1053)', () => {
    const l = layout(1366, 1070);
    l.chosen();
    expect(l.treeOpen()).toBe(true);
    expect(l.sideOpen()).toBe(false);
  });

  it("a first visit shows the tree expanded; the person's own collapse is remembered, a reset starts expanded again", () => {
    const l = layout(1366, 1070);
    expect(l.treeOpen()).toBe(true);
    l.collapseTree();
    expect(l.treeOpen()).toBe(false);
    expect(new MmLayout(7).treeOpen()).toBe(false);
    expect(layout(1366, 1070).treeOpen()).toBe(true);
  });

  it('opening the tree collapses the side panel when they cannot both fit, and the other way round', () => {
    const l = layout(1366, 1070);
    l.expandSide();
    expect(l.sideOpen()).toBe(true);
    expect(l.treeOpen()).toBe(false);
    expect(l.announcement()).toContain('collapsed to a rail');
    l.expandTree();
    expect(l.treeOpen()).toBe(true);
    expect(l.sideOpen()).toBe(false);
    expect(l.announcement()).toContain('collapsed to a rail');
  });

  it('below 1100 the tree is not docked', () => {
    const l = layout(1000, 900);
    expect(l.docked()).toBe(false);
    expect(l.treeOpen()).toBe(false);
  });

  it('a phone stacks and changes nothing', () => {
    const l = layout(375, 343);
    expect(l.stacked()).toBe(true);
  });

  it('remembers what the person chose', () => {
    const l = layout(1920, 1688);
    l.collapseSide();
    l.collapseTree();
    const again = new MmLayout(7);
    again.setWidths(1920, 1688);
    expect(again.sideOpen()).toBe(false);
    expect(again.treeOpen()).toBe(false);
  });
});
