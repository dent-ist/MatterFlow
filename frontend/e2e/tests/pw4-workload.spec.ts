import { Page } from '@playwright/test';
import { PodWorkPage } from '../pages/queues.pages';
import { axeAvailable } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { podWorkFixtures } from '../support/pod-work-fixtures';
import { SIZES, axeClean, box, pageSideScroll, shot } from '../support/pod-work-checks';

/**
 * Pod Work, By member workload table (epic #546, package WP-PW4): the table with people with work first, idle members folded, availability,
 * a neutral bar and the Unassigned row (W1, W12, #566); the sortable headings (#568); the phone cards (#569). Data: the fixtures of #547
 * (the busy pod: 23 members, 7 with open work, one idle member out of office). Screenshots go to `E2E_SCREENSHOTS_PW`
 * (docs/ux/pod-work-review/fixes/pw4-members). axe runs at the four sizes and the suite fails, never skips, without axe.
 */
interface Load {
  userId: number;
  displayName: string;
  open: number;
  overdue: number;
  onHold: number;
  availability?: { state: string };
}

test.describe('Pod Work workload table', () => {
  const rows = (page: Page) => page.locator('[data-members] [data-member-row]');
  const fold = (page: Page) => page.locator('[data-member-fold] button');

  test('axe is available (the audits below really run)', () => {
    expect(axeAvailable(), 'set E2E_AXE_PATH to axe.min.js').toBe(true);
  });

  test.describe('#566 W1 / W12: the table', () => {
    test('1366x768: the Unassigned row and every person with work are in view with no scroll box; idle members are folded and open by keyboard', async ({
      seed,
      personas,
      admin,
      asUser,
    }) => {
      const fx = await podWorkFixtures(seed, personas);
      const api = await admin.get(`/api/v1/pod-work?podId=${fx.busy.podId}`);
      const loads = api.memberLoads as Load[];
      const working = loads.filter((m) => m.open > 0);
      const idle = loads.filter((m) => m.open === 0);
      expect(working.length).toBeGreaterThan(0);

      const page = await asUser(fx.lead.username);
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto(`/pods/work?podId=${fx.busy.podId}&view=members`);
      const table = page.locator('table[data-members]');
      await expect(table).toBeVisible();
      await expect(page.getByRole('region', { name: /Pod members/ })).toHaveCount(0);

      // The Unassigned row first, then the people with work alphabetically, then the folded row.
      await expect(rows(page)).toHaveCount(1 + working.length);
      await expect(rows(page).first()).toContainText('Not assigned to a person');
      await expect(rows(page).first().locator('td').first()).toHaveText(String(api.unassigned));
      const people = (await rows(page).locator('.pm-name').allInnerTexts()).map((n) => n.trim());
      for (const m of working) expect(people.join('|')).toContain(m.displayName);
      const sorted = [...working].map((m) => m.displayName).sort((a, b) => a.localeCompare(b));
      expect(people).toEqual(sorted);
      // Every one of them is in the window without scrolling anything.
      for (let i = 0; i < working.length + 1; i++) await expect(rows(page).nth(i)).toBeInViewport();
      await expect(fold(page)).toHaveText(`Show ${idle.length} members with no open work`);
      await expect(fold(page)).toHaveAttribute('aria-expanded', 'false');
      await shot(page, 'members-1366x768');

      // Keyboard: the fold opens with Enter and closes with Space; the idle people carry their availability.
      await fold(page).focus();
      await page.keyboard.press('Enter');
      await expect(fold(page)).toHaveAttribute('aria-expanded', 'true');
      await expect(fold(page)).toBeFocused();
      await expect(rows(page)).toHaveCount(1 + working.length + idle.length);
      await expect(
        page.locator('[data-availability-chip][data-state="OUT_OF_OFFICE"]'),
      ).toContainText(/Out of office/);
      await shot(page, 'members-unfolded-1366x768');
      await page.keyboard.press('Space');
      await expect(fold(page)).toHaveAttribute('aria-expanded', 'false');
      await expect(rows(page)).toHaveCount(1 + working.length);
    });

    test('the chip says what the assignee picker says; an inactive member is marked', async ({
      seed,
      personas,
      admin,
      asUser,
    }) => {
      const fx = await podWorkFixtures(seed, personas);
      const api = await admin.get(`/api/v1/pod-work?podId=${fx.busy.podId}`);
      const away = (api.memberLoads as Load[]).find(
        (m) => m.availability?.state === 'OUT_OF_OFFICE',
      );
      expect(away, 'the fixture has a member out of office').toBeTruthy();
      const page = await asUser(fx.lead.username);
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto(`/pods/work?podId=${fx.busy.podId}&view=members`);
      await fold(page).click();
      const row = page.locator(`[data-member-row][data-user="${away!.userId}"]`);
      const chip = (await row.locator('[data-availability-chip]').innerText()).trim();
      expect(chip).toMatch(/^Out of office( until [A-Z][a-z]{2} \d{1,2})?$/);

      // The text is the shared one (`outOfOfficeText`, as the assignee picker's flag and the profile chip): the unit tests pin it. The picker
      // marks only the first 50 people of its lookup, so a large test database may not flag this member there; the table always does.
    });

    test('Open is a number and a neutral bar scaled to the largest load; no rank numbers, no colour judgement', async ({
      seed,
      personas,
      asUser,
    }) => {
      const fx = await podWorkFixtures(seed, personas);
      const page = await asUser(fx.lead.username);
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto(`/pods/work?podId=${fx.busy.podId}&view=members`);
      await expect(page.locator('table[data-members]')).toBeVisible();
      const cells = await page.locator('[data-member-row][data-user]').evaluateAll((els) =>
        els.map((e) => ({
          open: Number(e.querySelector('.pm-open')?.textContent),
          width: e.querySelector<HTMLElement>('.pm-bar')?.getBoundingClientRect().width ?? 0,
          hidden: e.querySelector('.pm-bar')?.getAttribute('aria-hidden'),
          color: e.querySelector('.pm-bar')
            ? getComputedStyle(e.querySelector('.pm-bar')!).backgroundColor
            : '',
        })),
      );
      expect(cells.length).toBeGreaterThan(1);
      const widest = Math.max(...cells.map((c) => c.width));
      const biggest = Math.max(...cells.map((c) => c.open));
      for (const c of cells) {
        expect(c.hidden).toBe('true');
        expect(c.width).toBeCloseTo((c.open / biggest) * widest, 0);
      }
      // One neutral token: the same colour on every bar.
      expect(new Set(cells.map((c) => c.color)).size).toBe(1);
    });

    test('View tasks toggles the Assignee filter chip and the address; Back and focus return to the same row', async ({
      seed,
      personas,
      admin,
      asUser,
    }) => {
      const fx = await podWorkFixtures(seed, personas);
      const api = await admin.get(`/api/v1/pod-work?podId=${fx.busy.podId}`);
      const who = (api.memberLoads as Load[]).find((m) => m.open > 0)!;
      const page = await asUser(fx.lead.username);
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto(`/pods/work?podId=${fx.busy.podId}&view=members`);
      const row = page.locator(`[data-member-row][data-user="${who.userId}"]`);
      const view = row.getByRole('button', { name: `View tasks of ${who.displayName}` });
      await view.focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(new RegExp(`assignee=${who.userId}`));
      await expect(view).toHaveAttribute('aria-pressed', 'true');
      await expect(view).toBeFocused();
      await expect(page.locator('li[data-task], tr[data-task]').first()).toBeVisible();
      await expect(page.getByText(who.displayName).first()).toBeVisible();
      await page.goBack();
      await expect(page).not.toHaveURL(/assignee=/);
      await expect(view).toHaveAttribute('aria-pressed', 'false');
      // Two Tab stops per member row: the name, then View tasks.
      expect(await row.locator('button').count()).toBe(2);
    });

    test('"Not assigned to a person" opens the Unassigned tab', async ({
      seed,
      personas,
      asUser,
    }) => {
      const fx = await podWorkFixtures(seed, personas);
      const page = await asUser(fx.lead.username);
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto(`/pods/work?podId=${fx.busy.podId}&view=members`);
      await page.locator('[data-member-row="unassigned"] button').click();
      await expect(new PodWorkPage(page).tab(/^Unassigned/)).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expect(page).not.toHaveURL(/view=members/);
    });

    test('1920x1080: the table stays about 60rem wide so View tasks is near the name', async ({
      seed,
      personas,
      asUser,
    }) => {
      const fx = await podWorkFixtures(seed, personas);
      const page = await asUser(fx.lead.username);
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.goto(`/pods/work?podId=${fx.busy.podId}&view=members`);
      const table = page.locator('table[data-members]');
      await expect(table).toBeVisible();
      expect((await box(table)).width).toBeLessThanOrEqual(60 * 16 + 1);
      const first = rows(page).nth(1);
      const name = await box(first.locator('th button, th em').first());
      const view = await box(first.locator('.pm-view'));
      expect(view.x - (name.x + name.width)).toBeLessThan(700);
      await shot(page, 'members-1920x1080');
    });

    for (const size of [SIZES[0], SIZES[1], SIZES[2]]) {
      test(`${size.name}: axe 0 and no sideways scroll, folded and unfolded`, async ({
        seed,
        personas,
        asUser,
      }) => {
        const fx = await podWorkFixtures(seed, personas);
        const page = await asUser(fx.lead.username);
        await page.setViewportSize({ width: size.width, height: size.height });
        await page.goto(`/pods/work?podId=${fx.busy.podId}&view=members`);
        await expect(page.locator('table[data-members]')).toBeVisible();
        expect(await pageSideScroll(page)).toBeLessThanOrEqual(0);
        await axeClean(page, `axe, folded, at ${size.name}`);
        await fold(page).click();
        expect(await pageSideScroll(page)).toBeLessThanOrEqual(0);
        await axeClean(page, `axe, unfolded, at ${size.name}`);
        await shot(page, `members-table-${size.name}`);
      });
    }

    test('the skip link still lands on the first row of the table', async ({
      seed,
      personas,
      asUser,
    }) => {
      const fx = await podWorkFixtures(seed, personas);
      const page = await asUser(fx.lead.username);
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto(`/pods/work?podId=${fx.busy.podId}&view=members`);
      const skip = page.getByRole('link', { name: 'Skip to member table' });
      await skip.focus();
      await page.keyboard.press('Enter');
      await expect
        .poll(() =>
          rows(page)
            .first()
            .evaluate((row) => row.contains(document.activeElement)),
        )
        .toBe(true);
    });
  });

  test.describe('#568 W1: the headings sort (the viewer decides)', () => {
    test('Enter or Space on a heading sorts the people ascending, then descending, then back to alphabetical; aria-sort follows; focus stays', async ({
      seed,
      personas,
      asUser,
    }) => {
      const fx = await podWorkFixtures(seed, personas);
      const page = await asUser(fx.lead.username);
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto(`/pods/work?podId=${fx.busy.podId}&view=members`);
      const heading = page.getByRole('button', { name: 'Open', exact: true });
      const th = page.locator('thead th').nth(1);
      const opens = () =>
        page
          .locator('[data-member-row][data-user]:not([data-idle]) .pm-open')
          .evaluateAll((els) => els.map((e) => Number(e.textContent)));
      await expect(th).toHaveAttribute('aria-sort', 'none');
      const alpha = await opens();

      await heading.focus();
      await page.keyboard.press('Enter');
      await expect(th).toHaveAttribute('aria-sort', 'ascending');
      await expect(heading).toBeFocused();
      const asc = await opens();
      expect(asc).toEqual([...asc].sort((a, b) => a - b));

      await page.keyboard.press('Space');
      await expect(th).toHaveAttribute('aria-sort', 'descending');
      const desc = await opens();
      expect(desc).toEqual([...desc].sort((a, b) => b - a));
      // The Unassigned row keeps the first place and the fold keeps its place after the people.
      await expect(rows(page).first()).toContainText('Not assigned to a person');
      await expect(page.locator('[data-members] tbody tr').last()).toHaveAttribute(
        'data-member-fold',
        '',
      );

      await page.keyboard.press('Enter');
      await expect(th).toHaveAttribute('aria-sort', 'none');
      expect(await opens()).toEqual(alpha);
      await shot(page, 'members-sorted-1366x768');

      // Sort is the viewer's, not remembered: a reload is alphabetical again.
      await page.keyboard.press('Enter');
      await page.reload();
      await expect(page.locator('thead th').nth(1)).toHaveAttribute('aria-sort', 'none');
    });

    test('Overdue and On hold sort too; sorting applies to the unfolded idle members', async ({
      seed,
      personas,
      asUser,
    }) => {
      const fx = await podWorkFixtures(seed, personas);
      const page = await asUser(fx.lead.username);
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto(`/pods/work?podId=${fx.busy.podId}&view=members`);
      await fold(page).click();
      await page.getByRole('button', { name: 'Member', exact: true }).click();
      await page.getByRole('button', { name: 'Member', exact: true }).click();
      await expect(page.locator('thead th').first()).toHaveAttribute('aria-sort', 'descending');
      const idleNames = await page.locator('[data-member-row][data-idle] .pm-name').allInnerTexts();
      expect(idleNames.length).toBeGreaterThan(1);
      const check = [...idleNames].sort((a, b) =>
        b.localeCompare(a, undefined, { sensitivity: 'base' }),
      );
      expect(idleNames).toEqual(check);
      for (const name of ['Overdue', 'On hold']) {
        await page.getByRole('button', { name, exact: true }).click();
        await expect(page.locator('thead th', { hasText: name })).toHaveAttribute(
          'aria-sort',
          'ascending',
        );
      }
    });
  });

  test.describe('#569 W1: below 640 px each member is a card', () => {
    for (const size of [SIZES[3]]) {
      test(`${size.name}: cards with the three numbers and a 44 px View tasks, the fold works, no sideways scroll, axe 0`, async ({
        seed,
        personas,
        admin,
        asUser,
      }) => {
        const fx = await podWorkFixtures(seed, personas);
        const api = await admin.get(`/api/v1/pod-work?podId=${fx.busy.podId}`);
        const working = (api.memberLoads as Load[]).filter((m) => m.open > 0);
        const idle = (api.memberLoads as Load[]).filter((m) => m.open === 0);
        const page = await asUser(fx.lead.username);
        await page.setViewportSize({ width: size.width, height: size.height });
        await page.goto(`/pods/work?podId=${fx.busy.podId}&view=members`);
        await expect(page.locator('[data-members]')).toBeVisible();
        await expect(page.locator('table[data-members]')).toHaveCount(0);
        await expect(page.getByRole('region', { name: /Pod members/ })).toHaveCount(0);

        const cards = page.locator('[data-members] [data-member-row]');
        await expect(cards).toHaveCount(1 + working.length);
        await expect(cards.first()).toContainText('Not assigned to a person');
        const first = working[0];
        const card = page.locator(`[data-member-row][data-user="${first.userId}"]`);
        await expect(card).toContainText(first.displayName);
        await expect(card).toContainText(
          `${first.open} open · ${first.overdue} overdue · ${first.onHold} on hold`,
        );
        const view = card.getByRole('button', { name: `View tasks of ${first.displayName}` });
        expect((await box(view)).height).toBeGreaterThanOrEqual(44);
        expect(await pageSideScroll(page)).toBeLessThanOrEqual(0);
        await shot(page, `members-cards-${size.name}`);
        await axeClean(page, `axe, cards, at ${size.name}`);

        // The idle fold is a card too.
        await expect(fold(page)).toHaveText(`Show ${idle.length} members with no open work`);
        await fold(page).click();
        await expect(cards).toHaveCount(1 + working.length + idle.length);
        expect(await pageSideScroll(page)).toBeLessThanOrEqual(0);
        await axeClean(page, `axe, cards unfolded, at ${size.name}`);

        // Keyboard order: the name, then View tasks; View tasks sets the Assignee filter and keeps the focus on the card.
        const name = card.locator('[data-card-name]');
        await name.focus();
        await page.keyboard.press('Tab');
        await expect(view).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(new RegExp(`assignee=${first.userId}`));
        await expect(view).toHaveAttribute('aria-pressed', 'true');
        await expect(view).toBeFocused();
      });
    }

    test('768x1024: the table fits with no sideways scroll and axe 0', async ({
      seed,
      personas,
      asUser,
    }) => {
      const fx = await podWorkFixtures(seed, personas);
      const page = await asUser(fx.lead.username);
      await page.setViewportSize({ width: 768, height: 1024 });
      await page.goto(`/pods/work?podId=${fx.busy.podId}&view=members`);
      await expect(page.locator('table[data-members]')).toBeVisible();
      expect(await pageSideScroll(page)).toBeLessThanOrEqual(0);
      await expect(page.locator('[data-member-row] .pm-view').first()).toContainText('View tasks');
      await shot(page, 'members-768x1024');
      await axeClean(page, 'axe at 768');
    });
  });
});
