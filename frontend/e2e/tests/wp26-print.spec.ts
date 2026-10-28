import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';
import { dateInZone, FIRM_ZONE } from '../support/time';

/**
 * Print (TQ-WP26, #215, BUG-TQ6 and TQ39): the Task Queue, My Work and Pod Work print the grid and nothing around it. Print emulation
 * hides the shell and the controls, a line says the page, sort, "Page 1 of 2, 60 tasks, showing 1-50" and when it was printed, rows and
 * group dividers are never split, the header row repeats, the two-line Due cell prints both lines and 50 rows fit in two sheets (A4
 * portrait) or four (landscape). Screenshots and PDFs go to E2E_SCREENSHOTS when set (docs/ux/task-queue-review/fixes/wp-print).
 */
const OUT = process.env['E2E_SCREENSHOTS'];

async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

/** Number of sheets in a PDF (the page tree objects are `/Type /Page` without the `s`). */
function sheets(pdf: Buffer): number {
  return (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
}

/** The words on one sheet of a PDF (poppler's pdftotext), or null where poppler is not installed. */
function sheetText(file: string, sheet: number): string | null {
  try {
    return execFileSync('pdftotext', ['-f', String(sheet), '-l', String(sheet), file, '-'], {
      encoding: 'utf8',
    });
  } catch {
    return null;
  }
}

async function pdf(page: Page, name: string, landscape: boolean): Promise<number> {
  const buffer = await page.pdf({ format: 'A4', landscape, printBackground: true });
  const dir = OUT ?? fs.mkdtempSync(path.join(os.tmpdir(), 'wp26-'));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.pdf`);
  fs.writeFileSync(file, buffer);
  // The header row is printed again at the top of the second sheet (the Assignee header is on no row).
  const second = sheetText(file, 2);
  if (second !== null) expect(second, `${name}: the header row repeats`).toContain('Assignee');
  return sheets(buffer);
}

/** Whole-page checks that hold for every list: nothing of the shell is visible and the table rules are set. */
async function expectCleanPrint(page: Page): Promise<void> {
  for (const sel of [
    '.mf-header',
    '.mf-nav',
    '.wl-footrow',
    'mf-pager',
    '.fbar',
    '.mf-filter-row',
    '.wt-resize',
    'mf-quick-views',
    'mf-work-strip',
    '.wp-tabrow',
    '[data-page-actions]',
    '[data-assign-link]',
  ]) {
    const visible = await page.locator(sel).evaluateAll((els) =>
      els.some((e) => {
        const s = getComputedStyle(e);
        return s.display !== 'none' && s.visibility !== 'hidden' && e.getClientRects().length > 0;
      }),
    );
    expect(visible, `${sel} is hidden in print`).toBe(false);
  }
  const rules = await page.evaluate(() => {
    const row = document.querySelector('tbody tr[data-task]') as HTMLElement;
    const head = document.querySelector('.wt thead') as HTMLElement;
    return {
      row: getComputedStyle(row).breakInside,
      head: getComputedStyle(head).display,
      layout: getComputedStyle(document.querySelector('.wt') as HTMLElement).tableLayout,
      exact: getComputedStyle(row.querySelector('td') as HTMLElement).getPropertyValue(
        'print-color-adjust',
      ),
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  expect(rules.row).toBe('avoid');
  expect(rules.head).toBe('table-header-group');
  expect(rules.layout).toBe('fixed');
  expect(rules.exact).toBe('exact');
  expect(rules.overflowX, 'nothing sticks out sideways').toBeLessThanOrEqual(1);
}

test.describe('Print (#215)', () => {
  test('BUG-TQ6 / TQ39: Task Queue, My Work and Pod Work print as a clean grid', async ({
    seed,
    asUser,
  }) => {
    test.setTimeout(240_000);
    const world = await seed.world();
    const tag = uid();
    const me = await seed.user(['Data Technician'], 'wp26-print');
    for (let i = 0; i < 60; i++) {
      await seed.task(world, {
        title: `Print ${String(i).padStart(2, '0')} ${tag}`,
        assignedUserId: me.userId,
        dueDate: dateInZone(FIRM_ZONE, i % 4 === 0 ? -5 - i : i - 3),
      });
    }
    const pod = await seed.pod(`Print ${tag}`, [me.userId]);
    for (let i = 0; i < 3; i++) {
      await seed.task(world, { title: `Pod ${i} ${uid()}`, assignedPodId: pod.podId });
    }
    const page = await asUser('ke\\kekim');
    await page.setViewportSize({ width: 1366, height: 768 });

    // --- Task Queue ----------------------------------------------------------------------------------------------------------
    await page.goto(`/tasks?q=${tag}&sort=due&dir=asc`);
    await expect(page.getByRole('heading', { name: 'Task Queue', level: 1 })).toBeVisible();
    await expect(page.locator('tbody tr[data-task]')).toHaveCount(50);
    // Screen: the print line is not there.
    await expect(page.locator('[data-print-line]')).toBeHidden();
    await page.emulateMedia({ media: 'print' });
    await expectCleanPrint(page);
    const line = page.locator('[data-print-line]');
    await expect(line).toBeVisible();
    await expect(line.locator('[data-print-page]')).toHaveText('Task Queue');
    await expect(line.locator('[data-print-sort]')).toHaveText('Sorted by Due date, soonest first');
    await expect(line.locator('[data-print-count]')).toHaveText(
      'Page 1 of 2, 60 tasks, showing 1-50',
    );
    await expect(line.locator('[data-print-when]')).toHaveText(
      /^Printed [A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2} [AP]M E[SD]T$/,
    );
    await expect(page.locator('[data-filter-print]')).toBeVisible();
    // The Due cell prints both lines.
    const due = page.locator('tbody tr[data-task] td[data-col="due"]').first();
    await expect(due.locator('.dc-l1')).toBeVisible();
    await expect(due.locator('.dc-l2')).toBeVisible();
    // An overdue row says so in words, not only in colour.
    await expect(page.locator('[data-due-tone="overdue"] .dc-l2').first()).toContainText(
      /overdue/i,
    );
    await shot(page, 'print-task-queue-1366');
    const portrait = await pdf(page, 'task-queue-a4-portrait', false);
    const landscape = await pdf(page, 'task-queue-a4-landscape', true);
    expect(portrait, '50 rows are at most two sheets in portrait').toBeLessThanOrEqual(2);
    expect(landscape, '50 rows are at most four sheets in landscape').toBeLessThanOrEqual(4);

    // The second page says so.
    await page.emulateMedia({ media: 'screen' });
    await page.goto(`/tasks?q=${tag}&sort=due&dir=asc&page=2`);
    await expect(page.locator('tbody tr[data-task]')).toHaveCount(10);
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('[data-print-count]')).toHaveText(
      'Page 2 of 2, 60 tasks, showing 51-60',
    );

    // --- grouped by Due: the dividers print and stay with their rows ----------------------------------------------------------
    await page.emulateMedia({ media: 'screen' });
    await page.goto(`/tasks?q=${tag}&sort=due&dir=asc`);
    await expect(page.locator('tr.wt-group').first()).toBeVisible();
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('tr.wt-group').first()).toBeVisible();
    expect(
      await page
        .locator('tr.wt-group')
        .first()
        .evaluate((e) => getComputedStyle(e).breakInside),
    ).toBe('avoid');
    await pdf(page, 'task-queue-grouped-a4-portrait', false);

    // --- My Work and Pod Work share the grid ---------------------------------------------------------------------------------
    for (const [url, name] of [
      ['/my-work', 'My Work'],
      [`/pods/work?podId=${pod.podId}`, 'Pod Work'],
    ]) {
      await page.emulateMedia({ media: 'screen' });
      await page.goto(url);
      await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
      await expect(page.locator('tbody tr[data-task], tbody td').first()).toBeVisible();
      await page.emulateMedia({ media: 'print' });
      await expectCleanPrint(page);
      await expect(page.locator('[data-print-page]')).toContainText(name);
      await expect(page.locator('[data-print-when]')).toBeVisible();
      await shot(page, `print-${name.toLowerCase().replace(' ', '-')}-1366`);
    }

    // --- the screen is unchanged and the standard page check passes ---------------------------------------------------------------
    await page.emulateMedia({ media: 'screen' });
    await page.goto(`/tasks?q=${tag}`);
    await expect(page.locator('tbody tr[data-task]').first()).toBeVisible();
    await expect(page.locator('.mf-header')).toBeVisible();
    if (axeAvailable()) expect(await axeViolations(page), 'axe on the Task Queue').toEqual([]);
  });
});
