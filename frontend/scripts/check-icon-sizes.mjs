// Icon size guard (US-06, #1097; extended to features by #1133): in shared code and in feature code (src/app/shared, src/app/features and src/styles) the font-size of an icon (`.pi` or a selector that names an icon) must come from the
// shared icon tokens (`--mf-icon-xs|sm|md|lg` in docs/ux/tokens.css), never a number. Run by `npm run lint`.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOTS = ['src/app/shared', 'src/app/features', 'src/styles'];
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|scss)$/.test(name) && !/\.spec\.ts$/.test(name)) files.push(p);
  }
})(ROOTS[0]);
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|scss)$/.test(name) && !/\.spec\.ts$/.test(name)) files.push(p);
  }
})(ROOTS[1]);
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|scss)$/.test(name)) files.push(p);
  }
})(ROOTS[2]);

const ICON_SELECTOR = /(\.pi\b|\.pi-|__icon|-icon\b|\bicon\b)/i;
const offenders = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  // Rules `selector { declarations }` (nesting is not used in these files).
  for (const m of text.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim();
    if (!ICON_SELECTOR.test(selector)) continue;
    const size = /(?:^|[;\s])(?:font-size|width|height)\s*:\s*([^;]+)/g;
    for (const d of m[2].matchAll(size)) {
      const prop = d[0].trim().split(':')[0].trim();
      if (prop !== 'font-size') continue;
      const value = d[1].trim();
      if (!/var\(--mf-icon-(xs|sm|md|lg)\)/.test(value) && !/^(inherit|1em|0\.9em)$/.test(value) && !/var\(--mf-nav-icon\)/.test(value)) {
        const line = text.slice(0, m.index + m[0].indexOf(d[0])).split('\n').length;
        offenders.push(`${file}:${line}  ${selector.replace(/\s+/g, ' ')}  font-size: ${value}`);
      }
    }
  }
}
if (offenders.length > 0) {
  console.error('Icon sizes must use the shared tokens (--mf-icon-xs, -sm, -md, -lg):\n' + offenders.join('\n'));
  process.exit(1);
}
console.log('Icon size check passed (' + files.length + ' shared files).');
