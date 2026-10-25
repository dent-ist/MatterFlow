import { ADMIN_NAV_ITEMS, NAV_ITEMS } from './nav-items';
import { EXTRA_SECTIONS, iconForPath } from './section-icons';

/** The header user button's glyph (user-menu.ts). */
const USER_BUTTON_ICON = 'pi pi-user';

describe('the glyph table (S8, #623)', () => {
  const all = [
    ...NAV_ITEMS.map((i) => ({ what: i.label, icon: i.icon })),
    ...ADMIN_NAV_ITEMS.map((i) => ({ what: i.label, icon: i.icon })),
    ...EXTRA_SECTIONS.map((s) => ({ what: s.prefix, icon: s.icon })),
  ];

  it('has no duplicate glyph', () => {
    const seen = new Map<string, string>();
    const duplicates: string[] = [];
    for (const { what, icon } of all) {
      const first = seen.get(icon);
      if (first) duplicates.push(`${icon}: ${first} and ${what}`);
      else seen.set(icon, what);
    }
    expect(duplicates).toEqual([]);
  });

  it('gives My Work its own check-square, not the header user button glyph', () => {
    expect(NAV_ITEMS.find((i) => i.path === '/my-work')?.icon).toBe('pi pi-check-square');
    expect(all.some((a) => a.icon === USER_BUTTON_ICON)).toBe(false);
    expect(iconForPath('/my-work')).toBe('pi pi-check-square');
  });
});
