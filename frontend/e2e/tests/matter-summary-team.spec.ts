import { Page } from '@playwright/test';
import { Api, Json } from '../support/api';
import { axeAvailable, axeViolations } from '../support/axe';
import { asDropdown } from '../support/dropdown';
import { expect, test } from '../support/fixtures';
import { SIZES, noSideScroll } from '../support/labels';
import { Seeder, uid } from '../support/seed';

/**
 * Epic #1373 / #1376: the matter Summary tab. The Details card is grouped under quiet sub-headings (Matter, Classification, Management, Paths) with the Created and Last Updated
 * line as its footer, Matter Types are chips, an unset Matter Category offers "Set Category", Copy sits beside the path; the Team is an expandable panel in the 340 px side column
 * (it replaces the Team tab): avatar, name, title on this matter and the System User / Internal / External chip, three rows at 1366x768 and "Show All N", the Edit Team dialog
 * with the inline empty row (the person combobox), applied on Save. Each test works on its own client and matter (the database is shared).
 *
 * Screenshots (not a test: only with E2E_SCREENSHOTS set to the output folder):
 *   E2E_SCREENSHOTS=/tmp/matter-summary frontend/e2e/run-local.sh -g "Summary screenshots"
 */
const S1366 = SIZES[1];
const panel = (page: Page) => page.locator('[data-section-panel="team"]');
const rows = (page: Page) => panel(page).locator('[data-team-row]');
const dialog = (page: Page) => page.locator('.mf-formdlg');

async function shot(page: Page, name: string) {
  const dir = process.env['E2E_SCREENSHOTS'];
  if (dir)
    await page.screenshot({
      path: `${dir}/${name}-${page.viewportSize()!.width}x${page.viewportSize()!.height}.png`,
    });
}

async function axeClean(page: Page, label: string) {
  if (axeAvailable()) expect(await axeViolations(page), label).toEqual([]);
}

interface Person {
  personId: number;
  displayName?: string;
}

test.describe('Matter Summary: Details groups and the Team panel (#1376)', () => {
  const token = uid().slice(0, 6);

  /** A matter with types, state, paths and a team of `size` people (only Internal people can be on a matter team, #1383), titles from the admin list. */
  async function world(seed: Seeder, admin: Api, size: number, opts: { category?: boolean } = {}) {
    const client = await seed.client();
    const matter = await seed.matter({ client, number: '00001', name: `Acme v. Beta ${token}` });
    const types = (await admin.get<Json[]>('/api/v1/matter-types')).filter((t) => t.isActive);
    const states = (await admin.get<Json[]>('/api/v1/current-states')).filter((t) => t.isActive);
    const categories = (await admin.get<Json[]>('/api/v1/matter-categories')).filter(
      (t) => t.isActive,
    );
    await admin.put(`/api/v1/matters/${matter.matterId}`, {
      name: matter.name,
      isSensitive: false,
      rowVersion: matter.rowVersion,
      matterTypeIds: types.slice(0, 2).map((t) => t.id),
      currentStateId: states[0]?.id,
      matterCategoryId: opts.category ? categories[0]?.id : undefined,
      dmsPath: '\\\\fs01\\dms\\Matters\\1048\\0017',
      dfsPath: 'https://dfs.example.com/matters/10482/0017',
    });
    const titles = (await admin.get<Json[]>('/api/v1/team-titles')).filter((t) => t.isActive);
    const specs: [string, string, string, string?, string?][] = [
      ['Maria', 'Alvarez', 'INTERNAL', 'Case Manager'],
      ['Helen', 'Park', 'INTERNAL', 'Lead Attorney'],
      ['Victor', 'Lang', 'INTERNAL', 'Partner'],
      ['Tom', 'Becker', 'INTERNAL', 'Technical Lead'],
      ['Grace', 'Liu', 'INTERNAL', 'Compliance Director'],
    ];
    const people: Person[] = [];
    for (const [first, last, type, title, company] of specs.slice(0, size)) {
      people.push(
        await admin.post('/api/v1/people', {
          firstName: `${first}${token}`,
          lastName: last,
          personType: type,
          title,
          companyName: company,
          email: `${first}.${last}.${token}@demo.example`.toLowerCase(),
        }),
      );
    }
    for (const [i, p] of people.entries()) {
      await admin.post(`/api/v1/matters/${matter.matterId}/team`, {
        personId: p.personId,
        teamTitleId: titles[i % titles.length].id,
      });
    }
    return { matter, people, titles, types, client };
  }

  test('Summary: no Team tab, Details in groups with the record line, Team panel in the side column', async ({
    page,
    seed,
    admin,
  }) => {
    const w = await world(seed, admin, 5);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto(`/matters/${w.matter.matterId}`);
      await expect(page.getByRole('tab', { name: /^Team/ })).toHaveCount(0);
      await expect(page.locator('[data-summary-details]')).toBeVisible();
      await expect(page.locator('[data-details-group]')).toHaveText([
        'Matter',
        'Classification',
        'Management',
        'Paths',
      ]);
      // Matter Types are chips; the unset category is muted with Set Category; the paths have Copy right beside the value.
      await expect(page.locator('[data-matter-type-chip]')).toHaveCount(2);
      await expect(page.locator('[data-matter-category]')).toHaveText('Not set');
      await expect(page.locator('[data-set-category]')).toHaveText('Set Category');
      const dms = page.locator('[data-dms-path]');
      const text = await dms.locator('[data-path-text]').boundingBox();
      const copy = await dms.locator('button.mf-copy').boundingBox();
      expect(copy!.x - (text!.x + text!.width), 'Copy sits beside the path').toBeLessThan(40);
      // Created and Last Updated are one quiet line below the fields, inside the card.
      await expect(page.locator('[data-record-line]')).toContainText('Created');
      await expect(page.locator('[data-record-line]')).toContainText('Last Updated');
      // The side column is 340 px wide, to the right of the Details card; Team is its first panel.
      const side = await page.locator('[data-summary-side]').boundingBox();
      const details = await page.locator('[data-summary-details]').boundingBox();
      expect(Math.round(side!.width)).toBe(340);
      expect(side!.x).toBeGreaterThan(details!.x + details!.width - 1);
      await expect(panel(page).locator('[data-panel-title]')).toHaveText('Team');
      await expect(panel(page).locator('[data-panel-count]')).toHaveText('5');
      // Three rows at 768 px of height, five from 900 px; "Show All 5" only while there are more than shown.
      const cap = size.height >= 900 ? 5 : 3;
      await expect(rows(page)).toHaveCount(cap);
      await expect(page.locator('[data-team-show-all]')).toHaveCount(cap === 5 ? 0 : 1);
      await expect(rows(page).first().locator('[data-member-name]')).toContainText('Grace');
      await expect(rows(page).first().locator('[data-person-kind]')).toHaveText('Internal');
      await expect(page.locator('[data-team-edit]')).toBeVisible();
      await noSideScroll(page, `Summary at ${size.width}`);
      await axeClean(page, `Summary at ${size.width}`);
      // The page never scrolls; the Details card may scroll inside itself, the footer line stays in view.
      const page_scroll = await page.evaluate(
        () => document.documentElement.scrollHeight - document.documentElement.clientHeight,
      );
      expect(page_scroll, 'the page itself never scrolls').toBeLessThanOrEqual(0);
      await expect(page.locator('[data-record-line]')).toBeInViewport();
    }
  });

  test('the panel folds and unfolds, Show All lists the whole team read only, and the Team tab address opens the Summary', async ({
    page,
    seed,
    admin,
  }) => {
    const w = await world(seed, admin, 5);
    await page.setViewportSize(S1366);
    await page.goto(`/matters/${w.matter.matterId}?tab=team`);
    await expect(page.getByRole('tab', { name: /^Summary/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const toggle = panel(page).locator('[data-panel-toggle]');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle).toHaveAccessibleName('Collapse Team');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toHaveAccessibleName('Expand Team');
    await expect(rows(page)).toHaveCount(0);
    await expect(panel(page).locator('[data-panel-count]')).toHaveText('5');
    await toggle.click();
    await expect(rows(page)).toHaveCount(3);

    await page.locator('[data-team-show-all]').click();
    const all = dialog(page);
    await expect(all.locator('[data-panel-title]')).toContainText('Team (5)');
    await expect(all.locator('[data-team-all-row]')).toHaveCount(5);
    await axeClean(page, 'Team Show All dialog');
    await expect(all.getByRole('button', { name: 'Close', exact: true }).first()).toBeVisible();
    await expect(all.locator('[data-panel-primary]')).toHaveCount(0);
    await shot(page, 'team-show-all');
    await all.getByRole('button', { name: 'Close', exact: true }).last().click();
    await expect(dialog(page)).toHaveCount(0);
  });

  test('Edit Team: pick a person in the empty row, the title is required, remove, retitle, applied on Save', async ({
    page,
    seed,
    admin,
  }) => {
    const w = await world(seed, admin, 3);
    const extra: Person = await admin.post('/api/v1/people', {
      firstName: `Laura${token}`,
      lastName: 'Whitfield',
      personType: 'INTERNAL',
      title: 'Account Executive',
      email: `laura.${token}@demo.example`,
    });
    await page.setViewportSize(S1366);
    await page.goto(`/matters/${w.matter.matterId}`);
    await panel(page).locator('[data-team-edit]').click();
    const d = dialog(page);
    await expect(d.locator('[data-panel-title]')).toContainText('Edit Team');
    await expect(d.locator('[data-team-rows] [data-team-row]')).toHaveCount(3);
    await axeClean(page, 'Edit Team dialog');
    const save = d.locator('[data-panel-primary]');
    await expect(save).toHaveAttribute('aria-disabled', 'true'); // nothing changed yet
    // The empty row: type, pick; the person joins the list with no title and a red field; Save needs the title.
    await d.locator('#team-add').fill(`Laura${token}`);
    await page.locator('[role=option][data-person-id]').first().click();
    await expect(d.locator('[data-team-rows] [data-team-row]')).toHaveCount(4);
    await expect(d.locator('[data-team-summary]')).toContainText(
      '1 added. Choose a title for every row.',
    );
    await expect(save).toHaveAttribute('aria-disabled', 'true');
    // The person is on the list now: the picker shows them disabled as "On the List".
    await d.locator('#team-add').fill(`Laura${token}`);
    await expect(page.getByRole('option', { name: /On the List/ })).toBeVisible();
    await d.locator('#team-add').fill('');
    await page.keyboard.press('Escape');
    await expect(d).toBeVisible(); // Esc closed the list only, not the dialog
    const newRow = d.locator('[data-team-row][data-added]');
    await asDropdown(
      newRow.locator('[data-row-title] button, button[data-row-title]').first(),
    ).selectOption({
      label: w.titles[0].name,
    });
    await expect(d.locator('[data-team-summary]')).toHaveText('1 added.');
    // Remove the first saved person, retitle another.
    const first = d.locator('[data-team-rows] [data-team-row]').first();
    const removedName = (await first.locator('[data-row-name]').textContent())!.trim();
    await first.locator('[data-remove-row]').click();
    await expect(d.locator('[data-team-summary]')).toHaveText('1 added, 1 removed.');
    const second = d.locator('[data-team-rows] [data-team-row]').first();
    await asDropdown(
      second.locator('[data-row-title] button, button[data-row-title]').first(),
    ).selectOption({
      label: w.titles[w.titles.length - 1].name,
    });
    await shot(page, 'team-edit');
    await expect(save).not.toHaveAttribute('aria-disabled', 'true');
    await save.click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(panel(page).locator('[data-panel-count]')).toHaveText('3');
    const saved = await admin.get<Json>(`/api/v1/matters/${w.matter.matterId}/team?pageSize=100`);
    expect(saved.total).toBe(3);
    expect(saved.items.map((m: Json) => m.personId)).toContain(extra.personId);
    expect(saved.items.map((m: Json) => m.name)).not.toContain(removedName);
  });

  test('Edit Team: typed text that is not a picked person refuses the save, and a dirty Cancel asks first', async ({
    page,
    seed,
    admin,
  }) => {
    const w = await world(seed, admin, 2);
    await page.setViewportSize(S1366);
    await page.goto(`/matters/${w.matter.matterId}`);
    await panel(page).locator('[data-team-edit]').click();
    const d = dialog(page);
    await d
      .locator('[data-team-rows] [data-team-row]')
      .first()
      .locator('[data-remove-row]')
      .click();
    await d.locator('#team-add').fill('Somebody Not Picked');
    await page.keyboard.press('Escape');
    await d.locator('[data-panel-primary]').click();
    await expect(d.getByText('Choose a person from the list.')).toBeVisible();
    await d.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('You have unsaved changes. Discard them?')).toBeVisible();
    await page.getByRole('button', { name: 'Keep Editing' }).click();
    await expect(d).toBeVisible();
    await d.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Discard Changes' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(panel(page).locator('[data-panel-count]')).toHaveText('2');
  });

  test('an empty team is one line with Add Member; Set Category opens the Edit Matter page', async ({
    page,
    seed,
    admin,
  }) => {
    const w = await world(seed, admin, 0);
    await page.setViewportSize(S1366);
    await page.goto(`/matters/${w.matter.matterId}`);
    await expect(panel(page).locator('[data-panel-empty]')).toHaveText('No members');
    await expect(panel(page).locator('[data-panel-toggle]')).toHaveCount(0);
    await shot(page, 'summary-no-team');
    await panel(page).locator('[data-team-add]').click();
    await expect(dialog(page).locator('[data-panel-title]')).toContainText('Edit Team');
    await dialog(page).getByRole('button', { name: 'Cancel' }).click();
    await page.locator('[data-set-category]').click();
    await expect(page).toHaveURL(/\/matters\/\d+\/edit/);
  });

  test('a viewer without Matter.Edit sees the team and the details but no Edit, Add or Set Category', async ({
    asUser,
    seed,
    admin,
    personas,
  }) => {
    const w = await world(seed, admin, 2);
    const viewer = await personas.create({
      label: 'matter viewer',
      permissions: ['Matter.View', 'Client.View'],
    });
    const page = await asUser(viewer.username);
    await page.setViewportSize(S1366);
    await page.goto(`/matters/${w.matter.matterId}`);
    await expect(rows(page)).toHaveCount(2);
    await expect(
      page.locator('[data-team-edit], [data-team-add], [data-set-category]'),
    ).toHaveCount(0);
    await axeClean(page, 'Summary without Matter.Edit');
  });

  test('Edit Team offers Internal people only: an External person is not found, and a person created there is Internal (#1383)', async ({
    page,
    seed,
    admin,
  }) => {
    const w = await world(seed, admin, 2);
    const outsider: Person = await admin.post('/api/v1/people', {
      firstName: `Olga${token}`,
      lastName: 'Outsider',
      personType: 'EXTERNAL',
      companyName: 'Outside Counsel LLP',
      email: `olga.${token}@demo.example`,
    });
    expect(outsider.personId).toBeGreaterThan(0);
    await page.setViewportSize(S1366);
    await page.goto(`/matters/${w.matter.matterId}`);
    await panel(page).locator('[data-team-edit]').click();
    const d = dialog(page);
    await d.locator('#team-add').fill(`Olga${token}`);
    await expect(page.locator('[data-create]')).toBeVisible(); // only "+ Create" is offered
    await expect(page.locator('[role=option][data-person-id]')).toHaveCount(0);
    // The inline form creates an Internal person and does not show the Internal or External choice.
    await page.locator('[data-create]').click();
    await expect(d.locator('[data-person-new]')).toBeVisible();
    await expect(d.locator('[data-person-new] [data-person-type]')).toHaveCount(0);
  });

  test('Summary screenshots', async ({ page, seed, admin }) => {
    test.skip(!process.env['E2E_SCREENSHOTS'], 'screenshots only with E2E_SCREENSHOTS');
    const w = await world(seed, admin, 5);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto(`/matters/${w.matter.matterId}`);
      await expect(rows(page).first()).toBeVisible();
      await shot(page, 'summary');
      await panel(page).locator('[data-panel-toggle]').click();
      await shot(page, 'summary-team-collapsed');
      await panel(page).locator('[data-panel-toggle]').click();
    }
  });
});
