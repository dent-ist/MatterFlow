import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';

/**
 * WP-AD2 #543: the admin grid contract (`mf-grid`, `mf-cell-*`, `data-drop`, `mf-cell-actions`) from `styles/_admin-lists.scss`. The real
 * stylesheet of the app is loaded (any route), then a fixture that renders every cell pattern replaces the page body, so the numbers are
 * the numbers every list that uses the classes gets. Screenshots go to E2E_SCREENSHOTS (docs/ux/admin-pages-review/fixes/ad2-kit).
 */
const OUT = process.env['E2E_SCREENSHOTS'];
const SIZES = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
  { width: 375, height: 812 },
] as const;

const LONG_WORD = 'Reallylongassettypenamewithoutanyspacesatall'.repeat(4);
const LONG_TEXT =
  'A very long asset type name that keeps going and going so that it needs more than two lines of the column to be shown in full';

const badge = (t: string) =>
  `<span style="display:inline-block;height:26px;line-height:26px;padding:0 8px;border:1px solid #888;border-radius:4px;font-size:12px">${t}</span>`;
const actions = (name: string) =>
  `<td class="mf-cell-actions"><button type="button" class="mf-btn" data-overflow aria-label="Actions for ${name}"><i class="pi pi-ellipsis-h" aria-hidden="true"></i></button></td>`;
const row = (id: string, name: string, desc: string | null, extra = '') => `
  <tr data-r="${id}">
    <td class="mf-cell-name"><a class="mf-name" href="#${id}" title="${name}">${name}</a>${desc ? `<span class="mf-desc" title="${desc}">${desc}</span>` : ''}</td>
    <td class="mf-cell-num" data-drop="1100">12,345</td>
    <td class="mf-cell-badge">${badge('Active')} ${badge('Default')}</td>
    <td class="mf-cell-date" data-drop="900">Oct 12</td>
    <td class="mf-cell-muted" data-drop="1280" title="muted">${extra || 'Secondary text that is longer than the column allows for sure'}</td>
    ${actions(id)}
  </tr>`;

const FIXTURE = `
<main style="padding:16px">
  <h1>Kit grid</h1>
  <div class="mf-table-wrap" id="kit-wrap">
    <table class="mf-grid" id="kit-grid">
      <caption class="mf-sr-only">Every cell pattern</caption>
      <thead><tr>
        <th class="mf-cell-name" scope="col">Name</th>
        <th class="mf-cell-num" data-drop="1100" scope="col">Assets</th>
        <th class="mf-cell-badge" scope="col">Status</th>
        <th class="mf-cell-date" data-drop="900" scope="col">Updated</th>
        <th class="mf-cell-muted" data-drop="1280" scope="col">Note</th>
        <th class="mf-cell-actions" scope="col"><span class="mf-sr-only">Actions</span></th>
      </tr></thead>
      <tbody>
        ${row('short', 'Source', null)}
        ${row('word', LONG_WORD, null)}
        ${row('text', LONG_TEXT, null)}
        ${row('desc', 'Document set', 'One muted line that describes the record and is much too long to ever fit on the single line it gets in the cell. '.repeat(4))}
        ${row('descword', LONG_WORD, 'Short description')}
        <tr class="gb-state" data-r="empty"><td colspan="6"><p>No asset types yet.</p></td></tr>
      </tbody>
    </table>
  </div>
  <h2>Wide</h2>
  <div class="mf-table-wrap" id="wide-wrap">
    <table class="mf-grid" id="wide-grid">
      <caption class="mf-sr-only">A table wider than its box</caption>
      <thead><tr>
        <th class="mf-cell-name" scope="col">Name</th>
        <th scope="col" style="min-width:900px">Wide column</th>
        <th class="mf-cell-actions" scope="col"><span class="mf-sr-only">Actions</span></th>
      </tr></thead>
      <tbody>
        <tr data-r="wide"><td class="mf-cell-name"><a class="mf-name" href="#w">Wide row</a></td><td style="min-width:900px">x</td>${actions('Wide row')}</tr>
      </tbody>
    </table>
  </div>
</main>`;

async function load(page: Page): Promise<void> {
  await page.goto('/403');
  await page.evaluate((html) => {
    document.body.innerHTML = html;
  }, FIXTURE);
}

async function noSideScroll(page: Page, what: string): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${what}: page-level horizontal scroll`).toBeLessThanOrEqual(0);
}

const visible = (page: Page, sel: string) =>
  page.evaluate((s) => {
    const el = document.querySelector<HTMLElement>(s);
    return !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
  }, sel);

test.describe('the 44 px grid contract (#543)', () => {
  for (const size of SIZES) {
    test(`${size.width}: every body row is exactly 44 px, the empty state has one height, nothing scrolls the page sideways`, async ({
      page,
    }) => {
      await page.setViewportSize(size);
      await load(page);
      const rem = await page.evaluate(() =>
        parseFloat(getComputedStyle(document.documentElement).fontSize),
      );
      const heights = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>('#kit-grid tbody tr[data-r]')).map(
          (tr) => [tr.dataset['r']!, tr.getBoundingClientRect().height] as [string, number],
        ),
      );
      for (const [id, h] of heights) {
        if (id === 'empty') expect(h, 'empty state').toBeGreaterThanOrEqual(9 * rem - 1);
        else {
          // 44 px; the collapsed border adds up to a pixel (as in wp8-list-chrome and ty3-lists).
          expect(h, `row ${id} at ${size.width}`).toBeGreaterThanOrEqual(43);
          expect(h, `row ${id} at ${size.width}`).toBeLessThanOrEqual(45);
        }
      }
      const empty = heights.find(([id]) => id === 'empty')![1];
      expect(empty).toBeLessThanOrEqual(9 * rem + 6);
      await noSideScroll(page, `${size.width}`);
      if (OUT) {
        fs.mkdirSync(OUT, { recursive: true });
        await page.screenshot({ path: path.join(OUT, `grid-${size.width}x${size.height}.png`) });
      }
    });

    test(`${size.width}: axe finds nothing in the fixture, target-size included`, async ({
      page,
    }) => {
      test.skip(!axeAvailable(), 'axe-core is not available');
      await page.setViewportSize(size);
      await load(page);
      expect(await axeViolations(page)).toEqual([]);
    });
  }

  test('a name is clamped to two lines, one line above a description, and the full text is the tooltip', async ({
    page,
  }) => {
    await page.setViewportSize(SIZES[1]);
    await load(page);
    const lines = (id: string) =>
      page.evaluate((i) => {
        const a = document.querySelector<HTMLElement>(`tr[data-r="${i}"] .mf-name`)!;
        const style = getComputedStyle(a);
        return Math.round(a.getBoundingClientRect().height / parseFloat(style.lineHeight));
      }, id);
    expect(await lines('short')).toBe(1);
    expect(await lines('word')).toBe(2);
    expect(await lines('text')).toBe(2);
    expect(await lines('desc')).toBe(1);
    expect(await lines('descword')).toBe(1);
    // The description is one clipped line.
    const desc = await page.evaluate(() => {
      const d = document.querySelector<HTMLElement>('tr[data-r="desc"] .mf-desc')!;
      return { h: d.getBoundingClientRect().height, clipped: d.scrollWidth > d.clientWidth };
    });
    expect(desc.h).toBeLessThanOrEqual(20);
    expect(desc.clipped).toBe(true);
    await expect(page.locator('tr[data-r="text"] .mf-name')).toHaveAttribute('title', LONG_TEXT);
  });

  test('counts are right aligned and the badge, date and number cells never wrap', async ({
    page,
  }) => {
    await page.setViewportSize(SIZES[0]);
    await load(page);
    const css = await page.evaluate(() => {
      const get = (s: string) => getComputedStyle(document.querySelector<HTMLElement>(s)!);
      return {
        numAlign: get('tr[data-r="short"] .mf-cell-num').textAlign,
        numHead: get('th.mf-cell-num').textAlign,
        numWrap: get('tr[data-r="short"] .mf-cell-num').whiteSpace,
        badgeWrap: get('tr[data-r="short"] .mf-cell-badge').whiteSpace,
        dateWrap: get('tr[data-r="short"] .mf-cell-date').whiteSpace,
        mutedColor: get('tr[data-r="short"] .mf-cell-muted').color,
        textColor: get('tr[data-r="short"] .mf-cell-num').color,
      };
    });
    expect(css.numAlign).toBe('right');
    expect(css.numHead).toBe('right');
    expect(css.numWrap).toBe('nowrap');
    expect(css.badgeWrap).toBe('nowrap');
    expect(css.dateWrap).toBe('nowrap');
    expect(css.mutedColor).not.toBe(css.textColor);
  });

  test('optional columns leave by window width (data-drop) and the actions column never does', async ({
    page,
  }) => {
    const cases: { width: number; num: boolean; date: boolean; note: boolean }[] = [
      { width: 1920, num: true, date: true, note: true },
      { width: 1366, num: true, date: true, note: true },
      { width: 1279, num: true, date: true, note: false },
      { width: 1024, num: false, date: true, note: false },
      { width: 899, num: false, date: false, note: false },
      { width: 375, num: false, date: false, note: false },
    ];
    for (const c of cases) {
      await page.setViewportSize({ width: c.width, height: 800 });
      await load(page);
      const what = `at ${c.width}`;
      expect(await visible(page, 'th.mf-cell-num'), `Assets ${what}`).toBe(c.num);
      expect(await visible(page, 'tr[data-r="short"] .mf-cell-num'), `Assets cell ${what}`).toBe(
        c.num,
      );
      expect(await visible(page, 'th.mf-cell-date'), `Updated ${what}`).toBe(c.date);
      expect(await visible(page, 'th.mf-cell-muted'), `Note ${what}`).toBe(c.note);
      expect(await visible(page, 'th.mf-cell-actions'), `Actions ${what}`).toBe(true);
      expect(await visible(page, 'th.mf-cell-name'), `Name ${what}`).toBe(true);
      await noSideScroll(page, what);
    }
  });

  test('the actions cell is a 44 px wide target that stays at the right edge while the table scrolls sideways', async ({
    page,
  }) => {
    await page.setViewportSize(SIZES[4]);
    await load(page);
    const before = await page.evaluate(() => {
      const wrap = document.querySelector<HTMLElement>('#wide-wrap')!;
      const cell = document.querySelector<HTMLElement>('#wide-grid td.mf-cell-actions')!;
      return {
        scrolls: wrap.scrollWidth > wrap.clientWidth,
        sticky: getComputedStyle(cell).position,
        width: cell.getBoundingClientRect().width,
        button: document.querySelector<HTMLElement>('#wide-grid button')!.getBoundingClientRect(),
      };
    });
    expect(before.scrolls).toBe(true);
    expect(before.sticky).toBe('sticky');
    expect(before.width).toBeGreaterThanOrEqual(44);
    expect(before.button.width).toBeGreaterThanOrEqual(44);
    expect(before.button.height).toBeGreaterThanOrEqual(24);
    await page.evaluate(() => {
      const wrap = document.querySelector<HTMLElement>('#wide-wrap')!;
      wrap.scrollLeft = wrap.scrollWidth;
    });
    const atEnd = await page.evaluate(() => {
      const wrap = document.querySelector<HTMLElement>('#wide-wrap')!.getBoundingClientRect();
      const cell = document
        .querySelector<HTMLElement>('#wide-grid td.mf-cell-actions')!
        .getBoundingClientRect();
      return { wrapRight: wrap.right, cellRight: cell.right };
    });
    expect(Math.abs(atEnd.wrapRight - atEnd.cellRight)).toBeLessThanOrEqual(1.5);
    // At the start of the scroll it is still in view, not pushed off to the far end of the table.
    await page.evaluate(() => {
      document.querySelector<HTMLElement>('#wide-wrap')!.scrollLeft = 0;
    });
    const atStart = await page.evaluate(() => {
      const wrap = document.querySelector<HTMLElement>('#wide-wrap')!.getBoundingClientRect();
      const cell = document
        .querySelector<HTMLElement>('#wide-grid td.mf-cell-actions')!
        .getBoundingClientRect();
      return cell.right <= wrap.right + 1.5 && cell.left >= wrap.left;
    });
    expect(atStart).toBe(true);
    await noSideScroll(page, 'wide table at 375');
  });
});
