import { mmWorld } from '../support/my-matters-fixtures';
import { expect, test } from '../support/fixtures';

/**
 * PM v2 lane G (epic #851): Export and Copy of the filtered lists (#879). A list export is not a status report: no layout, no narrative, no schedule.
 */
test.describe('Export (#879)', () => {
  test('Export downloads the filtered Task Queue as a CSV, copies it as text, is formula-safe and is audited', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await seed.world();
    await seed.task(world, { title: '=HYPERLINK("http://x","click")' });
    await seed.task(world, { title: 'Plain, with a comma' });
    await seed.task(world, { title: 'Third' });
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(`/tasks?matter=${world.matter.matterId}`);
    await expect(page.locator('tbody tr[data-task]')).toHaveCount(3);

    const trigger = page.locator('[data-export-menu] [data-overflow]');
    await expect(trigger).toHaveAttribute('aria-label', /not a status report/);
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: 'Download CSV' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Copy as text' })).toBeVisible();
    const download = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'Download CSV' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('task-queue.csv');
    const bytes = await (await import('node:fs/promises')).readFile((await file.path())!);
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const lines = bytes
      .toString('utf8')
      .replace(/^\uFEFF/, '')
      .split('\r\n')
      .filter(Boolean);
    expect(lines).toHaveLength(4); // the header and exactly the three rows on screen
    expect(lines[0]).toMatch(/^Task,Title,Matter,/);
    const body = lines.slice(1).join('\n');
    expect(body).toContain(`"'=HYPERLINK(""http://x"",""click"")"`);
    expect(body).toContain('"Plain, with a comma"');
    await expect(page.locator('[data-export-status]')).toContainText('Downloaded 3 rows.');

    await trigger.click();
    await page.getByRole('menuitem', { name: 'Copy as text' }).click();
    await expect(page.locator('[data-export-status]')).toContainText('Copied 3 rows.');
    const pasted = await page.evaluate(() => navigator.clipboard.readText());
    const rows = pasted.split('\n').filter(Boolean);
    expect(rows).toHaveLength(4);
    expect(rows[0].split('\t').length).toBeGreaterThan(10);

    // Both exports are in the audit log (surface, count, filters; no data).
    const found = await admin.get('/api/v1/audit/search?eventType=EXPORT_RUN&pageSize=50');
    const mine = JSON.stringify(found).includes(`matter=${world.matter.matterId}`);
    expect(mine, 'the EXPORT_RUN event names the filters').toBe(true);
    expect(JSON.stringify(found)).not.toContain('HYPERLINK');
  });

  test('Export of an empty list is unavailable with a reason, and the Breakdown exports what the table shows', async ({
    page,
    seed,
    personas,
    asUser,
    admin,
  }) => {
    await page.goto('/tasks?matter=99999999');
    await page.locator('[data-export-menu] [data-overflow]').click();
    await expect(page.getByRole('menuitem', { name: 'Download CSV' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );

    const w = await mmWorld(seed, personas, 'ex');
    const a = await w.matter('Alpha');
    await w.task(a, { dueDate: '2000-01-01' });
    await w.task(a);
    const pm = await asUser(w.pm.username);
    await pm.goto('/my-matters?tab=breakdown');
    await expect(pm.locator('table[data-bd-table="matrix"]')).toBeVisible();
    // Export is inside the tab's Options menu (issue #911).
    await pm.locator('[data-panel=breakdown] [data-options-trigger]').click();
    const download = pm.waitForEvent('download');
    await pm.locator('[data-panel=breakdown] [data-export=csv]').click();
    const file = await download;
    const text = (await (await import('node:fs/promises')).readFile((await file.path())!))
      .toString('utf8')
      .replace(/^\uFEFF/, '');
    const lines = text.split('\r\n').filter(Boolean);
    expect(lines[0]).toMatch(/^Matter,Matter name,Client,/);
    expect(lines).toHaveLength(2); // header and the one matter: a single matter has no "All matters" row (issue #911)
    expect(lines[1]).toContain(a.matterRef);
    await expect(pm.locator('[data-panel=breakdown] [data-export-status]')).toContainText(
      'Downloaded 1 row.',
    );
    // The browser-side export is audited too (surface, count; no data).
    await expect
      .poll(async () =>
        JSON.stringify(await admin.get('/api/v1/audit/search?eventType=EXPORT_RUN&pageSize=50')),
      )
      .toMatch(/Exported 1 rows? of my-matters\.breakdown/);
  });
});
