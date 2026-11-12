import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

/**
 * The Notes height toggle (#1342, epic #1340; docs/ux/notes-height/ui-spec.md, D-46a): a second icon button next to the width toggle folds the matter header
 * (breadcrumb and title row) so the Notes card is taller; the note list stays, the page never scrolls, the choice is remembered per person in browser storage.
 * Desktop sizes only (D-82). Only this file is run for the feature (no full suite).
 */
const SIZES = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
];

const html = (title: string, paragraphs = 1) =>
  `<h1>${title}</h1>` +
  Array.from(
    { length: paragraphs },
    (_, i) => `<p>${title} paragraph ${i + 1}. Lorem ipsum.</p>`,
  ).join('');

async function world(seed: import('../support/seed').Seeder, sensitive = false) {
  const client = await seed.client({ name: `Height Client ${uid()}` });
  const matter = await seed.matter({ client, name: `Height Matter ${uid()}`, sensitive });
  const note = async (title: string, paragraphs = 1) =>
    seed.admin.post('/api/v1/notes', {
      matterId: matter.matterId,
      bodyHtml: html(title, paragraphs),
      tagIds: [],
    });
  return { client, matter, note };
}

const open = async (page: Page, matterId: number) => {
  await page.goto(`/matters/${matterId}?tab=notes`);
  await expect(page.locator('[data-notes-tab]')).toBeVisible();
};

const card = (page: Page) => page.locator('section.nt[data-notes-tab]');
const toggle = (page: Page) => page.locator('[data-note-height]');
const crumb = (page: Page) => page.locator('[data-crumb-current]');

async function cardHeight(page: Page): Promise<number> {
  return (await card(page).boundingBox())!.height;
}

/** No scroll anywhere above the card: the document, the body and every scrolling ancestor fit their content. */
async function noPageScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const out: string[] = [];
    const doc = document.documentElement;
    if (doc.scrollHeight - window.innerHeight > 0) out.push('document');
    if (document.body.scrollHeight - document.body.clientHeight > 1) out.push('body');
    let el: HTMLElement | null = document.querySelector('section.nt[data-notes-tab]');
    while (el && el !== document.body) {
      const oy = getComputedStyle(el).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight - el.clientHeight > 1) {
        out.push(el.tagName + '.' + el.className);
      }
      el = el.parentElement;
    }
    return out;
  });
  expect(overflow).toEqual([]);
  const box = await card(page).boundingBox();
  const vh = page.viewportSize()!.height;
  expect(box!.y + box!.height).toBeLessThanOrEqual(vh + 1);
}

test.describe('Notes height toggle (#1342)', () => {
  for (const size of SIZES) {
    test(`four combinations and the measured gain at ${size.width}x${size.height}`, async ({
      page,
      seed,
    }, testInfo) => {
      const w = await world(seed);
      const title = `Combo ${uid()}`;
      await w.note(title, 40);
      await page.setViewportSize(size);
      await open(page, w.matter.matterId);

      // No open note: the button is at the end of the list's first row, nothing else carries it.
      await expect(toggle(page)).toHaveCount(1);
      await expect(page.locator('[data-notes-controls] [data-note-height]')).toHaveCount(1);
      await expect(toggle(page)).toHaveAttribute('aria-label', 'Expand to the full height');
      await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
      const before = await cardHeight(page);
      await noPageScroll(page);

      await page.locator('[data-note-item]').first().click();
      await expect(page.locator('[data-note-title]')).toContainText(title);
      // Opened: the button moved to the pane header, after the width toggle and before Close; never two.
      await expect(toggle(page)).toHaveCount(1);
      await expect(page.locator('[data-note-head] [data-note-height]')).toHaveCount(1);
      const wb = (await page.locator('[data-note-wide]').boundingBox())!;
      const hb = (await toggle(page).boundingBox())!;
      const cb = (await page.locator('[data-note-close]').boundingBox())!;
      expect(hb.x - (wb.x + wb.width)).toBeCloseTo(8, 0);
      expect(cb.x - (hb.x + hb.width)).toBeCloseTo(8, 0);
      expect([hb.width, hb.height]).toEqual([36, 36]);

      const rows: string[] = [];
      for (const [wide, folded] of [
        [false, false],
        [true, false],
        [false, true],
        [true, true],
      ] as const) {
        // Bring the toggles to the wanted state.
        const isWide =
          (await page.locator('[data-note-wide]').getAttribute('aria-pressed')) === 'true';
        if (isWide !== wide) await page.locator('[data-note-wide]').click();
        const isFolded = (await toggle(page).getAttribute('aria-pressed')) === 'true';
        if (isFolded !== folded) await toggle(page).click();

        await expect(toggle(page)).toHaveAttribute('aria-pressed', String(folded));
        await expect(toggle(page)).toHaveAttribute(
          'aria-label',
          folded ? 'Show the matter header again' : 'Expand to the full height',
        );
        if (wide) await expect(page.locator('[data-notes-list]')).toHaveCount(0);
        else await expect(page.locator('[data-notes-list]')).toBeVisible();
        await expect(crumb(page)).toHaveCount(folded ? 0 : 1);
        await expect(page.getByRole('tablist', { name: 'Matter sections' })).toBeVisible();
        await expect(page.getByRole('heading', { level: 1 })).toContainText('Height Matter');
        await noPageScroll(page);
        const h = await cardHeight(page);
        const gain = h - before;
        rows.push(`wide=${wide} folded=${folded} card=${Math.round(h)} gain=${Math.round(gain)}`);
        if (folded) expect(gain).toBeGreaterThanOrEqual(58);
        if (folded) expect(gain).toBeLessThanOrEqual(64);
        else expect(Math.abs(gain)).toBeLessThanOrEqual(1);
      }
      const line = `MEASURED ${size.width}x${size.height}: header shown ${Math.round(before)} px, folded ${rows[3]}`;
      console.log(line);
      testInfo.annotations.push({ type: 'measured', description: `${line} | ${rows.join(' | ')}` });
    });
  }

  test('the choice is remembered per person, global across matters, reset by turning it off', async ({
    page,
    seed,
  }) => {
    const a = await world(seed);
    const b = await world(seed);
    await a.note(`Mem ${uid()}`);
    await page.setViewportSize(SIZES[0]);
    await open(page, a.matter.matterId);
    await toggle(page).click();
    await expect(crumb(page)).toHaveCount(0);
    const stored = await page.evaluate(() =>
      Object.entries(localStorage).filter(([k]) => k.startsWith('mf.notes.height.v1.')),
    );
    expect(stored).toHaveLength(1);
    expect(stored[0][1]).toBe('1');
    expect(stored[0][0]).not.toBe('mf.notes.height.v1.anon');

    // Reload and another matter: folded at once; the skeleton honours it (the page is folded as soon as the matter is shown).
    await page.reload();
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(crumb(page)).toHaveCount(0);
    await open(page, b.matter.matterId);
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(crumb(page)).toHaveCount(0);

    // Another tab shows the full header; coming back folds it again.
    await page.getByRole('tab', { name: /^Summary/ }).click();
    await expect(crumb(page)).toHaveCount(1);
    await page.getByRole('tab', { name: /^Notes/ }).click();
    await expect(crumb(page)).toHaveCount(0);

    // Anything but 1 is off.
    await page.evaluate(() => {
      for (const [k] of Object.entries(localStorage))
        if (k.startsWith('mf.notes.height.v1.')) localStorage.setItem(k, 'true');
    });
    await page.reload();
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(crumb(page)).toHaveCount(1);

    // Off again removes the entry.
    await toggle(page).click();
    await toggle(page).click();
    expect(
      await page.evaluate(
        () => Object.keys(localStorage).filter((k) => k.startsWith('mf.notes.height.v1.')).length,
      ),
    ).toBe(0);
  });

  test('works when storage is blocked: the toggle holds for the visit and starts off after a reload', async ({
    page,
    seed,
  }) => {
    const w = await world(seed);
    await page.addInitScript(() => {
      const get = Storage.prototype.getItem;
      const set = Storage.prototype.setItem;
      const rm = Storage.prototype.removeItem;
      const blocked = (k: string) => String(k).startsWith('mf.notes.height');
      Storage.prototype.getItem = function (k: string) {
        if (blocked(k)) throw new DOMException('blocked', 'SecurityError');
        return get.call(this, k);
      };
      Storage.prototype.setItem = function (k: string, v: string) {
        if (blocked(k)) throw new DOMException('blocked', 'SecurityError');
        return set.call(this, k, v);
      };
      Storage.prototype.removeItem = function (k: string) {
        if (blocked(k)) throw new DOMException('blocked', 'SecurityError');
        return rm.call(this, k);
      };
    });
    await page.setViewportSize(SIZES[0]);
    await open(page, w.matter.matterId);
    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(crumb(page)).toHaveCount(0);
    await page.reload();
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(crumb(page)).toHaveCount(1);
  });

  test('focus stays on the same toggle node, the tab is not re-created, and the unsaved text survives the fold', async ({
    page,
    seed,
  }) => {
    const w = await world(seed);
    await w.note(`Focus ${uid()}`);
    await page.setViewportSize(SIZES[0]);
    await open(page, w.matter.matterId);
    await page.locator('[data-note-item]').first().click();
    await page.locator('[data-note-edit]').click();
    await page.locator('.ProseMirror').click();
    await page.keyboard.type(' Typed before folding.');
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>)['__tab'] =
        document.querySelector('[data-notes-tab]');
      (window as unknown as Record<string, unknown>)['__btn'] =
        document.querySelector('[data-note-height]');
    });
    await toggle(page).focus();
    await page.keyboard.press('Enter');
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
    const same = await page.evaluate(() => ({
      tab:
        (window as unknown as Record<string, unknown>)['__tab'] ===
        document.querySelector('[data-notes-tab]'),
      btn:
        (window as unknown as Record<string, unknown>)['__btn'] ===
        document.querySelector('[data-note-height]'),
      focused: document.activeElement === document.querySelector('[data-note-height]'),
      scrollY: window.scrollY,
    }));
    expect(same).toEqual({ tab: true, btn: true, focused: true, scrollY: 0 });
    await expect(page.locator('.ProseMirror')).toContainText('Typed before folding.');
    await expect(page.locator('[data-note-state]')).toContainText('Unsaved changes');
    // Space unfolds again and focus is still there.
    await page.keyboard.press('Space');
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(toggle(page)).toBeFocused();
    // The height toggle never changes the width toggle, and saving does not unfold.
    await expect(page.locator('[data-note-wide]')).toHaveAttribute('aria-pressed', 'true');
  });

  test('the tooltip says the same as the accessible name, on both toggles', async ({
    page,
    seed,
  }) => {
    const w = await world(seed);
    await w.note(`Tip ${uid()}`);
    await page.setViewportSize(SIZES[0]);
    await open(page, w.matter.matterId);
    await page.locator('[data-note-item]').first().click();
    for (const [sel, off, on] of [
      ['[data-note-height]', 'Expand to the full height', 'Show the matter header again'],
      ['[data-note-wide]', 'Expand to the full width', 'Show the list again'],
    ]) {
      const btn = page.locator(sel);
      await btn.hover();
      await expect(page.locator('[role=tooltip]')).toHaveText(off);
      await expect(btn).toHaveAttribute('aria-label', off);
      await expect(btn).not.toHaveAttribute('title', /.+/);
      await btn.click();
      await expect(btn).toHaveAttribute('aria-label', on);
      await expect(page.locator('[role=tooltip]')).toHaveText(on);
      await page.mouse.move(5, 400);
      await btn.click();
    }
    // Both toggles share the pressed look: same fill when on. Both are pressed and the pointer is away (no hover fill, no colour transition
    // under way) before the fills are read; on a slow machine the first read came before the second toggle had taken its look.
    await page.locator('[data-note-wide]').click();
    await toggle(page).click();
    await expect(page.locator('[data-note-wide]')).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
    await page.mouse.move(5, 400);
    const fill = (sel: string) =>
      page.evaluate((s) => {
        const el = document.querySelector(s)!;
        return (
          getComputedStyle(el).backgroundColor +
          '|' +
          getComputedStyle(el.querySelector('i')!).color
        );
      }, sel);
    await expect
      .poll(async () => (await fill('[data-note-wide]')) === (await fill('[data-note-height]')))
      .toBe(true);
  });

  test('folded: an edit error, the save state and the buttons stay visible; a sensitive bar stays; no page scroll', async ({
    page,
    seed,
  }) => {
    const w = await world(seed, true);
    await w.note(`Err ${uid()}`, 30);
    await page.setViewportSize(SIZES[0]);
    await open(page, w.matter.matterId);
    await toggle(page).click();
    await expect(page.locator('[data-sensitive-banner]')).toBeVisible();
    await page.locator('[data-note-item]').first().click();
    await page.locator('[data-note-edit]').click();
    await page.locator('.ProseMirror').click();
    await page.keyboard.type(' Changed.');
    await page.route('**/api/v1/notes/**', (route) =>
      route.request().method() === 'PUT' || route.request().method() === 'PATCH'
        ? route.fulfill({
            status: 400,
            contentType: 'application/problem+json',
            body: JSON.stringify({
              type: 'about:blank',
              title: 'Validation failed',
              status: 400,
              errors: { bodyHtml: [{ code: 'TOO_LONG', message: 'The note is too long.' }] },
            }),
          })
        : route.continue(),
    );
    await page.locator('[data-note-save]').click();
    const err = page.locator('[data-note-error]');
    await expect(err).toBeVisible();
    const vh = SIZES[0].height;
    for (const loc of [
      err,
      page.locator('[data-note-state]'),
      page.locator('[data-note-save]'),
      page.locator('[data-note-cancel]'),
    ]) {
      const b = (await loc.boundingBox())!;
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.y + b.height).toBeLessThanOrEqual(vh);
    }
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
    await noPageScroll(page);
    // The sensitive bar is kept: the gain is the same 61 px, with the bar still on screen.
    await expect(page.locator('[data-sensitive-banner]')).toBeVisible();
  });

  test('template view uses the list-row button', async ({ page, seed }) => {
    const w = await world(seed);
    await page.setViewportSize(SIZES[0]);
    await open(page, w.matter.matterId);
    await page.locator('[data-view="templates"]').click();
    await expect(toggle(page)).toHaveCount(1);
    await expect(page.locator('[data-notes-controls] [data-note-height]')).toHaveCount(1);
    await toggle(page).click();
    await expect(crumb(page)).toHaveCount(0);
    await noPageScroll(page);
  });

  for (const size of SIZES) {
    test(`axe is clean, folded and not, at ${size.width}x${size.height}`, async ({
      page,
      seed,
    }) => {
      test.skip(!axeAvailable(), 'axe-core is not installed');
      const w = await world(seed);
      await w.note(`Axe ${uid()}`);
      await page.setViewportSize(size);
      await open(page, w.matter.matterId);
      await expect(page.locator('[data-note-item]').first()).toBeVisible();
      expect(await axeViolations(page, '[data-notes-tab]')).toEqual([]);
      await toggle(page).click();
      await expect(crumb(page)).toHaveCount(0);
      expect(await axeViolations(page)).toEqual([]);
      await page.locator('[data-note-item]').first().click();
      await expect(page.locator('[data-note-title]')).toBeVisible();
      expect(await axeViolations(page)).toEqual([]);
      await page.locator('[data-note-edit]').click();
      await expect(page.locator('[data-editor-toolbar]')).toBeVisible();
      expect(await axeViolations(page)).toEqual([]);
    });
  }
});

/** Evidence screenshots for the review (owner requirement); only when E2E_SHOTS_DIR is set. JPEGs are committed to the design-evidence branch only. */
test.describe('evidence', () => {
  test('screenshots of every state at both sizes', async ({ page, seed }) => {
    const dir = process.env['E2E_SHOTS_DIR'];
    test.skip(!dir, 'E2E_SHOTS_DIR is not set');
    fs.mkdirSync(dir!, { recursive: true });
    const w = await world(seed);
    const title = `Quarterly privilege review ${uid()}`;
    await w.note(title, 12);
    await w.note(`Custodian interviews ${uid()}`, 3);
    const shot = (name: string, size: { width: number; height: number }) =>
      page.screenshot({
        path: path.join(dir!, `${name}-${size.width}.jpg`),
        type: 'jpeg',
        quality: 70,
      });
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.addInitScript(() => localStorage.removeItem('x'));
      await open(page, w.matter.matterId);
      await page.evaluate(() =>
        Object.keys(localStorage)
          .filter((k) => k.startsWith('mf.notes.height'))
          .forEach((k) => localStorage.removeItem(k)),
      );
      await page.reload();
      await expect(card(page)).toBeVisible();
      await page.locator('[data-note-item]').first().click();
      await expect(page.locator('[data-note-title]')).toBeVisible();
      const wide = page.locator('[data-note-wide]');
      if ((await wide.getAttribute('aria-pressed')) === 'true') await wide.click();
      if ((await toggle(page).getAttribute('aria-pressed')) === 'true') await toggle(page).click();
      await page.mouse.move(5, 400);
      await shot('1-list-header', size);
      await wide.click();
      await page.mouse.move(5, 400);
      await shot('2-wide-header', size);
      await wide.click();
      await toggle(page).click();
      await page.mouse.move(5, 400);
      await shot('3-list-folded', size);
      await wide.click();
      await page.mouse.move(5, 400);
      await shot('4-wide-folded', size);
      await toggle(page).hover();
      await expect(page.locator('[role=tooltip]')).toBeVisible();
      await shot('5-tooltip', size);
      await page.mouse.move(5, 400);
      await page.locator('[data-note-edit]').click();
      await page.locator('.ProseMirror').click();
      await page.keyboard.type(' Edited while folded.');
      await page.route('**/api/v1/notes/**', (route) =>
        route.request().method() === 'PUT'
          ? route.fulfill({
              status: 400,
              contentType: 'application/problem+json',
              body: JSON.stringify({
                type: 'about:blank',
                title: 'Validation failed',
                status: 400,
                errors: { bodyHtml: [{ code: 'TOO_LONG', message: 'The note is too long.' }] },
              }),
            })
          : route.continue(),
      );
      await page.locator('[data-note-save]').click();
      await expect(page.locator('[data-note-error]')).toBeVisible();
      await shot('6-folded-validation', size);
      await page.unroute('**/api/v1/notes/**');
      await page.locator('[data-note-cancel]').click();
      const discard = page.getByRole('dialog', { name: 'Unsaved Changes' });
      if (await discard.isVisible()) await discard.getByRole('button', { name: /Discard/ }).click();
      await page.locator('[data-note-close]').click();
      await expect(page.locator('[data-notes-controls] [data-note-height]')).toBeVisible();
      await page.mouse.move(5, 400);
      await shot('7-folded-list-only', size);
    }
  });
});
