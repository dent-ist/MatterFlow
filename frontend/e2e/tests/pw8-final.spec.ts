import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { MyWorkPage, PodWorkPage } from '../pages/queues.pages';
import { axeAvailable } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { delayApi, failApi, goOffline } from '../support/personas';
import { podWorkFixtures } from '../support/pod-work-fixtures';
import { SIZES, axeClean, box, pageSideScroll, shot } from '../support/pod-work-checks';
import { toasts } from '../support/toasts';

/**
 * Final verification of Pod Work (epic #546, package WP-PW8, #577): the contract over the fixtures at four sizes (axe 0 including
 * `target-size`, no sideways scroll, no failed API response and no toast on any allowed path, no nested scroll box on By member, "Assign to
 * me" in view at 768), the state matrix (loading, empty pod, no pod, no pods, error, offline, reduced motion) and the measurements of the
 * review taken again (`fixes/final/measurements.json`). Screenshots go to `E2E_SCREENSHOTS_PW` (docs/ux/pod-work-review/fixes/final). It uses
 * its own data (the fixtures of #547) and touches nothing of another run. axe is required: the suite fails, never skips, without it.
 */
const OUT = process.env['E2E_SCREENSHOTS_PW'];

function failedResponses(page: Page): string[] {
  const failed: string[] = [];
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
  });
  return failed;
}

test.describe('Pod Work final verification', () => {
  test('axe is available (the audits below really run)', () => {
    expect(axeAvailable(), 'set E2E_AXE_PATH to axe.min.js').toBe(true);
  });

  test.describe('the contract over the fixtures at four sizes', () => {
    for (const size of SIZES) {
      test(`${size.name}: every tab and state of the busy pod: axe 0, no sideways scroll, no failed request, no toast, no nested scroll box`, async ({
        seed,
        personas,
        asUser,
      }) => {
        test.setTimeout(240_000);
        const fx = await podWorkFixtures(seed, personas);
        const page = await asUser(fx.lead.username);
        await page.setViewportSize({ width: size.width, height: size.height });
        const failed = failedResponses(page);
        const base = `/pods/work?podId=${fx.busy.podId}`;
        const states: [string, string][] = [
          ['unassigned', base],
          ['by-member', `${base}&view=members`],
          ['all-open', `${base}&view=all`],
          ['all-open-overdue', `${base}&view=all&overdue=true`],
          ['all-open-on-hold', `${base}&view=all&status=ON_HOLD`],
          ['empty-pod-members', `/pods/work?podId=${fx.empty.podId}&view=members`],
          ['long-name', `/pods/work?podId=${fx.longName.podId}`],
        ];
        for (const [name, url] of states) {
          await page.goto(url);
          await expect(page.getByRole('heading', { name: 'Pod Work', level: 1 })).toBeVisible();
          await expect(page.locator('[role="tab"]').first()).toBeVisible();
          await page.waitForTimeout(300);
          expect(await pageSideScroll(page), `${name} sideways scroll`).toBeLessThanOrEqual(0);
          await axeClean(
            page,
            `axe (WCAG 2.2 AA, target-size, best practice), ${name}, ${size.name}`,
          );
          await shot(page, `${name}-${size.name}`);
        }

        // By member: the table has no scroll box of its own between it and the tab panel.
        await page.goto(`${base}&view=members`);
        await expect(page.locator('[data-members]')).toBeVisible();
        const stats = await page.evaluate(() => {
          const table = document.querySelector('[data-members]');
          const panel = document.querySelector('[role="tabpanel"]');
          const scrollers: string[] = [];
          for (let el = table?.parentElement ?? null; el && el !== panel; el = el.parentElement) {
            const o = getComputedStyle(el).overflowY;
            if (o === 'auto' || o === 'scroll') scrollers.push(el.tagName.toLowerCase());
          }
          return { found: !!table, scrollers };
        });
        expect(stats.found).toBe(true);
        expect(stats.scrollers, 'no nested scroll box around the workload table').toEqual([]);

        // Assign to me is in the first view at 768 px (and everywhere else), inside the grid.
        await page.goto(base);
        const pw = new PodWorkPage(page);
        const link = pw
          .assignToMe(fx.busy.unassignedNumbers[0])
          .or(page.getByRole('button', { name: /Assign .* to me/ }).first());
        await expect(link.first()).toBeVisible();
        await expect(link.first()).toBeInViewport({ ratio: 1 });
        expect(await pageSideScroll(page)).toBeLessThanOrEqual(0);

        expect(failed, 'no API response of 400 or more on any allowed path').toEqual([]);
        await expect(toasts(page)).toHaveCount(0);
      });
    }
  });

  test.describe('the state matrix', () => {
    test('loading: a skeleton or a polite "Loading" while the answer is slow, then the page; at 1366 and 375', async ({
      seed,
      personas,
      asUser,
    }) => {
      const fx = await podWorkFixtures(seed, personas);
      const page = await asUser(fx.lead.username);
      for (const size of [SIZES[0], SIZES[3]]) {
        await page.setViewportSize({ width: size.width, height: size.height });
        const release = await delayApi(page, /\/api\/v1\/pod-work\?/, 3500);
        await page.goto(`/pods/work?podId=${fx.busy.podId}`);
        await expect(page.getByRole('heading', { name: 'Pod Work', level: 1 })).toBeVisible();
        await expect(
          page.locator('[aria-busy="true"], [data-skeleton], [data-loading]').first(),
        ).toBeAttached();
        await shot(page, `loading-${size.name}`);
        await axeClean(page, `axe while loading, ${size.name}`);
        await release();
        await expect(page.locator('[data-task]').first()).toBeVisible({ timeout: 15_000 });
      }
    });

    test('empty pod, no pod and no pods are each one message or one list; error has the reference and Retry and no toast; at four sizes', async ({
      seed,
      personas,
      asUser,
    }) => {
      test.setTimeout(240_000);
      const fx = await podWorkFixtures(seed, personas);
      const lead = await asUser(fx.lead.username);
      const director = await asUser(fx.director.username);
      for (const size of SIZES) {
        await lead.setViewportSize({ width: size.width, height: size.height });
        await director.setViewportSize({ width: size.width, height: size.height });

        await lead.goto(`/pods/work?podId=${fx.empty.podId}`);
        await expect(lead.getByText(`Nothing waiting in ${fx.empty.name}.`)).toBeVisible();
        await lead.goto(`/pods/work?podId=${fx.empty.podId}&view=members`);
        await expect(lead.getByText('No members yet.')).toHaveCount(1);
        await expect(lead.getByRole('link', { name: 'Add members' })).toHaveCount(1);
        expect(await pageSideScroll(lead)).toBeLessThanOrEqual(0);
        await shot(lead, `empty-pod-${size.name}`);
        await axeClean(lead, `axe, empty pod, ${size.name}`);

        await director.goto('/pods/work');
        await expect(director.locator('[data-pod-list]')).toBeVisible();
        await expect(director.getByText('Choose a Pod to see its work')).toHaveCount(0);
        await shot(director, `no-pod-${size.name}`);
        await axeClean(director, `axe, no pod chosen, ${size.name}`);

        const unfail = await failApi(lead, /\/api\/v1\/pod-work\?/, 500);
        await lead.goto(`/pods/work?podId=${fx.busy.podId}`);
        const alert = lead.getByRole('alert').filter({ hasText: "Couldn't load tasks." });
        await expect(alert).toHaveCount(1);
        await expect(alert).toContainText('Reference:');
        await lead.waitForTimeout(800);
        await expect(toasts(lead)).toHaveCount(0);
        await shot(lead, `error-${size.name}`);
        await axeClean(lead, `axe, error state, ${size.name}`);
        await unfail();
        await lead.getByRole('button', { name: 'Retry' }).click();
        await expect(lead.locator('[data-task]').first()).toBeVisible();
      }

      // No pods at all (the pod list answered empty): both variants.
      const stub = {
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
      };
      for (const person of [fx.lead, fx.readonly]) {
        const page = await asUser(person.username);
        await page.route('**/api/v1/pod-work*', (route) =>
          route.fulfill({ contentType: 'application/json', body: JSON.stringify(stub) }),
        );
        for (const size of SIZES) {
          await page.setViewportSize({ width: size.width, height: size.height });
          await page.goto('/pods/work');
          await expect(page.locator('[data-empty="no-pods"]')).toContainText(
            'There are no pods yet.',
          );
          expect(await pageSideScroll(page)).toBeLessThanOrEqual(0);
          await axeClean(page, `axe, no pods, ${person.username}, ${size.name}`);
        }
      }
    });

    test('offline: the shell says so, the tab that cannot load shows one inline state with no toast, and it reads itself when the connection returns', async ({
      seed,
      personas,
      asUser,
    }) => {
      test.setTimeout(180_000);
      const fx = await podWorkFixtures(seed, personas);
      const page = await asUser(fx.lead.username);
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto(`/pods/work?podId=${fx.busy.podId}`);
      await expect(page.locator('[data-task]').first()).toBeVisible();
      await goOffline(page);
      await expect(page.locator('[data-offline-banner]')).toBeVisible({ timeout: 5000 });
      await new PodWorkPage(page).tab(/^All open/).click();
      await expect(page.getByText(/Couldn.t load tasks|offline/i).first()).toBeVisible({
        timeout: 15_000,
      });
      await shot(page, 'offline-1366x768');
      await expect(toasts(page)).toHaveCount(0);
      await goOffline(page, false);
      await expect(page.locator('[data-task]').first()).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('[data-offline-banner]')).toHaveCount(0);
    });

    test('reduced motion: nothing on the page keeps animating', async ({
      seed,
      personas,
      asUser,
    }) => {
      const fx = await podWorkFixtures(seed, personas);
      const page = await asUser(fx.lead.username);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.setViewportSize({ width: 1366, height: 768 });
      const release = await delayApi(page, /\/api\/v1\/pod-work\?/, 2500);
      await page.goto(`/pods/work?podId=${fx.busy.podId}`);
      await expect(page.getByRole('heading', { name: 'Pod Work', level: 1 })).toBeVisible();
      await page.waitForTimeout(600);
      const loading = await page.evaluate(
        () =>
          document
            .getAnimations()
            .filter(
              (a) =>
                a.playState === 'running' && a.effect?.getComputedTiming().iterations === Infinity,
            ).length,
      );
      await release();
      await expect(page.locator('[data-task]').first()).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(500);
      const settled = await page.evaluate(
        () => document.getAnimations().filter((a) => a.playState === 'running').length,
      );
      expect(loading, 'no endless animation while loading').toBe(0);
      expect(settled, 'no animation running once the page is shown').toBe(0);
    });
  });

  test.describe('the measurements of the review, taken again', () => {
    test('title, select, header, By member, phone first screen, strip and toast', async ({
      seed,
      personas,
      asUser,
    }) => {
      test.setTimeout(240_000);
      const fx = await podWorkFixtures(seed, personas);
      const page = await asUser(fx.lead.username);
      const after: Record<string, number | string | boolean> = {};

      // BUG-1 / W2 / W4 at 768 with the 76-character pod name.
      await page.setViewportSize({ width: 768, height: 1024 });
      await page.goto(`/pods/work?podId=${fx.longName.podId}`);
      const pw = new PodWorkPage(page);
      await expect(pw.podSelect).toBeVisible();
      const h1 = await box(page.getByRole('heading', { name: 'Pod Work', level: 1 }));
      after['title height at 768 (px)'] = Math.round(h1.height);
      expect(h1.height).toBeLessThan(44);
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto(`/pods/work?podId=${fx.longName.podId}`);
      const sel = await box(pw.podSelect);
      after['pod select width with the 76-character name at 1366 (px)'] = Math.round(sel.width);
      expect(sel.width).toBeLessThanOrEqual(22 * 14 + 1);
      const podTop = (await box(page.getByRole('heading', { name: 'Pod Work', level: 1 }))).y;
      await new MyWorkPage(page).open();
      const myTop = (await box(page.getByRole('heading', { level: 1 }))).y;
      after['title top, Pod Work minus My Work (px)'] = Math.round(podTop - myTop);
      expect(podTop).toBe(myTop);

      // W1: By member at 1366x768.
      await page.goto(`/pods/work?podId=${fx.busy.podId}&view=members`);
      await expect(page.locator('table[data-members]')).toBeVisible();
      const rows = page.locator('[data-members] [data-member-row]');
      let inView = 0;
      for (let i = 0; i < (await rows.count()); i++) {
        if (
          await rows.nth(i).evaluate((el) => {
            const b = el.getBoundingClientRect();
            return b.top >= 0 && b.bottom <= window.innerHeight;
          })
        )
          inView++;
      }
      after['By member rows in view at 1366x768 (no scroll)'] = inView;
      after['By member nested scroll boxes'] = await page.evaluate(() => {
        const table = document.querySelector('[data-members]');
        const panel = document.querySelector('[role="tabpanel"]');
        let n = 0;
        for (let el = table?.parentElement ?? null; el && el !== panel; el = el.parentElement) {
          const o = getComputedStyle(el).overflowY;
          if (o === 'auto' || o === 'scroll') n++;
        }
        return n;
      });
      expect(inView).toBeGreaterThanOrEqual(8);

      // BUG-4 and W10 at 375.
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(`/pods/work?podId=${fx.busy.podId}`);
      await expect(page.locator('li[data-task]').first()).toBeVisible();
      await page.waitForTimeout(300);
      after['page width minus window at 375 (px)'] = await pageSideScroll(page);
      const t = await box(page.getByRole('heading', { name: 'Pod Work', level: 1 }));
      const c = await box(page.locator('li[data-task]').first());
      after['first card under the title at 375 (px)'] = Math.round(c.y - (t.y + t.height));
      expect(c.y - (t.y + t.height)).toBeLessThanOrEqual(200);

      // W5: the strip.
      after['strip items that are toggle buttons'] = await page
        .locator('button[data-strip-item]')
        .count();
      expect(after['strip items that are toggle buttons']).toBe(4);

      // Bundle: the initial total is recorded by the build log (607.48 kB before and after, limit 700).
      after['initial bundle total (kB), build log'] = 607.48;

      const outDir = OUT ?? '';
      if (outDir) {
        fs.mkdirSync(outDir, { recursive: true });
        const before = {
          'title height at 768 (px)': 'wrapped letter by letter ("Po / d / Wo / rk"), BUG-1',
          'pod select width with the 76-character name at 1366 (px)': 560,
          'title top, Pod Work minus My Work (px)': 6,
          'By member rows in view at 1366x768 (no scroll)': 4,
          'By member nested scroll boxes': 1,
          'page width minus window at 375 (px)': 611 - 375,
          'first card under the title at 375 (px)': 330,
          'strip items that are toggle buttons': 0,
          'initial bundle total (kB), build log': 607,
        };
        fs.writeFileSync(
          path.join(outDir, 'measurements.json'),
          JSON.stringify({ before: before, after }, null, 2) + '\n',
        );
      }
    });
  });
});
