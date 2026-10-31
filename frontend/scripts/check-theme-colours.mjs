#!/usr/bin/env node
/**
 * Theme colour check (UI-01, #954): new code must not hard-code colours; it uses the design tokens (docs/ux/tokens.css, docs/ux/theme-guide.md).
 *
 * Scans src/ and projects/ (ts, html, scss, css; specs and generated files are skipped) for hex colours (#RRGGBB, #RRGGBBAA, and #RGB in
 * stylesheets) and rgb()/rgba()/hsl()/hsla() literals outside comments. Existing files are listed in scripts/theme-colours-baseline.json with
 * their current count: such a file may use fewer literals (the ledger shrinks as pages convert) but never more, and a file that is not in the
 * ledger may have none. Run `node scripts/check-theme-colours.mjs --update` ONLY when a page was converted (counts went down) to rewrite the ledger.
 * A line with `theme-colour-ok: <reason>` is not counted (data colours that cannot be a token, for example a user-picked palette).
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const baselinePath = join(root, 'scripts', 'theme-colours-baseline.json');
const roots = ['src', 'projects'];
const exts = new Set(['.ts', '.html', '.scss', '.css']);
const skip = (p) => /\.spec\.ts$/.test(p) || p.includes(`${sep}generated${sep}`) || /\.generated\.ts$/.test(p) || p.includes('node_modules');

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

const hex6 = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b/g;
const hex3 = /#[0-9a-fA-F]{3}\b/g;
const fn = /\b(?:rgb|rgba|hsl|hsla)\(/g;

export function countColours(file, text) {
  const style = file.endsWith('.scss') || file.endsWith('.css');
  let n = 0;
  let inBlock = false;
  for (const raw of text.split('\n')) {
    let line = raw;
    if (line.includes('theme-colour-ok')) continue;
    if (inBlock) {
      if (!line.includes('*/')) continue;
      line = line.slice(line.indexOf('*/') + 2);
      inBlock = false;
    }
    line = line.replace(/\/\*.*?\*\//g, '');
    if (line.includes('/*')) {
      line = line.slice(0, line.indexOf('/*'));
      inBlock = true;
    }
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('<!--')) continue;
    n += (line.match(hex6) ?? []).length + (line.match(fn) ?? []).length;
    if (style) n += (line.match(hex3) ?? []).length;
  }
  return n;
}

const found = {};
for (const r of roots) {
  const dir = join(root, r);
  try { statSync(dir); } catch { continue; }
  for (const p of walk(dir)) {
    const ext = p.slice(p.lastIndexOf('.'));
    if (!exts.has(ext) || skip(p)) continue;
    const n = countColours(p, readFileSync(p, 'utf8'));
    if (n > 0) found[relative(root, p).split(sep).join('/')] = n;
  }
}

if (process.argv.includes('--update')) {
  const sorted = Object.fromEntries(Object.entries(found).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(baselinePath, JSON.stringify(sorted, null, 2) + '\n');
  console.log(`Baseline written: ${Object.keys(sorted).length} files.`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const problems = [];
for (const [file, n] of Object.entries(found)) {
  const allowed = baseline[file] ?? 0;
  if (n > allowed) {
    problems.push(`${file}: ${n} hard-coded colour(s), ${allowed} allowed. Use a design token (var(--mf-...)); see docs/ux/theme-guide.md.`);
  }
}
if (problems.length > 0) {
  console.error('Hard-coded colours found:\n' + problems.join('\n'));
  process.exit(1);
}
console.log(`Theme colour check passed (${Object.keys(found).length} legacy files within their ledger).`);
