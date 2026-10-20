import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Setup, build } from '../support/ty-workflow';
import { uid } from '../support/seed';

/**
 * WP-TY5 Workflow record page (epic #352): the record header, summary strip and tabs (#387, #388), the Task types tab (#389), the
 * deactivation dialog that names the task types (#390) and the version table (#392). With E2E_SCREENSHOTS set to a folder the tests also
 * save a screenshot per width (docs/ux/task-types-review/fixes/ty5-workflow).
 */
const SHOTS = process.env['E2E_SCREENSHOTS'];
const SIZES = [
  { w: 375, h: 812 },
  { w: 768, h: 1024 },
  { w: 1024, h: 768 },
  { w: 1366, h: 768 },
  { w: 1920, h: 1080 },
] as const;

async function shot(page: Page, name: string, w: number): Promise<void> {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}-${w}.png`) });
}

const noSideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

const url = (s: Setup, tab?: string) =>
  `/admin/workflows/${s.workflow.workflowDefinitionId}${tab ? `?tab=${tab}` : ''}`;
const header = (page: Page) => page.locator('[data-record-header]');
const tab = (page: Page, label: string) => page.getByRole('tab', { name: new RegExp(`^${label}`) });

test.describe('Workflow record page (WP-TY5)', () => {
  test('header, badges, strip and tabs show the API numbers; the primary is Open draft v3', async ({
    page,
    seed,
    admin,
  }) => {
    const s = await build(seed, admin, { types: 2 });
    const api = await admin.get<{
      workflow: { taskTypeCount: number };
      versions: { versionNo: number; openTaskCount: number; createdByName: string }[];
    }>(`/api/v1/workflows/${s.workflow.workflowDefinitionId}`);
    const published = api.versions.find((v) => v.versionNo === 2)!;
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(url(s));
    await expect(page.getByRole('heading', { level: 1 })).toContainText(s.workflow.name);
    await expect(header(page)).toContainText('Active');
    await expect(header(page)).toContainText('Published v2');
    await expect(header(page)).toContainText('Draft v3 in progress');
    await expect(header(page).getByRole('button', { name: 'Open draft v3' })).toBeVisible();
    await expect(header(page).getByRole('button', { name: 'Create new draft' })).toHaveCount(0);

    const strip = page.locator('[data-strip]');
    await expect(strip.locator('[data-strip-item="published"]')).toContainText('v2');
    await expect(strip.locator('[data-strip-item="draft"]')).toContainText('v3');
    await expect(strip.locator('[data-strip-item="steps"]')).toContainText('3');
    await expect(strip.locator('[data-strip-item="task-types"]')).toContainText('3');
    // The number is the API's, for the published version only (v1 has 3 more that the strip does not claim).
    await expect(strip.locator('[data-strip-item="open-tasks"]')).toContainText(
      String(published.openTaskCount),
    );
    expect(published.openTaskCount).toBe(s.openV2);

    await expect(tab(page, 'Overview')).toHaveAttribute('aria-selected', 'true');
    await expect(tab(page, 'Versions')).toHaveAccessibleName(/Versions.*3/);
    await expect(tab(page, 'Task types')).toHaveAccessibleName(/Task types.*3/);
    // The status checkbox is gone on an existing workflow; the mode is read-only.
    await expect(page.locator('#wf-active')).toHaveCount(0);
    await expect(page.locator('[data-mode-read]')).toContainText('Ordered');
    await expect(page).toHaveTitle(/Billing request.*: Overview/);
    await shot(page, 'header-overview', 1366);
  });

  test('without a draft the primary is Create new draft and opens the new draft', async ({
    page,
    seed,
  }) => {
    const wf = await seed.workflow({ name: `Plain ${uid()}`, stepCount: 2 });
    await page.goto(`/admin/workflows/${wf.workflowDefinitionId}`);
    await expect(header(page).getByRole('button', { name: /Open draft/ })).toHaveCount(0);
    await header(page).getByRole('button', { name: 'Create new draft' }).click();
    await expect(page).toHaveURL(
      new RegExp(`/admin/workflows/${wf.workflowDefinitionId}/versions/\\d+`),
    );
    await expect(page.getByRole('heading', { level: 1 })).toContainText('v2');
  });

  test('tab changes replace the address: Back leaves the page, the title follows the tab', async ({
    page,
    seed,
    admin,
  }) => {
    const s = await build(seed, admin);
    await page.goto(`/admin/workflows?name=${s.token}`);
    await page.getByRole('link', { name: s.workflow.name }).first().click();
    await expect(tab(page, 'Overview')).toHaveAttribute('aria-selected', 'true');
    await tab(page, 'Versions').click();
    await expect(page).toHaveURL(/tab=versions/);
    await expect(page).toHaveTitle(/: Versions/);
    await tab(page, 'Task types').click();
    await expect(page).toHaveURL(/tab=task-types/);
    await tab(page, 'Overview').click();
    await expect(page).not.toHaveURL(/tab=/);
    await page.goBack();
    await expect(page).toHaveURL(/\/admin\/workflows\?name=/);
  });

  test('keyboard: Right arrow moves between the tabs, Enter on a menu item works, focus returns after the menu and the dialog', async ({
    page,
    seed,
    admin,
  }) => {
    const s = await build(seed, admin, { types: 1 });
    await page.goto(url(s));
    await tab(page, 'Overview').focus();
    await page.keyboard.press('ArrowRight');
    await expect(tab(page, 'Versions')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowRight');
    await expect(tab(page, 'Task types')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Home');
    await expect(tab(page, 'Overview')).toHaveAttribute('aria-selected', 'true');

    const overflow = header(page).locator('[data-overflow]');
    await overflow.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: 'Deactivate' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(overflow).toBeFocused();
    await page.keyboard.press('Enter');
    await page.getByRole('menuitem', { name: 'Deactivate' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(overflow).toBeFocused();
  });

  test.describe('Task types tab (#389)', () => {
    test('lists 22 task types with long names, the default marker and the state, no sideways scroll', async ({
      page,
      seed,
      admin,
    }) => {
      const s = await build(seed, admin, { types: 21 });
      await page.goto(url(s, 'task-types'));
      const rows = page.locator('[data-task-type]');
      await expect(rows).toHaveCount(22);
      await expect(page.locator('[data-default]')).toHaveCount(22);
      await expect(tab(page, 'Task types')).toHaveAccessibleName(/Task types.*22/);
      await expect(rows.first().getByRole('link')).toHaveAttribute(
        'href',
        /\/admin\/task-types\/\d+/,
      );
      for (const size of SIZES) {
        await page.setViewportSize({ width: size.w, height: size.h });
        expect(await noSideways(page), `sideways at ${size.w}`).toBe(true);
        if (axeAvailable()) expect(await axeViolations(page), `axe at ${size.w}`).toEqual([]);
        await shot(page, 'task-types-22', size.w);
      }
    });

    test('shows the note when no task type uses the workflow, and lists inactive types after the active ones', async ({
      page,
      seed,
      admin,
    }) => {
      const wf = await seed.workflow({ name: `Lonely ${uid()}`, stepCount: 1 });
      await page.goto(`/admin/workflows/${wf.workflowDefinitionId}?tab=task-types`);
      await expect(page.locator('[data-no-task-types]')).toHaveText(
        'No task type uses this workflow.',
      );
      await expect(tab(page, 'Task types')).toHaveAccessibleName(/Task types.*0/);

      const a = await seed.taskType({ name: `Active ${uid()}`, workflows: [wf] });
      const b = await seed.taskType({ name: `Inactive ${uid()}`, workflows: [wf] });
      const detail = await admin.get<{ rowVersion?: string }>(`/api/v1/task-types/${b.id}`);
      await admin.put(`/api/v1/task-types/${b.id}`, { ...detail, isActive: false });
      await page.reload();
      const rows = page.locator('[data-task-type]');
      await expect(rows).toHaveCount(2);
      await expect(rows.nth(0)).toContainText(a.name);
      await expect(rows.nth(1)).toContainText('Inactive');
      await expect(tab(page, 'Task types')).toHaveAccessibleName(/Task types.*1/);
    });
  });

  test.describe('Versions tab (#392)', () => {
    test('has Created, By and Tasks from the API and an overflow per row', async ({
      page,
      seed,
      admin,
    }) => {
      const s = await build(seed, admin);
      const api = await admin.get<{ versions: { versionNo: number; openTaskCount: number }[] }>(
        `/api/v1/workflows/${s.workflow.workflowDefinitionId}`,
      );
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto(url(s, 'versions'));
      const table = page.locator('[data-version-table]');
      await expect(table.locator('th')).toHaveText([
        'Version',
        'Status',
        'Mode',
        'Steps',
        'Created',
        'By',
        'Tasks',
        'Actions',
      ]);
      for (const v of api.versions) {
        await expect(
          table.locator(`tr[data-version="${v.versionNo}"] [data-version-tasks]`),
        ).toHaveText(String(v.openTaskCount));
      }
      expect(api.versions.find((v) => v.versionNo === 1)!.openTaskCount).toBe(s.openV1);
      await expect(table.locator('tr[data-version="2"]')).toContainText('Current');
      const rowHeight = await table
        .locator('tbody tr')
        .first()
        .evaluate((r) => r.getBoundingClientRect().height);
      expect(rowHeight).toBeGreaterThanOrEqual(43);
      expect(rowHeight).toBeLessThanOrEqual(46);
      // The version number is the link to the version page.
      await expect(table.getByRole('link', { name: 'View v2' })).toHaveAttribute(
        'href',
        new RegExp(`/admin/workflows/${s.workflow.workflowDefinitionId}/versions/\\d+`),
      );

      // Row menu of the published version while a draft exists: Create draft is disabled with its reason, Open draft v3 is offered, Retire works.
      await page.getByRole('button', { name: 'Actions for v2' }).click();
      const create = page.getByRole('menuitem', { name: /Create draft from this version/ });
      await expect(create).toHaveAttribute('aria-disabled', 'true');
      await expect(page.getByRole('menuitem', { name: 'Open draft v3' })).toBeVisible();
      await expect(page.getByRole('menuitem', { name: 'Retire v2' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: 'Actions for v2' })).toBeFocused();
      // The floating menu closes when the window is resized, so it is opened again at every width.
      for (const size of SIZES) {
        await page.setViewportSize({ width: size.w, height: size.h });
        await page.getByRole('button', { name: 'Actions for v2' }).click();
        await expect(page.getByRole('menuitem', { name: 'Retire v2' })).toBeVisible();
        expect(await noSideways(page), `sideways at ${size.w}`).toBe(true);
        if (axeAvailable()) expect(await axeViolations(page), `axe at ${size.w}`).toEqual([]);
        await shot(page, 'versions-menu-open', size.w);
        await page.keyboard.press('Escape');
      }
    });

    test('phone: each version is a card with its facts', async ({ page, seed, admin }) => {
      const s = await build(seed, admin);
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(url(s, 'versions'));
      const cards = page.locator('[data-version-cards] > li');
      await expect(cards).toHaveCount(3);
      await expect(cards.first()).toContainText('Created');
      await expect(page.locator('[data-version-table]')).toHaveCount(0);
      await shot(page, 'versions-cards', 375);
    });

    test('retire from a row: the dialog names the open tasks; retiring the published version', async ({
      page,
      seed,
      admin,
    }) => {
      const s = await build(seed, admin);
      await page.goto(url(s, 'versions'));
      await page.getByRole('button', { name: 'Actions for v2' }).click();
      await page.getByRole('menuitem', { name: 'Retire v2' }).click();
      const d = page.getByRole('dialog');
      await expect(d).toContainText('2 open tasks keep running on v2.');
      await expect(d.getByRole('button', { name: 'Keep published' })).toBeVisible();
      for (const size of SIZES) {
        await page.setViewportSize({ width: size.w, height: size.h });
        if (axeAvailable()) expect(await axeViolations(page), `axe at ${size.w}`).toEqual([]);
        expect(await noSideways(page), `sideways at ${size.w}`).toBe(true);
      }
      await shot(page, 'retire-dialog', 1366);
      await d.getByRole('button', { name: 'Retire v2' }).click();
      await expect(page.locator('tr[data-version="2"]')).toContainText('Retired');
      await expect(page.locator('tr[data-version="2"]')).not.toContainText('Current');
    });

    test('create draft from a retired version when there is no draft', async ({ page, seed }) => {
      const wf = await seed.workflow({ name: `Draftless ${uid()}`, stepCount: 2 });
      await page.goto(`/admin/workflows/${wf.workflowDefinitionId}?tab=versions`);
      await page.getByRole('button', { name: 'Actions for v1' }).click();
      await page.getByRole('menuitem', { name: 'Create draft from this version' }).click();
      await expect(page).toHaveURL(/\/versions\/\d+/);
    });
  });

  test.describe('Deactivate (#390)', () => {
    test('the dialog names the task types that lose the workflow and the open tasks, then deactivates; Activate brings it back', async ({
      page,
      seed,
      admin,
    }) => {
      const s = await build(seed, admin, { types: 11 });
      await page.goto(url(s));
      await header(page).locator('[data-overflow]').click();
      await page.getByRole('menuitem', { name: 'Deactivate' }).click();
      const d = page.getByRole('dialog');
      await expect(d.locator('[data-impact]')).toContainText('12 task types lose this workflow.');
      await expect(d.locator('[data-impact]')).toContainText('5 open tasks keep running on it.');
      await expect(d.locator('[data-impact-names] li')).toHaveCount(9);
      await expect(d.locator('[data-impact-names] li').last()).toHaveText('and 4 more');
      for (const size of SIZES) {
        await page.setViewportSize({ width: size.w, height: size.h });
        if (axeAvailable()) expect(await axeViolations(page), `axe at ${size.w}`).toEqual([]);
        expect(await noSideways(page), `sideways at ${size.w}`).toBe(true);
        await shot(page, 'deactivate-dialog', size.w);
      }
      await d.getByRole('button', { name: 'Deactivate workflow' }).click();
      await expect(header(page)).toContainText('Inactive');
      await header(page).locator('[data-overflow]').click();
      await expect(page.getByRole('menuitem', { name: 'Activate' })).toBeVisible();
      await page.getByRole('menuitem', { name: 'Activate' }).click();
      await expect(header(page).getByText('Active', { exact: true }).first()).toBeVisible();
    });

    test('a workflow no task type uses says nothing about task types', async ({ page, seed }) => {
      const wf = await seed.workflow({ name: `Unused ${uid()}`, stepCount: 1 });
      await page.goto(`/admin/workflows/${wf.workflowDefinitionId}`);
      await header(page).locator('[data-overflow]').click();
      await page.getByRole('menuitem', { name: 'Deactivate' }).click();
      await expect(page.getByRole('dialog').locator('[data-impact-names]')).toHaveCount(0);
      await expect(page.getByRole('dialog')).not.toContainText('lose this workflow');
    });
  });

  test.describe('Overview and the dirty guard', () => {
    test('editing then switching tab asks; Stay keeps the edit, Save and leave saves and switches', async ({
      page,
      seed,
      admin,
    }) => {
      const s = await build(seed, admin);
      await page.goto(url(s));
      const name = page.locator('#wf-name');
      await name.fill(`${s.workflow.name} edited`);
      await tab(page, 'Versions').click();
      const d = page.getByRole('dialog');
      await expect(d).toBeVisible();
      await d.getByRole('button', { name: 'Stay' }).click();
      await expect(tab(page, 'Overview')).toHaveAttribute('aria-selected', 'true');
      await expect(name).toHaveValue(`${s.workflow.name} edited`);
      await tab(page, 'Versions').click();
      await page.getByRole('dialog').getByRole('button', { name: 'Save and leave' }).click();
      await expect(tab(page, 'Versions')).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('heading', { level: 1 })).toContainText('edited');
    });

    test('the header Edit button takes focus to the name', async ({ page, seed, admin }) => {
      const s = await build(seed, admin);
      await page.goto(url(s, 'versions'));
      await header(page).getByRole('button', { name: 'Edit' }).click();
      await expect(tab(page, 'Overview')).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('#wf-name')).toBeFocused();
    });

    test('creating a workflow is unchanged: mode chosen on the form, then the first draft opens', async ({
      page,
    }) => {
      await page.goto('/admin/workflows/new');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('New workflow');
      await page.locator('#wf-name').fill(`Created ${uid()}`);
      await page.locator('[data-mode="unordered"]').check();
      await page.getByRole('button', { name: 'Create workflow' }).click();
      await expect(page).toHaveURL(/\/versions\/\d+/);
    });
  });

  test.describe('widths, long name, states', () => {
    for (const size of SIZES) {
      test(`${size.w}: header with a 150-character name, menu open, every tab clean`, async ({
        page,
        seed,
        admin,
      }) => {
        const s = await build(seed, admin, { types: 3, longName: true });
        await page.setViewportSize({ width: size.w, height: size.h });
        await page.goto(url(s));
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        const h1 = await page
          .getByRole('heading', { level: 1 })
          .evaluate((e) => e.getBoundingClientRect().height);
        // The title stops at two lines (clamp), whatever the name.
        expect(h1).toBeLessThan(110);
        for (const [tabLabel, query] of [
          ['Overview', ''],
          ['Versions', '?tab=versions'],
          ['Task types', '?tab=task-types'],
        ] as const) {
          await page.goto(`/admin/workflows/${s.workflow.workflowDefinitionId}${query}`);
          await expect(tab(page, tabLabel)).toHaveAttribute('aria-selected', 'true');
          expect(await noSideways(page), `sideways ${tabLabel} at ${size.w}`).toBe(true);
          if (axeAvailable()) {
            expect(await axeViolations(page), `axe ${tabLabel} at ${size.w}`).toEqual([]);
          }
          await shot(page, `long-name-${tabLabel.toLowerCase().replace(' ', '-')}`, size.w);
        }
        await page.goto(url(s));
        await header(page).locator('[data-overflow]').click();
        await expect(page.getByRole('menuitem').first()).toBeVisible();
        expect(await noSideways(page)).toBe(true);
        if (axeAvailable()) expect(await axeViolations(page), `axe menu at ${size.w}`).toEqual([]);
        await shot(page, 'header-menu-open', size.w);
      });
    }

    test('states: not published, published only, an inactive workflow, a missing one', async ({
      page,
      seed,
      admin,
    }) => {
      const created = await admin.post('/api/v1/workflows', {
        name: `Draft only ${uid()}`,
        description: null,
        isOrdered: true,
      });
      await page.goto(`/admin/workflows/${created.workflow.workflowDefinitionId}`);
      await expect(header(page)).toContainText('Not published');
      await expect(header(page)).toContainText('Draft v1 in progress');
      await expect(page.locator('[data-strip-item="published"]')).toContainText('None');
      await expect(page.locator('[data-strip-item="open-tasks"]')).toHaveCount(0);

      const wf = await seed.workflow({ name: `Only published ${uid()}`, stepCount: 1 });
      await page.goto(`/admin/workflows/${wf.workflowDefinitionId}`);
      await expect(header(page)).toContainText('Published v1');
      await expect(header(page)).not.toContainText('Draft v');
      await expect(page.locator('[data-strip-item="draft"]')).toContainText('None');

      await page.goto('/admin/workflows/999999999');
      await expect(page.getByRole('heading', { name: /couldn.t find/i })).toBeVisible();
    });
  });

  test.describe('permission variants', () => {
    test('Workflow.Manage only: no open-task numbers anywhere and plain task type names; with Task.View the numbers; TaskType.Manage links; Task.View only and TaskType.Manage only are kept out', async ({
      seed,
      admin,
      asUser,
    }) => {
      const s = await build(seed, admin, { types: 1 });
      const wfOnly = await seed.user(
        [(await seed.role(['Workflow.Manage'], 'TY5 wf only')).name],
        'ty5-wf',
      );
      const p1 = await asUser(wfOnly.username);
      await p1.goto(url(s));
      await expect(p1.getByRole('heading', { level: 1 })).toContainText(s.workflow.name);
      await expect(p1.locator('[data-strip-item="open-tasks"]')).toHaveCount(0);
      await expect(p1.locator('[data-strip-item="steps"]')).toBeVisible();
      await p1.goto(url(s, 'versions'));
      await expect(p1.locator('[data-version-tasks]')).toHaveCount(0);
      await expect(p1.locator('[data-version-table] th', { hasText: 'Tasks' })).toHaveCount(0);
      await p1.getByRole('button', { name: 'Actions for v2' }).click();
      await p1.getByRole('menuitem', { name: 'Retire v2' }).click();
      await expect(p1.getByRole('dialog')).not.toContainText('open task');
      await p1.keyboard.press('Escape');
      await p1.goto(url(s, 'task-types'));
      await expect(p1.locator('[data-task-types-tab] a')).toHaveCount(0);
      await expect(p1.locator('[data-task-type]')).toHaveCount(2);

      const wfView = await seed.user(
        [(await seed.role(['Workflow.Manage', 'Task.View'], 'TY5 wf view')).name],
        'ty5-wfv',
      );
      const p2 = await asUser(wfView.username);
      await p2.goto(url(s));
      await expect(p2.locator('[data-strip-item="open-tasks"]')).toContainText(String(s.openV2));
      await p2.goto(url(s, 'versions'));
      await expect(p2.locator('tr[data-version="1"] [data-version-tasks]')).toHaveText(
        String(s.openV1),
      );

      const both = await seed.user(
        [(await seed.role(['Workflow.Manage', 'TaskType.Manage', 'Task.View'], 'TY5 both')).name],
        'ty5-both',
      );
      const p3 = await asUser(both.username);
      await p3.goto(url(s, 'task-types'));
      await expect(p3.locator('[data-task-types-tab] a').first()).toHaveAttribute(
        'href',
        /\/admin\/task-types\/\d+/,
      );

      const ttOnly = await seed.user(
        [(await seed.role(['TaskType.Manage', 'Task.View'], 'TY5 tt only')).name],
        'ty5-tt',
      );
      const p4 = await asUser(ttOnly.username);
      await p4.goto(url(s));
      await expect(
        p4.getByRole('heading', { name: "You don't have permission to view this." }),
      ).toBeVisible();
      await expect(p4.locator('[data-record-header]')).toHaveCount(0);

      const viewer = await seed.user(
        [(await seed.role(['Task.View'], 'TY5 viewer')).name],
        'ty5-view',
      );
      const p5 = await asUser(viewer.username);
      await p5.goto(url(s));
      await expect(
        p5.getByRole('heading', { name: "You don't have permission to view this." }),
      ).toBeVisible();
    });
  });
});
