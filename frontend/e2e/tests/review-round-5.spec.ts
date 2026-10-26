import fs from 'node:fs';
import path from 'node:path';
import { Locator, Page } from '@playwright/test';
import { Api, Json } from '../support/api';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';
import { openEditAvailability, rowMenuItems } from '../support/users-grid';

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
  test('UXR5-01: at 768 px the selected Dashboard tab is inside the tab strip (a Pod Lead sees Summary, Swimlane, Users)', async ({
    seed,
    asUser,
  }) => {
    const lead = await seed.user(['Pod Lead'], 'r5tabs');
    await seed.pod(undefined, [lead.userId]);
    const page = await asUser(lead.username);
    await page.setViewportSize({ width: 768, height: 1024 });
    for (const tab of ['users', 'swimlane']) {
      await page.goto(`/dashboard?tab=${tab}`);
      const selected = page.locator(`[role="tab"][data-tab="${tab}"]`);
      await expect(selected).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('[data-refresh]')).toBeVisible(); // the controls beside the tab strip have arrived
      await expect
        .poll(async () => {
          const box = await selected.boundingBox();
          const list = await page.getByRole('tablist', { name: 'Dashboard views' }).boundingBox();
          return (
            !!box && !!list && box.x >= list.x - 1 && box.x + box.width <= list.x + list.width + 1
          );
        })
        .toBe(true);
    }
  });

  test('UXR5-04: the validation summary of My profile is axe clean (24 px link targets) at 1366 and 375', async ({
    seed,
    asUser,
  }) => {
    test.skip(!axeAvailable(), 'axe-core is not available');
    const user = await seed.user(['Data Technician'], 'r5valid');
    const page = await asUser(user.username);
    for (const size of [
      { width: 1366, height: 768 },
      { width: 375, height: 812 },
    ]) {
      await page.setViewportSize(size);
      await page.goto('/profile');
      await page.getByRole('radio', { name: /Out of office/ }).check();
      for (const [id, text] of [
        ['#av-from', 'Oct 30, 2026'],
        ['#av-until', 'Oct 20, 2026'],
      ]) {
        await page.locator(id).fill(text);
        await page.locator(id).blur();
      }
      await page.getByRole('button', { name: 'Save changes' }).click();
      const summary = page.locator('[data-summary]');
      await expect(summary).toBeFocused();
      const link = summary.getByRole('link', { name: /Until must be on or after From/ });
      const box = await link.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(24);
      await expectNoAxeViolations(page, `profile validation at ${size.width}`);
      // The link still moves focus to its field.
      await link.click();
      await expect(page.locator('#av-until')).toBeFocused();
      await page.getByRole('button', { name: 'Discard changes' }).click();
    }
  });

  test('UXR5-02: the Users list no longer needs a "Scroll sideways" hint: the six-column grid fits (#432)', async ({
    page,
    seed,
  }) => {
    const person = await seed.user(['Data Technician'], 'r5scroll');
    const query = `/admin/users?status=all&name=${encodeURIComponent(person.username.split('\\')[1])}`;
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto(query);
    await expect(page.locator(`tbody tr`)).toHaveCount(1);
    await expect(page.locator('[data-scroll-hint]')).toHaveCount(0);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await expect(page.locator('[data-scroll-hint]')).toHaveCount(0);
  });

  test('UXR5-05: a one-line Swimlane card title is a 24 px target (axe target-size) at 1024', async ({
    page,
    seed,
  }) => {
    const world = await seed.world({ stepCount: 2 });
    const tag = uid();
    await seed.task(world, { title: `Hi ${tag}` });
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto(`/dashboard?tab=swimlane&q=${tag}`);
    const open = page.locator('[data-card-open]', { hasText: `Hi ${tag}` });
    await expect(open).toBeVisible();
    expect((await open.boundingBox())!.height).toBeGreaterThanOrEqual(24);
    await expectNoAxeViolations(page, 'swimlane at 1024');
  });

  test('UXR5-03: in the "Edit availability" dialog the Save bar sits flush with the bottom of the dialog (no form rows show under it)', async ({
    page,
    seed,
  }) => {
    const person = await seed.user(['Data Technician'], 'r5dialog');
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(
      `/admin/users?status=all&name=${encodeURIComponent(person.username.split('\\')[1])}`,
    );
    await openEditAvailability(page.locator('tbody tr').first());
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('[data-actions]')).toBeVisible();
    await expect
      .poll(async () => {
        const bar = await dialog.locator('[data-actions]').boundingBox();
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
      await page.getByRole('menuitem', { name: 'Set out of office...' }).click();
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
    await page.getByRole('button', { name: 'Set out of office' }).last().click();
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
    await page.getByRole('radio', { name: /Out of office/ }).check();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Availability saved').first()).toBeVisible();
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
    await expect(
      page.getByRole('heading', { name: "You don't have permission to view this." }),
    ).toBeVisible();
  });
});

/**
 * Screenshots of docs/ux/review-round-5 (not a test: skipped unless E2E_SCREENSHOTS names the output folder):
 *   E2E_SCREENSHOTS=docs/ux/review-round-5 frontend/e2e/run-local.sh -g "review round 5 screenshots"
 */
const OUT = process.env['E2E_SCREENSHOTS'];

test.describe('review round 5 screenshots', () => {
  test.skip(!OUT, 'set E2E_SCREENSHOTS to the output folder');

  test('capture', async ({ page, admin, seed, asUser }) => {
    test.setTimeout(900_000);
    fs.mkdirSync(OUT!, { recursive: true });
    const tag = uid();
    const shot = async (p: Page, name: string) => {
      await p.waitForTimeout(350);
      await p.screenshot({ path: path.join(OUT!, `${name}.png`) });
    };
    const at = async (p: Page, w: number, h: number) => p.setViewportSize({ width: w, height: h });
    const rename = async (userId: number, displayName: string) => {
      const detail = await admin.get<Json>(`/api/v1/users/${userId}`);
      await admin.put(`/api/v1/users/${userId}`, {
        displayName: `${displayName} ${tag}`,
        email: null,
        rowVersion: detail.rowVersion,
      });
    };

    // The people: a Director, a Pod Lead and a technician in Pod A, a technician without a pod, a read-only observer, a person on leave,
    // one in Tokyo with their own hours, and a few colleagues with different loads.
    const dir = await seed.user(['Director'], `r5dir${tag}`);
    const lead = await seed.user(['Pod Lead'], `r5lead${tag}`);
    const tech = await seed.user(['Data Technician'], `r5tech${tag}`);
    const nopod = await seed.user(['Data Technician'], `r5nopod${tag}`);
    const ro = await seed.user(['Read-Only Observer'], `r5ro${tag}`);
    const leave = await seed.user(['Data Technician'], `r5leave${tag}`);
    const tokyo = await seed.user(['Data Technician'], `r5tokyo${tag}`);
    const crowd = [];
    for (let i = 0; i < 5; i++) crowd.push(await seed.user(['Data Technician'], `r5c${i}${tag}`));
    const names: [{ userId: number }, string][] = [
      [dir, 'Dana Director'],
      [lead, 'Marcus Lead'],
      [tech, 'Jamal Tech'],
      [nopod, 'Nina Nopod'],
      [ro, 'Vera Observer'],
      [leave, 'Lee Leave'],
      [tokyo, 'Taro Tokyo'],
      ...crowd.map((c, i): [{ userId: number }, string] => [
        c,
        ['Ana Adams', 'Ben Baker', 'Cai Chen', 'Dev Diaz', 'Eli Evans'][i],
      ]),
    ];
    for (const [u, n] of names) await rename(u.userId, n);
    const podA = await seed.pod(`Review A ${tag}`, [
      lead.userId,
      tech.userId,
      leave.userId,
      tokyo.userId,
      ...crowd.map((c) => c.userId),
    ]);
    await seed.availability(tokyo.userId, {
      timeZoneId: 'Asia/Tokyo',
      workHours: [1, 2, 3, 4, 5].map((dayOfWeek) => ({ dayOfWeek, start: '10:00', end: '18:30' })),
    });
    await seed.outOfOffice(leave.userId, {
      until: '2026-10-30',
      note: 'Annual leave, back Oct 31',
    });
    for (const u of [lead, tech, ...crowd])
      await seed.availability(u.userId, { workHours: ALL_DAY });

    const world = await seed.world({ stepCount: 3 });
    const priorities: Json = await admin.get('/api/v1/priorities');
    const plist: Json[] = (Array.isArray(priorities) ? priorities : priorities.items)
      .filter((p: Json) => p.isActive)
      .sort((a: Json, b: Json) => a.sortOrder - b.sortOrder);
    const loads: [{ userId: number }, number[]][] = [
      [tech, [0, 1, 2, 1]],
      [lead, [0, 0, 1, 0]],
      [leave, [0, 2, 1, 0]],
      [tokyo, [0, 0, 2, 2]],
      [crowd[0], [2, 1, 1, 0]],
      [crowd[1], [0, 3, 2, 1]],
      [crowd[2], [0, 0, 0, 3]],
      [crowd[3], [0, 0, 0, 0]],
    ];
    let n = 0;
    for (const [person, counts] of loads) {
      for (let p = 0; p < counts.length; p++) {
        for (let k = 0; k < counts[p]; k++) {
          await seed.task(world, {
            title: `Review ${tag} ${['Custodian intake', 'Production set', 'Privilege log', 'QC sample'][n % 4]} ${++n}`,
            priorityId: plist[p].id,
            assignedUserId: person.userId,
            assignedPodId: podA.podId,
          });
        }
      }
    }
    await seed.task(world, { title: `Review ${tag} Unassigned intake`, priorityId: plist[1].id });

    const s = (w: number) => `${w}`;

    // --- My profile (technician, then Director) ---
    const techPage = await asUser(tech.username);
    for (const [w, h] of [
      [1366, 768],
      [1024, 768],
      [768, 1024],
      [375, 812],
    ]) {
      await at(techPage, w, h);
      await techPage.goto('/profile');
      await expect(techPage.locator('h1 [data-availability-chip]')).toBeVisible();
      await shot(techPage, `01-profile-technician-${s(w)}`);
    }
    await at(techPage, 1366, 768);
    await techPage.getByRole('radio', { name: /Out of office/ }).check();
    await shot(techPage, '02-profile-out-of-office-1366');
    await techPage.locator('#av-from').fill('Oct 30, 2026');
    await techPage.locator('#av-from').blur();
    await techPage.locator('#av-until').fill('Oct 20, 2026');
    await techPage.locator('#av-until').blur();
    await techPage.locator('#av-tz').selectOption('__other__');
    await techPage.locator('#av-tz-other').fill('Mars/Olympus');
    await techPage.getByRole('button', { name: 'Save changes' }).click();
    await shot(techPage, '03-profile-validation-1366');
    await at(techPage, 375, 812);
    await shot(techPage, '04-profile-validation-375');
    await techPage.getByRole('button', { name: 'Discard changes' }).click();

    // Header menu and the Set out of office dialog.
    for (const [w, h] of [
      [1366, 768],
      [375, 812],
    ]) {
      await at(techPage, w, h);
      await techPage.goto('/my-work');
      await techPage.getByRole('button', { name: /account menu/ }).click();
      await shot(techPage, `05-header-menu-${s(w)}`);
      await techPage.getByRole('menuitem', { name: 'Set out of office...' }).click();
      await shot(techPage, `06-set-out-of-office-dialog-${s(w)}`);
      await techPage.getByRole('button', { name: 'Cancel' }).click();
      await expect(techPage.getByRole('button', { name: /account menu/ })).toBeFocused();
    }

    // Tokyo person: custom hours and time zone.
    const tokyoPage = await asUser(tokyo.username, { timezoneId: 'Asia/Tokyo' });
    await at(tokyoPage, 1366, 768);
    await tokyoPage.goto('/profile');
    await expect(tokyoPage.locator('h1 [data-availability-chip]')).toBeVisible();
    await shot(tokyoPage, '07-profile-tokyo-custom-hours-1366');

    // Read-only observer.
    const roPage = await asUser(ro.username);
    for (const [w, h] of [
      [1366, 768],
      [375, 812],
    ]) {
      await at(roPage, w, h);
      await roPage.goto('/profile');
      await expect(roPage.locator('h1 [data-availability-chip]')).toBeVisible();
      await shot(roPage, `08-profile-read-only-${s(w)}`);
    }
    for (const [w, h] of [
      [1366, 768],
      [768, 1024],
    ]) {
      await at(roPage, w, h);
      await roPage.goto('/dashboard?tab=users');
      await expect(roPage.getByText(/is not available for your role/)).toBeVisible();
      await shot(roPage, `09-read-only-users-url-${s(w)}`);
    }

    // --- Administration > Users (System Admin) ---
    for (const [w, h] of [
      [1366, 768],
      [1024, 768],
      [768, 1024],
    ]) {
      await at(page, w, h);
      await page.goto(`/admin/users?status=active&name=${tag}`);
      await expect(page.locator('[data-availability-chip]').first()).toBeVisible();
      await shot(page, `10-admin-users-${s(w)}`);
    }
    await at(page, 1366, 768);
    await page.goto(`/admin/users?status=active&name=${tag}&availability=OUT_OF_OFFICE`);
    await expect(page.locator('[data-availability-chip]')).toHaveCount(1);
    await shot(page, '11-admin-users-filter-out-of-office-1366');
    await page.goto(`/admin/users?status=active&name=Taro Tokyo ${tag}`);
    await openEditAvailability(page.locator('tbody tr', { hasText: 'Taro Tokyo' }));
    await shot(page, '12-admin-edit-availability-dialog-1366');
    await page.keyboard.press('Escape');

    // Director: the same list without the Edit availability button.
    const dirPage = await asUser(dir.username);
    await at(dirPage, 1366, 768);
    await dirPage.goto(`/admin/users?status=active&name=${tag}`);
    await expect(dirPage.locator('[data-availability-chip]').first()).toBeVisible();
    expect(await rowMenuItems(dirPage.locator('tbody tr').first())).toEqual(['Open']);
    await dirPage.keyboard.press('Escape');
    await shot(dirPage, '13-director-users-list-no-edit-1366');

    // --- Dashboard Users and Swimlane ---
    for (const [w, h] of [
      [1366, 768],
      [1024, 768],
      [768, 1024],
    ]) {
      await at(dirPage, w, h);
      await dirPage.goto(`/dashboard?tab=users&uq=${tag}`);
      await expect(dirPage.locator('[data-user-card]').first()).toBeVisible();
      await shot(dirPage, `14-users-director-${s(w)}`);
      await dirPage.goto(`/dashboard?tab=swimlane&q=${tag}${w < 900 ? '&lane=progress' : ''}`);
      await expect(dirPage.locator('mf-swimlane-card').first()).toBeVisible();
      await shot(dirPage, `15-swimlane-director-${s(w)}`);
    }

    const leadPage = await asUser(lead.username);
    for (const [w, h] of [
      [1024, 768],
      [768, 1024],
    ]) {
      await at(leadPage, w, h);
      await leadPage.goto(`/dashboard?tab=users&uq=${tag}`);
      await expect(leadPage.locator('[data-user-card]').first()).toBeVisible();
      await shot(leadPage, `16-users-pod-lead-${s(w)}`);
    }
    await at(leadPage, 1024, 768);
    await leadPage.goto(`/dashboard?tab=swimlane&q=${tag}`);
    await expect(leadPage.locator('mf-swimlane-card').first()).toBeVisible();
    await shot(leadPage, '17-swimlane-pod-lead-1024');

    // Technician and Dashboard (what a technician sees of the tabs).
    await at(techPage, 1366, 768);
    await techPage.goto('/dashboard?tab=users');
    await shot(techPage, '18-technician-dashboard-users-url-1366');
    void nopod;
  });
});
