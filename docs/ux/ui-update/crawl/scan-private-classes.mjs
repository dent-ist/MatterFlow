// Inventory of private chip and link class families in component styles (UI update 2, #1130 and #1132).
// Usage: node docs/ux/ui-update/crawl/scan-private-classes.mjs [--list]   (run from the repo root)
// A "private chip" is a CSS rule in a component whose selector names a class containing chip|badge|pill|tag as a word part AND whose body paints a pill or a fill
// (border-radius or background). A "private link" is a rule for a class named lnk|link|linkbtn|link-btn|lnk-btn|pg-link|ov-link|... that underlines or uses the link colour.
// The same logic runs as a unit test in frontend/src/app/shared/ui/private-classes.spec.ts (the guard).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(process.cwd(), 'frontend', 'src', 'app');
const files = [];
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|scss)$/.test(f) && !/\.spec\.ts$/.test(f)) files.push(p);
  }
})(ROOT);

const CHIP_WORD = /(^|[-_])(chip|chips|chipk|badge|badges|pill|pills|tag|tags|hchip|achip)($|[-_])|chip|badge|pill/;
const LINK_WORD = /^(lnk|link|linkbtn|link-btn|lnk-btn|lnk-)|(^|[-_])(lnk|link|linkbtn)($|[-_])|^(pg-link|ov-link|tc)$/;
// The shared chip components themselves: their own inner class names are the shared look, not a private one (same list as the guard).
const SHARED_KINDS = new Set([
  'shared/ui/badge.ts',
  'shared/ui/status-chip.ts',
  'shared/ui/filter-chips.ts',
  'shared/ui/priority-badge.ts',
  'shared/ui/priority-pill.ts',
  'shared/ui/task-type-chip.ts',
]);
const rules = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const css = file.endsWith('.scss') ? text : [...text.matchAll(/styles:\s*(?:\[\s*)?`([\s\S]*?)`/g)].map((m) => m[1]).join('\n');
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const selector = m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim();
    const body = m[2];
    for (const cls of new Set([...selector.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((x) => x[1]))) {
      if (CHIP_WORD.test(cls) && /border-radius|background/.test(body) && !/^mf-/.test(cls)) { if (!SHARED_KINDS.has(relative(ROOT, file))) rules.push({ kind: 'chip', file: relative(ROOT, file), cls }); }
      if (LINK_WORD.test(cls) && /text-decoration|--mf-link/.test(body) && !/^mf-/.test(cls)) rules.push({ kind: 'link', file: relative(ROOT, file), cls });
    }
  }
}
const fam = (kind) => {
  const set = new Map();
  for (const r of rules.filter((x) => x.kind === kind)) set.set(`${r.file} .${r.cls}`, r);
  return [...set.keys()].sort();
};
for (const kind of ['chip', 'link']) {
  const l = fam(kind);
  console.log(`${kind}: ${l.length} (file, class) pairs in ${new Set(l.map((x) => x.split(' ')[0])).size} files`);
  if (process.argv.includes('--list')) l.forEach((x) => console.log('  ' + x));
}
