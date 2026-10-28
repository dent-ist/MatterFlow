// The optional "aged" step of the demo seeder (--aged, issue #925).
//
// The API creates every task "now", so no task could be At risk (80 percent of the type's target turnaround must have passed since the task
// was created) and no task could have been On hold for days. This step moves two dates of Demo tasks back with a few UPDATE statements inside
// the SQL Server container of the local development database. It is the only place where the seeder writes to the database directly,
// so it is opt-in and guarded:
//   - only for a local API (localhost / 127.0.0.1), and only the database named MatterFlow in the named container;
//   - only tasks whose requestor name carries the demo marker "[demo <tag>]" (the seeder puts it on every task it creates);
//   - only tasks that still have today's dates (a task that was aged before is not moved again), so it is safe to run twice.
// Nothing here is used by the application, by CI or by the e2e suite (which has its own helper in frontend/e2e/support/seed.ts).

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Calendar days between now and the instant the 80 percent rule starts to apply, per target day (1,152 minutes; see AtRiskRules). */
const MINUTES_PER_TARGET_DAY = 1152;

export function sqlFromOptions(opts) {
  return {
    container: opts.sqlContainer,
    password: opts.sqlPassword,
  };
}

/** Runs one T-SQL batch in the container and returns the text sqlcmd printed. */
export async function sql(target, statement) {
  const { stdout } = await run(
    'docker',
    [
      'exec',
      target.container,
      '/opt/mssql-tools18/bin/sqlcmd',
      '-C',
      '-I', // QUOTED_IDENTIFIER on: dbo.Task has filtered indexes
      '-S',
      'localhost',
      '-U',
      'sa',
      '-P',
      target.password,
      '-d',
      'MatterFlow',
      '-b',
      '-h',
      '-1',
      '-W',
      '-Q',
      statement,
    ],
    { maxBuffer: 4 * 1024 * 1024 },
  );
  return stdout;
}

export function assertLocal(apiUrl) {
  const host = new URL(apiUrl).hostname;
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host))
    throw new Error(
      `--aged writes to the database of the local development container, so the API must be on localhost (it is ${host}).`,
    );
}

/**
 * Moves the dates of Demo tasks back so the screens have something to show.
 *  - On hold: the hold started 3, 9, 14 or 21 days ago (in turn, by task id), so there are holds under and over the 7-day line; the persona
 *    hold ("[persona hold]") 10 days ago.
 *  - At risk: every third open (New / In Progress) Demo task that is not overdue and whose type has a target turnaround is moved back to
 *    just past 80 percent of the target (plus up to 47 hours), so it is At risk and not yet overdue (a task due within a day is left alone).
 * Every Demo task that still has fresh dates is considered; the persona tasks of the seeder ("[persona risk]") are always moved to At risk.
 * Returns how many tasks were moved, per kind.
 */
export async function ageDemoTasks(target) {
  const demo = `t.RequestorName LIKE N'%[[]demo %'`;
  const fresh = `t.StatusChangedAt >= DATEADD(HOUR, -12, SYSUTCDATETIME())`;
  const statement = `
SET NOCOUNT ON;
DECLARE @hold INT = 0, @risk INT = 0;

;WITH held AS (
  SELECT t.TaskId, ROW_NUMBER() OVER (ORDER BY t.TaskId) AS r
  FROM dbo.Task t
  WHERE t.StatusCode = 'ON_HOLD' AND ${demo} AND ${fresh}
)
UPDATE t SET StatusChangedAt = DATEADD(DAY, -CASE WHEN t.RequestorName LIKE N'%[[]persona hold]%' THEN 10 ELSE CASE h.r % 4 WHEN 0 THEN 9 WHEN 1 THEN 14 WHEN 2 THEN 3 ELSE 21 END END, SYSUTCDATETIME())
FROM dbo.Task t JOIN held h ON h.TaskId = t.TaskId;
SET @hold = @@ROWCOUNT;

;WITH eligible AS (
  SELECT t.TaskId, ty.TargetDays, CASE WHEN t.RequestorName LIKE N'%[[]persona risk]%' THEN 1 ELSE 0 END AS Persona, ROW_NUMBER() OVER (ORDER BY t.TaskId) AS r
  FROM dbo.Task t JOIN dbo.TaskType ty ON ty.TaskTypeId = t.TaskTypeId
  WHERE t.StatusCode IN ('NEW', 'IN_PROGRESS') AND ${demo} AND ty.TargetDays IS NOT NULL
    AND t.CreatedAt >= DATEADD(HOUR, -12, SYSUTCDATETIME())
    AND (t.DueSortKey IS NULL OR t.DueSortKey > DATEADD(DAY, 1, SYSUTCDATETIME()))
)
UPDATE t SET CreatedAt = DATEADD(MINUTE, -(e.TargetDays * ${MINUTES_PER_TARGET_DAY} + 60 * (e.r % 48)), SYSUTCDATETIME())
FROM dbo.Task t JOIN eligible e ON e.TaskId = t.TaskId
WHERE e.r % 3 = 0 OR e.Persona = 1;
SET @risk = @@ROWCOUNT;

SELECT CONCAT(@hold, ' ', @risk);`;
  const out = (await sql(target, statement)).trim().split(/\s+/);
  return { onHold: Number(out[0]) || 0, atRisk: Number(out[1]) || 0 };
}
