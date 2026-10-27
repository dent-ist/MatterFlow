import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guard for the initial bundle budget (angular.json: 700 kB warning). The generated API client is one 580 kB source file that the
 * bundler cannot split, so a single value import of it (or of the LookupStore, which injects two of its clients) from code the shell
 * loads eagerly puts about 190 kB into the initial chunk. Those files must import it as a type or with `await import(...)`.
 */
const APP = join(process.cwd(), 'src', 'app');
const EAGER = [
  join(APP, 'shared', 'search', 'global-search.ts'),
  join(process.cwd(), 'src', 'main.ts'),
  ...readdirSync(join(APP, 'core', 'branding'))
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))
    .map((f) => join(APP, 'core', 'branding', f)),
  ...readdirSync(join(APP, 'shared', 'layout'))
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts') && !f.endsWith('-testing.ts'))
    .map((f) => join(APP, 'shared', 'layout', f)),
];
const HEAVY = /api\/generated\/api-client'|lookups\/lookup-store'/;

describe('initial bundle', () => {
  for (const file of EAGER) {
    it(`${file.slice(process.cwd().length + 1)} loads the API client and the LookupStore lazily`, () => {
      const statements = readFileSync(file, 'utf8').match(/^import\s[^;]*?;/gms) ?? [];
      const eager = statements.filter((s) => !/^import\s+type\s/.test(s) && HEAVY.test(s));
      expect(eager).toEqual([]);
    });
  }
});
