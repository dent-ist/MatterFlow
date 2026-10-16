/// <reference types="node" />
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { AuraLite } from './aura-lite';

const ROOT = process.cwd();
const PRIMENG = join(ROOT, 'node_modules/primeng/fesm2022');
const AURA = join(ROOT, 'node_modules/@primeuix/themes/dist/aura');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (name.endsWith('.ts') && !name.endsWith('.spec.ts')) out.push(path);
  }
  return out;
}

function primengImports(text: string): string[] {
  return [...text.matchAll(/from\s+'primeng\/([a-z0-9-]+)'/g)].map((m) => m[1]);
}

describe('AuraLite', () => {
  it('has a token set for every themed PrimeNG component the app (transitively) imports', () => {
    const seen = new Set<string>();
    // The app and the form-engine library it renders (the library is consumed from dist, so scan its source).
    const queue = [
      ...sourceFiles(join(ROOT, 'src')),
      ...sourceFiles(join(ROOT, 'projects/form-engine/src')),
    ].flatMap((f) => primengImports(readFileSync(f, 'utf8')));
    const styleNames = new Set<string>();
    while (queue.length) {
      const entry = queue.pop() as string;
      if (seen.has(entry)) continue;
      seen.add(entry);
      const file = join(PRIMENG, `primeng-${entry}.mjs`);
      if (!existsSync(file)) continue;
      const text = readFileSync(file, 'utf8');
      queue.push(...primengImports(text));
      for (const m of text.matchAll(/^\s+name = '([a-z]+)';/gm)) styleNames.add(m[1]);
    }
    const themed = [...styleNames].filter(
      (n) => n !== 'base' && existsSync(join(AURA, n, 'index.mjs')),
    );
    const missing = themed.filter((n) => !(n in AuraLite.components));
    expect(missing).toEqual([]);
    expect(themed.length).toBeGreaterThan(5);
  });
});
