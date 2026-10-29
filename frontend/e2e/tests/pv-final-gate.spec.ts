import { Page } from '@playwright/test';
import { Json } from '../support/api';
import { axeAvailable, axeBestPractice } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { MmWorld, mmWorld } from '../support/my-matters-fixtures';
import { SIZES, shot } from '../support/screens';
import { uid } from '../support/seed';

/**
 * PM v2 final gate (epic #851, issue #889, PV-38): what is true of every new screen together, on top of the per-screen specs (`pv-*.spec.ts`).
 * One Project Manager with a task of two types, an overdue task and assets, then:
 *  - all four My Matters tabs: the title rule `My Matters: <Tab> - MatterFlow`, one level-one heading, axe (including best practice) finds nothing and the page
 *    does not scroll sideways at 1920x1080, 1366x768, 768x1024 and 375x812;
 *  - keyboard only: the Options menu, Focus, the Views and Export menus open from the keyboard, Escape closes them and puts focus back on their button, and a
 *    Breakdown cell is a link that Enter follows to the Task Queue;
 *  - reduced motion: with the preference on, nothing on the Breakdown, the Data tab or the report chart animates, and the one hover transition of the pie is
 *    switched off (and is on without the preference, so the check can fail).
 * Screenshots: E2E_SCREENSHOTS=docs/ux/pm-v2-review/after.
 */
const TABS = [
  { tab: 'overview', title: 'My Matters - MatterFlow', ready: '[data-panel=tasks] a.wt-title' },
  {
    tab: 'breakdown',
    title: 'My Matters: Breakdown - MatterFlow',
    ready: '[data-bd-table], [data-bd-cards]',
  },
  { tab: 'data', title: 'My Matters: Data - MatterFlow', ready: '[data-panel="data"]' },
  { tab: 'activity', title: 'My Matters: Activity - MatterFlow', ready: '#mm-tab-activity' },
] as const;

test.describe('PM v2 final gate', () => {
  test.beforeEach(() => {
    expect(axeAvailable(), 'axe-core must be available (set E2E_AXE_PATH)').toBe(true);
  });

  interface Gate {
    w: MmWorld;
    second: Json;
    matter: Json;
  }

  async function world(
    seed: import('../support/seed').Seeder,
    personas: import('../support/personas').Personas,
  ): Promise<Gate> {
    const admin = seed.admin;
    const w = await mmWorld(seed, personas, 'fg');
    const token = uid().slice(0, 6);
    const second = await seed.taskType({ workflows: [w.world.workflow] });
    const type = await admin.post('/api/v1/asset-types', {
      name: `Gate workspace ${token}`,
      description: null,
    });
    const definition = await admin.get(
      `/api/v1/forms/by-owner?ownerKind=AssetType&ownerId=${type.assetTypeId}`,
    );
    await seed.publishForm(definition.formDefinitionId, [
      { key: 'size_gb', label: 'Size (GB)', control: 'NUMBER' },
    ]);
    const current = await admin.get(`/api/v1/asset-types/${type.assetTypeId}`);
    await admin.put(`/api/v1/asset-types/${type.assetTypeId}/size-field`, {
      sizeFieldKey: 'size_gb',
      sizeUnit: 'GB',
      rowVersion: current.rowVersion,
    });
    const matter = await w.matter(`Gate ${token}`);
    await w.task(matter, { dueDate: '2000-01-01' });
    await w.task(matter, { dueDate: '2000-01-02', taskTypeId: second.id });
    await w.task(matter);
    for (const [name, size] of [
      ['Alpha', 12],
      ['Bravo', 3.5],
    ] as const) {
      await admin.post('/api/v1/assets', {
        matterId: matter.matterId,
        assetTypeId: type.assetTypeId,
        displayName: `${name} ${token}`,
        formValues: { size_gb: size },
      });
    }
    return { w, second, matter };
  }

  async function clean(page: Page, what: string): Promise<void> {
    const violations = await axeBestPractice(page);
    expect(
      violations.map((v) => `${v.id}: ${v.help} ${JSON.stringify(v.nodes.map((n) => n.target))}`),
      what,
    ).toEqual([]);
  }

  test('all four My Matters tabs follow the title rule and are clean at four widths', async ({
    seed,
    personas,
    asUser,
  }) => {
    test.slow(); // six tabs, four sizes, axe each time
    const g = await world(seed, personas);
    const page = await asUser(g.w.pm.username);
    for (const { tab, title, ready } of TABS) {
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto(tab === 'overview' ? '/my-matters' : `/my-matters?tab=${tab}`);
      await expect(page.locator(ready).first()).toBeVisible();
      await expect(page).toHaveTitle(title);
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      for (const size of SIZES) {
        await page.setViewportSize(size);
        await expect(page.locator(ready).first()).toBeVisible();
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(
          overflow,
          `no sideways scroll: ${tab} at ${size.width}x${size.height}`,
        ).toBeLessThanOrEqual(0);
        await clean(page, `${tab} at ${size.width}x${size.height}`);
        if (size.width === 1366 || size.width === 375)
          await shot(page, `pv-final-my-matters-${tab}`);
      }
    }
  });

  test('keyboard only: Options, Focus and the Views and Export of the Task Queue open, Escape closes and returns focus; a Breakdown cell is followed with Enter', async ({
    seed,
    personas,
    asUser,
  }) => {
    const g = await world(seed, personas);
    const page = await asUser(g.w.pm.username);
    await page.goto('/my-matters');
    await expect(page.locator('[data-panel=tasks] a.wt-title').first()).toBeVisible();

    // The one Options menu of the list (issue #894): opens from the keyboard, Escape closes it and returns the focus to its button.
    const trigger = page.locator('[data-panel=tasks] [data-options-trigger]');
    await trigger.focus();
    await page.keyboard.press('Enter');
    const csv = page.locator('[data-panel=tasks] [data-export=csv]');
    await expect(csv).toBeVisible();
    await csv.focus();
    await expect(csv).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(csv).toBeHidden();
    await expect(trigger).toBeFocused();
    // There is no per-list task type filter any more (issue #907): Focus is the one filter.
    await expect(page.locator('[data-types-trigger], [data-chips]')).toHaveCount(0);

    const focus = page.locator('[data-header-options] [data-options-trigger]');
    await focus.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-focus-save]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-focus-save]')).toBeHidden();
    await expect(focus).toBeFocused();

    // A Breakdown cell is a real link: Tab reaches it, Enter follows it to exactly the tasks it counts.
    await page.goto('/my-matters?tab=breakdown');
    const cell = page.locator('table[data-bd-table="matrix"] a[data-bd-cell]').first();
    await expect(cell).toBeVisible();
    await cell.focus();
    await expect(cell).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/tasks\?/);
    await expect(page.locator('tbody tr[data-task]').first()).toBeVisible();

    // The Task Queue's Views and Export menus: same rule.
    const views = page.locator('[data-views-trigger]');
    await views.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-view-name-input]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-view-name-input]')).toBeHidden();
    await expect(views).toBeFocused();

    const exportButton = page.locator('[data-export-menu] [data-overflow]');
    await exportButton.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: 'Download CSV' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menuitem', { name: 'Download CSV' })).toBeHidden();
    await expect(exportButton).toBeFocused();
  });

  test('reduced motion: nothing animates on the Breakdown, the Data tab or the report chart, and the pie hover transition is off', async ({
    seed,
    personas,
    asUser,
  }) => {
    const g = await world(seed, personas);
    const page = await asUser(g.w.pm.username);
    const animations = () =>
      page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length);
    const sliceTransition = () =>
      page
        .locator('mf-pie-chart .slice')
        .first()
        .evaluate((e) => getComputedStyle(e).transitionDuration);

    const openReport = async () => {
      await page.goto('/assets/reports');
      await page.locator('[data-run]').click();
      await expect(page.locator('[data-result-table]')).toBeVisible();
      await page.locator('[data-show-pie]').click();
      await expect(page.locator('mf-pie-chart')).toBeVisible();
    };

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/my-matters?tab=breakdown');
    await expect(page.locator('table[data-bd-table="matrix"]')).toBeVisible();
    expect(await animations(), 'Breakdown').toBe(0);
    await page.goto('/my-matters?tab=data');
    await expect(page.locator('[data-panel="data"] [data-loading]')).toHaveCount(0);
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    expect(await animations(), 'Data tab').toBe(0);
    await openReport();
    expect(await animations(), 'report chart').toBe(0);
    expect(await sliceTransition(), 'pie hover transition with reduced motion').toBe('0s');

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await openReport();
    expect(await sliceTransition(), 'pie hover transition without the preference').not.toBe('0s');
  });
  test('very long names (a 99-character asset type, matter and task type, one unbroken word) do not widen a phone page on Breakdown, Data, the report builder or the Create task chooser', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'fl');
    const long = `${uid().slice(0, 4)} Extremely long name that a real firm could well type ${'x'.repeat(60)}`;
    const matter = await w.matter(long);
    const tt = await seed.taskType({
      workflows: [w.world.workflow],
      name: `TT ${long}`.slice(0, 99),
    });
    await w.task(matter, { taskTypeId: tt.id, dueDate: '2000-01-01' });
    const type = await seed.admin.post('/api/v1/asset-types', {
      name: `AT ${long}`.slice(0, 99),
      description: null,
    });
    await seed.admin.post('/api/v1/assets', {
      matterId: matter.matterId,
      assetTypeId: type.assetTypeId,
      displayName: `${long} asset`,
    });
    const page = await asUser(w.pm.username);
    await page.setViewportSize({ width: 375, height: 812 });
    // The Create task chooser lists every task type, so the long one must not widen it either (it did, once other specs had left such a type).
    for (const url of [
      '/my-matters?tab=breakdown',
      '/my-matters?tab=data',
      '/assets/reports',
      '/tasks/new',
    ]) {
      await page.goto(url);
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `no sideways scroll with long names: ${url}`).toBeLessThanOrEqual(0);
    }
  });
});
