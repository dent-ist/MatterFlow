import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { openHeaderOptions } from '../support/mm-header';
import { mmWorld } from '../support/my-matters-fixtures';
import { pmSolo, pmThree } from '../support/pm-fixtures';
import { SIZES } from '../support/screens';

/**
 * My Matters, a calmer page: batch 3 of epic #893.
 *
 *  - #894 one Options menu per list (Export inside), no Views / Sort / Task types toolbar; #907 Focus is the only task-type filter;
 *  - #896 Next 7 days never repeats a task, "All deadlines" opens the Deadlines tab;
 *  - #897 lighter rows (matter name only with several matters, a pill only for what is unusual, one status text on the right);
 *  - #903 one column, the first task row within about 300 px at 1366x768.
 */
const settled = async (page: Page): Promise<void> => {
  await expect(page.locator('#mm-tab-overview')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-mm-tabpanel] >> text=/^Loading /')).toHaveCount(0);
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
};

const firstTaskRowTop = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const a = document.querySelector('[data-mm-tabpanel] a[href^="/tasks/"]')!;
    const row = a.closest('li') ?? a;
    return Math.round(row.getBoundingClientRect().top + window.scrollY);
  });

test.describe('One column, lighter rows, one Options menu (#903, #897, #894)', () => {
  test('three matters: the sections follow each other in one column, the first task row is within 300 px, no task id is listed twice', async ({
    seed,
    personas,
    asUser,
  }) => {
    const p = await pmThree(seed, personas, 'b3a');
    const page = await asUser(p.pm.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/my-matters');
    await settled(page);
    const boxes = await Promise.all(
      ['attention', 'deadlines', 'health'].map((k) =>
        page.locator(`[data-panel=${k}]`).boundingBox(),
      ),
    );
    for (const b of boxes) expect(b, 'every section is drawn').not.toBeNull();
    expect(Math.abs(boxes[0]!.x - boxes[1]!.x)).toBeLessThan(2);
    expect(boxes[1]!.y).toBeGreaterThanOrEqual(boxes[0]!.y + boxes[0]!.height - 2);
    expect(boxes[2]!.y).toBeGreaterThanOrEqual(boxes[1]!.y + boxes[1]!.height - 2);
    // The Client / Role bar is drawn here (three clients, both roles) and the first task row is still within 300 px at 1366x768.
    await expect(page.locator('[data-mm-filters]')).toBeVisible();
    expect(await firstTaskRowTop(page)).toBeLessThanOrEqual(300 + 40); // + the "since" line, which the fixture's new tasks always draw
    const hrefs = await page
      .locator('[data-mm-tabpanel] a[href^="/tasks/"]')
      .evaluateAll((as) => as.map((a) => a.getAttribute('href')!.split('?')[0]));
    expect(new Set(hrefs).size, 'no task listed twice').toBe(hrefs.length);
  });

  test('one matter: no matter name on a row, a row is one line, a pill only for what is unusual, one status text, no per-list toolbar', async ({
    seed,
    personas,
    asUser,
  }) => {
    const p = await pmSolo(seed, personas, 'b3b');
    const page = await asUser(p.pm.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/my-matters');
    await settled(page);
    const rows = page.locator('[data-attention-item]');
    expect(await rows.count()).toBeGreaterThan(0);
    await expect(page.locator('[data-row-matter]')).toHaveCount(0);
    for (const box of await rows.evaluateAll((els) =>
      els.map((e) => e.getBoundingClientRect().height),
    ))
      expect(box, 'a row is one line').toBeLessThanOrEqual(44);
    const pills = await page.locator('[data-priority]').allInnerTexts();
    for (const t of pills) expect(['High', 'Critical']).toContain(t.trim());
    for (const r of await rows.all()) await expect(r.locator('[data-fact]')).toHaveCount(1);
    // The link says the code and the title; the screen reader's name keeps the matter, priority and status.
    const link = rows.first().locator('[data-attention-row]');
    const name = (await link.getAttribute('aria-label'))!;
    expect(name).toContain(p.matters[0].name);
    expect(name).toMatch(/priority/);
    // No toolbar: the list's only controls are View all and Options; the Next 7 days list has none besides its link.
    await expect(
      page.locator('[data-types-trigger], [data-sort], [data-views], [data-range]'),
    ).toHaveCount(0);
    await expect(page.locator('[data-panel=attention] mf-options-menu')).toHaveCount(1);
    await expect(
      page.locator('[data-panel=deadlines] mf-options-menu, [data-panel=deadlines] button'),
    ).toHaveCount(0);
  });

  test('Options opens with Export, closes with Escape and returns the focus; a click outside closes it', async ({
    seed,
    personas,
    asUser,
  }) => {
    const p = await pmSolo(seed, personas, 'b3c');
    const page = await asUser(p.pm.username);
    await page.goto('/my-matters');
    await settled(page);
    const trigger = page.locator('[data-panel=attention] [data-options-trigger]');
    await expect(page.locator('[data-panel=attention] [data-export=csv]')).toBeHidden();
    await trigger.click();
    await expect(page.locator('[data-panel=attention] [data-export=csv]')).toBeVisible();
    await expect(page.locator('[data-panel=attention] [data-export=copy]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-panel=attention] [data-export=csv]')).toBeHidden();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await page.locator('h1').click();
    await expect(page.locator('[data-panel=attention] [data-export=csv]')).toBeHidden();
  });

  test('Focus is the one task-type filter: it narrows Needs my attention and Next 7 days, and there is no per-list Task types control', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'b3d');
    const second = await seed.taskType({ workflows: [w.world.workflow] });
    const a = await w.matter('Focus alpha');
    await w.task(a, { dueDate: '2000-01-01', title: 'First type' });
    await w.task(a, { dueDate: '2000-01-02', title: 'Second type', taskTypeId: second.id });
    const page = await asUser(w.pm.username);
    await page.goto('/my-matters');
    await settled(page);
    await expect(page.locator('[data-panel=attention] [data-attention-row]')).toHaveCount(2);
    await openHeaderOptions(page);
    await page.locator(`[data-focus-option="${second.id}"]`).check();
    await page.locator('[data-focus-save]').click();
    await expect(page.locator('[data-panel=attention] [data-attention-row]')).toHaveCount(1);
    await expect(page.locator('[data-types-trigger]')).toHaveCount(0);
    await page.locator('[data-focus-chip] button').click();
    await expect(page.locator('[data-panel=attention] [data-attention-row]')).toHaveCount(2);
  });

  for (const size of SIZES) {
    test(`axe is clean at ${size.width}x${size.height} with the Options menu open (three matters)`, async ({
      seed,
      personas,
      asUser,
    }) => {
      expect(axeAvailable(), 'set E2E_AXE_PATH to axe.min.js').toBe(true);
      const p = await pmThree(seed, personas, `b3x${size.width}`);
      const page = await asUser(p.pm.username);
      await page.setViewportSize(size);
      await page.goto('/my-matters');
      await settled(page);
      expect(await axeViolations(page), `closed at ${size.width}`).toEqual([]);
      await page.locator('[data-panel=attention] [data-options-trigger]').click();
      await expect(page.locator('[data-panel=attention] [data-export=csv]')).toBeVisible();
      expect(await axeViolations(page), `Options open at ${size.width}`).toEqual([]);
      await page.keyboard.press('Escape');
      await page.goto('/my-matters?tab=deadlines');
      await expect(
        page.locator('[data-panel=deadlines-tab] [data-deadline-row]').first(),
      ).toBeVisible();
      expect(await axeViolations(page), `Deadlines tab at ${size.width}`).toEqual([]);
    });
  }
});
