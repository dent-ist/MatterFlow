#!/usr/bin/env node
// Markdown summary of one Playwright JSON report for the job summary of GitHub Actions (E2E B0, #1357):
// passed / failed / flaky / skipped / did not run, the failed and flaky tests, and the slowest 10 tests.
//
//   node e2e/summary.mjs <results.json> [title]      writes to $GITHUB_STEP_SUMMARY when it is set, else to the console
//
// "Did not run" is a test with no attempt at all (Playwright stops the rest of a serial group after its first failure, or the run was cut off by
// the step limit); "skipped" is a test that started and skipped itself (test.skip).
import fs from 'node:fs';

const [file, title = 'Playwright'] = process.argv.slice(2);
if (!file) {
  console.error('usage: node e2e/summary.mjs <results.json> [title]');
  process.exit(2);
}

const tests = [];
const walk = (suite, titles) => {
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests ?? []) {
      const results = t.results ?? [];
      tests.push({
        project: t.projectName,
        where: `${spec.file}:${spec.line}`,
        title: [...titles, spec.title].filter(Boolean).join(' › '),
        status: t.status,
        attempts: results.length,
        seconds: results.reduce((a, r) => a + (r.duration ?? 0), 0) / 1000,
      });
    }
  }
  for (const child of suite.suites ?? []) walk(child, child.title && child.title !== suite.file ? [...titles, child.title] : titles);
};

let report = null;
try {
  report = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (e) {
  report = null;
}

const lines = [];
if (report === null) {
  lines.push(`### ${title}`, '', `No JSON report at \`${file}\` (the run stopped before Playwright wrote it, for example at the step time limit).`, '');
} else {
  for (const s of report.suites ?? []) walk(s, []);
  const count = { passed: 0, failed: 0, flaky: 0, skipped: 0, didNotRun: 0 };
  for (const t of tests) {
    if (t.status === 'expected') count.passed++;
    else if (t.status === 'unexpected') count.failed++;
    else if (t.status === 'flaky') count.flaky++;
    else if (t.attempts === 0) count.didNotRun++;
    else count.skipped++;
  }
  const minutes = ((report.stats?.duration ?? 0) / 60000).toFixed(1);
  const cell = (s) => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ').slice(0, 170);
  lines.push(
    `### ${title}`,
    '',
    `${tests.length} tests in ${minutes} min`,
    '',
    '| passed | failed | flaky | skipped | did not run |',
    '|---:|---:|---:|---:|---:|',
    `| ${count.passed} | ${count.failed} | ${count.flaky} | ${count.skipped} | ${count.didNotRun} |`,
    '',
  );
  const listed = (label, status) => {
    const rows = tests.filter((t) => t.status === status);
    if (rows.length === 0) return;
    lines.push(`<details><summary>${label} (${rows.length})</summary>`, '');
    for (const t of rows.slice(0, 50)) lines.push(`- \`${t.where}\` ${cell(t.title)}`);
    if (rows.length > 50) lines.push(`- ... and ${rows.length - 50} more`);
    lines.push('', '</details>', '');
  };
  listed('Failed', 'unexpected');
  listed('Flaky', 'flaky');
  if (count.didNotRun > 0) {
    const files = [...new Set(tests.filter((t) => t.status === 'skipped' && t.attempts === 0).map((t) => t.where.split(':')[0]))];
    lines.push(`Did not run: ${files.map((f) => `\`${f}\``).join(', ')}`, '');
  }
  lines.push('Slowest 10 tests', '', '| seconds | test |', '|---:|---|');
  for (const t of [...tests].sort((a, b) => b.seconds - a.seconds).slice(0, 10)) {
    lines.push(`| ${t.seconds.toFixed(1)} | \`${t.where}\` ${cell(t.title)} |`);
  }
  lines.push('');
}

const text = lines.join('\n');
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + '\n');
else console.log(text);
