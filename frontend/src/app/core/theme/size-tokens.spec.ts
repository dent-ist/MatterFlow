import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** UI update 2, #1122: the size tokens of docs/ux/tokens.css (the single source) and the places that must not contradict them. */
describe('size tokens (docs/ux/tokens.css)', () => {
  const css = readFileSync(join(process.cwd(), '..', 'docs', 'ux', 'tokens.css'), 'utf8');
  const value = (name: string): string | null => {
    const m = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
    return m ? m[1].trim() : null;
  };

  it('defines the control, tab, figure, tile, dialog and drawer sizes', () => {
    const expected: Record<string, string> = {
      'mf-ctl-h': '36px',
      'mf-ctl-h-sm': '32px',
      'mf-tab-h': '40px',
      'mf-fs-figure': '24px',
      'mf-fs-figure-lg': '32px',
      'mf-tile-size': '32px',
      'mf-row-h': '36px',
      'mf-target-min': '24px',
      'mf-dialog-w-sm': '416px',
      'mf-dialog-w': '576px',
      'mf-dialog-w-lg': '768px',
      'mf-drawer-w': '520px',
      'mf-drawer-w-wide': '720px',
    };
    for (const [name, v] of Object.entries(expected)) {
      expect(value(name)?.replace(/\s*\/\*.*$/, ''), name).toBe(v);
    }
  });

  it('has no 19 px title token and the compact H1 is the H2 size', () => {
    expect(css).not.toMatch(/--mf-fs-title:/);
    expect(value('mf-fs-h1-compact')).toMatch(/^var\(--mf-fs-h2\)/);
  });

  it('keeps the radius roles documented', () => {
    expect(value('mf-radius')).toBe('4px');
    expect(value('mf-radius-lg')).toBe('8px');
    expect(value('mf-radius-xl')).toBe('12px');
    expect(value('mf-radius-md')).toBe('6px');
  });

  it('styles.scss does not override --mf-target-min (tokens.css keeps 24 px)', () => {
    const scss = readFileSync(join(process.cwd(), 'src', 'styles.scss'), 'utf8');
    expect(scss).not.toMatch(/--mf-target-min\s*:/);
  });
});
