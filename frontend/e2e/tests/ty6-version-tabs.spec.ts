import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';
import { Setup, VersionIds, build, versionIds } from '../support/ty-workflow';

/**
 * WP-TY6 version page leftovers (epic #352): the tabs Steps (n) and Used by (n) with a version switcher (#399), the neutral read-only note
 * and the retire dialog that states impact (#400), and the publish dialog's impact line (#402). With E2E_SCREENSHOTS set to a folder the
 * tests also save a screenshot per width (docs/ux/task-types-review/fixes/ty6-version).
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

const vurl = (s: Setup, id: number, tab?: string) =>
  `/admin/workflows/${s.workflow.workflowDefinitionId}/versions/${id}${tab ? `?tab=${tab}` : ''}`;
const tab = (page: Page, label: string) => page.getByRole('tab', { name: new RegExp(`^${label}`) });
const switcher = (page: Page) => page.locator('[data-version-switcher] [data-overflow]');

async function clean(page: Page, what: string, w: number): Promise<void> {
  expect(await noSideways(page), `sideways: ${what} at ${w}`).toBe(true);
  if (axeAvailable()) expect(await axeViolations(page), `axe: ${what} at ${w}`).toEqual([]);
}

test.describe('Version page tabs and switcher (#399)', () => {
  test('Steps (n) and Used by (n), no Versions tab; the tab is kept in the address and replaced', async ({
    page,
    seed,
    admin,
  }) => {
    const s = await build(seed, admin, { types: 2 });
    const ids: VersionIds = await versionIds(admin, s);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(vurl(s, ids.v3));
    await expect(tab(page, 'Steps')).toHaveAccessibleName(/Steps.*3/);
    await expect(tab(page, 'Used by')).toHaveAccessibleName(/Used by.*3/);
    await expect(page.getByRole('tab', { name: /Versions/ })).toHaveCount(0);
    await expect(page.locator('[data-steps]')).toBeVisible();
    await tab(page, 'Used by').click();
    await expect(page).toHaveURL(/tab=used-by/);
    await expect(page.locator('[data-task-type]')).toHaveCount(3);
    await expect(page.locator('[data-steps]')).toHaveCount(0);
    await shot(page, 'used-by-1366', 1366);
    // Used by is a separate step in history only through the address, which is replaced: Back leaves the page.
    await tab(page, 'Steps').click();
    await expect(page).not.toHaveURL(/tab=/);
    // Arrow keys move between the two tabs.
    await tab(page, 'Steps').focus();
    await page.keyboard.press('ArrowRight');
    await expect(tab(page, 'Used by')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowLeft');
    await expect(tab(page, 'Steps')).toHaveAttribute('aria-selected', 'true');
    // The count of Steps follows the draft live.
    const first = page.locator('[data-step-row]').first();
    await first.getByRole('button', { name: /^Actions for / }).click();
    await page.getByRole('menuitem', { name: 'Remove' }).click();
    await expect(tab(page, 'Steps')).toHaveAccessibleName(/Steps.*2/);
  });

  test('the switcher lists every version, marks the current one and keeps the tab; a dirty draft asks first', async ({
    page,
    seed,
    admin,
  }) => {
    const s = await build(seed, admin);
    const ids = await versionIds(admin, s);
    await page.goto(vurl(s, ids.v3, 'used-by'));
    await expect(switcher(page)).toContainText('v3 Draft');
    await expect(switcher(page)).toHaveAccessibleName(/Switch version: v3 Draft/);
    await switcher(page).click();
    const items = page.locator('[data-version-switcher] [role="menuitem"]');
    await expect(items).toHaveText(['v3 Draft', 'v2 Published (current)', 'v1 Retired']);
    await expect(items.first()).toHaveAttribute('aria-current', 'true');
    // Escape closes and returns focus.
    await page.keyboard.press('Escape');
    await expect(switcher(page)).toBeFocused();

    // A dirty draft asks before leaving (Stay).
    await page.goto(vurl(s, ids.v3));
    const row = page.locator('[data-step-row]').first();
    await row.getByRole('button', { name: /^Actions for / }).focus();
    await page.keyboard.press('Alt+ArrowDown');
    await expect(page.locator('[data-dirty]')).toContainText('Unsaved changes');
    await switcher(page).click();
    await page.getByRole('menuitem', { name: /^v2 Published/ }).click();
    const d = page.getByRole('dialog');
    await expect(d).toBeVisible();
    await d.getByRole('button', { name: 'Stay' }).click();
    await expect(page).toHaveURL(new RegExp(`/versions/${ids.v3}`));

    // A clean page switches, on the same tab (keyboard: Enter on the entry).
    await page.goto(vurl(s, ids.v3, 'used-by'));
    await switcher(page).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('menuitem', { name: /^v1 Retired/ }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/versions/${ids.v1}\\?tab=used-by`));
    await expect(switcher(page)).toContainText('v1 Retired');
    await expect(tab(page, 'Used by')).toHaveAttribute('aria-selected', 'true');
  });

  for (const size of SIZES) {
    test(`${size.w}: used by with 22 task types, the switcher menu and the read-only note are clean, no sideways scroll`, async ({
      page,
      seed,
      admin,
    }) => {
      const s = await build(seed, admin, { types: 21, longName: true });
      const ids = await versionIds(admin, s);
      await page.setViewportSize({ width: size.w, height: size.h });
      await page.goto(vurl(s, ids.v3));
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await clean(page, 'draft steps', size.w);
      await shot(page, 'draft-steps', size.w);
      await switcher(page).click();
      await expect(page.getByRole('menuitem').first()).toBeVisible();
      await clean(page, 'switcher open', size.w);
      await shot(page, 'switcher-open', size.w);
      await page.keyboard.press('Escape');
      await page.goto(vurl(s, ids.v3, 'used-by'));
      await expect(page.locator('[data-task-type]')).toHaveCount(22);
      await clean(page, 'used by 22', size.w);
      await shot(page, 'used-by-22', size.w);
      await page.goto(vurl(s, ids.v2));
      await expect(page.locator('[data-readonly-banner]')).toBeVisible();
      await clean(page, 'published read-only', size.w);
      await shot(page, 'read-only-note', size.w);
    });
  }
});

test.describe('Read-only states and the retire dialog (#400)', () => {
  test('a neutral note, Open draft v3 in place of the disabled button, a retired version without actions', async ({
    page,
    seed,
    admin,
  }) => {
    const s = await build(seed, admin);
    const ids = await versionIds(admin, s);
    await page.goto(vurl(s, ids.v2));
    const note = page.locator('[data-readonly-banner]');
    await expect(note).toContainText('This version is published and cannot be edited.');
    await expect(note).toHaveClass(/wf-note/);
    await expect(note).not.toHaveAttribute('role', 'alert');
    // Not an amber box: its background is the neutral surface, not the warning background.
    const colors = await page.evaluate(() => {
      const el = document.querySelector('[data-readonly-banner]') as HTMLElement;
      const warn = getComputedStyle(document.documentElement)
        .getPropertyValue('--mf-warning-bg')
        .trim();
      const probe = document.createElement('div');
      probe.style.background = warn;
      document.body.appendChild(probe);
      const warnRgb = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return { note: getComputedStyle(el).backgroundColor, warn: warnRgb };
    });
    expect(colors.note).not.toBe(colors.warn);
    const bar = page.locator('[data-action-bar]');
    await expect(bar.getByRole('button', { name: 'Create new draft from v2' })).toHaveCount(0);
    await expect(bar.getByRole('link', { name: 'Open draft v3' })).toBeVisible();
    await page.goto(vurl(s, ids.v1));
    await expect(page.locator('[data-readonly-banner]')).toContainText('retired');
  });

  test('retire: the dialog names the task types left without a published workflow and the open tasks; Keep published leaves', async ({
    page,
    seed,
    admin,
  }) => {
    const s = await build(seed, admin, { types: 4 });
    // One more type has a second published workflow, so it is not named.
    const other = await seed.workflow({ name: `Other ${uid()}`, stepCount: 1 });
    await seed.taskType({
      name: `Has another ${s.token}`,
      workflows: [s.workflow, other],
    });
    const ids = await versionIds(admin, s);
    await page.goto(vurl(s, ids.v2));
    await page.getByRole('button', { name: 'More version actions' }).click();
    await page.getByRole('menuitem', { name: 'Retire version' }).click();
    const d = page.getByRole('dialog');
    await expect(d).toContainText('Retire v2?');
    await expect(d.locator('[data-retire-impact]')).toHaveText(
      `Billing type ${s.token} and 4 other task types have no other published workflow. 2 open tasks keep running on v2. New tasks cannot use it.`,
    );
    for (const size of SIZES) {
      await page.setViewportSize({ width: size.w, height: size.h });
      await clean(page, 'retire dialog', size.w);
      await shot(page, 'retire-dialog', size.w);
    }
    await d.getByRole('button', { name: 'Keep published' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('[data-status]')).toContainText('Published');
    await page.getByRole('button', { name: 'More version actions' }).click();
    await page.getByRole('menuitem', { name: 'Retire version' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Retire v2' }).click();
    await expect(page.locator('[data-status]')).toContainText('Retired');
  });

  test('Workflow.Manage only: the dialog leaves out what the person may not see (no open-task number, no task type names)', async ({
    seed,
    admin,
    asUser,
  }) => {
    const s = await build(seed, admin, { types: 1 });
    const ids = await versionIds(admin, s);
    const role = await seed.role(['Workflow.Manage'], 'TY6 wf only');
    const user = await seed.user([role.name], 'ty6-wf');
    const page = await asUser(user.username);
    await page.goto(vurl(s, ids.v2));
    await page.getByRole('button', { name: 'More version actions' }).click();
    await page.getByRole('menuitem', { name: 'Retire version' }).click();
    await expect(page.getByRole('dialog').locator('[data-retire-impact]')).toHaveText(
      'New tasks cannot use it.',
    );
    await page.keyboard.press('Escape');
    // Used by still lists the task types (the workflow response has them), as plain text.
    await page.goto(vurl(s, ids.v2, 'used-by'));
    await expect(page.locator('[data-task-type]')).toHaveCount(2);
    await expect(page.locator('[data-task-types-tab] a')).toHaveCount(0);
  });
});

test.describe('Publish dialog impact (#402)', () => {
  test('a draft over a published version: "Tasks already running keep v2 (2 open). New tasks use v3."', async ({
    page,
    seed,
    admin,
  }) => {
    const s = await build(seed, admin);
    const ids = await versionIds(admin, s);
    await page.goto(vurl(s, ids.v3));
    await page.getByRole('button', { name: 'Publish...' }).click();
    const d = page.getByRole('dialog');
    await expect(d.locator('[data-publish-impact]')).toHaveText(
      'Tasks already running keep v2 (2 open). New tasks use v3.',
    );
    for (const size of SIZES) {
      await page.setViewportSize({ width: size.w, height: size.h });
      await clean(page, 'publish dialog', size.w);
      await shot(page, 'publish-dialog', size.w);
    }
  });

  test('the first version says how many task types it makes usable; without the count the line is dropped', async ({
    page,
    seed,
    admin,
    asUser,
  }) => {
    const token = uid();
    const step = await seed.step({ title: `First step ${token}` });
    const created = await admin.post('/api/v1/workflows', {
      name: `First ${token}`,
      description: null,
      isOrdered: true,
    });
    const id = created.workflow.workflowDefinitionId;
    const v = created.versions[0];
    await admin.put(`/api/v1/workflows/${id}/versions/${v.workflowVersionId}`, {
      isOrdered: true,
      steps: [{ sourceStepDefinitionId: step.id, isSkippable: false, skipCommentRequired: false }],
      rowVersion: v.rowVersion,
    });
    for (const n of [1, 2]) {
      await seed.taskType({
        name: `Waiting ${n} ${token}`,
        workflows: [
          { workflowDefinitionId: id, name: '', versionId: 0, stepTitles: [], stepIds: [] },
        ],
      });
    }
    await page.goto(`/admin/workflows/${id}/versions/${v.workflowVersionId}`);
    await page.getByRole('button', { name: 'Publish...' }).click();
    await expect(page.getByRole('dialog').locator('[data-publish-impact]')).toHaveText(
      'New tasks use this version. This makes 2 task types usable.',
    );
    const role = await seed.role(['Workflow.Manage'], 'TY6 wf only 2');
    const user = await seed.user([role.name], 'ty6-wf2');
    const p2 = await asUser(user.username);
    await p2.goto(`/admin/workflows/${id}/versions/${v.workflowVersionId}`);
    await p2.getByRole('button', { name: 'Publish...' }).click();
    await expect(p2.getByRole('dialog').locator('[data-publish-impact]')).toHaveText(
      'New tasks use this version.',
    );
  });

  test('Workflow.Manage only: the open-task count is left out of the sentence', async ({
    seed,
    admin,
    asUser,
  }) => {
    const s = await build(seed, admin);
    const ids = await versionIds(admin, s);
    const role = await seed.role(['Workflow.Manage'], 'TY6 wf only 3');
    const user = await seed.user([role.name], 'ty6-wf3');
    const p = await asUser(user.username);
    await p.goto(vurl(s, ids.v3));
    await p.getByRole('button', { name: 'Publish...' }).click();
    await expect(p.getByRole('dialog').locator('[data-publish-impact]')).toHaveText(
      'Tasks already running keep v2. New tasks use v3.',
    );
  });
});

test.describe('Permission variants of the version page', () => {
  test('TaskType.Manage only and Task.View only are kept out; Workflow.Manage with Task.View sees everything', async ({
    seed,
    admin,
    asUser,
  }) => {
    const s = await build(seed, admin);
    const ids = await versionIds(admin, s);
    const ttOnly = await seed.user(
      [(await seed.role(['TaskType.Manage', 'Task.View'], 'TY6 tt only')).name],
      'ty6-tt',
    );
    const p1 = await asUser(ttOnly.username);
    await p1.goto(vurl(s, ids.v2));
    await expect(
      p1.getByRole('heading', { name: "You don't have permission to view this." }),
    ).toBeVisible();
    const viewer = await seed.user([(await seed.role(['Task.View'], 'TY6 viewer')).name], 'ty6-v');
    const p2 = await asUser(viewer.username);
    await p2.goto(vurl(s, ids.v2));
    await expect(
      p2.getByRole('heading', { name: "You don't have permission to view this." }),
    ).toBeVisible();
    const both = await seed.user(
      [(await seed.role(['Workflow.Manage', 'Task.View', 'TaskType.Manage'], 'TY6 both')).name],
      'ty6-b',
    );
    const p3 = await asUser(both.username);
    await p3.goto(vurl(s, ids.v2, 'used-by'));
    await expect(p3.locator('[data-task-types-tab] a').first()).toHaveAttribute(
      'href',
      /\/admin\/task-types\/\d+/,
    );
  });
});
