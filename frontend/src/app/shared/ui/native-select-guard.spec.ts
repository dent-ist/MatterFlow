import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Guard for the native `<select>` (D-14, #1251): every choice is the shared `mf-dropdown`, in a toolbar, a filter row, a form or a dialog. A native select looks and behaves
 * differently from the rest of the app (no 36 px trigger, no check mark, the browser's own list), so no template under `src/app` may contain one. The only one left is the
 * Development sign-in banner, which is not part of the product. A new exception needs the designer.
 */
const APP = join(process.cwd(), 'src', 'app');

const ALLOWED: Readonly<Record<string, string>> = {
  'shared/layout/dev-auth-banner.ts':
    'Development-only sign-in banner (never shown with Windows auth)',
};

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (/\.(ts|html)$/.test(name) && !/\.spec\.ts$/.test(name) && !name.includes('generated'))
      out.push(path);
  }
  return out;
}

describe('no native select (D-14, #1251)', () => {
  it('only the Development banner may contain a <select> element', () => {
    const found = sources(APP)
      .filter((p) => /<select[\s>]/.test(readFileSync(p, 'utf8')))
      .map((p) => relative(APP, p).replace(/\\/g, '/'))
      .filter((p) => !(p in ALLOWED))
      .sort();
    expect(found, 'use mf-dropdown (shared/ui/dropdown.ts) instead of a native select').toEqual([]);
  });

  it('the allowed list names only files that still contain one', () => {
    for (const file of Object.keys(ALLOWED))
      expect(readFileSync(join(APP, file), 'utf8')).toMatch(/<select[\s>]/);
  });
});
