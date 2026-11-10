// Runs `ng test <project> --watch=false` for each project given on the command line and makes sure the run ENDS (issue #1353).
//
// Why: with the Angular unit-test builder (Vitest) the `frontend` run prints its summary and then the `ng` process stays alive
// (worker threads keep running), so CI sat in the step until the job time limit and the later steps (client drift check,
// production build) never ran. The `form-engine` run is not affected.
//
// How: the output of `ng` is passed through unchanged and watched for the Vitest summary (`Test Files`, `Tests`, `Duration`).
// When the process ends by itself, its exit code is used. When it is still alive GRACE_MS after the `Duration` line, only the
// process tree started here is stopped and the verdict is taken from the summary. The step FAILS when
//   - `ng` exits with a non-zero code (build error, failed test, unhandled error),
//   - the summary reports failed tests, failed files or errors (an unhandled error or rejection),
//   - no summary with at least one passed test is seen (nothing ran, or the run died), or
//   - there is no summary within RUN_LIMIT_MS (a real hang).
// Usage: node scripts/run-ng-test.mjs frontend form-engine [-- <extra ng test arguments>]
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ngBin = join(root, 'node_modules', '@angular', 'cli', 'bin', 'ng.js');
const GRACE_MS = Number(process.env.NG_TEST_GRACE_MS ?? 20_000);
const RUN_LIMIT_MS = Number(process.env.NG_TEST_RUN_LIMIT_MS ?? 12 * 60_000);

const args = process.argv.slice(2);
const split = args.indexOf('--');
const projects = split === -1 ? args : args.slice(0, split);
const extra = split === -1 ? [] : args.slice(split + 1);
if (projects.length === 0) {
  console.error('usage: node scripts/run-ng-test.mjs <project> [<project> ...] [-- <extra ng test arguments>]');
  process.exit(2);
}

// eslint-disable-next-line no-control-regex
const stripAnsi = (text) => text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');

function killTree(child) {
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      process.kill(-child.pid, 'SIGKILL'); // the process group created below, nothing else
    }
  } catch {
    // already gone
  }
}

function runProject(project) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [ngBin, 'test', project, '--watch=false', ...extra], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      env: { ...process.env, CI: process.env.CI ?? 'true', FORCE_COLOR: process.env.FORCE_COLOR ?? '1' },
    });

    let pending = '';
    let passed = 0;
    const problems = [];
    let sawTests = false;
    let sawDuration = false;
    let settled = false;
    let graceTimer;

    const finish = (ok, why) => {
      if (settled) return;
      settled = true;
      clearTimeout(graceTimer);
      clearTimeout(limitTimer);
      resolve({ project, ok, why });
    };

    const inspect = (rawLine) => {
      const line = stripAnsi(rawLine);
      let m;
      if ((m = /^\s*Tests\s+(.*)$/.exec(line))) {
        sawTests = true;
        const p = /(\d+) passed/.exec(m[1]);
        passed = p ? Number(p[1]) : 0;
        if (/\d+ (failed|errored)/.test(m[1])) problems.push(line.trim());
      } else if ((m = /^\s*Test Files\s+(.*)$/.exec(line))) {
        if (/\d+ (failed|errored)/.test(m[1])) problems.push(line.trim());
      } else if (/^\s*Errors\s+\d+ errors?/.test(line) || /Unhandled (Errors?|Rejection)/i.test(line)) {
        problems.push(line.trim());
      } else if (/^\s*Duration\s+\d/.test(line) && sawTests) {
        sawDuration = true;
        // The summary is complete. If `ng` does not end by itself soon, it is the known hang: stop it.
        graceTimer = setTimeout(() => {
          console.log(`\n[run-ng-test] ${project}: summary printed, ng still running after ${GRACE_MS / 1000}s (known hang, #1353): stopping its process tree.`);
          killTree(child);
          const ok = problems.length === 0 && passed > 0;
          finish(ok, ok ? 'ok' : problems.length > 0 ? `summary reports: ${problems.join(' | ')}` : 'no passed tests in the summary');
        }, GRACE_MS);
      }
    };

    const onData = (stream) => (chunk) => {
      stream.write(chunk);
      pending += chunk.toString();
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';
      lines.forEach(inspect);
    };
    child.stdout.on('data', onData(process.stdout));
    child.stderr.on('data', onData(process.stderr));

    const limitTimer = setTimeout(() => {
      if (sawDuration) return;
      console.error(`\n[run-ng-test] ${project}: no test summary within ${RUN_LIMIT_MS / 60_000} minutes: stopping it.`);
      killTree(child);
      finish(false, 'no summary within the time limit (real hang)');
    }, RUN_LIMIT_MS);

    child.on('error', (err) => finish(false, `could not start ng: ${err.message}`));
    child.on('exit', (code, signal) => {
      if (pending) inspect(pending);
      if (settled) return;
      if (code === 0 && problems.length === 0 && sawDuration && passed > 0) return finish(true, 'ok');
      if (code === 0 && !(sawDuration && passed > 0)) return finish(false, 'ng exited 0 but printed no summary with passed tests');
      finish(false, code === 0 ? `summary reports: ${problems.join(' | ')}` : `ng exited with ${code ?? signal}`);
    });
  });
}

const results = [];
for (const project of projects) {
  console.log(`\n[run-ng-test] ng test ${project} --watch=false`);
  results.push(await runProject(project));
}
console.log('');
for (const r of results) console.log(`[run-ng-test] ${r.project}: ${r.ok ? 'PASSED' : 'FAILED (' + r.why + ')'}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
