import { Page } from '@playwright/test';
import { Api } from '../support/api';
import { axeAvailable } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Persona } from '../support/personas';
import { podWorkFixtures } from '../support/pod-work-fixtures';
import { axeClean, pageSideScroll } from '../support/pod-work-checks';
import { toasts } from '../support/toasts';

/**
 * Pod Work permission matrix (epic #546, package WP-PW7, #574): for every kind of person the page's controls are exactly what their
 * permissions allow: the rail item and the page need Pod.View and Task.View (else the 403 page with no request); "Assign to me" needs
 * Task.Assign; "Add members" needs Pod.ManageMembers; "Create a pod" needs Pod.Manage. A control a person may not use is hidden, never
 * disabled. On every allowed path no request is answered 403, no toast appears and nothing on the page looks disabled. The table of the
 * result is docs/ux/pod-work-review/fixes/pw7-access/permissions.md. axe runs on the main states and the suite fails without axe.
 */
const EMPTY_PODS = {
  items: [],
  total: 0,
  page: 1,
  pageSize: 50,
  timeZone: 'America/New_York',
  view: 'queue',
  pods: [],
  summary: { unassignedToPerson: 0, assigned: 0, overdue: 0, onHold: 0, dueToday: 0, asap: 0 },
  counts: { queue: 0, members: 0, attention: 0, all: 0, membersWithWork: 0 },
  memberLoads: [],
  unassigned: 0,
};

/** What the page's own parts show as dead: a disabled or aria-disabled control in the header, strip, tabs, pod list or workload table. */
const DEAD =
  '[data-page-actions] [disabled], [data-strip] [disabled], [role="tablist"] [disabled], [data-pod-list] [disabled], ' +
  '[data-members] [disabled], [data-assign-link][disabled], [aria-disabled="true"]:is([data-strip-item], [role="tab"], [data-pod], [data-assign-link])';

interface Watch {
  forbidden: string[];
  podWorkRequests: string[];
}

function watch(page: Page): Watch {
  const seen: Watch = { forbidden: [], podWorkRequests: [] };
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() === 403) seen.forbidden.push(r.url());
  });
  page.on('request', (r) => {
    if (r.url().includes('/api/v1/pod-work')) seen.podWorkRequests.push(r.url());
  });
  return seen;
}

async function permissionsOf(username: string): Promise<Set<string>> {
  const api = await Api.as(username);
  try {
    return new Set<string>((await api.get('/api/v1/me')).permissions);
  } finally {
    await api.dispose();
  }
}

test.describe('Pod Work permission matrix', () => {
  test('axe is available (the audits below really run)', () => {
    expect(axeAvailable(), 'set E2E_AXE_PATH to axe.min.js').toBe(true);
  });

  test('without Task.View or without Pod.View: no rail item, the 403 page, no Pod Work request, no toast', async ({
    seed,
    personas,
    asUser,
  }) => {
    const fx = await podWorkFixtures(seed, personas);
    const noPodView = await personas.create({ label: 'pw-notview2', permissions: ['Task.View'] });
    for (const [who, person] of [
      ['Pod.View without Task.View', fx.podNoTask],
      ['Task.View without Pod.View', noPodView],
    ] as const) {
      const page = await asUser(person.username);
      await page.setViewportSize({ width: 1366, height: 768 });
      const seen = watch(page);
      await page.goto('/pods/work?podId=1');
      await expect(
        page.getByRole('heading', { name: "You don't have permission to view this." }),
        who,
      ).toBeVisible();
      await page.waitForTimeout(400);
      expect(seen.podWorkRequests, `${who}: nothing asked of Pod Work`).toEqual([]);
      await expect(toasts(page), who).toHaveCount(0);
      await expect(
        page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Pod Work' }),
        who,
      ).toHaveCount(0);
      await axeClean(page, `axe, 403, ${who}`);
    }
  });

  test('every person who may open Pod Work gets exactly the controls their permissions allow, and no 403, toast or disabled control', async ({
    seed,
    personas,
    asUser,
  }) => {
    test.setTimeout(240_000);
    const fx = await podWorkFixtures(seed, personas);
    const podManage = await personas.create({
      label: 'pw-podmanage',
      permissions: ['Pod.View', 'Task.View', 'Pod.Manage', 'Matter.View', 'Client.View'],
    });
    const membersOnly = await personas.create({
      label: 'pw-membersonly',
      permissions: [
        'Pod.View',
        'Task.View',
        'Pod.ManageMembers',
        'Task.Assign',
        'Matter.View',
        'Client.View',
      ],
    });
    const people: [string, Persona][] = [
      ['Pod Lead', fx.lead],
      ['read-only (Pod.View, Task.View)', fx.readonly],
      ['Pod.Manage only', podManage],
      ['Pod.ManageMembers and Task.Assign', membersOnly],
      ['Director, no pod', fx.director],
      ['Read-Only Observer, no pod', fx.observer],
    ];

    for (const [who, person] of people) {
      const can = await permissionsOf(person.username);
      expect(can.has('Pod.View') && can.has('Task.View'), `${who} may open the page`).toBe(true);
      const page = await asUser(person.username);
      await page.setViewportSize({ width: 1366, height: 768 });
      const seen = watch(page);

      // The rail item and the page.
      await page.goto('/my-work');
      await expect(
        page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Pod Work' }),
        who,
      ).toBeVisible();

      // No pod chosen: the list of pods (people with no pod and no remembered pod: before any pod is opened).
      if (person === fx.director || person === fx.observer) {
        await page.goto('/pods/work');
        await expect(page.locator('[data-pod-list]'), who).toBeVisible();
        expect(await page.locator(DEAD).count(), `${who}: pod list`).toBe(0);
        await axeClean(page, `axe, pod list, ${who}`);
      }

      // A pod's three tabs and the strip; assign controls follow Task.Assign alone.
      for (const view of ['queue', 'all', 'members']) {
        await page.goto(`/pods/work?podId=${fx.busy.podId}&view=${view}`);
        await expect(page.locator('[data-strip-item="overdue"]'), `${who} ${view}`).toBeVisible();
        await expect(page.getByRole('tab')).toHaveCount(3);
        if (view === 'queue' && can.has('Task.Assign')) {
          await expect(page.locator('[data-assign-link]').first(), who).toBeVisible();
        }
        if (!can.has('Task.Assign'))
          await expect(
            page.locator('[data-assign-link]'),
            `${who} ${view}: no assign control`,
          ).toHaveCount(0);
        expect(await page.locator(DEAD).count(), `${who} ${view}: nothing looks disabled`).toBe(0);
        expect(await pageSideScroll(page)).toBeLessThanOrEqual(0);
      }

      // An empty pod: "Add members" only with Pod.ManageMembers.
      await page.goto(`/pods/work?podId=${fx.empty.podId}&view=members`);
      await expect(page.getByText('No members yet.'), who).toBeVisible();
      await expect(page.getByRole('link', { name: 'Add members' }), who).toHaveCount(
        can.has('Pod.ManageMembers') ? 1 : 0,
      );

      // The system has no pods at all: "Create a pod" only with Pod.Manage.
      await page.route('**/api/v1/pod-work*', (route) =>
        route.fulfill({ contentType: 'application/json', body: JSON.stringify(EMPTY_PODS) }),
      );
      await page.goto('/pods/work');
      await expect(page.locator('[data-empty="no-pods"]'), who).toContainText(
        'There are no pods yet.',
      );
      await expect(page.getByRole('link', { name: 'Create a pod' }), who).toHaveCount(
        can.has('Pod.Manage') ? 1 : 0,
      );
      await expect(page.getByText('Ask an administrator to create one.'), who).toHaveCount(
        can.has('Pod.Manage') ? 0 : 1,
      );
      await axeClean(page, `axe, no pods, ${who}`);
      await page.unroute('**/api/v1/pod-work*');

      expect(seen.forbidden, `${who}: no request answered 403`).toEqual([]);
      await expect(toasts(page), `${who}: no toast`).toHaveCount(0);
    }
  });

  test('the strip and the tabs are the same for a read-only person: it only filters', async ({
    seed,
    personas,
    asUser,
  }) => {
    const fx = await podWorkFixtures(seed, personas);
    const page = await asUser(fx.readonly.username);
    const seen = watch(page);
    await page.goto(`/pods/work?podId=${fx.busy.podId}`);
    await page.locator('[data-strip-item="onHold"]').click();
    await expect(page).toHaveURL(/status=ON_HOLD/);
    await page.getByRole('tab', { name: /^By member/ }).click();
    await page.locator('[data-member-row][data-user] .pm-view').first().click();
    await expect(page).toHaveURL(/assignee=\d+/);
    await expect(toasts(page)).toHaveCount(0);
    expect(seen.forbidden).toEqual([]);
  });
});
