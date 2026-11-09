import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { SIZES, noSideScroll, shot } from '../support/labels';

/**
 * Epic #1314 (#1317, #1318): Administration > Lists. The master-detail page (catalogue of lists, editor of the open one), its redirects from the old
 * addresses, the views by permission and one smoke test per list. Screenshots go to E2E_SCREENSHOTS. The axe checks need axe-core (E2E_AXE_PATH).
 */
const LISTS = [
  ['matter-types', 'Matter Types', 'New Matter Type'],
  ['current-states', 'Current States', 'New State'],
  ['team-titles', 'Team Titles', 'New Title'],
  ['priorities', 'Priorities', 'New Priority'],
  ['status-labels', 'Status Labels', null],
  ['on-hold-reasons', 'On-Hold Reasons', 'New Reason'],
  ['note-tags', 'Note Tags', 'New Tag'],
  ['link-roles', 'Link Roles', 'New Link Role'],
] as const;

test.describe('the Lists page (epic #1314)', () => {
  test('the catalogue names all eight lists in four groups and the editor follows the pick, at both sizes', async ({
    page,
  }) => {
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto('/admin/lists/priorities');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lists');
      await expect(page).toHaveTitle('Lists: Priorities - MatterFlow');
      const catalogue = page.getByRole('complementary', { name: 'Lists' });
      await expect(catalogue).toBeVisible();
      // 320 px at both sizes: the catalogue never grows.
      expect((await catalogue.boundingBox())!.width).toBeCloseTo(320, 0);
      await expect(page.getByRole('listbox', { name: 'Lists' }).getByRole('option')).toHaveCount(8);
      await expect(page.getByRole('searchbox', { name: 'Find a list' })).toBeVisible();
      // The counts arrive as numbers (the lists' own GETs), never as a usage figure.
      await expect(catalogue.locator('[data-count]').first()).not.toHaveText('--');
      await expect(page.getByRole('heading', { level: 2 })).toHaveText('Priorities');
      await expect(page.getByRole('option', { name: /^Priorities/ })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await shot(page, 'lists-priorities');
      await noSideScroll(page, `lists at ${size.width}`);
    }
    await page.getByRole('option', { name: /^On-Hold Reasons/ }).click();
    await expect(page).toHaveURL(/\/admin\/lists\/on-hold-reasons$/);
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('On-Hold Reasons');
    await expect(page.getByRole('option', { name: /^On-Hold Reasons/ })).toBeFocused();
  });

  test('the listbox is one Tab stop and the arrow keys, Home and End move and open the lists', async ({
    page,
  }) => {
    await page.setViewportSize(SIZES[0]);
    await page.goto('/admin/lists/matter-types');
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('Matter Types');
    await page.getByRole('option', { name: /^Matter Types/ }).focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('Current States');
    await page.keyboard.press('End');
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('Link Roles');
    await page.keyboard.press('Home');
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('Matter Types');
    await expect(page).toHaveURL(/\/admin\/lists\/matter-types$/);
    // Only the selected option is a Tab stop.
    await expect(page.locator('[role="option"][tabindex="0"]')).toHaveCount(1);
  });

  test('Find a list filters by name, group, hint and Shown on, and says so when nothing matches', async ({
    page,
  }) => {
    await page.setViewportSize(SIZES[0]);
    await page.goto('/admin/lists/priorities');
    const find = page.getByRole('searchbox', { name: 'Find a list' });
    await find.fill('dashboard');
    await expect(page.getByRole('option')).toHaveText([/Status Labels/]);
    await find.fill('zzz');
    await expect(page.getByRole('option')).toHaveCount(0);
    await expect(page.locator('[data-no-match]')).toContainText('No list matches "zzz".');
    await shot(page, 'lists-no-match');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('option')).toHaveCount(8);
  });

  for (const [key, label, newLabel] of LISTS) {
    test(`${label}: opens at /admin/lists/${key} with its header, sentence, rule and rows`, async ({
      page,
    }) => {
      await page.setViewportSize(SIZES[1]);
      await page.goto(`/admin/lists/${key}`);
      await expect(page.getByRole('heading', { level: 2 })).toHaveText(label);
      await expect(page).toHaveTitle(`Lists: ${label} - MatterFlow`);
      await expect(page.locator('[data-shown-on]')).toContainText('Shown on:');
      await expect(page.locator('[data-rule]')).toBeVisible();
      await expect(page.locator('[data-list-body] tbody tr').first()).toBeVisible();
      if (newLabel)
        await expect(
          page.locator('mf-list-editor').getByRole('button', { name: newLabel }).first(),
        ).toBeVisible();
      else await expect(page.locator('mf-list-editor [data-new]')).toHaveCount(0);
      // Status Labels have no active state: their badge counts the five statuses.
      await expect(page.locator('[data-active-count]')).toContainText(
        key === 'status-labels' ? '5 statuses' : 'active',
      );
      await shot(page, `lists-${key}`);
      if (axeAvailable()) expect(await axeViolations(page), `${key} axe`).toEqual([]);
    });
  }
});

test.describe('old addresses go to the Lists page (UI spec 6.2)', () => {
  const OLD = [
    ['/admin/priorities', 'priorities', 'Task'],
    ['/admin/status-labels', 'status-labels', 'Task'],
    ['/admin/on-hold-reasons', 'on-hold-reasons', 'Task'],
    ['/admin/note-tags', 'note-tags', 'Notes'],
    ['/admin/matter-types', 'matter-types', 'Matter'],
    ['/admin/current-states', 'current-states', 'Matter'],
    ['/admin/team-titles', 'team-titles', 'Matter'],
    ['/admin/asset-link-roles', 'link-roles', 'Assets'],
    ['/admin/asset-types?tab=link-roles', 'link-roles', 'Assets'],
  ] as const;

  for (const [old, key, group] of OLD) {
    test(`${old} goes to /admin/lists/${key} and says so once`, async ({ page }) => {
      await page.setViewportSize(SIZES[0]);
      await page.goto(old);
      await expect(page).toHaveURL(new RegExp(`/admin/lists/${key}$`));
      const banner = page.locator('[data-moved-banner]');
      await expect(banner).toContainText(
        `has moved here, under Lists > ${group}. Update your bookmark.`,
      );
      if (key === 'link-roles') await shot(page, 'lists-moved-banner');
      await banner.getByRole('button', { name: 'Dismiss' }).click();
      await expect(banner).toHaveCount(0);
      // Back does not loop through the old address.
      await page.goBack();
      await expect(page).not.toHaveURL(new RegExp(old.replace('?', '\\?')));
    });
  }

  test('?edit=new is kept and opens the dialog', async ({ page }) => {
    await page.goto('/admin/priorities?edit=new');
    await expect(page).toHaveURL(/\/admin\/lists\/priorities\?edit=new$/);
    await expect(page.getByRole('dialog', { name: 'New Priority' })).toBeVisible();
  });

  test('/admin/lists and an unknown list open the first permitted list', async ({ page }) => {
    await page.goto('/admin/lists');
    await expect(page).toHaveURL(/\/admin\/lists\/matter-types$/);
    await page.goto('/admin/lists/nope');
    await expect(page).toHaveURL(/\/admin\/lists\/matter-types$/);
  });
});

test.describe('views by permission (UI spec 3.4)', () => {
  test('one list: no catalogue; two to four lists: a catalogue without the search box', async ({
    asUser,
    personas,
  }) => {
    const priorityOnly = await asUser(
      (await personas.create({ permissions: ['Priority.Manage'], label: 'lists-pr' })).username,
    );
    await priorityOnly.setViewportSize(SIZES[0]);
    await priorityOnly.goto('/admin/status-labels');
    await expect(priorityOnly).toHaveURL(/\/admin\/lists\/priorities$/);
    await expect(priorityOnly.getByRole('heading', { level: 1 })).toHaveText('Lists');
    await expect(priorityOnly.getByRole('heading', { level: 2 })).toHaveText('Priorities');
    await expect(priorityOnly.getByRole('listbox')).toHaveCount(0);
    await shot(priorityOnly, 'lists-single');

    const matterOnly = await asUser(
      (await personas.create({ permissions: ['MatterList.Manage'], label: 'lists-ml' })).username,
    );
    await matterOnly.setViewportSize(SIZES[0]);
    await matterOnly.goto('/admin/lists');
    await expect(matterOnly.getByRole('option')).toHaveCount(3);
    await expect(matterOnly.getByRole('searchbox', { name: 'Find a list' })).toHaveCount(0);
    await shot(matterOnly, 'lists-no-search');
  });

  test('Note Tags follow StatusLabel.Manage, Link Roles AssetType.Manage; nothing else shows the Lists item or the page', async ({
    asUser,
    personas,
  }) => {
    const statuses = await asUser(
      (await personas.create({ permissions: ['StatusLabel.Manage'], label: 'lists-sl' })).username,
    );
    await statuses.goto('/admin/lists');
    await expect(statuses.getByRole('option')).toHaveText([/Status Labels/, /Note Tags/]);
    const roles = await asUser(
      (await personas.create({ permissions: ['AssetType.Manage'], label: 'lists-at' })).username,
    );
    await roles.goto('/admin/lists');
    await expect(roles.getByRole('heading', { level: 2 })).toHaveText('Link Roles');
    await expect(
      roles
        .getByRole('list', { name: 'Administration' })
        .getByRole('link', { name: 'Asset Types' }),
    ).toBeVisible();
    const viewer = await asUser(
      (await personas.create({ permissions: ['Task.View'], label: 'lists-tv' })).username,
    );
    await viewer.goto('/admin/lists/priorities');
    await expect(viewer.getByRole('heading', { name: "You don't have access." })).toBeVisible();
  });
});

test.describe('Custom Fields cross-links (UI spec 3.5)', () => {
  test('Lists points to Custom Fields and Custom Fields points back with a banner', async ({
    page,
  }) => {
    await page.setViewportSize(SIZES[0]);
    await page.goto('/admin/lists/priorities');
    await expect(page.getByText('Need a new field instead?')).toBeVisible();
    await page.getByRole('link', { name: 'Open Custom Fields' }).click();
    await expect(page).toHaveURL(/\/admin\/custom-fields$/);
    const banner = page.locator('[data-lists-banner]');
    await expect(banner).toContainText(
      'Looking for the choices of a dropdown, such as Priority or Matter Type?',
    );
    await shot(page, 'custom-fields-banner');
    await banner.getByRole('link', { name: 'Open Lists' }).click();
    await expect(page).toHaveURL(/\/admin\/lists\/matter-types$/);
  });
});
