import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';
import { TaskApi } from '../support/tasks';
import { dateInZone, FIRM_ZONE } from '../support/time';

/**
 * Screenshot run for docs/ux/dashboard-trends-types (not a test: skipped unless E2E_SCREENSHOTS is set to the output folder, and it needs
 * the docker SQL Server of the stack because tasks are back-dated over 30 days in the database, which the API cannot do):
 *   E2E_SCREENSHOTS=docs/ux/dashboard-trends-types frontend/e2e/run-local.sh -g "trends screenshots"
 * Seeds 10 task types and about 150 tasks, back-dates their created, completed and due dates, then takes the Trends tab at 1366x768 and 375x812.
 */
const OUT = process.env['E2E_SCREENSHOTS'];
const SQL_PASSWORD = 'MatterFlow_Dev1!';

const NAMES = [
  'Data Processing',
  'Collection',
  'Review Set',
  'Production',
  'Redaction',
  'Quality Control',
  'Archive',
  'Hosting',
  'Privilege Log',
  'Search Terms',
];

/** Runs SQL in the stack's container (the one whose database holds this run's tasks). */
function sql(query: string, tag?: string): string | null {
  const names = execFileSync(
    'docker',
    ['ps', '--filter', 'name=mf-e2e-sql', '--format', '{{.Names}}'],
    { encoding: 'utf8' },
  )
    .split('\n')
    .filter(Boolean);
  for (const name of names) {
    const run = (q: string) =>
      execFileSync(
        'docker',
        [
          'exec',
          name,
          '/opt/mssql-tools18/bin/sqlcmd',
          '-C',
          '-I',
          '-S',
          'localhost',
          '-U',
          'sa',
          '-P',
          SQL_PASSWORD,
          '-d',
          'MatterFlow',
          '-h',
          '-1',
          '-W',
          '-Q',
          q,
        ],
        { encoding: 'utf8' },
      );
    if (tag) {
      const found = run(
        `SET NOCOUNT ON; SELECT COUNT(*) FROM dbo.Task WHERE Title LIKE N'Trend shot ${tag}%'`,
      ).trim();
      if (!(Number(found) > 0)) continue;
    }
    return run(query);
  }
  return null;
}

test.describe('trends screenshots', () => {
  test.skip(!OUT, 'set E2E_SCREENSHOTS to the output folder');

  test('capture', async ({ page, admin, seed }) => {
    test.setTimeout(900_000);
    fs.mkdirSync(OUT!, { recursive: true });
    const tag = uid();
    const world = await seed.world();
    const types = [{ id: world.taskType.id, name: NAMES[0] }];
    for (let i = 1; i < NAMES.length; i++) {
      const t = await seed.taskType({ name: `${NAMES[i]} ${tag}`, workflows: [world.workflow] });
      types.push({ id: t.id, name: `${NAMES[i]} ${tag}` });
    }
    const me = await admin.get<{ userId: number }>('/api/v1/me');

    // Task counts fall from the first type to the last; every second task is assigned and completed.
    const jobs: { type: number; n: number }[] = [];
    types.forEach((t, i) => {
      for (let n = 0; n < 24 - i * 2 - (i > 7 ? 2 : 0); n++)
        jobs.push({ type: t.id, n: jobs.length });
    });
    for (let start = 0; start < jobs.length; start += 4) {
      await Promise.all(
        jobs.slice(start, start + 4).map(async (job) => {
          const done = job.n % 2 === 0;
          const created = await seed.task(
            { ...world, taskType: { ...world.taskType, id: job.type } },
            {
              title: `Trend shot ${tag} ${String(job.n).padStart(3, '0')}`,
              dueDate: dateInZone(FIRM_ZONE, (job.n % 9) - 3),
              ...(done ? { assignedUserId: me.userId } : {}),
            },
          );
          if (done) {
            const api = new TaskApi(admin, created.taskId);
            await api.completeSteps(1, 2, 3);
            const result = await api.complete();
            if (result.status >= 300) throw new Error(`complete -> ${result.status}`);
          }
        }),
      );
    }

    // Spread the tasks over the last 28 days.
    const out = sql(
      `SET NOCOUNT ON;
       ;WITH t AS (SELECT TaskId, ROW_NUMBER() OVER (ORDER BY TaskId) AS rn FROM dbo.Task WHERE Title LIKE N'Trend shot ${tag}%')
       UPDATE k SET
         CreatedAt = DATEADD(MINUTE, -a.age, SYSUTCDATETIME()),
         StatusChangedAt = CASE WHEN k.StatusCode = 'COMPLETED' THEN DATEADD(MINUTE, a.age - ((t.rn * 97) % (a.age + 1)), DATEADD(MINUTE, -a.age, SYSUTCDATETIME())) ELSE DATEADD(MINUTE, -a.age, SYSUTCDATETIME()) END,
         CompletedAt = CASE WHEN k.StatusCode = 'COMPLETED' THEN DATEADD(MINUTE, a.age - ((t.rn * 97) % (a.age + 1)), DATEADD(MINUTE, -a.age, SYSUTCDATETIME())) ELSE NULL END,
         DueDate = CASE WHEN t.rn % 6 = 0 THEN NULL ELSE CAST(DATEADD(DAY, ((t.rn * 5) % 12) - 3, DATEADD(MINUTE, -a.age, SYSUTCDATETIME())) AS DATE) END,
         DueAtUtc = NULL,
         DueSortKey = CASE WHEN t.rn % 6 = 0 THEN NULL ELSE DATEADD(MILLISECOND, 86399999, CAST(CAST(DATEADD(DAY, ((t.rn * 5) % 12) - 3, DATEADD(MINUTE, -a.age, SYSUTCDATETIME())) AS DATE) AS DATETIME2(3))) END
       FROM dbo.Task k JOIN t ON t.TaskId = k.TaskId
       CROSS APPLY (SELECT (t.rn * 211) % 40000 + 60 AS age) a;
       SELECT @@ROWCOUNT;`,
      tag,
    );
    expect(out, 'a stack container holding the seeded tasks').not.toBeNull();
    expect(out, 'the back-dating UPDATE: ' + out).not.toMatch(/Msg \d+/);

    const lines = (p: Page) => p.locator('[data-plot] polyline.series:not(.partial)');
    const box = (p: Page, name: string) =>
      p.locator('[data-type]').filter({ hasText: name }).getByRole('checkbox');
    const ready = async (p: Page) => {
      await expect(p.locator('[data-plot]')).toBeVisible();
      await expect(p.locator('[data-trend-loading]')).toHaveCount(0);
    };
    const shot = async (name: string) => {
      await page.getByRole('heading', { name: 'Dashboard', level: 1 }).scrollIntoViewIfNeeded();
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(OUT!, `${name}.png`) });
    };
    const top = types.map((t) => t.name);

    for (const [w, h] of [
      [1366, 768],
      [375, 812],
    ]) {
      await page.setViewportSize({ width: w, height: h });
      await page.addInitScript(() => localStorage.clear());
      await page.goto('/dashboard?tab=trends');
      await ready(page);
      await shot(`01-all-only-${w}`);

      await box(page, top[0]).check();
      await box(page, top[1]).check();
      await box(page, top[2]).check();
      await expect(lines(page)).toHaveCount(4);
      await shot(`02-three-types-${w}`);
      await page.locator('[data-plot]').focus();
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('ArrowLeft');
      await shot(`03-tooltip-${w}`);

      for (const name of top.slice(3, 8)) await box(page, name).check();
      await expect(lines(page)).toHaveCount(9);
      await shot(`04-eight-types-${w}`);

      await box(page, top[8]).click();
      await expect(page.locator('[data-limit-msg]')).toContainText('Pick up to 8');
      await page.locator('[data-limit-msg]').scrollIntoViewIfNeeded();
      await shot(`05-limit-message-${w}`);

      await page.getByRole('button', { name: /View as table/ }).click();
      await expect(page.locator('tbody tr').first()).toBeVisible();
      await shot(`06-table-8-types-${w}`);
      await page.getByRole('button', { name: /View as chart/ }).click();

      await page.locator('[data-clear]').click();
      for (const name of top.slice(0, 3)) await box(page, name).check();
      await page.getByRole('radio', { name: 'Overdue' }).check();
      await expect(page.getByRole('heading', { name: /Overdue tasks/ })).toBeVisible();
      await shot(`07-three-types-overdue-${w}`);
      await page.getByRole('button', { name: /View as table/ }).click();
      await shot(`08-table-3-types-overdue-${w}`);
      await page.getByRole('button', { name: /View as chart/ }).click();

      await page.locator('[data-clear]').click();
      await page
        .getByRole('group', { name: 'Due dates' })
        .getByRole('checkbox', { name: 'Overdue' })
        .check();
      await page
        .getByRole('group', { name: 'Due dates' })
        .getByRole('checkbox', { name: 'On time' })
        .check();
      await page
        .getByRole('group', { name: 'Due dates' })
        .getByRole('checkbox', { name: 'Completed late' })
        .check();
      await expect(lines(page)).toHaveCount(5);
      await shot(`09-due-dates-${w}`);
    }
  });
});
