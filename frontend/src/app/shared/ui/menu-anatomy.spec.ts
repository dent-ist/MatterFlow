import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (file: string): string => readFileSync(join(process.cwd(), 'src', file), 'utf8');

/** The body of the first rule in `css` that starts with `selector`. */
function rule(css: string, selector: string): string {
  const at = css.indexOf(selector);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', at);
  return css.slice(open + 1, css.indexOf('}', open));
}

describe('one menu and popover anatomy (D-36, #1143)', () => {
  const menus = source('styles/_menus.scss');

  it('the surface is radius 8, a 1 px soft border, the pop shadow, padding 4, 200 to 360 wide, 70% of the window high', () => {
    const surface = rule(menus, '.mf-menu {');
    expect(surface).toContain('border: 1px solid var(--mf-border-soft)');
    expect(surface).toContain('border-radius: var(--mf-radius-lg)');
    expect(surface).toContain('box-shadow: var(--mf-shadow-pop)');
    expect(surface).toContain('padding: var(--mf-s1)');
    expect(surface).toContain('min-width: 200px');
    expect(surface).toContain('360px');
    expect(surface).toContain('max-height: 70vh');
    expect(surface).toContain('overflow-y: auto');
    expect(rule(menus, '.mf-menu--filter {')).toContain('width: 320px');
  });

  it('an item is 36 px (--mf-row-h), 14 px, icon --mf-icon-md and an 8 px gap, hover --mf-row-hover, danger --mf-danger', () => {
    const item = rule(menus, '.mf-menu__item {');
    expect(item).toContain('min-height: var(--mf-row-h)');
    expect(item).toContain('font-size: var(--mf-fs-md)');
    expect(item).toContain('gap: var(--mf-s2)');
    expect(item).toContain('border-radius: var(--mf-radius)');
    expect(menus).toMatch(/&:hover \{\s*background: var\(--mf-row-hover\)/);
    expect(menus).toMatch(/outline-offset: calc\(-1 \* var\(--mf-focus-width\)\)/);
    expect(menus).toMatch(/\.pi \{[^}]*font-size: var\(--mf-icon-md\)/);
    expect(rule(menus, '.mf-menu__item--danger,')).toContain('color: var(--mf-danger)');
    expect(rule(menus, '.mf-menu__sep {')).toContain('1px solid var(--mf-border-soft)');
  });

  it('every shared menu puts the surface class on its panel and keeps no surface of its own', () => {
    const users: [string, string][] = [
      ['app/shared/ui/action-menu.ts', 'am__menu mf-menu'],
      ['app/shared/layout/user-menu.ts', 'um-pop mf-menu'],
      ['app/features/notifications/notification-panel.ts', 'np mf-menu'],
      ['app/shared/ui/options-menu.ts', 'om__panel mf-menu'],
      ['app/shared/ui/views-menu.ts', 'vm__panel mf-menu'],
      ['app/shared/ui/grid-columns.ts', 'gc-panel mf-menu'],
      ['app/shared/work-queue/column-menu.ts', 'cm mf-menu'],
      ['app/features/my-matters/ui/new-menu.ts', 'menu mf-menu'],
    ];
    for (const [file, cls] of users) {
      const text = source(file);
      expect(text, file).toContain(cls);
      // No private radius, shadow or border on the surface any more.
      expect(text, file).not.toMatch(
        /\.(am__menu|um-pop|om__panel|vm__panel|gc-panel|cm) \{[^}]*(box-shadow|border-radius)/,
      );
    }
    const popover = source('app/shared/filters/filter-popover.ts');
    expect(popover).toContain("class: 'mf-menu'");
    expect(popover).toContain("'[class.mf-menu--filter]': '!menu()'");
    expect(source('app/shared/ui/action-menu.ts')).toContain('am__item mf-menu__item');
    expect(source('app/shared/layout/user-menu.ts')).toContain('um-item mf-menu__item');
  });
});
