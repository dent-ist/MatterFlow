import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Spec helper (not part of the app build, see tsconfig.app.json): resolves a design token reference such as `var(--mf-chart-1)` to its `#RRGGBB`
 * value by reading docs/ux/tokens.css (the first definition of a token is the light theme). Code that holds colours as tokens is tested for
 * contrast with the real values, so a change of a token in the CSS is caught by the same spec.
 */
let tokens: Map<string, string> | null = null;

function load(): Map<string, string> {
  if (tokens) return tokens;
  const css = readFileSync(join(process.cwd(), '..', 'docs', 'ux', 'tokens.css'), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );
  tokens = new Map();
  for (const m of css.matchAll(/(--mf-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    if (!tokens.has(m[1])) tokens.set(m[1], m[2].trim().replace(/\s+/g, ' '));
  }
  return tokens;
}

/** `#RRGGBB` (upper case) of a hex colour or a `var(--mf-...)` chain; throws for anything else, so a typo cannot pass a contrast check. */
export function tokenHex(value: string, depth = 0): string {
  const v = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toUpperCase();
  const ref = /^var\((--mf-[a-z0-9-]+)\)$/.exec(v);
  if (!ref || depth > 8) throw new Error(`Cannot resolve colour "${value}"`);
  const next = load().get(ref[1]);
  if (next === undefined) throw new Error(`Unknown token ${ref[1]}`);
  return tokenHex(next, depth + 1);
}
