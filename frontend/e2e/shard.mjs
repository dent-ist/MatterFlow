#!/usr/bin/env node
// Balanced split of the chromium spec FILES over the CI shards (E2E B0, #1357, epic #1356).
//
// Playwright's own `--shard=i/n` splits by test count, which does not balance by time (one shard got six tests of 17 minutes, another 200 tests of
// 2 seconds). This script assigns whole spec files with the greedy longest-processing-time rule on e2e/shard-weights.json (seconds per file):
// heaviest file first, always into the shard with the least load so far; ties go to the lower shard number. A file that is not in the weights
// file (a new spec) gets the median weight. The result depends only on the files and the weights, so every job computes the same split.
//
//   node e2e/shard.mjs 3 12            the spec files of shard 3 of 12, one per line (names relative to e2e/tests)
//   node e2e/shard.mjs 3 12 --args     the same as Playwright arguments on one line: --project=chromium e2e/tests/a.spec.ts e2e/tests/b.spec.ts ...
//   node e2e/shard.mjs --plan 12       every shard with its files, predicted minutes and total (what the docs show)
//   node e2e/shard.mjs --refresh r1.json r2.json ...   rewrite shard-weights.json from Playwright JSON reports (e2e/summary.mjs input)
//
// Not in any shard: app-settings.spec.ts (project `branding`, own job, it changes the application name for everybody) and sensitive-*.spec.ts (own
// job with the go-live switch on; run-local.sh turns that switch on whenever an argument contains `sensitive-`, so these files must never ride along).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const testsDir = path.join(here, 'tests');
const weightsFile = path.join(here, 'shard-weights.json');

export const excluded = (f) => f === 'app-settings.spec.ts' || f.startsWith('sensitive-');

export function specFiles() {
  return fs
    .readdirSync(testsDir)
    .filter((f) => f.endsWith('.spec.ts') && !excluded(f))
    .sort();
}

export function loadWeights() {
  return JSON.parse(fs.readFileSync(weightsFile, 'utf8')).weights;
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? 1 : s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** @returns {{files: string[], seconds: number}[]} one entry per shard (index 0 is shard 1). */
export function plan(count, files = specFiles(), weights = loadWeights()) {
  const fallback = median(Object.values(weights));
  const weighted = files
    .map((f) => ({ f, w: weights[f] ?? fallback }))
    .sort((a, b) => b.w - a.w || (a.f < b.f ? -1 : 1));
  const shards = Array.from({ length: count }, () => ({ files: [], seconds: 0 }));
  for (const { f, w } of weighted) {
    let best = shards[0];
    for (const s of shards) if (s.seconds < best.seconds) best = s;
    best.files.push(f);
    best.seconds += w;
  }
  for (const s of shards) s.files.sort();
  return shards;
}

function refresh(reports) {
  const seconds = {};
  const walk = (suite, file) => {
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        if (t.projectName !== 'chromium') continue;
        const f = path.basename(spec.file ?? file);
        seconds[f] = (seconds[f] ?? 0) + (t.results ?? []).reduce((a, r) => a + (r.duration ?? 0), 0) / 1000;
      }
    }
    for (const child of suite.suites ?? []) walk(child, child.file ?? file);
  };
  for (const r of reports) for (const s of JSON.parse(fs.readFileSync(r, 'utf8')).suites ?? []) walk(s, s.file);
  const doc = JSON.parse(fs.readFileSync(weightsFile, 'utf8'));
  const next = {};
  for (const f of specFiles()) {
    // a file that no report ran keeps its old weight
    next[f] = f in seconds ? Math.max(1, Math.round(seconds[f])) : (doc.weights[f] ?? undefined);
  }
  doc.weights = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined));
  doc._comment = doc._comment.filter((l) => !l.startsWith('Refreshed'));
  doc._comment.splice(8, 0, `Refreshed ${new Date().toISOString().slice(0, 10)} from ${reports.length} Playwright JSON report(s): sum of the durations of all attempts per file.`);
  fs.writeFileSync(weightsFile, JSON.stringify(doc, null, 1) + '\n');
  console.log(`weights written for ${Object.keys(doc.weights).length} files`);
}

function main(argv) {
  const args = argv.filter((a) => !a.startsWith('--'));
  if (argv[0] === '--refresh') return refresh(argv.slice(1));
  if (argv[0] === '--plan') {
    const n = Number(argv[1]);
    plan(n).forEach((s, i) =>
      console.log(`shard ${i + 1} of ${n}: ${s.files.length} files, predicted ${(s.seconds / 60).toFixed(1)} min`),
    );
    return;
  }
  const [i, n] = args.map(Number);
  if (!Number.isInteger(i) || !Number.isInteger(n) || i < 1 || i > n) {
    console.error('usage: node e2e/shard.mjs <index> <count> [--args] | --plan <count> | --refresh <report.json...>');
    process.exit(2);
  }
  const files = plan(n)[i - 1].files;
  if (argv.includes('--args')) console.log(['--project=chromium', ...files.map((f) => `e2e/tests/${f}`)].join(' '));
  else console.log(files.join('\n'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
