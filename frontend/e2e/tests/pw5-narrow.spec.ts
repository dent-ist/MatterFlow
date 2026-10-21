import { Page } from '@playwright/test';
import { PodWorkPage } from '../pages/queues.pages';
import { axeAvailable } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { podWorkFixtures } from '../support/pod-work-fixtures';
import { SIZES, axeClean, box, pageSideScroll, shot } from '../support/pod-work-checks';

/**
 * Pod Work on a phone (epic #546, package WP-PW5, #570, W10): the page's own rows (title, capped select, context line, chip row, tabs) leave
 * the first card within 200 px of the bottom of the page title at 375 px (it was 330 px with the four-tab, 2x2 version), and all three
 * tabs are in view and reachable by touch and keyboard. The shell's phone header (hamburger, app header) is not this page's. Screenshots go to
 * `E2E_SCREENSHOTS_PW` (docs/ux/pod-work-review/fixes/pw5-narrow); the "before" pictures are `screenshots/` of the review.
 */
test.describe('Pod Work first screen on a phone (#570)', () => {
  test('axe is available (the audits below really run)', () => {
    expect(axeAvailable(), 'set E2E_AXE_PATH to axe.min.js').toBe(true);
  });

  const firstCardGap = async (page: Page, selector: string) => {
    const h1 = await box(page.getByRole('heading', { name: 'Pod Work', level: 1 }));
    const card = await box(page.locator(selector).first());
    return card.y - (h1.y + h1.height);
  };

  for (const [name, view, selector] of [
    ['Unassigned', 'queue', 'li[data-task]'],
    ['By member', 'members', '[data-member-row]'],
    ['All open', 'all', 'li[data-task]'],
  ] as const) {
    test(`375x812, ${name}: the first card starts within 200 px of the page title, no sideways scroll, axe 0`, async ({
      seed,
      personas,
      asUser,
    }) => {
      const fx = await podWorkFixtures(seed, personas);
      const page = await asUser(fx.lead.username);
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(`/pods/work?podId=${fx.busy.podId}&view=${view}`);
      await expect(page.locator(selector).first()).toBeVisible();
      await page.waitForTimeout(300);
      const gap = await firstCardGap(page, selector);
      expect(gap, `the first card is ${Math.round(gap)} px under the title`).toBeLessThanOrEqual(
        200,
      );
      expect(await pageSideScroll(page)).toBeLessThanOrEqual(0);
      await shot(page, `first-screen-${view}-375x812`);
      await axeClean(page, `axe, ${name}, 375`);
    });
  }

  test('375x812: all three tabs are fully in view, and reachable by touch and by keyboard', async ({
    seed,
    personas,
    asUser,
  }) => {
    const fx = await podWorkFixtures(seed, personas);
    const page = await asUser(fx.lead.username);
    await page.setViewportSize({ width: 375, height: 812 });
    const pw = new PodWorkPage(page);
    await page.goto(`/pods/work?podId=${fx.busy.podId}`);
    const tabs = [pw.tab(/^Unassigned/), pw.tab(/^By member/), pw.tab(/^All open/)];
    for (const tab of tabs) {
      await expect(tab).toBeVisible();
      await expect(tab).toBeInViewport({ ratio: 1 });
    }
    // Touch: a tap on the third tab selects it.
    await tabs[2].tap().catch(async () => tabs[2].click());
    await expect(tabs[2]).toHaveAttribute('aria-selected', 'true');
    // Keyboard: Home and the arrow keys reach every tab.
    await page.keyboard.press('Home');
    await expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('End');
    await expect(tabs[2]).toHaveAttribute('aria-selected', 'true');
    await expect(tabs[2]).toBeInViewport({ ratio: 1 });
    expect(await pageSideScroll(page)).toBeLessThanOrEqual(0);
  });

  test('the other sizes keep their layout: the header is one title row plus the context line, tabs in one row', async ({
    seed,
    personas,
    asUser,
  }) => {
    const fx = await podWorkFixtures(seed, personas);
    const page = await asUser(fx.lead.username);
    for (const size of SIZES.slice(0, 3)) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto(`/pods/work?podId=${fx.busy.podId}`);
      await expect(page.locator('li[data-task], tr[data-task]').first()).toBeVisible();
      const tops = await page
        .getByRole('tab')
        .evaluateAll((tabs) => tabs.map((t) => Math.round(t.getBoundingClientRect().top)));
      expect(new Set(tops).size, `${size.name}: tabs in one row`).toBe(1);
      expect(await pageSideScroll(page)).toBeLessThanOrEqual(0);
      await shot(page, `first-screen-${size.name}`);
      await axeClean(page, `axe at ${size.name}`);
    }
  });
});
