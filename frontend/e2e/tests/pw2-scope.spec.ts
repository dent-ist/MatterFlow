import { PodWorkPage } from '../pages/queues.pages';
import { axeAvailable } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { podWorkFixtures } from '../support/pod-work-fixtures';
import { SIZES, axeClean, box, pageSideScroll, shot } from '../support/pod-work-checks';
import { toasts } from '../support/toasts';

/**
 * Pod Work, pod scope (epic #546, package WP-PW2): the context line and the pod in the document title (W2, #557), the list of pods when no
 * pod is chosen (W3, #558) and the honest "There are no pods yet." copy (W3, #559). Data: the fixtures of #547. Screenshots go to
 * `E2E_SCREENSHOTS_PW` (docs/ux/pod-work-review/fixes/pw2-scope). axe runs at the four sizes and the suite fails, never skips, without axe.
 */
const DOT = ' · ';

test.describe('Pod Work pod scope', () => {
  test('axe is available (the audits below really run)', () => {
    expect(axeAvailable(), 'set E2E_AXE_PATH to axe.min.js').toBe(true);
  });

  test.describe('#557 W2: the context line and the pod in the document title', () => {
    for (const size of SIZES) {
      test(`${size.name}: one muted line under the title, one row, axe 0, no sideways scroll`, async ({
        seed,
        personas,
        asUser,
      }) => {
        const fx = await podWorkFixtures(seed, personas);
        const page = await asUser(fx.lead.username);
        await page.setViewportSize({ width: size.width, height: size.height });
        const pw = new PodWorkPage(page);
        for (const pod of [fx.busy, fx.longName]) {
          await page.goto(`/pods/work?podId=${pod.podId}`);
          await expect(pw.podSelect.locator('option:checked')).toContainText(pod.name.slice(0, 20));
          const line = page.locator('[data-page-description]');
          await expect(line).toContainText(pod.name.slice(0, 20));
          await expect(line).toContainText(/you are a member/);
          const lineBox = await box(line);
          expect(lineBox.height, 'one line only').toBeLessThan(24);
          const h1 = await box(page.getByRole('heading', { name: 'Pod Work', level: 1 }));
          expect(h1.height, 'one title row').toBeLessThan(44);
          expect(await pageSideScroll(page)).toBeLessThanOrEqual(0);
          // Its whole text is the tooltip, so a clamped long name is still readable.
          await expect(line).toHaveAttribute('title', /you are a member/);
        }
        await shot(page, `context-line-long-name-${size.name}`);
        await page.goto(`/pods/work?podId=${fx.busy.podId}`);
        await expect(page.locator('[data-page-description]')).toContainText(fx.busy.name);
        await shot(page, `context-line-${size.name}`);
        await axeClean(page, `axe at ${size.name}`);
      });
    }

    test('names the pod, its members and the viewer: a member, a person who is not one, and a pod with no members', async ({
      seed,
      personas,
      admin,
      asUser,
    }) => {
      const fx = await podWorkFixtures(seed, personas);
      const apiPage = await admin.get(`/api/v1/pod-work?podId=${fx.busy.podId}`);
      const choice = apiPage.pods.find((p: { podId: number }) => p.podId === fx.busy.podId);
      expect(choice.memberCount).toBe(23);

      const lead = await asUser(fx.lead.username);
      await lead.goto(`/pods/work?podId=${fx.busy.podId}`);
      const leadLine = lead.locator('[data-page-description]');
      await expect(leadLine).toContainText(`${fx.busy.name}${DOT}23 members${DOT}you are a member`);

      const director = await asUser(fx.director.username);
      await director.goto(`/pods/work?podId=${fx.busy.podId}`);
      const dirLine = director.locator('[data-page-description]');
      await expect(dirLine).toHaveText(`${fx.busy.name}${DOT}23 members${DOT}you are not a member`);
      await expect(dirLine).not.toContainText('(primary)');

      await director.goto(`/pods/work?podId=${fx.empty.podId}`);
      await expect(director.locator('[data-page-description]')).toHaveText(
        `${fx.empty.name}${DOT}0 members${DOT}you are not a member`,
      );
    });

    test('a read-only person sees the same line', async ({ seed, personas, asUser }) => {
      const fx = await podWorkFixtures(seed, personas);
      const page = await asUser(fx.readonly.username);
      await page.goto(`/pods/work?podId=${fx.busy.podId}`);
      await expect(page.locator('[data-page-description]')).toContainText(
        `${fx.busy.name}${DOT}23 members${DOT}you are a member`,
      );
    });

    test('the document title names pod and tab, follows a pod change without a reload, and the change is announced politely without moving focus', async ({
      seed,
      personas,
      asUser,
    }) => {
      const fx = await podWorkFixtures(seed, personas);
      const page = await asUser(fx.multi.username);
      const pw = new PodWorkPage(page);
      const first = fx.multi.pods[0];
      await page.goto(`/pods/work?podId=${first.podId}`);
      await expect(page).toHaveTitle(`Pod Work: ${first.name}: Unassigned - MatterFlow`);
      await pw.tab('By member').click();
      await expect(page).toHaveTitle(`Pod Work: ${first.name}: By member - MatterFlow`);

      const second = fx.multi.pods[1];
      // The select has the focus (the person is on it) when the pod changes; the change never moves it.
      await pw.podSelect.focus();
      await pw.podSelect.selectOption({ value: String(second.podId) });
      await expect(page).toHaveTitle(new RegExp(`^Pod Work: ${second.name}: `));
      const live = page.locator('[data-pod-announce]');
      await expect(live).toHaveAttribute('aria-live', 'polite');
      await expect(live).toContainText(second.name);
      // Focus stays on the select: choosing a pod never moves it.
      await expect(pw.podSelect).toBeFocused();
    });
  });

  test.describe('#558 W3: with no pod chosen the pods are a list with counts', () => {
    for (const who of ['director', 'observer', 'noPod'] as const) {
      test(`${who}: the list shows every pod with its counts and no "Choose a Pod" sentence`, async ({
        seed,
        personas,
        admin,
        asUser,
      }) => {
        const fx = await podWorkFixtures(seed, personas);
        const page = await asUser(fx[who].username);
        await page.setViewportSize({ width: 1366, height: 768 });
        await page.goto('/pods/work');
        const list = page.locator('[data-pod-list]');
        await expect(list).toBeVisible();
        await expect(page.getByText('Choose a Pod to see its work')).toHaveCount(0);

        const api = await admin.get('/api/v1/pod-work');
        const pods = api.pods as {
          podId: number;
          name: string;
          memberCount: number;
          unassignedCount: number;
          overdueCount: number;
        }[];
        await expect(list.locator('button')).toHaveCount(pods.length);
        const busy = pods.find((p) => p.podId === fx.busy.podId)!;
        const row = list.locator(`[data-pod="${fx.busy.podId}"]`);
        const overdue = busy.overdueCount > 0 ? `${DOT}${busy.overdueCount} overdue` : '';
        await expect(row).toContainText(
          `${busy.memberCount} members${DOT}${busy.unassignedCount} unassigned${overdue}`,
        );
        // No membership: everything is under "Other pods".
        await expect(list.getByRole('heading', { name: 'Your pods' })).toHaveCount(0);
        await expect(list.getByRole('heading', { name: 'Other pods' })).toBeVisible();
        await shot(page, `pod-list-${who}-1366x768`);
      });
    }

    test('a person in several pods and no primary sees the groups, alphabetical inside each', async ({
      seed,
      personas,
      asUser,
    }) => {
      const fx = await podWorkFixtures(seed, personas);
      // A user with a primary pod goes straight to it: no list (no regression).
      const page = await asUser(fx.multi.username);
      await page.goto('/pods/work');
      await expect(page.locator('[data-pod-list]')).toHaveCount(0);
      await expect(page.getByRole('tab', { name: /Unassigned/ })).toBeVisible();
    });

    test('choosing a pod sets podId, remembers it, moves focus to the title and announces the pod', async ({
      seed,
      personas,
      asUser,
    }) => {
      const fx = await podWorkFixtures(seed, personas);
      const page = await asUser(fx.director.username);
      await page.goto('/pods/work');
      await page.locator(`[data-pod-list] [data-pod="${fx.busy.podId}"]`).click();
      await expect(page).toHaveURL(new RegExp(`podId=${fx.busy.podId}`));
      await expect(page.getByRole('heading', { name: 'Pod Work', level: 1 })).toBeFocused();
      await expect(page.locator('[data-pod-announce]')).toContainText(fx.busy.name);
      await expect(page.locator('[data-pod-list]')).toHaveCount(0);
      // Remembered: the next plain visit comes back to the same pod.
      await page.goto('/pods/work');
      await expect(page.locator('[data-page-description]')).toContainText(fx.busy.name);
    });

    test('keyboard: Tab reaches the pod rows and Enter chooses one', async ({
      seed,
      personas,
      asUser,
    }) => {
      const fx = await podWorkFixtures(seed, personas);
      const page = await asUser(fx.observer.username);
      await page.goto('/pods/work');
      const row = page.locator(`[data-pod-list] [data-pod="${fx.busy.podId}"]`);
      await row.focus();
      await expect(row).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(new RegExp(`podId=${fx.busy.podId}`));
    });

    for (const size of SIZES) {
      test(`${size.name}: the list is one column (max 40rem), axe 0, no sideways scroll`, async ({
        seed,
        personas,
        asUser,
      }) => {
        const fx = await podWorkFixtures(seed, personas);
        const page = await asUser(fx.director.username);
        await page.setViewportSize({ width: size.width, height: size.height });
        await page.goto('/pods/work');
        const list = page.locator('[data-pod-list]');
        await expect(list).toBeVisible();
        const b = await box(list);
        expect(b.width, 'not stretched').toBeLessThanOrEqual(40 * 16 + 1);
        expect(b.x + b.width).toBeLessThanOrEqual(size.width);
        expect(await pageSideScroll(page)).toBeLessThanOrEqual(0);
        await shot(page, `pod-list-${size.name}`);
        await axeClean(page, `axe at ${size.name}`);
      });
    }
  });

  test.describe('#559 W3: honest copy when the system has no pods', () => {
    const stub = async (page: import('@playwright/test').Page) => {
      await page.route('**/api/v1/pod-work*', (route) =>
        route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            items: [],
            total: 0,
            page: 1,
            pageSize: 50,
            timeZone: 'America/New_York',
            view: 'queue',
            pods: [],
            summary: {
              unassignedToPerson: 0,
              assigned: 0,
              overdue: 0,
              onHold: 0,
              dueToday: 0,
              asap: 0,
            },
            counts: { queue: 0, members: 0, attention: 0, all: 0, membersWithWork: 0 },
            memberLoads: [],
            unassigned: 0,
          }),
        }),
      );
    };

    test('with Pod.Manage: "There are no pods yet." and a Create a pod link to the Pods page', async ({
      seed,
      personas,
      asUser,
    }) => {
      const fx = await podWorkFixtures(seed, personas);
      const page = await asUser(fx.lead.username);
      await stub(page);
      await page.goto('/pods/work');
      const box = page.locator('[data-empty="no-pods"]');
      await expect(box).toContainText('There are no pods yet.');
      await expect(box).not.toContainText("You aren't in a pod yet");
      await expect(page.getByRole('link', { name: 'Create a pod' })).toHaveAttribute(
        'href',
        '/admin/pods?pod=new',
      );
      await shot(page, 'no-pods-manage-1366x768');
      await axeClean(page, 'axe, no pods with Pod.Manage');
    });

    test('without Pod.Manage: "Ask an administrator to create one." and no link', async ({
      seed,
      personas,
      asUser,
    }) => {
      const fx = await podWorkFixtures(seed, personas);
      const page = await asUser(fx.readonly.username);
      await stub(page);
      await page.goto('/pods/work');
      const box = page.locator('[data-empty="no-pods"]');
      await expect(box).toContainText('There are no pods yet.');
      await expect(box).toContainText('Ask an administrator to create one.');
      await expect(page.getByRole('link', { name: 'Create a pod' })).toHaveCount(0);
      await expect(toasts(page)).toHaveCount(0);
      for (const size of SIZES) {
        await page.setViewportSize({ width: size.width, height: size.height });
        expect(await pageSideScroll(page)).toBeLessThanOrEqual(0);
        await axeClean(page, `axe, no pods at ${size.name}`);
      }
      await shot(page, 'no-pods-read-1366x768');
    });
  });
});
