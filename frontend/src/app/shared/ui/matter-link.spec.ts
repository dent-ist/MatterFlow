import { canOpenMatter, matterLinkOf } from './matter-link';

const holding = (...codes: string[]) => ({ has: (code: string) => codes.includes(code) });

describe('matter link rule', () => {
  it('opens matters only with Matter.View', () => {
    expect(canOpenMatter(holding('Matter.View'))).toBe(true);
    expect(canOpenMatter(holding('Asset.View'))).toBe(false);
    expect(canOpenMatter(holding())).toBe(false);
  });

  it('gives router commands with the permission and null without it', () => {
    expect(matterLinkOf(holding('Matter.View'), 7)).toEqual(['/matters', 7]);
    expect(matterLinkOf(holding('Asset.View'), 7)).toBeNull();
  });

  it('gives null when the matter is unknown', () => {
    expect(matterLinkOf(holding('Matter.View'), null)).toBeNull();
    expect(matterLinkOf(holding('Matter.View'), undefined)).toBeNull();
  });
});
