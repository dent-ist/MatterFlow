#!/usr/bin/env node
/**
 * Contrast check of the design tokens (UI-01, #954). Reads docs/ux/tokens.css, resolves var() references and checks every documented pairing:
 * text 4.5:1 (WCAG 1.4.3), graphics and focus rings 3:1 (1.4.11). `--table` prints the markdown table used by docs/ux/theme-guide.md.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const css = readFileSync(join(root, '..', 'docs', 'ux', 'tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const tokens = {};
for (const m of css.matchAll(/(--mf-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
  if (!(m[1] in tokens)) tokens[m[1]] = m[2].trim(); // first definition = the light theme
}

function resolve(name, depth = 0) {
  if (depth > 8) throw new Error(`Alias loop at ${name}`);
  const v = tokens[name];
  if (v === undefined) throw new Error(`Unknown token ${name}`);
  const ref = /^var\((--mf-[a-z0-9-]+)\)$/.exec(v);
  return ref ? resolve(ref[1], depth + 1) : v;
}

const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => {
  const x = lum(a);
  const y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

const pairs = []; // [label, foreground token, background token, minimum]
const text = 4.5;
const graphic = 3;
for (const h of ['overdue', 'risk', 'info', 'healthy', 'person', 'critical', 'neutral']) {
  pairs.push([`${h} text on its tint`, `--mf-sem-${h}-fg`, `--mf-sem-${h}-bg`, text]);
  pairs.push([`${h} text on a card`, `--mf-sem-${h}-fg`, '--mf-surface', text]);
  pairs.push([`${h} solid (dot, bar, icon) on a card`, `--mf-sem-${h}-solid`, '--mf-surface', graphic]);
}
for (const s of ['new', 'progress', 'hold', 'done', 'cancel']) {
  pairs.push([`status ${s} text on its chip`, `--mf-status-${s}-fg`, `--mf-status-${s}-bg`, text]);
  pairs.push([`status ${s} text on a card`, `--mf-status-${s}-fg`, '--mf-surface', text]);
}
for (const e of ['court', 'trial', 'deposition', 'production', 'filing', 'mediation', 'meeting', 'other']) {
  pairs.push([`event ${e} icon and text on its tint`, `--mf-event-${e}-fg`, `--mf-event-${e}-bg`, text]);
}
pairs.push(
  ['nav text on the panel', '--mf-nav-text', '--mf-nav-bg', text],
  ['nav muted text and ADMINISTRATION heading on the panel', '--mf-nav-heading', '--mf-nav-bg', text],
  ['nav text on hover', '--mf-nav-text', '--mf-nav-hover-bg', text],
  ['nav muted text on hover', '--mf-nav-text-muted', '--mf-nav-hover-bg', text],
  ['nav selected text on the white pill', '--mf-nav-selected-fg', '--mf-nav-selected-bg', text],
  ['nav focus ring on the panel', '--mf-nav-focus', '--mf-nav-bg', graphic],
  ['nav focus ring on hover', '--mf-nav-focus', '--mf-nav-hover-bg', graphic],
  ['text on the page', '--mf-text', '--mf-bg', text],
  ['muted text on the page', '--mf-text-muted', '--mf-bg', text],
  ['muted text on a card', '--mf-text-muted', '--mf-surface', text],
  ['link and primary on a card', '--mf-primary', '--mf-surface', text],
  ['white text on primary', '--mf-primary-contrast', '--mf-primary', text],
  ['tooltip text', '--mf-tip-fg', '--mf-tip-bg', text],
  ['active-matter dot on a card', '--mf-active', '--mf-surface', graphic],
  ['focus ring on the page', '--mf-focus', '--mf-bg', graphic],
  ['focus ring on a card', '--mf-focus', '--mf-surface', graphic],
  ['input border on a card', '--mf-border-strong', '--mf-surface', graphic],
);

const rows = [];
let failed = 0;
for (const [label, fg, bg, min] of pairs) {
  const r = ratio(resolve(fg), resolve(bg));
  const ok = r >= min;
  if (!ok) failed++;
  rows.push({ label, fg, bg, r, min, ok });
}

if (process.argv.includes('--table')) {
  console.log('| Pairing | Foreground | Background | Ratio | Needs |\n| --- | --- | --- | --- | --- |');
  for (const x of rows) console.log(`| ${x.label} | \`${x.fg}\` ${resolve(x.fg)} | \`${x.bg}\` ${resolve(x.bg)} | ${x.r.toFixed(1)}:1 | ${x.min}:1 |`);
  process.exit(0);
}
for (const x of rows.filter((y) => !y.ok)) console.error(`FAIL ${x.label}: ${x.fg} on ${x.bg} is ${x.r.toFixed(2)}:1, needs ${x.min}:1`);
if (failed > 0) process.exit(1);
console.log(`Theme contrast check passed (${rows.length} pairings).`);
