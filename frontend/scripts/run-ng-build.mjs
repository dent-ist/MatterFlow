// Runs `ng build` and makes sure the run ENDS (issue #1354).
//
// Why: after the production build has written its output and printed `Output location: ...`, the `ng` process stays alive (the esbuild
// service and its workers keep running), the same hang as `ng test` (#1353). CI sat in the "Production build" step until the job time
// limit (run 580: cancelled after 13 minutes of idling), so the frontend job never gave a verdict.
//
// How: the output of `ng` is passed through unchanged and watched for the success line `Output location:`. When the process ends by itself,
// its exit code is used. When it is still alive GRACE_MS after that line, only the process group started here is stopped and the verdict is
// taken from the output. The step FAILS when
//   - `ng` exits with a non-zero code (compile error, a bundle budget set to "error"),
//   - an `[ERROR]` line was printed (the bundle size budgets are checked by `ng build` itself: a budget with the severity error shows up as one),
//   - no `Output location:` line is seen, or
//   - there is no such line within RUN_LIMIT_MS (a real hang).
// Warnings (for example the budget warnings) do not fail the step, exactly as with a plain `ng build`.
// Usage: node scripts/run-ng-build.mjs [<extra ng build arguments>]
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ngBin = join(root, 'node_modules', '@angular', 'cli', 'bin', 'ng.js');
const GRACE_MS = Number(process.env.NG_BUILD_GRACE_MS ?? 15_000);
const RUN_LIMIT_MS = Number(process.env.NG_BUILD_RUN_LIMIT_MS ?? 10 * 60_000);
const extra = process.argv.slice(2);

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

const child = spawn(process.execPath, [ngBin, 'build', ...extra], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: process.platform !== 'win32',
  env: {
    ...process.env,
    CI: process.env.CI ?? 'true',
    FORCE_COLOR: process.env.FORCE_COLOR ?? '1',
  },
});

let pending = '';
let sawOutput = false;
let settled = false;
let graceTimer;
const problems = [];

const finish = (ok, why) => {
  if (settled) return;
  settled = true;
  clearTimeout(graceTimer);
  clearTimeout(limitTimer);
  console.log(`\n[run-ng-build] ${ok ? 'PASSED' : 'FAILED (' + why + ')'}`);
  process.exit(ok ? 0 : 1);
};

const inspect = (rawLine) => {
  const line = stripAnsi(rawLine);
  if (/\[ERROR\]/.test(line)) problems.push(line.trim());
  if (/^\s*Output location:/.test(line)) {
    sawOutput = true;
    // The build is complete. Errors are printed before this line. If `ng` does not end by itself soon, it is the known hang: stop it.
    graceTimer = setTimeout(() => {
      console.log(
        `\n[run-ng-build] build finished, ng still running after ${GRACE_MS / 1000}s (known hang, #1354): stopping its process tree.`,
      );
      killTree(child);
      finish(problems.length === 0, `build reports: ${problems.join(' | ')}`);
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
  if (sawOutput) return;
  console.error(
    `\n[run-ng-build] no "Output location" line within ${RUN_LIMIT_MS / 60_000} minutes: stopping it.`,
  );
  killTree(child);
  finish(false, 'no build result within the time limit (real hang)');
}, RUN_LIMIT_MS);

child.on('error', (err) => finish(false, `could not start ng: ${err.message}`));
child.on('exit', (code, signal) => {
  if (pending) inspect(pending);
  if (settled) return;
  if (code === 0 && problems.length === 0 && sawOutput) return finish(true, 'ok');
  if (code === 0)
    return finish(
      false,
      problems.length > 0
        ? `build reports: ${problems.join(' | ')}`
        : 'ng exited 0 but printed no "Output location" line',
    );
  finish(false, `ng exited with ${code ?? signal}`);
});
