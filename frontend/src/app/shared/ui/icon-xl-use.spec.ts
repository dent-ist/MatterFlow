import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guard for spec 15.2 (#1223): `--mf-icon-xl` (24 px) exists in `docs/ux/tokens.css` and is used ONLY for the icon of an empty, error or system-page state block
 * (`mf-state-block`, `mf-state-page`). Controls, tabs, switches and chips stay on xs, sm, md and lg.
 */
const APP = join(process.cwd(), 'src', 'app');
const STYLES = join(process.cwd(), 'src', 'styles');
const ALLOWED_USERS = ['shared/ui/state-block.ts', 'shared/ui/state-page.ts'];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|html|scss)$/.test(name) && !name.endsWith('.spec.ts') ? [path] : [];
  });
}

describe('the 24 px icon token', () => {
  it('is defined once in tokens.css as 24px', () => {
    const tokens = readFileSync(join(process.cwd(), '..', 'docs', 'ux', 'tokens.css'), 'utf8');
    expect(tokens).toMatch(/--mf-icon-xl:\s*24px;/);
  });

  it('is used by the state block icon and nowhere else', () => {
    const users = [...sources(APP), ...sources(STYLES)]
      .filter((file) => readFileSync(file, 'utf8').includes('var(--mf-icon-xl)'))
      .map((file) => relative(APP, file).replace(/\\/g, '/'));
    expect(users).toContain('shared/ui/state-block.ts');
    expect(users.filter((file) => !ALLOWED_USERS.includes(file))).toEqual([]);
  });
});
