import { Locator, Page } from '@playwright/test';
import { Api, Json } from '../support/api';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';
import { openEditAvailability } from '../support/users-grid';

/**
 * UX / QA review round 5 (issue #74, epic #68): the profile availability screen, the Swimlane and Users tabs at 1024 and 768, and the
 * read-only user. These are the regression tests for the Medium findings of docs/ux/review-round-5.md (UXR5-01 to UXR5-05) and the checks
 * the earlier reviews did not make (state across surfaces and zones, refresh after a change, permissions and direct URLs). Every test
 * creates its own people and tasks, finds them by their unique names and does not depend on counts or order.
 */

const ALL_DAY = [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({
  dayOfWeek,
  start: '00:00',
  end: '23:59',
}));

async function userCard(page: Page, userId: number): Promise<Locator> {
  const card = page.locator(`[data-user-card="${userId}"]`);
  await expect(card).toBeVisible();
  return card;
}

async function expectNoAxeViolations(page: Page, label: string): Promise<void> {
  if (!axeAvailable()) return;
  const violations = await axeViolations(page);
  expect(violations, `${label}: ${JSON.stringify(violations)}`).toEqual([]);
}

test.describe('Review round 5: profile availability, Swimlane and Users', () => {
  test('UXR5-02: the Users list no longer needs a "Scroll sideways" hint: the six-column grid fits (#432)', async ({
    page,
    seed,
  }) => {
    const person = await seed.user(['Data Technician'], 'r5scroll');
    const query = `/admin/users?status=all&name=${encodeURIComponent(person.username.split('\\')[1])}`;
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(query);
    await expect(page.locator(`tbody tr`)).toHaveCount(1);
    await expect(page.locator('[data-scroll-hint]')).toHaveCount(0);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await expect(page.locator('[data-scroll-hint]')).toHaveCount(0);
  });

  test('UXR5-05: a one-line Swimlane card title is a 24 px target (axe target-size) at 1366 and 1920', async ({
    page,
    seed,
  }) => {
    const world = await seed.world({ stepCount: 2 });
    const tag = uid();
    await seed.task(world, { title: `Hi ${tag}` });
    for (const [width, height] of [
      [1366, 768],
      [1920, 1080],
    ]) {
      await page.setViewportSize({ width, height });
      await page.goto(`/dashboard?tab=swimlane&q=${tag}`);
      const open = page.locator('[data-card-open]', { hasText: `Hi ${tag}` });
      await expect(open).toBeVisible();
      expect((await open.boundingBox())!.height).toBeGreaterThanOrEqual(24);
      await expectNoAxeViolations(page, `swimlane at ${width}`);
    }
  });

  test('UXR5-03: in the "Edit Availability" dialog the Save bar sits flush with the bottom of the dialog (no form rows show under it)', async ({
    page,
    seed,
  }) => {
    const person = await seed.user(['Data Technician'], 'r5dialog');
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(
      `/admin/users?status=all&name=${encodeURIComponent(person.username.split('\\')[1])}`,
    );
    await openEditAvailability(page.locator('tbody tr').first());
    // The Cancel and Save Changes bar is the footer of the shared form dialog.
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('.p-dialog-footer')).toBeVisible();
    await expect
      .poll(async () => {
        const bar = await dialog.locator('.p-dialog-footer').boundingBox();
        const box = await dialog.boundingBox();
        return bar && box ? Math.round(box.y + box.height - (bar.y + bar.height)) : null;
      })
      .toBeLessThanOrEqual(2);
    // Esc closes it and focus goes back to the button that opened it.
    await page.keyboard.press('Escape');
    await expect(page.locator('tbody tr').first().locator('button[data-overflow]')).toBeFocused();
  });

  test('the header "Set out of office" dialog returns focus to the account menu button on Esc, Cancel and Save', async ({
    seed,
    asUser,
  }) => {
    const lead = await seed.user(['Pod Lead'], 'r5focus');
    await seed.pod(undefined, [lead.userId]);
    const page = await asUser(lead.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/dashboard?tab=users');
    const trigger = page.getByRole('button', { name: /account menu/ });
    const openDialog = async () => {
      await trigger.click();
      await page.getByRole('menuitem', { name: 'Set Out of Office' }).click();
      await expect(page.getByRole('dialog', { name: 'Set out of office' })).toBeVisible();
    };
    await openDialog();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await openDialog();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(trigger).toBeFocused();
    await openDialog();
    await page.getByRole('button', { name: 'Set Out of Office', exact: true }).last().click();
    await expect(page.locator('[data-ooo-label]')).toBeVisible();
    await expect(trigger).toBeFocused();
  });

  test('a change of availability shows on the Users tab and on the Swimlane card after the five-minute refresh', async ({
    page,
    seed,
  }) => {
    const person = await seed.user(['Data Technician'], 'r5refresh');
    await seed.availability(person.userId, { workHours: ALL_DAY });
    const pod = await seed.pod(undefined, [person.userId]);
    const world = await seed.world({ stepCount: 2 });
    const tag = uid();
    await seed.task(world, {
      title: `Refresh ${tag}`,
      assignedUserId: person.userId,
      assignedPodId: pod.podId,
    });
    const nameFragment = person.username.split('\\')[1];

    await page.clock.install({ time: new Date() });
    await page.goto(`/dashboard?tab=users&uq=${nameFragment}`);
    const card = await userCard(page, person.userId);
    await expect(card).toHaveAttribute('data-availability', 'AVAILABLE');
    await page.waitForLoadState('networkidle');
    await seed.outOfOffice(person.userId, { note: 'Away' });
    await page.clock.fastForward('05:05');
    await expect(card).toHaveAttribute('data-availability', 'OUT_OF_OFFICE');
    // Focus stays where it was and the filter stays in the address.
    await expect(page).toHaveURL(new RegExp(`uq=${nameFragment}`));

    // The same on the Swimlane: the card's assignee shows the out-of-office dot.
    await page.goto(`/dashboard?tab=swimlane&q=${tag}`);
    const swimCard = page.locator('mf-swimlane-card', { hasText: `Refresh ${tag}` });
    await expect(swimCard.locator('[data-ooo]')).toHaveCount(1);
    await seed.availability(person.userId, { workHours: ALL_DAY });
    await page.waitForLoadState('networkidle');
    await page.clock.fastForward('05:05');
    await expect(swimCard.locator('[data-ooo]')).toHaveCount(0);
  });

  test('every surface agrees on the state of people in other time zones and with custom hours', async ({
    admin,
    seed,
  }) => {
    const tag = uid();
    // Around the clock in Tokyo, a weekend-only schedule in Auckland, no working days, out of office with an end date, and the default week.
    const make = async (label: string) => seed.user(['Data Technician'], `r5${label}${tag}`);
    const people = {
      tokyo: await make('tk'),
      auckland: await make('nz'),
      never: await make('nv'),
      out: await make('oo'),
      plain: await make('pl'),
    };
    await seed.availability(people.tokyo.userId, { timeZoneId: 'Asia/Tokyo', workHours: ALL_DAY });
    await seed.availability(people.auckland.userId, {
      timeZoneId: 'Pacific/Auckland',
      workHours: [6, 7].map((dayOfWeek) => ({ dayOfWeek, start: '08:00', end: '12:00' })),
    });
    await seed.availability(people.never.userId, { workHours: [] });
    await seed.outOfOffice(people.out.userId, {
      until: '2099-01-02',
      timeZoneId: 'Pacific/Kiritimati',
    });
    const pod = await seed.pod(
      undefined,
      Object.values(people).map((p) => p.userId),
    );
    const world = await seed.world({ stepCount: 2 });
    for (const p of Object.values(people)) {
      await seed.task(world, {
        title: `Zones ${tag}`,
        assignedUserId: p.userId,
        assignedPodId: pod.podId,
      });
    }

    const list = await admin.get<Json>(`/api/v1/users?status=all&search=${tag}&pageSize=50`);
    const listed = new Map<number, string>(
      list.items.map((u: Json) => [u.userId, u.availability.state] as [number, string]),
    );
    const workload = await admin.get<Json>(`/api/v1/dashboard/workload?podScope=${pod.podId}`);
    const tiles = new Map<number, string>(
      workload.users.map((u: Json) => [u.userId, u.availability.state] as [number, string]),
    );
    const board = await admin.get<Json>(`/api/v1/dashboard/swimlane?q=Zones%20${tag}`);
    const dots = new Map<number, string>();
    for (const lane of board.lanes)
      for (const card of lane.cards)
        dots.set(card.assignee.userId, card.assignee.availability.state);

    for (const p of Object.values(people)) {
      const profile = await admin.get<Json>(`/api/v1/users/${p.userId}/availability`);
      const state = profile.current.state;
      expect(listed.get(p.userId), 'Users administration').toBe(state);
      if (tiles.size > 0) expect(tiles.get(p.userId), 'Users tile').toBe(state);
      expect(dots.get(p.userId), 'Swimlane card').toBe(state);
    }
    expect(
      (await admin.get<Json>(`/api/v1/users/${people.out.userId}/availability`)).current.state,
    ).toBe('OUT_OF_OFFICE');
    expect(
      (await admin.get<Json>(`/api/v1/users/${people.never.userId}/availability`)).current.state,
    ).toBe('OFF_HOURS');
    expect(
      (await admin.get<Json>(`/api/v1/users/${people.tokyo.userId}/availability`)).current.state,
    ).toBe('AVAILABLE');
  });

  test('a read-only user: direct URLs to Swimlane and Users fall back to Summary with a notice, the own profile is editable, other people are not', async ({
    seed,
    asUser,
  }) => {
    const ro = await seed.user(['Read-Only Observer'], 'r5ro');
    const other = await seed.user(['Data Technician'], 'r5other');
    const page = await asUser(ro.username);
    for (const tab of ['swimlane', 'users']) {
      await page.goto(`/dashboard?tab=${tab}`);
      await expect(page.getByRole('tab', { name: 'Swimlane' })).toHaveCount(0);
      await expect(page.getByRole('tab', { name: 'Users' })).toHaveCount(0);
      await expect(page).toHaveURL(/tab=summary|\/dashboard$/);
      await expect(page.getByText(/is not available for your role/)).toBeVisible();
    }
    expect((await page.request.get('/api/v1/dashboard/swimlane')).status()).toBe(403);
    expect((await page.request.get('/api/v1/dashboard/workload')).status()).toBe(403);

    // Own availability: allowed.
    await page.goto('/profile');
    // The out-of-office list of the own profile is editable (the status radio and its Save are gone: absences replaced them).
    await expect(page.getByRole('button', { name: 'Add Out of Office' }).first()).toBeEnabled();
    // Somebody else's: not through the API, and no menu item or admin screen in the UI.
    const asRo = await Api.as(ro.username);
    try {
      expect((await asRo.raw('GET', `/api/v1/users/${other.userId}/availability`)).status).toBe(
        403,
      );
    } finally {
      await asRo.dispose();
    }
    await page.goto('/admin/users');
    await expect(page.getByRole('heading', { name: "You don't have access." })).toBeVisible();
  });
});

/**
 * Screenshots of docs/ux/review-round-5 (not a test: skipped unless E2E_SCREENSHOTS names the output folder):
 *   E2E_SCREENSHOTS=docs/ux/review-round-5 frontend/e2e/run-local.sh -g "review round 5 screenshots"
 */
const OUT = process.env['E2E_SCREENSHOTS'];

test.describe('review round 5 screenshots', () => {
  test.skip(!OUT, 'set E2E_SCREENSHOTS to the output folder');
});
