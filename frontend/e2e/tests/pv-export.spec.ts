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

  test('Export of an empty list is unavailable with a reason', async ({ page }) => {
    await page.goto('/tasks?matter=99999999');
    await page.locator('[data-export-menu] [data-overflow]').click();
    await expect(page.getByRole('menuitem', { name: 'Download CSV' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });
});
