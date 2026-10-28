import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { inDays, mmWorld } from '../support/my-matters-fixtures';
import { pmSolo, pmThree } from '../support/pm-fixtures';
import { SIZES } from '../support/screens';

/**
 * My Matters, a calmer page: batch 2 of epic #893.
 *
 *  - #909 + #895 one "what changed" line, drawn only when something that needs a decision changed; no Recent activity on the Overview;
 *  - #902 the count strip as five chips (buttons), zeros muted, counts equal to the lists they open;
 *  - #908 no matters list for one matter; for several, one line each with counts, the worst first, no Red / Amber / Green wall;
 *  - #905 Needs my attention as ONE ranked list of at most five rows with a reason column, At risk included, each task once per screen.
 */
const settled = async (page: Page, tab = 'overview'): Promise<void> => {
  await expect(page.locator(`#mm-tab-${tab}`)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-mm-tabpanel] >> text=/^Loading /')).toHaveCount(0);
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
};

const noSideways = async (page: Page): Promise<void> => {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    )
    .toBeLessThanOrEqual(0);
};

/** Answers the since-last-visit call with the given counts (a task set up leaves audit events and new tasks behind, so "nothing changed" is staged). */
const sinceCounts = async (
  page: Page,
  counts: Partial<
    Record<
      'becameOverdue' | 'putOnHold' | 'completed' | 'newUnassigned' | 'newTasks' | 'comments',
      number
    >
  >,
): Promise<void> => {
  const now = new Date().toISOString();
  await page.route('**/api/v1/my-matters/since-last-visit**', (route) => {
    const c = (n: number | undefined, target = 'taskQueue') => ({
      count: n ?? 0,
      query: 'managedByMe=true&unassigned=true',
      target,
    });
    return route.fulfill({
      json: {
        timeZone: 'America/New_York',
        asOfUtc: now,
        sinceUtc: now,
        hasMarker: true,
        seenEventId: 0,
        counts: {
          newTasks: c(counts.newTasks, 'activity'),
          completed: c(counts.completed, 'activity'),
          becameOverdue: c(counts.becameOverdue),
          reassigned: c(0, 'activity'),
          putOnHold: c(counts.putOnHold, 'activity'),
          comments: c(counts.comments, 'activity'),
          newUnassigned: c(counts.newUnassigned),
        },
        items: [],
      },
    });
  });
};

const taskLinks = (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-mm-tabpanel] a[href^="/tasks/"]')]
      .filter((a) => {
        const r = a.getBoundingClientRect();
        return r.width > 2 && r.height > 2;
      })
      .map((a) => a.getAttribute('href')!.split('?')[0]),
  );

test.describe('One "what changed" line, on the Activity tab (#909, #895, owner decision of 2026-10-28)', () => {
  test('changes that need a decision: the Overview draws nothing and the Activity tab a badge; opened, one line of links with Mark as read; no Recent activity and no event listed on the Overview', async ({
    seed,
    personas,
    asUser,
  }) => {
    const p = await pmThree(seed, personas, 'sc1');
    const page = await asUser(p.pm.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await sinceCounts(page, {
      putOnHold: 4,
      becameOverdue: 2,
      completed: 9,
      newUnassigned: 3,
      comments: 21,
    });
    await page.goto('/my-matters');
    await settled(page);
    // Cut 1: nothing of it on the Overview; the four figures added up are the badge of the Activity tab.
    await expect(page.locator('[data-panel=since]')).toHaveCount(0);
    await expect(page.locator('#mm-tab-activity [data-tab-badge]')).toHaveText('18'); // 2 + 4 + 9 + 3, comments are not counted
    await expect(page.locator('#mm-tab-activity')).toHaveAccessibleName(
      'Activity, 18 changes since your last visit',
    );
    // The Overview has no Recent activity and lists no event; the Activity tab keeps the full list.
    await expect(page.getByRole('heading', { name: 'Recent activity' })).toHaveCount(0);
    await expect(page.locator('[data-panel=activity], [data-activity-row]')).toHaveCount(0);
    await expect(page.locator('[data-since-item], [data-since-toggle]')).toHaveCount(0);
    await page.locator('#mm-tab-activity').click();
    await expect(page).toHaveURL(/tab=activity/);
    const line = page.locator('[data-panel=since]');
    await expect(line).toHaveCount(1);
    await expect(line).toContainText('Since your last visit:');
    // Only the four that need a decision are counted; comments are not.
    await expect(line.locator('[data-since-figures] a').first()).toBeVisible();
    const parts = (await line.locator('[data-since-figures] a').allInnerTexts()).map((t) =>
      t.replace(/\s+/g, ' ').trim(),
    );
    expect(parts).toEqual(['2 became overdue', '4 put on hold', '9 completed', '3 new unassigned']);
    await expect(line).not.toContainText('comment');
    await expect(line.getByRole('button', { name: 'Mark as read' })).toBeVisible();
    // It is a line, not a card: about one text line high.
    const box = await line.boundingBox();
    expect(box!.height, 'one line').toBeLessThanOrEqual(30);
    // Each part leads to its list (the Task Queue, or the Activity tab).
    await expect(line.locator('[data-figure=becameOverdue]')).toHaveAttribute('href', /\/tasks\?/);
    await expect(line.locator('[data-figure=putOnHold]')).toHaveAttribute('href', /tab=activity/);
  });

  test('nothing that needs a decision changed: nothing is drawn (comments and new tasks alone do not count)', async ({
    seed,
    personas,
    asUser,
  }) => {
    const p = await pmThree(seed, personas, 'sc2');
    const page = await asUser(p.pm.username);
    await sinceCounts(page, { comments: 5, newTasks: 12 });
    await page.goto('/my-matters?tab=activity');
    await expect(page.locator('#mm-tab-activity')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
    await expect(page.locator('[data-panel=since]')).toHaveCount(0);
    await expect(page.locator('#mm-tab-activity [data-tab-badge]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Mark as read' })).toHaveCount(0);
    const host = await page.locator('mf-mm-since').boundingBox();
    expect(host?.height ?? 0, 'no space reserved').toBeLessThanOrEqual(1);
  });

  test('the real counts: a held task and unassigned tasks, linked; Mark as read moves the marker and the line goes away', async ({
    seed,
    personas,
    asUser,
  }) => {
    const p = await pmSolo(seed, personas, 'sc3');
    const page = await asUser(p.pm.username);
    await page.goto('/my-matters?tab=activity');
    await expect(page.locator('#mm-tab-activity')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
    const line = page.locator('[data-panel=since]');
    await expect(line).toBeVisible();
    // The persona has unassigned tasks created in the last 7 days; the part links to exactly those.
    const unassigned = line.locator('[data-figure=newUnassigned]');
    await expect(unassigned).toBeVisible();
    const n = Number((await unassigned.innerText()).trim().split(/\s+/)[0]);
    expect(n).toBeGreaterThan(0);
    const [queue] = await Promise.all([
      page.waitForResponse((r) => /\/api\/v1\/task-queue\?/.test(r.url()) && r.ok()),
      unassigned.click(),
    ]);
    expect(((await queue.json()) as { total: number }).total).toBe(n);
    await page.goBack();
    await settled(page, 'activity');

    const seen = page.waitForResponse(
      (r) => r.url().includes('/api/v1/my-matters/activity/seen') && r.ok(),
    );
    await page.getByRole('button', { name: 'Mark as read' }).click();
    await seen;
    await expect(page.locator('[data-panel=since]')).toHaveCount(0);
    // Reload: still nothing (the marker moved on the server).
    await page.reload();
    await settled(page, 'activity');
    await expect(page.locator('[data-panel=since]')).toHaveCount(0);
  });

  test('the Activity tab still lists the events (and no event is on the Overview)', async ({
    seed,
    personas,
    asUser,
  }) => {
    const p = await pmSolo(seed, personas, 'sc4');
    const page = await asUser(p.pm.username);
    await page.goto('/my-matters?tab=activity');
    await expect(page.locator('#mm-tab-activity')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-mm-tabpanel] a[href^="/tasks/"]').first()).toBeVisible({
      timeout: 20_000,
    });
    await page.goto('/my-matters');
    await settled(page);
    await expect(page.locator('[data-activity-row], [data-panel=activity]')).toHaveCount(0);
  });

  for (const size of SIZES) {
    test(`the line is clean (axe, no sideways scroll) at ${size.width} px`, async ({
      seed,
      personas,
      asUser,
    }) => {
      const p = await pmThree(seed, personas, `sca${size.width}`);
      const page = await asUser(p.pm.username);
      await page.setViewportSize({ width: size.width, height: size.height });
      await sinceCounts(page, { becameOverdue: 2, putOnHold: 4, completed: 9, newUnassigned: 3 });
      await page.goto('/my-matters?tab=activity');
      await settled(page, 'activity');
      await expect(page.locator('[data-panel=since]')).toBeVisible();
      await noSideways(page);
      if (axeAvailable()) expect(await axeViolations(page), `axe ${size.width}`).toEqual([]);
    });
  }
});

test.describe('Count tiles (#902, #927)', () => {
  test('six equal tiles with their count in the name; each opens a Task Queue whose total is the count', async ({
    seed,
    personas,
    asUser,
  }) => {
    test.slow();
    const p = await pmThree(seed, personas, 'ch1');
    const page = await asUser(p.pm.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/my-matters');
    await settled(page);
    const keys = ['overdue', 'atRisk', 'unassigned', 'onHold', 'due7', 'open'];
    for (const key of keys) {
      const chip = page.locator(`button[data-strip-item=${key}]`);
      await expect(chip, key).toBeVisible();
      expect((await chip.getAttribute('aria-label')) ?? '', key).toMatch(/^\d+ /);
    }
    await expect(page.locator('[data-strip-item=matters], [data-strip-item=due3]')).toHaveCount(0);
    await expect(page.locator('button[data-strip-item=open]')).toContainText(/\d+\s+Open\s*$/);
    // The six tiles are one size (issue #927).
    const sizes = await page
      .locator('button[data-strip-item]')
      .evaluateAll((els) =>
        els.map((e) => [
          Math.round(e.getBoundingClientRect().width),
          Math.round(e.getBoundingClientRect().height),
        ]),
      );
    expect(sizes.length).toBe(6);
    for (const sz of sizes) expect(sz, 'equal tiles').toEqual(sizes[0]);
    // Every tile opens the Task Queue with exactly the tasks it counts.
    for (const key of keys) {
      await page.goto('/my-matters');
      await settled(page);
      const chip = page.locator(`button[data-strip-item=${key}]`);
      const count = Number(((await chip.getAttribute('aria-label')) ?? '').split(' ')[0]);
      const [queue] = await Promise.all([
        page.waitForResponse((r) => /\/api\/v1\/task-queue\?/.test(r.url()) && r.ok()),
        chip.click(),
      ]);
      await expect(page).toHaveURL(/\/tasks\?/);
      expect(((await queue.json()) as { total: number }).total, `${key}: tile = list`).toBe(count);
    }
  });

  test('red only for Overdue and amber only for At risk, only above zero; a zero tile is muted and still reachable', async ({
    seed,
    personas,
    asUser,
  }) => {
    const p = await pmSolo(seed, personas, 'ch2');
    const page = await asUser(p.pm.username);
    await page.goto('/my-matters');
    await settled(page);
    const state = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLButtonElement>('button[data-strip-item]')].map((b) => ({
        key: b.getAttribute('data-strip-item'),
        zero: b.classList.contains('tile--zero'),
        danger: b.classList.contains('tile--danger'),
        warning: b.classList.contains('tile--warning'),
        count: Number(b.getAttribute('aria-label')!.split(' ')[0]),
        disabled: b.disabled,
      })),
    );
    // Six tiles are always drawn (the strip does not rearrange itself).
    expect(state.map((s) => s.key)).toEqual([
      'overdue',
      'atRisk',
      'unassigned',
      'onHold',
      'due7',
      'open',
    ]);
    for (const s of state) {
      expect(s.disabled, `${s.key}: reachable`).toBe(false);
      expect(s.danger, `${s.key}: red exactly for Overdue above zero`).toBe(
        s.key === 'overdue' && s.count > 0,
      );
      expect(s.warning, `${s.key}: amber exactly for At risk above zero`).toBe(
        s.key === 'atRisk' && s.count > 0,
      );
      expect(s.zero, `${s.key}: muted exactly when zero`).toBe(s.count === 0);
    }
    // A zero tile works with the keyboard like any other.
    const zero = page.locator('button[data-strip-item].tile--zero').first();
    if ((await zero.count()) > 0) {
      await zero.focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/tasks\?/);
    }
  });

  for (const size of SIZES) {
    test(`the tiles are clean (axe, no sideways scroll) at ${size.width} px`, async ({
      seed,
      personas,
      asUser,
    }) => {
      const p = await pmThree(seed, personas, `cha${size.width}`);
      const page = await asUser(p.pm.username);
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto('/my-matters');
      await settled(page);
      await expect(page.locator('[data-mm-strip]')).toBeVisible();
      if (size.width < 640) {
        // A phone draws the six tiles as two columns by three rows (issue #927): every one is a 44 px target and all six are on screen at once.
        const boxes = await page
          .locator('button[data-strip-item]')
          .evaluateAll((els) =>
            els
              .map((e) => e.getBoundingClientRect())
              .map((r) => [r.left, r.top, r.width, r.height]),
          );
        expect(boxes.length).toBe(6);
        for (const [, , w, h] of boxes) {
          expect(h, 'phone targets are 44 px').toBeGreaterThanOrEqual(43.5);
          expect(w, 'phone tiles share the width').toBeGreaterThan(100);
        }
        expect(new Set(boxes.map((b) => Math.round(b[0]))).size, 'two columns').toBe(2);
        expect(new Set(boxes.map((b) => Math.round(b[1]))).size, 'three rows').toBe(3);
      }
      await noSideways(page);
      if (axeAvailable()) expect(await axeViolations(page), `axe ${size.width}`).toEqual([]);
    });
  }
});

test.describe('Matters list (#908)', () => {
  test('one matter: no matters list, no New task button of a row; the matter is named and linked after the tiles', async ({
    seed,
    personas,
    asUser,
  }) => {
    const p = await pmSolo(seed, personas, 'mh1');
    const page = await asUser(p.pm.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/my-matters');
    await settled(page);
    await expect(page.locator('[data-panel=health]')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Matter health' })).toHaveCount(0);
    await expect(page.locator('[data-health-list], [data-health-row]')).toHaveCount(0);
    // One create button for the whole page: the shell's.
    await expect(page.getByRole('button', { name: /New task|Task on a matter/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Create task' })).toHaveCount(1);
    const link = page.locator('[data-strip-matter]');
    await expect(link).toHaveAttribute('href', `/matters/${p.matters[0].matterId}`);
    await expect(link).toContainText(p.matters[0].name);
  });

  test('several matters: at most 8 one-line rows, worst first, chips that differ (0, 1 and 5 overdue), no Red / Amber / Green, one menu per row', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'mh3');
    const calm = await w.matter('Calm');
    const some = await w.matter('Some');
    const many = await w.matter('Many');
    await w.task(calm, { dueDate: '2099-01-01' });
    await w.task(some, { dueDate: '2000-01-01' });
    for (let i = 0; i < 5; i++) await w.task(many, { dueDate: '2000-01-0' + (i + 1) });
    const page = await asUser(w.pm.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/my-matters');
    await settled(page);

    const rows = page.locator('[data-health-row]');
    await expect(rows).toHaveCount(3);
    const overdue = await rows.evaluateAll((els) =>
      els.map((e) => ({
        id: Number(e.getAttribute('data-matter-id')),
        text: e.querySelector('[data-overdue]')!.textContent!.replace(/\s+/g, ' ').trim(),
        red: e.querySelector('[data-overdue]')!.classList.contains('mh__chip--danger'),
      })),
    );
    expect(overdue.map((o) => o.id)).toEqual([many.matterId, some.matterId, calm.matterId]);
    expect(overdue.map((o) => o.text)).toEqual(['5 overdue', '1 overdue', '0 overdue']);
    expect(overdue.map((o) => o.red)).toEqual([true, true, false]);
    // No colour words, no table, no per-row button; one menu per row with New task in it.
    await expect(page.getByText(/^(Red|Amber|Green)$/)).toHaveCount(0);
    await expect(page.locator('[data-health-table], [data-flag], [data-new-task]')).toHaveCount(0);
    await expect(rows.first().locator('[data-row-actions] button')).toHaveCount(1);
    await rows.first().locator('[data-row-actions] button').click();
    await expect(page.getByRole('menuitem', { name: '+ New task' })).toBeVisible();
    await page.keyboard.press('Escape');
    // The names do not wrap.
    const heights = await rows
      .locator('a[data-matter-link]')
      .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    for (const h of heights) expect(h, 'one line').toBeLessThanOrEqual(30);
    const rowHeights = await rows.evaluateAll((els) =>
      els.map((e) => e.getBoundingClientRect().height),
    );
    for (const h of rowHeights) expect(h, 'a row is one line').toBeLessThanOrEqual(48);
    // Reading order for a screen reader: matter, overdue, next deadline.
    const text = (await rows.first().innerText()).replace(/\s+/g, ' ');
    expect(text.indexOf(many.name)).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('5 overdue')).toBeGreaterThan(text.indexOf(many.name));
    expect(text.indexOf('Next deadline')).toBeGreaterThan(text.indexOf('5 overdue'));
    // The rule is stated once, behind the info button; All matters (N) opens the list.
    await expect(page.locator('[data-rule]')).toHaveCount(0);
    await page.locator('[data-how]').click();
    await expect(page.locator('[data-rule]')).toContainText('Worst first');
    await expect(page.locator('[data-all-matters]')).toContainText('All matters (3)');
    await page.getByRole('link', { name: /All matters/ }).click();
    await expect(page).toHaveURL(/\/matters/);
  });

  test('at risk and unassigned appear on a row only above zero, and the worst matter is first', async ({
    seed,
    personas,
    asUser,
  }) => {
    const p = await pmThree(seed, personas, 'mh4');
    const page = await asUser(p.pm.username);
    await page.goto('/my-matters');
    await settled(page);
    const rows = page.locator('[data-health-row]');
    await expect(rows).toHaveCount(3);
    const first = rows.first();
    await expect(first.locator('[data-overdue]')).toContainText('1 overdue');
    const withRisk = await rows.evaluateAll((els) =>
      els.map((e) => !!e.querySelector('[data-at-risk]')),
    );
    if (p.aged) expect(withRisk.some(Boolean)).toBe(true);
    // Chips exist only for counts above zero.
    const chips = await page
      .locator('[data-at-risk], [data-unassigned]')
      .evaluateAll((els) => els.map((e) => Number(e.textContent!.trim().split(/\s+/)[0])));
    for (const n of chips) expect(n).toBeGreaterThan(0);
  });

  for (const size of SIZES) {
    test(`the matters list is clean (axe, no sideways scroll) at ${size.width} px; on a phone a row is two lines`, async ({
      seed,
      personas,
      asUser,
    }) => {
      const p = await pmThree(seed, personas, `mha${size.width}`);
      const page = await asUser(p.pm.username);
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto('/my-matters');
      await settled(page);
      await expect(page.locator('[data-health-row]')).toHaveCount(3);
      if (size.width < 640) {
        const row = await page.locator('[data-health-row]').first().boundingBox();
        expect(row!.height, 'two lines of text and a 44 px menu').toBeLessThan(150);
        const name = await page.locator('[data-health-row] .mh__name').first().boundingBox();
        const counts = await page.locator('[data-health-row] .mh__counts').first().boundingBox();
        expect(counts!.y, 'counts under the name').toBeGreaterThan(name!.y + name!.height - 2);
      }
      await noSideways(page);
      if (axeAvailable()) expect(await axeViolations(page), `axe ${size.width}`).toEqual([]);
    });
  }
});

test.describe('Needs my attention: one ranked list (#905)', () => {
  test('one list, at most five rows, a reason on each, one View all N that opens the Task Queue with the same tasks', async ({
    seed,
    personas,
    asUser,
  }) => {
    const p = await pmThree(seed, personas, 'na1');
    const page = await asUser(p.pm.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/my-matters');
    await settled(page);
    const panel = page.locator('[data-panel=attention]');
    const rows = panel.locator('[data-attention-item]');
    const n = await rows.count();
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(5);
    // No group headings, no "also listed" notes; one View all.
    await expect(panel.locator('h3, [data-group], [data-repeated]')).toHaveCount(0);
    await expect(panel.locator('[data-view-all]')).toHaveCount(1);
    // The reason is the last column of each row and the names keep task, matter and reason.
    const facts = await rows.evaluateAll((els) =>
      els.map((e) => ({
        reason: e.getAttribute('data-reason'),
        text: e.querySelector('[data-fact]')!.textContent!.trim(),
        right: e.querySelector('[data-fact]')!.getBoundingClientRect().right,
        name: e.querySelector('[data-attention-row]')!.getAttribute('aria-label'),
      })),
    );
    for (const f of facts) {
      expect(f.text).not.toBe('');
      expect(f.name).toContain(f.text);
    }
    expect(new Set(facts.map((f) => Math.round(f.right))).size, 'one fixed column').toBe(1);
    // Ranked: overdue first, then at risk, then the long hold.
    const order = facts.map((f) => f.reason);
    const rank = ['overdue', 'atRisk', 'dueToday', 'unassigned', 'onHold'];
    expect(order.map((r) => rank.indexOf(r!))).toEqual(
      [...order.map((r) => rank.indexOf(r!))].sort((a, b) => a - b),
    );
    expect(order[0]).toBe('overdue');
    if (p.aged) {
      expect(order).toContain('atRisk');
      expect(order).toContain('onHold');
    }
    // View all N: N equals the Task Queue total of the link, and the list is no taller than 420 px.
    const all = panel.locator('[data-view-all]');
    const total = Number((await all.innerText()).replace(/\D+/g, ''));
    const box = await panel.boundingBox();
    expect(box!.height, 'at most 420 px').toBeLessThanOrEqual(420);
    const [queue] = await Promise.all([
      page.waitForResponse((r) => /\/api\/v1\/task-queue\?/.test(r.url()) && r.ok()),
      all.click(),
    ]);
    await expect(page).toHaveURL(/needsAttention=true/);
    expect(((await queue.json()) as { total: number }).total).toBe(total);
  });

  test('a task is listed once per screen: overdue and unassigned is one overdue row; an at-risk task is not also in the deadlines', async ({
    seed,
    personas,
    asUser,
  }) => {
    const p = await pmThree(seed, personas, 'na2');
    const page = await asUser(p.pm.username);
    await page.goto('/my-matters');
    await settled(page);
    const links = await taskLinks(page);
    expect(new Set(links).size, `no task id twice: ${links.join(' ')}`).toBe(links.length);
    // The overdue task is unassigned too: one row, reason overdue.
    const overdueRows = page.locator('[data-attention-item]', { hasText: `Overdue ${p.token}` });
    await expect(overdueRows).toHaveCount(1);
    await expect(overdueRows).toHaveAttribute('data-reason', 'overdue');
    await expect(overdueRows.locator('[data-fact]')).toContainText('overdue');
    if (p.aged) {
      const risk = page.locator('[data-attention-item]', { hasText: `At risk ${p.token}` });
      await expect(risk).toHaveCount(1);
      await expect(risk.locator('[data-fact]')).toHaveText('at risk');
      // It is due in 12 days (inside the deadlines window) and still not listed there.
      await expect(
        page.locator('[data-panel=deadlines]', { hasText: `At risk ${p.token}` }),
      ).toHaveCount(0);
    }
  });

  test('more than five need attention: the list stops at five, the oldest overdue first, View all counts all of them', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'na3');
    const m = await w.matter('Late');
    for (let i = 0; i < 8; i++)
      await w.task(m, { dueDate: `2000-01-0${i + 1}`, title: `Late ${i}` });
    const page = await asUser(w.pm.username);
    await page.goto('/my-matters');
    await settled(page);
    const panel = page.locator('[data-panel=attention]');
    await expect(panel.locator('[data-attention-item]')).toHaveCount(5);
    const titles = await panel.locator('[data-attention-row]').allInnerTexts();
    expect(titles.map((t) => t.replace(/^TSK-\d+\s+/, ''))).toEqual([
      'Late 0',
      'Late 1',
      'Late 2',
      'Late 3',
      'Late 4',
    ]);
    await expect(panel.locator('[data-view-all]')).toHaveText('View all 8');
  });

  test('nothing needs attention: one muted line, no toolbar', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'na4');
    const m = await w.matter('Quiet');
    await w.task(m, { dueDate: inDays(30), assignedUserId: w.pm.userId });
    const page = await asUser(w.pm.username);
    await page.goto('/my-matters');
    await settled(page);
    const panel = page.locator('[data-panel=attention]');
    await expect(panel).toContainText('Nothing needs your attention.');
    await expect(panel.locator('button, select, a')).toHaveCount(0);
  });

  for (const size of SIZES) {
    test(`the list is clean (axe, no sideways scroll) at ${size.width} px`, async ({
      seed,
      personas,
      asUser,
    }) => {
      const p = await pmThree(seed, personas, `naa${size.width}`);
      const page = await asUser(p.pm.username);
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto('/my-matters');
      await settled(page);
      await expect(page.locator('[data-attention-item]').first()).toBeVisible();
      await noSideways(page);
      if (axeAvailable()) expect(await axeViolations(page), `axe ${size.width}`).toEqual([]);
    });
  }
});
