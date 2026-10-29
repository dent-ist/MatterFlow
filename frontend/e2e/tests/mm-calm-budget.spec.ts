import { Page } from '@playwright/test';
import { calmMetrics, CalmMetrics } from '../support/calm-metrics';
import { expect, test } from '../support/fixtures';
import { inDays } from '../support/my-matters-fixtures';
import { PmPersona, pmSolo, pmThree } from '../support/pm-fixtures';

/**
 * The calm budget (epic #893, issue #924): the page became busy one reasonable addition at a time, and nothing noticed. This spec measures the first screen the
 * way the review did (`docs/ux/my-matters-calm/after/metrics.mjs`, "reach" and "seen": what a person can actually reach and read) for the Project Manager with
 * one matter and the one with three, at 1366x768 and on a phone (375x812), and FAILS, printing the measured numbers, when the page is busier than its budget.
 * A busy fixture is built first (five late tasks, three due soon) so the lists are full, as they are for a real Project Manager.
 *
 * The budgets and why (README, "The calm budget"):
 *  - first task row: 300 px at 1366x768 (the issue's number; measured 291 for one matter, 299 for three after the tiles became one row), 420 px on a phone (measured 343);
 *  - controls and words on the first screen, per person, set from the measured result of Release 3 with a small margin, NOT the issue's 25 / 150 for both. They ROSE
 *    in Release 3 on purpose: every column heading of the two grids is a sort button (about 7 each), the second grid has its own heading row, there is a Matter
 *    column and a Calendar button, and the six tiles replace three chips. Measured at 1366x768: one matter 39 controls / 204 words, three matters 58 / 274
 *    (the Client and Role filters, the New task chooser, three matter rows with a menu each); on a phone 22 / 100 and 23 / 101. The ceilings stop the page getting
 *    busier; the issue's targets stay open and are said so in the README;
 *  - no task id twice on the Overview; no sideways scroll.
 * The Calendar view, the Data tab and the Activity tab get a ratchet, their measured numbers plus a margin, so that work only lowers them.
 */
interface Budget {
  row: number;
  controls: number;
  words: number;
}

const OVERVIEW: Record<'solo' | 'three', Record<'desktop' | 'phone', Budget>> = {
  solo: {
    desktop: { row: 300, controls: 41, words: 215 },
    phone: { row: 420, controls: 22, words: 110 },
  },
  three: {
    desktop: { row: 300, controls: 61, words: 290 },
    phone: { row: 420, controls: 24, words: 110 },
  },
};

/**
 * The tabs and the Calendar view: a ratchet, their measured numbers plus about 5 percent, so that later work only lowers them. (Release 3: the Deadlines tab is gone,
 * the Calendar is a view of the Overview behind an icon button; the Data tab was rebuilt in #931 to #933.)
 */
const TABS: Record<
  'calendar' | 'breakdown' | 'data' | 'activity',
  Record<'desktop' | 'phone', Budget>
> = {
  calendar: {
    desktop: { row: 410, controls: 30, words: 96 },
    phone: { row: 470, controls: 22, words: 85 },
  },
  // The Breakdown (issues #911, #912; no task row, the cells are counts). Measured after the rework (1366x768 / 375x812): one matter 17 / 16 controls and 57 / 45 words,
  // three matters 29 / 23 controls and 87 / 78 words. The ratchet is the higher of the two people plus about 5 percent.
  breakdown: {
    desktop: { row: 0, controls: 31, words: 92 },
    phone: { row: 0, controls: 25, words: 82 },
  },
  // The Data tab holds no task row (row is not measured): tiles, selection bar and the asset-type grid. Measured: 23 / 27 controls and 74 words on a desktop, 20 / 21 and 53 / 49 on a phone.
  data: {
    desktop: { row: 0, controls: 29, words: 78 },
    phone: { row: 0, controls: 22, words: 56 },
  },
  // The Activity grid (issue #946). Measured (one matter / three matters): 1366x768 first task row 354 / 362 px (was 374 to 382), controls 27 / 39 (35 to 38), words 156 / 201 (191 to 192);
  // 375x812 row 382 px (was 577), controls 22 / 23 (24 to 25), words 87 / 97 (79 to 80). The words rose a little on purpose: the rows and the phone cards are shorter, so more of them
  // fit in the first screen, and each row names who, what, the task and the matter in columns. Ratchet = the measured number of the busier person plus about 5 percent.
  activity: {
    desktop: { row: 380, controls: 41, words: 212 },
    phone: { row: 400, controls: 25, words: 103 },
  },
};

/** Where each ratcheted view lives, and the tab that is selected there. */
const VIEWS = {
  calendar: { url: '/my-matters?view=calendar', tab: 'overview' },
  breakdown: { url: '/my-matters?tab=breakdown', tab: 'breakdown' },
  data: { url: '/my-matters?tab=data', tab: 'data' },
  activity: { url: '/my-matters?tab=activity', tab: 'activity' },
} as const;

const SIZES = {
  desktop: { width: 1366, height: 768 },
  phone: { width: 375, height: 812 },
} as const;

const settled = async (page: Page, tab: string): Promise<void> => {
  await expect(page.locator(`#mm-tab-${tab}`)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-mm-tabpanel] >> text=/^Loading /')).toHaveCount(0);
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
  // The page holds its body back for a moment while the first answers arrive.
  await expect(page.locator('[data-mm-body]')).toHaveCSS('visibility', 'visible');
};

/** A busy person: the persona's four tasks plus four more overdue (five in Needs my attention), three due within the week and four assets (the Data tab). */
async function fill(
  seed: import('../support/seed').Seeder,
  p: PmPersona,
  assigneeId: number,
): Promise<void> {
  const on = (i: number) => ({
    matter: { matterId: p.matters[i % p.matters.length].matterId },
    taskType: p.world.taskType,
    workflow: p.world.workflow,
  });
  for (let i = 0; i < 4; i++)
    await seed.task(on(i), {
      title: `Late ${i} ${p.token}`,
      dueDate: '2000-01-0' + (i + 2),
      assignedUserId: assigneeId,
    });
  // Assets, so the Data tab shows its tiles and its grid and not the one-line empty state (the ratchet measures the real thing).
  for (let i = 0; i < 4; i++)
    await seed.asset(p.matters[i % p.matters.length], `Asset ${i} ${p.token}`);
  for (let i = 0; i < 3; i++)
    await seed.task(on(i), {
      title: `Soon ${i} ${p.token}`,
      dueDate: inDays(2 + i),
      assignedUserId: assigneeId,
    });
}

const say = (m: CalmMetrics): string =>
  `row ${m.firstTaskRowTop}px, controls ${m.controlsReach}, words ${m.wordsSeen}, task links ${m.taskLinks}, repeated ${m.repeatedTaskCodes}`;

for (const who of ['solo', 'three'] as const) {
  test.describe(`Calm budget: the Project Manager with ${who === 'solo' ? 'one matter' : 'three matters'}`, () => {
    for (const size of ['desktop', 'phone'] as const) {
      test(`${size}: the Overview and the tabs stay inside their budget`, async ({
        seed,
        personas,
        asUser,
      }) => {
        test.setTimeout(150_000);
        const p = await (who === 'solo' ? pmSolo : pmThree)(seed, personas, `bud${who}${size}`);
        await fill(seed, p, p.other.userId);
        const page = await asUser(p.pm.username);
        await page.setViewportSize(SIZES[size]);

        await page.goto('/my-matters');
        await settled(page, 'overview');
        const m = await calmMetrics(page);
        test.info().annotations.push({ type: `${who}-${size}-overview`, description: say(m) });
        console.log(`BUDGET ${who} ${size} overview: ${say(m)}`);
        const b = OVERVIEW[who][size];
        expect(
          m.firstTaskRowTop,
          `first task row is lower than ${b.row} px (${say(m)})`,
        ).not.toBeNull();
        expect(m.firstTaskRowTop!, `first task row (${say(m)})`).toBeLessThanOrEqual(b.row);
        expect(m.controlsReach, `controls on the first screen (${say(m)})`).toBeLessThanOrEqual(
          b.controls,
        );
        expect(m.wordsSeen, `words on the first screen (${say(m)})`).toBeLessThanOrEqual(b.words);
        expect(m.repeatedTaskCodes, `a task id appears twice on the Overview (${say(m)})`).toBe(0);
        expect(m.horizontalScroll, 'sideways scroll').toBe(false);

        for (const tab of ['calendar', 'breakdown', 'data', 'activity'] as const) {
          await page.goto(VIEWS[tab].url);
          await settled(page, VIEWS[tab].tab);
          const t = await calmMetrics(page);
          test.info().annotations.push({ type: `${who}-${size}-${tab}`, description: say(t) });
          console.log(`BUDGET ${who} ${size} ${tab}: ${say(t)}`);
          const tb = TABS[tab][size];
          if (t.firstTaskRowTop !== null)
            expect(t.firstTaskRowTop, `${tab}: first task row (${say(t)})`).toBeLessThanOrEqual(
              tb.row,
            );
          expect(t.controlsReach, `${tab}: controls (${say(t)})`).toBeLessThanOrEqual(tb.controls);
          expect(t.wordsSeen, `${tab}: words (${say(t)})`).toBeLessThanOrEqual(tb.words);
          expect(t.horizontalScroll, `${tab}: sideways scroll`).toBe(false);
        }
      });
    }
  });
}
