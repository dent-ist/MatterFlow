import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';
import { TaskApi } from '../support/tasks';
import { dateInZone, FIRM_ZONE } from '../support/time';

/**
 * Screenshot run for docs/ux/dashboard-trends-types and docs/ux/dashboard-review-2/fixes/wp8a and wp8b (not a test: skipped unless E2E_SCREENSHOTS is set to the output folder, and it needs
 * the docker SQL Server of the stack because tasks are back-dated over 30 days in the database, which the API cannot do):
 *   E2E_SCREENSHOTS=docs/ux/dashboard-review-2/fixes/wp8b frontend/e2e/run-local.sh -g "trends screenshots"
 * Seeds 10 task types and about 150 tasks, back-dates their created, completed and due dates, then takes the Trends tab at 1366x768, 1920x1080, 768x1024 and 375x812.
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
  test.use({ hasTouch: true });
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
    const worker = await seed.user(['Data Technician'], 'trendshot');

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
              ...(done ? { assignedUserId: worker.userId } : {}),
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
       CROSS APPLY (SELECT CASE WHEN t.rn % 3 = 0 THEN (t.rn * 211) % 120000 + 60 ELSE (t.rn * 211) % 40000 + 60 END AS age) a;
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
    const shot = async (name: string, keepScroll = false) => {
      if (!keepScroll) {
        await page.getByRole('heading', { name: 'Dashboard', level: 1 }).scrollIntoViewIfNeeded();
      }
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(OUT!, `${name}.png`) });
    };
    const top = types.map((t) => t.name);

    for (const [w, h] of [
      [1366, 768],
      [1920, 1080],
      [375, 812],
      [320, 700],
    ]) {
      await page.setViewportSize({ width: w, height: h });
      await page.addInitScript(() => localStorage.clear());
      await page.goto('/dashboard?tab=trends');
      await ready(page);
      await shot(`01-default-${w}`);

      // On a phone the list is folded behind Compare task types.
      const toggle = page.locator('[data-compare-toggle]');
      if (await toggle.count()) await toggle.click();
      // Three types: All task types is hidden for scale, the type lines use the plot.
      await box(page, top[0]).check();
      await box(page, top[1]).check();
      await box(page, top[2]).check();
      await expect(lines(page)).toHaveCount(6);
      await shot(`02-three-types-${w}`);
      await page.locator('[data-plot]').focus();
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('ArrowLeft');
      await shot(`03-tooltip-${w}`);

      for (const name of top.slice(3, 8)) await box(page, name).check();
      await expect(lines(page)).toHaveCount(16);
      await shot(`04-eight-types-${w}`);
      // The legend list scrolls on its own and the chart stays in view (sticky from 1000 px).
      await page.locator('[data-type-list]').evaluate((e) => e.scrollTo(0, e.scrollHeight));
      await page.mouse.wheel(0, 400);
      await shot(`05-sticky-scrolled-${w}`, true);
      await page.evaluate(() => window.scrollTo(0, 0));

      await box(page, top[8]).click();
      await expect(page.locator('[data-limit-msg]')).toContainText('Pick up to 8');
      await page.locator('[data-limit-msg]').scrollIntoViewIfNeeded();
      await shot(`06-limit-message-${w}`, true);

      await page.getByRole('button', { name: /View as table/ }).click();
      await expect(page.locator('tbody tr').first()).toBeVisible();
      await shot(`07-table-8-types-${w}`);
      await page.getByRole('button', { name: /View as chart/ }).click();

      await page.locator('[data-clear]').click();
      await expect(
        page.locator('[data-measure="flows"] [data-measure-option="both"]'),
      ).toBeChecked();
      await shot(`08-measure-both-${w}`);
      const measure = w < 600 ? page.locator('[data-measure-select="flows"]') : null;
      if (measure) await measure.selectOption('onTime');
      else await page.locator('[data-measure-option="onTime"]').check();
      await expect(
        page.locator('[data-measure-option="onTime"], [data-measure-select]').first(),
      ).toBeAttached();
      await shot(`09-measure-on-time-${w}`);

      // A legacy address: Overdue per task type lives in the backlog panel.
      await page.goto(
        `/dashboard?tab=trends&types=${types[0].id},${types[1].id},${types[2].id}&metric=overdue`,
      );
      await ready(page);
      await shot(`10-legacy-overdue-types-${w}`);

      // Open at end of day per task type, and the weekly view of a long period.
      await page.goto(
        `/dashboard?tab=trends&types=${types[0].id},${types[1].id},${types[2].id}&bmetric=open`,
      );
      await ready(page);
      await shot(`11-open-per-type-${w}`);
      await page.goto('/dashboard?tab=trends&period=90d');
      await ready(page);
      await expect(page.locator('[data-per-week]')).toHaveCount(2);
      await shot(`12-weekly-90d-${w}`);
      await page.locator('[data-plot]').focus();
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('ArrowLeft');
      await shot(`13-weekly-tooltip-${w}`);
      await page.getByRole('button', { name: /View as table/ }).click();
      await expect(page.locator('tbody tr').first()).toBeVisible();
      await shot(`14-weekly-table-${w}`);
      if (w < 500) {
        await page.goto('/dashboard?tab=trends');
        await ready(page);
        const plot = (await page.locator('[data-panel-plot="flows"]').boundingBox())!;
        await page.touchscreen.tap(plot.x + plot.width * 0.5, plot.y + plot.height / 2);
        await shot(`15-tap-tooltip-${w}`);
        await page.locator('[data-compare-toggle]').tap();
        await shot(`16-compare-open-${w}`, true);
      }
    }
  });
});
