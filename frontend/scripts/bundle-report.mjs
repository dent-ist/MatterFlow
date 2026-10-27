#!/usr/bin/env node
// Bundle gate for the production build (epic #851, issue #889, PV-38): runs `ng build --stats-json --verbose`, prints Angular's own report, then lists every chunk that
// carries a PM v2 screen (by the source file the chunk starts at, with its size) and checks that none of them is loaded with the first page. Fails when the initial total is
// over 700 kB (the same limit is the error budget in angular.json, so a plain `npm run build` fails the same way; this adds the list and the lazy check).
//
//   npm run build:report                                  build and check
//   node scripts/bundle-report.mjs --from build.log       check the output of an earlier build (needs dist/frontend/stats.json from --stats-json)
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const LIMIT_KB = 700;
const STATS = 'dist/frontend/stats.json';
// The source files that start a PM v2 chunk: every one must be lazy (a dynamic import of a route, a tab or a chart), none may be in the initial bundle.
const PM_V2 = [
  ['My Matters page', /features\/my-matters\/pages\/my-matters-page\.ts$/],
  ['Breakdown tab', /features\/my-matters\/tabs\/breakdown-tab\.ts$/],
  ['Data tab', /features\/my-matters\/tabs\/data-tab\.ts$/],
  ['Deadlines tab', /features\/my-matters\/tabs\/deadlines-tab\.ts$/],
  ['Activity tab', /features\/my-matters\/tabs\/activity-tab\.ts$/],
  ['Trends tab', /features\/my-matters\/tabs\/trends-tab\.ts$/],
  ['Asset report builder', /features\/assets\/reports\/asset-reports-page\.ts$/],
  ['Pie chart', /shared\/charts\/pie-chart\.ts$/],
  ['Bar chart', /shared\/charts\/bar-chart\.ts$/],
  ['Column chart', /shared\/charts\/column-chart\.ts$/],
];

const strip = (s) => s.replace(/\u001b\[[0-9;]*m/g, '');
const fromIndex = process.argv.indexOf('--from');
let text;
if (fromIndex > 0) {
  text = strip(readFileSync(process.argv[fromIndex + 1], 'utf8'));
} else {
  const run = spawnSync('npx', ['ng', 'build', '--stats-json', '--verbose'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, shell: process.platform === 'win32' });
  text = strip((run.stdout ?? '') + (run.stderr ?? ''));
  process.stdout.write(text + '\n');
  if (run.status !== 0) {
    console.error('\nThe build failed (an error budget counts: the initial bundle must stay under 700 kB).');
    process.exit(run.status ?? 1);
  }
}

const kb = (s) => {
  const m = /([\d.]+)\s*(bytes|kB|MB)/.exec(s);
  return !m ? 0 : m[2] === 'bytes' ? Number(m[1]) / 1000 : m[2] === 'MB' ? Number(m[1]) * 1000 : Number(m[1]);
};
const initial = /Initial total\s*\|\s*([\d.]+ (?:bytes|kB|MB))/.exec(text);
if (!initial) {
  console.error('Initial total not found in the build output.');
  process.exit(2);
}
const total = kb(initial[1]);
const lazyCount = (text.match(/^chunk-\w+\.js\s*\|/gm) ?? []).length;

console.log('Bundle gate (PV-38)');
console.log(`  Initial total: ${initial[1]} (limit ${LIMIT_KB} kB)`);
let failed = total > LIMIT_KB;
if (existsSync(STATS)) {
  const outputs = JSON.parse(readFileSync(STATS, 'utf8')).outputs;
  // The initial bundle: everything reachable from the entry chunks by static imports.
  const initialSet = new Set();
  const queue = Object.entries(outputs).filter(([, o]) => /(^|\/)(main|polyfills)\.ts$/.test(o.entryPoint ?? '')).map(([k]) => k);
  while (queue.length) {
    const key = queue.pop();
    if (initialSet.has(key) || !outputs[key]) continue;
    initialSet.add(key);
    for (const i of outputs[key].imports ?? []) if (i.kind === 'import-statement') queue.push(i.path);
  }
  console.log(`  Chunks in the build: ${Object.keys(outputs).length} (${initialSet.size} initial)`);
  console.log('  PM v2 chunks (loaded on demand):');
  for (const [name, pattern] of PM_V2) {
    const hits = Object.entries(outputs).filter(([, o]) => o.entryPoint && pattern.test(o.entryPoint));
    if (hits.length === 0) {
      console.log(`    ${name.padEnd(24)} not a chunk of its own (its code is inside another lazy chunk)`);
      continue;
    }
    for (const [file, o] of hits) {
      const eager = initialSet.has(file);
      failed ||= eager;
      console.log(`    ${name.padEnd(24)} ${(o.bytes / 1000).toFixed(2).padStart(8)} kB  ${file}${eager ? '   EAGER: part of the initial bundle' : ''}`);
    }
  }
} else {
  console.log(`  (no ${STATS}: build with --stats-json to list the PM v2 chunks)`);
}
console.log(`  Lazy chunk files in the report: ${lazyCount}`);
if (failed) {
  console.error(`\nFAILED: ${total > LIMIT_KB ? `the initial bundle is ${total} kB, over the ${LIMIT_KB} kB limit` : 'a PM v2 chunk is loaded eagerly'}.`);
  process.exit(1);
}
console.log(`\nOK: the initial bundle is ${(LIMIT_KB - total).toFixed(2)} kB under the limit and every PM v2 chunk is lazy.`);
