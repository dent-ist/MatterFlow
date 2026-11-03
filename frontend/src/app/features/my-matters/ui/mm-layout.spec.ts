import { MmLayout } from './mm-layout';

function layout(win: number, work: number): MmLayout {
  localStorage.removeItem('mf-mm-ui');
  const l = new MmLayout();
  l.setWidths(win, work);
  return l;
}

describe('MmLayout (tree and side panel take turns)', () => {
  afterEach(() => localStorage.removeItem('mf-mm-ui'));

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
    expect(new MmLayout().treeOpen()).toBe(false);
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
    const again = new MmLayout();
    again.setWidths(1920, 1688);
    expect(again.sideOpen()).toBe(false);
    expect(again.treeOpen()).toBe(false);
  });
});
