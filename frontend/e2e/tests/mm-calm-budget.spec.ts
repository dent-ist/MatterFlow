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
 *  - first task row: 300 px at 1366x768 (the issue's number; measured 233 for one matter, 273 for three), 420 px on a phone;
 *  - controls and words on the first screen, per person, set from the measured result of Release 2 with a small margin, NOT the issue's 25 / 150 for both:
 *    the one-matter person meets them (25 and 125 measured at 1366x768), the three-matter person does not (36 controls, 207 words: the Client and Role filters, the
 *    New task chooser, three matter rows with a menu each, and the matter name on every task row, which the owner kept). The ceilings stop the page getting
 *    busier; the issue's targets stay open and are said so in the README;
 *  - no task id twice on the Overview; no sideways scroll.
 * The Deadlines and Activity tabs are not reworked yet (Release 3): they get a ratchet, their measured numbers plus a margin, so that work only lowers them.
 */
interface Budget {
  row: number;
  controls: number;
  words: number;
}

const OVERVIEW: Record<'solo' | 'three', Record<'desktop' | 'phone', Budget>> = {
  solo: {
    desktop: { row: 300, controls: 25, words: 150 },
    phone: { row: 420, controls: 22, words: 110 },
  },
  three: {
    desktop: { row: 300, controls: 37, words: 215 },
    phone: { row: 420, controls: 22, words: 110 },
  },
};

/** Release 3 lowers these (the Deadlines and Activity tabs are rebuilt there): measured numbers plus about 5 percent. */
const TABS: Record<'deadlines' | 'activity', Record<'desktop' | 'phone', Budget>> = {
  deadlines: {
    desktop: { row: 400, controls: 30, words: 125 },
    phone: { row: 430, controls: 22, words: 90 },
  },
  activity: {
    desktop: { row: 400, controls: 42, words: 215 },
    phone: { row: 560, controls: 27, words: 90 },
  },
};

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

/** A busy person: the persona's four tasks plus four more overdue (five in Needs my attention) and three due within the week. */
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

        for (const tab of ['deadlines', 'activity'] as const) {
          await page.goto(`/my-matters?tab=${tab}`);
          await settled(page, tab);
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
