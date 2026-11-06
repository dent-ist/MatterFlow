#!/usr/bin/env node
/**
 * Off-scale check (UI update 2, #1155, rules D-01 and D-23): component styles use the token scales and nothing else.
 *  - border-radius: 0, 50%, 4 px (--mf-radius), 8 px (--mf-radius-lg), 12 px (--mf-radius-xl), 999 px (--mf-radius-pill), or a var(...)
 *  - font-size: 12, 13, 14, 16, 18, 22, 24, 32 px, or a var(...) / inherit (never rem or em, never 10, 11, 11.5, 12.5, 13.5, 15, 17, 19, 26 ...)
 *  - font-weight: 400, 600, 700, normal, inherit, or a var(...) (never 500 or 800)
 *  - the 6 px --mf-radius-md token is retired (#1229); a use of it fails here as an undefined token (6 px lives in --mf-nav-item-radius only)
 *  - a --mf-fs-*, --mf-radius-* or --mf-fw-* token must exist in docs/ux/tokens.css
 *  - text-transform: uppercase only in the files of ALLOW_UPPERCASE (grid column headings and the navigation section label, D-23)
 * Scans src/ and projects/ (ts, html, scss, css; specs and generated files are skipped). A line with `off-scale-ok: <reason>` (or the line right after a comment line
 * that has it) is not counted. LEDGER lists what is left on purpose, per file and rule, with the reason; the check fails when a file has more than its ledger count,
 * and when a ledger entry is no longer needed. Run by `npm run lint`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const roots = ['src', 'projects'];
const exts = new Set(['.ts', '.html', '.scss', '.css']);
const skip = (p) => /\.spec\.ts$/.test(p) || p.includes(`${sep}generated${sep}`) || /\.generated\.ts$/.test(p) || p.includes('node_modules');

/** Grid column headings (D-23) and the navigation section label: the only places with capitals. */
const ALLOW_UPPERCASE = new Set([
  'src/app/shared/ui/page.scss',
  'src/app/shared/ui/grid-frame.ts',
  'src/app/shared/work-queue/task-table.scss',
  'src/app/shared/layout/app-shell.scss',
  'src/app/features/admin/admin-lookup.scss',
  'src/app/features/admin/holidays/holidays-admin.ts',
  'src/app/features/admin/holidays/import-dialog.ts',
  'src/app/features/admin/roles/roles-page.scss',
  'src/app/features/admin/pods/pods-page.scss',
  'src/app/features/my-matters/ui/metrics-work.ts',
  'src/app/features/clients/pages/client-overview.scss',
  'src/app/features/pod-work/ui/pod-member-table.scss',
  'src/app/features/dashboard/users/users-table.ts',
  'src/app/features/dashboard/users/skills-view.ts',
  'src/styles/_admin-lists.scss',
]);

/** What is left on purpose: `file|rule` -> [count, reason]. */
const LEDGER = {
  'src/app/shared/charts/pie-chart.ts|font-size': [1, 'SVG centre figure of the pie chart (chart internals, out of scope of #1155)'],
  'src/app/features/dashboard/ui/trend-chart.ts|font-size': [1, 'SVG end-of-line labels of the trend chart (chart internals)'],
  'src/app/features/dashboard/summary/dash-gauge.ts|font-size': [1, 'SVG tick numbers of the gauge (chart internals)'],
  'src/app/features/dashboard/swimlane/swimlane-card.ts|font-size': [1, 'a 7 px glyph inside the 12 px out-of-office dot; no token fits the dot (needs the designer)'],
};

const tokensCss = readFileSync(join(root, '..', 'docs', 'ux', 'tokens.css'), 'utf8');
const DEFINED = new Set([...tokensCss.matchAll(/(--mf-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));

const RADIUS_OK = /^(0|50%|4px|8px|12px|999px)$/;
const FS_OK = /^(12|13|14|16|18|22|24|32)px$/;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

/** Offences of one file as `{ rule, line, text }`. Exported for the unit test of the check itself. */
export function offences(file, text) {
  const out = [];
  let inBlock = false;
  let prevOk = false;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const marked = line.includes('off-scale-ok');
    const ok = marked || prevOk;
    prevOk = marked && /^\s*(<!--|\/\/|\/\*)/.test(line);
    if (ok) continue;
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
    for (const m of line.matchAll(/border-radius:\s*([^;}]+)/g)) {
      const stripped = m[1].replace(/var\((?:[^()]|\([^()]*\))*\)/g, ' ').replace(/!important/, '');
      const values = stripped.trim().split(/\s+/).filter((v) => v && v !== '/');
      if (values.some((v) => !RADIUS_OK.test(v))) out.push({ rule: 'border-radius', line: i + 1, text: m[0].trim() });
    }
    for (const m of line.matchAll(/(?<![-\w])font-size:\s*([^;}]+)/g)) {
      const v = m[1].trim().replace(/\s*!important/, '');
      if (v.startsWith('var(') || v === 'inherit' || v === 'initial' || v === '0' || v.startsWith('calc(') || v.startsWith('clamp(')) continue;
      if (!FS_OK.test(v)) out.push({ rule: 'font-size', line: i + 1, text: m[0].trim() });
    }
    for (const m of line.matchAll(/(?<![-\w])font-weight:\s*([^;}]+)/g)) {
      const v = m[1].trim().replace(/\s*!important/, '');
      if (v.startsWith('var(') || v === 'inherit' || v === 'normal' || v === 'initial') continue;
      if (!/^(400|600|700)$/.test(v)) out.push({ rule: 'font-weight', line: i + 1, text: m[0].trim() });
    }
    // A size token that does not exist falls back to its literal (or to nothing): fs-body, fs-xl and radius-sm were such tokens.
    for (const m of line.matchAll(/var\((--mf-(?:fs|radius|fw)-[a-z0-9-]+)/g)) {
      if (!DEFINED.has(m[1])) out.push({ rule: 'undefined-token', line: i + 1, text: m[1] });
    }
    if (/text-transform:\s*uppercase/.test(line) && !ALLOW_UPPERCASE.has(file)) out.push({ rule: 'uppercase', line: i + 1, text: line.trim() });
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const found = new Map();
  for (const r of roots) {
    for (const p of walk(join(root, r))) {
      const ext = p.slice(p.lastIndexOf('.'));
      if (!exts.has(ext) || skip(p)) continue;
      const rel = relative(root, p).split(sep).join('/');
      for (const o of offences(rel, readFileSync(p, 'utf8'))) {
        const key = `${rel}|${o.rule}`;
        if (!found.has(key)) found.set(key, []);
        found.get(key).push(o);
      }
    }
  }
  const failures = [];
  for (const [key, list] of found) {
    const allowed = LEDGER[key]?.[0] ?? 0;
    if (list.length > allowed) {
      for (const o of list) failures.push(`${key.split('|')[0]}:${o.line}  ${o.rule}  ${o.text}`);
    }
  }
  for (const [key, [n]] of Object.entries(LEDGER)) {
    if ((found.get(key)?.length ?? 0) < n) failures.push(`${key}: the ledger allows ${n}, fewer are left; remove or lower the ledger entry`);
  }
  if (failures.length) {
    console.error('Off-scale check failed (D-01, D-23): use the tokens (radius 4/8/12/pill, font 12/13/14/16/18/22/24/32, weight 400/600/700), capitals only on grid headings.\n' + failures.join('\n'));
    process.exit(1);
  }
  console.log(`Off-scale check passed (${Object.keys(LEDGER).length} ledger entries).`);
}
