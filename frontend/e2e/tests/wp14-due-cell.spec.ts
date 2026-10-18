import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { TaskQueuePage } from '../pages/queues.pages';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';
import { dateInZone, FIRM_ZONE } from '../support/time';

/**
 * The shared two-line Due cell (TQ-WP14, #209, TQ15, TQ44): the eight states of describeDueCell on seeded tasks, exactly two lines at
 * Comfortable (18 px each, no gap) and one inline line at Compact, one spoken sentence per cell, the tooltip with the zone, a steady
 * 136 px column, tone contrast of 4.5:1 with a cue other than colour, axe at four sizes. Own tagged tasks only. Screenshots go to
 * E2E_SCREENSHOTS when it is set (docs/ux/task-queue-review/fixes/wp-due).
 */
const OUT = process.env['E2E_SCREENSHOTS'];

async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

async function axeClean(page: Page, what: string): Promise<void> {
  if (axeAvailable()) expect(await axeViolations(page), what).toEqual([]);
}

/** Calendar date and wall time (HH:mm) of an instant in the firm zone: what the create request expects. */
function inFirmZone(ms: number): { dueDate: string; dueTime: string } {
  const d = new Date(ms);
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: FIRM_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: FIRM_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(d);
  return { dueDate: date, dueTime: time };
}

const SIZES = [
  [1366, 768],
  [1920, 1080],
  [768, 1024],
  [375, 812],
] as const;

interface State {
  key: string;
  line2: string | RegExp | null;
  icon: string | null;
  tone: string;
}

const STATES: State[] = [
  { key: 'overdue6h', line2: 'Overdue 6h', icon: 'pi-exclamation-circle', tone: 'overdue' },
  { key: 'overdue3d', line2: 'Overdue 3d', icon: 'pi-exclamation-circle', tone: 'overdue' },
  { key: 'overdue120d', line2: 'Overdue 120d', icon: 'pi-exclamation-circle', tone: 'overdue' },
  { key: 'today', line2: 'Due today', icon: 'pi-clock', tone: 'today' },
  { key: 'tomorrow', line2: 'Tomorrow', icon: null, tone: 'soon' },
  { key: 'in2', line2: 'In 2 days', icon: null, tone: 'soon' },
  { key: 'later', line2: null, icon: null, tone: 'none' },
  { key: 'nextYear', line2: null, icon: null, tone: 'none' },
  { key: 'asap', line2: null, icon: 'pi-bolt', tone: 'asap' },
  { key: 'closed', line2: null, icon: null, tone: 'closed' },
];

test.describe('Due cell (#209)', () => {
  test('eight states on seeded tasks: two lines, one spoken sentence, tooltip, tone contrast, Due 136 px, axe at four sizes', async ({
    seed,
    page,
  }) => {
    test.setTimeout(180_000);
    const world = await seed.world();
    const tag = uid();
    const title = (k: string) => `Due ${k} ${tag}`;
    const now = Date.now();
    const make = (k: string, due: object) => seed.task(world, { title: title(k), ...due });
    await make('overdue6h', inFirmZone(now - 6 * 3600_000 - 60_000));
    await make('overdue3d', { dueDate: dateInZone(FIRM_ZONE, -3) });
    await make('overdue120d', { dueDate: dateInZone(FIRM_ZONE, -120) });
    await make('today', { dueDate: dateInZone(FIRM_ZONE, 0), dueTime: '23:59' });
    await make('tomorrow', { dueDate: dateInZone(FIRM_ZONE, 1) });
    await make('in2', { dueDate: dateInZone(FIRM_ZONE, 2) });
    await make('later', { dueDate: dateInZone(FIRM_ZONE, 20) });
    await make('nextYear', { dueDate: dateInZone(FIRM_ZONE, 400) });
    await make('asap', {});
    const done = await make('closed', { dueDate: dateInZone(FIRM_ZONE, -2) });
    seed.ageTask(Number(done['taskId']), { createdDaysAgo: 7, completedDaysAgo: 3 });

    const queue = new TaskQueuePage(page);
    for (const [width, height] of SIZES) {
      await page.setViewportSize({ width, height });
      await queue.open(`?q=${tag}&status=NEW&status=COMPLETED`);
      await expect(
        page.locator('tbody tr[data-task]', { hasText: title('asap') }).locator('.dc'),
      ).toBeVisible();
      // One round trip for the whole page: the machine running the suite is loaded.
      const facts = await page.evaluate(
        (needles) => {
          const lum = (c: string) => {
            const m = c.match(/[\d.]+/g)!.map(Number);
            const f = (v: number) => {
              const x = v / 255;
              return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
            };
            return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]);
          };
          const out: Record<string, unknown> = {};
          for (const [key, needle] of Object.entries(needles)) {
            const row = Array.from(document.querySelectorAll('tbody tr[data-task]')).find((r) =>
              r.textContent?.includes(needle),
            );
            const root = row?.querySelector('td[data-col="due"] .dc');
            if (!root) {
              out[key] = null;
              continue;
            }
            const l1 = root.querySelector('.dc-l1') as HTMLElement;
            const l2 = root.querySelector('.dc-l2') as HTMLElement | null;
            let bg = 'rgb(255, 255, 255)';
            for (let e: Element | null = root; e; e = e.parentElement) {
              const c = getComputedStyle(e).backgroundColor;
              if (!c.endsWith(', 0)') && c !== 'transparent') {
                bg = c;
                break;
              }
            }
            const ratio = Math.min(
              ...[l1, l2].filter(Boolean).map((t) => {
                const a = lum(getComputedStyle(t as Element).color);
                const b = lum(bg);
                return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
              }),
            );
            const r1 = l1.getBoundingClientRect();
            const r2 = l2?.getBoundingClientRect();
            out[key] = {
              tone: root.getAttribute('data-due-tone'),
              tip: root.getAttribute('title'),
              sr: root.querySelector('.dc-sr')?.textContent ?? '',
              l1: l1.textContent ?? '',
              l1Hidden: l1.getAttribute('aria-hidden'),
              l1H: Math.round(r1.height),
              l2: l2?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
              l2H: r2 ? Math.round(r2.height) : null,
              l2Gap: r2 ? Math.round(r2.top - r1.top) : null,
              l2W: r2 ? r2.width : null,
              l2Weight: l2 ? getComputedStyle(l2).fontWeight : null,
              icons: Array.from(root.querySelectorAll('.pi')).map((i) =>
                Array.from(i.classList).find((c) => c !== 'pi'),
              ),
              ratio,
            };
          }
          return out;
        },
        Object.fromEntries(STATES.map((s) => [s.key, title(s.key)])),
      );
      for (const s of STATES) {
        const f = facts[s.key] as {
          tone: string;
          tip: string;
          sr: string;
          l1: string;
          l1Hidden: string;
          l1H: number;
          l2: string | null;
          l2H: number | null;
          l2Gap: number | null;
          l2W: number | null;
          l2Weight: string | null;
          icons: string[];
          ratio: number;
        } | null;
        expect(f, `${s.key} is listed at ${width}`).not.toBeNull();
        if (!f) continue;
        expect(f.tone, `${s.key} tone`).toBe(s.tone);
        if (s.line2) {
          expect(f.l2, `${s.key} line 2`).toContain(s.line2);
          expect(f.l2Weight).toBe('700');
          // Exactly two lines of 18 px with no gap, and the longest text fits 136 px.
          expect(f.l2H).toBe(18);
          expect(f.l2Gap, `${s.key} no gap at ${width}`).toBe(18);
          expect(f.l2W, `${s.key} line 2 fits 136 px at ${width}`).toBeLessThanOrEqual(136);
        } else {
          expect(f.l2, `${s.key} has no line 2`).toBeNull();
        }
        expect(f.l1H, `${s.key} line 1 at ${width}`).toBe(18);
        if (s.icon) expect(f.icons, `${s.key} icon`).toEqual([s.icon]);
        else expect(f.icons).toEqual([]);
        // One spoken name: the sentence; the visible lines are hidden from assistive technology.
        expect(f.l1Hidden).toBe('true');
        expect(f.sr).toBeTruthy();
        expect(f.tip).toBeTruthy();
        if (s.key === 'overdue120d') expect(f.sr).toContain('overdue 120 days');
        if (s.key === 'overdue6h') expect(f.sr).toContain('overdue 6 hours');
        if (s.key === 'today') expect(f.tip).toContain('EDT');
        if (s.key === 'nextYear') expect(f.l1).toMatch(/, \d{4}$/);
        if (s.key === 'later') expect(f.l1).not.toMatch(/\d{4}/);
        // Tone colours reach 4.5:1 against the row.
        expect(f.ratio, `${s.key} contrast at ${width}`).toBeGreaterThanOrEqual(4.5);
      }
      // Due is 136 px at every size where the column shows (WP9).
      const th = page.locator('thead th[data-col="due"]');
      if (await th.count()) expect(Math.round((await th.boundingBox())!.width)).toBe(136);
      await shot(page, `due-cell-${width}x${height}`);
      await axeClean(page, `Due cell ${width}`);
    }
  });

  test('Compact shows the inline layout on one line; the cell name is the sentence in the accessibility tree', async ({
    seed,
    page,
  }) => {
    const world = await seed.world();
    const tag = uid();
    const late = await seed.task(world, {
      title: `Inline late ${tag}`,
      dueDate: dateInZone(FIRM_ZONE, -4),
    });
    const longest = await seed.task(world, {
      title: `Inline 120 ${tag}`,
      dueDate: dateInZone(FIRM_ZONE, -120),
    });
    await page.setViewportSize({ width: 1366, height: 768 });
    const queue = new TaskQueuePage(page);
    await queue.open(`?q=${tag}`);
    const row = page.locator(`tr[data-task="${late.taskNumber}"]`);
    const cell = row.locator('td[data-col="due"]');
    await expect(cell.locator('.dc-l2')).toContainText('Overdue 4d');
    await expect(page.getByRole('cell', { name: /overdue 4 days/ })).toHaveCount(1);
    expect(await cell.locator('.dc-sr').textContent()).toMatch(
      /^Due [A-Z][a-z]{2} \d+(, \d{4})?, overdue 4 days$/,
    );
    // Sorting keeps announcing itself.
    await expect(page.locator('thead th[data-col="due"]')).toHaveAttribute('aria-sort', /.*/);

    await page.getByRole('button', { name: 'Columns', exact: true }).click();
    await page.getByRole('radio', { name: 'Compact' }).check();
    await page.keyboard.press('Escape');
    const root = cell.locator('.dc');
    await expect(root).toHaveClass(/dc--inline/);
    const b1 = (await root.locator('.dc-l1').boundingBox())!;
    const b2 = (await root.locator('.dc-l2').boundingBox())!;
    expect(Math.abs(b2.y - b1.y), 'one line').toBeLessThan(4);
    expect(b2.x + b2.width - b1.x, 'fits the 136 px column').toBeLessThanOrEqual(136);
    expect((await row.boundingBox())!.height).toBeLessThanOrEqual(40);
    // The longest relative text is never clipped at 136 px; only the date may give way.
    const longRoot = page.locator(`tr[data-task="${longest.taskNumber}"] td[data-col="due"] .dc`);
    await expect(longRoot.locator('.dc-l2')).toHaveText('Overdue 120d');
    const l2 = (await longRoot.locator('.dc-l2').boundingBox())!;
    const td = (await page
      .locator(`tr[data-task="${longest.taskNumber}"] td[data-col="due"]`)
      .boundingBox())!;
    expect(l2.x + l2.width, 'Overdue 120d inside the cell').toBeLessThanOrEqual(td.x + td.width);
    await shot(page, 'due-cell-compact-1366x768');
    await axeClean(page, 'Due cell Compact');
  });
});
