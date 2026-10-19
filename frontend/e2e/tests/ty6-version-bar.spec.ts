import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Seeder } from '../support/seed';
import { Api } from '../support/api';

/**
 * Task Types UX epic #352, WP-TY6, VP1 (#357): the action bar of the workflow version page stays on screen while the page scrolls.
 * Screenshots go to the folder in E2E_SCREENSHOTS (docs/ux/task-types-review/fixes/ty6-version) when it is set.
 */
const OUT = process.env['E2E_SCREENSHOTS'];

const SIZES = [
  { w: 1366, h: 768 },
  { w: 1920, h: 1080 },
  { w: 768, h: 1024 },
  { w: 375, h: 812 },
];

/** A published workflow with `n` steps and an open draft copied from it (the draft has `n` steps too). */
async function draftWorld(seed: Seeder, admin: Api, n = 13) {
  const wf = await seed.workflow({ stepCount: n });
  const draft = await admin.post(`/api/v1/workflows/${wf.workflowDefinitionId}/versions`, {});
  return {
    wf,
    draftId: draft.version.workflowVersionId as number,
    url: `/admin/workflows/${wf.workflowDefinitionId}/versions/${draft.version.workflowVersionId}`,
    publishedUrl: `/admin/workflows/${wf.workflowDefinitionId}/versions/${wf.versionId}`,
  };
}

async function noSideScroll(page: Page): Promise<void> {
  const over = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(over).toBeLessThanOrEqual(0);
}

async function shoot(page: Page, name: string, size: { w: number; h: number }): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, `${name}-${size.w}x${size.h}.png`) });
}

async function expectNoViolations(page: Page, label: string): Promise<void> {
  if (!axeAvailable()) return;
  const found = await axeViolations(page);
  expect(found, `${label}: ${JSON.stringify(found)}`).toEqual([]);
}

const bar = (page: Page) => page.locator('mf-workflow-version-bar');

test.describe('Workflow version page: sticky action bar (VP1, #357)', () => {
  for (const size of SIZES) {
    test(`the bar keeps its place while the page scrolls, no side scroll, axe 0 at ${size.w}x${size.h}`, async ({
      page,
      seed,
      admin,
    }) => {
      test.setTimeout(120_000);
      const { url } = await draftWorld(seed, admin);
      await page.setViewportSize({ width: size.w, height: size.h });
      await page.goto(url);
      const save = page.getByRole('button', { name: 'Save draft' });
      const publish = page.getByRole('button', { name: 'Publish...' });
      await expect(publish).toBeVisible();
      await expect(page.locator('[data-step-row]')).toHaveCount(13);
      await noSideScroll(page);
      await shoot(page, 'draft-top', size);
      await expectNoViolations(page, 'draft idle');

      const scrollable = await page.evaluate(
        () => document.documentElement.scrollHeight - window.innerHeight,
      );
      expect(scrollable).toBeGreaterThan(600);
      const top = async () => (await bar(page).boundingBox())!.y;
      const header = async () => (await page.locator('header.mf-header').boundingBox())!;
      const y0 = await top();
      for (const to of [300, 900, 100000]) {
        await page.evaluate((y) => window.scrollTo(0, y), to);
        await page.waitForTimeout(100);
        const h = await header();
        const y = await top();
        expect(y).toBeGreaterThanOrEqual(h.y + h.height - 1);
        if (to > 300) expect(Math.abs(y - (h.y + h.height))).toBeLessThanOrEqual(6);
        await expect(save).toBeInViewport();
        await expect(publish).toBeInViewport();
        expect(y).toBeLessThanOrEqual(y0 + 0.5);
      }
      await noSideScroll(page);
      await shoot(page, 'draft-scrolled', size);
      await expectNoViolations(page, 'draft scrolled');

      // The overflow menu open (Discard draft), still in view and axe clean.
      await page.getByRole('button', { name: 'More version actions' }).click();
      await expect(page.getByRole('menuitem', { name: 'Discard draft' })).toBeVisible();
      await expect(page.getByRole('menuitem', { name: 'Discard draft' })).toBeInViewport();
      await noSideScroll(page);
      await shoot(page, 'draft-overflow-open', size);
      await expectNoViolations(page, 'overflow open');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: 'More version actions' })).toBeFocused();

      // The publish dialog open.
      await publish.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.locator('[data-diff]')).toBeVisible();
      await noSideScroll(page);
      await shoot(page, 'draft-publish-dialog', size);
      await expectNoViolations(page, 'publish dialog');
      await page.keyboard.press('Escape');
      await expect(publish).toBeFocused();
    });
  }

  test('keyboard only: change the order, save the draft, publish it; Discard draft from the overflow returns focus', async ({
    page,
    seed,
    admin,
  }) => {
    test.setTimeout(120_000);
    const { url, wf } = await draftWorld(seed, admin, 4);
    await page.goto(url);
    const save = page.getByRole('button', { name: 'Save draft' });
    await expect(save).toBeDisabled();
    await expect(page.locator('[data-dirty]')).toHaveCount(0);

    // Alt+Arrow on a step (the existing shortcut, unchanged) makes the draft dirty.
    const first = page.locator('[data-step-row]').first();
    await first.getByRole('button', { name: /^Preview inputs of / }).focus();
    await page.keyboard.press('Alt+ArrowDown');
    await expect(page.locator('[data-dirty]')).toContainText('Unsaved changes');
    await expect(bar(page).locator('[data-dirty]')).toBeVisible();
    await expect(save).toBeEnabled();

    // Tab order in the bar: Save draft, Publish..., More version actions.
    await save.focus();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Publish...' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'More version actions' })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(save).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-dirty]')).toHaveCount(0);

    // Discard draft: overflow, dialog, Escape: focus is back on the overflow button.
    const more = page.getByRole('button', { name: 'More version actions' });
    await more.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: 'Discard draft' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Discard draft' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(more).toBeFocused();

    // Publish with the keyboard.
    await page.getByRole('button', { name: 'Publish...' }).focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('[data-diff]')).toBeVisible();
    // Focus starts on the first control of the dialog (Back to draft); Tab reaches Publish.
    await expect(dialog.getByRole('button', { name: 'Back to draft' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: /^Publish v/ })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/admin/workflows/${wf.workflowDefinitionId}$`));
    const detail = await admin.get(`/api/v1/workflows/${wf.workflowDefinitionId}`);
    expect(detail.workflow.draftVersionId ?? null).toBeNull();
  });

  test('read-only versions: Create new draft or Open draft, Retire in the overflow, none on a retired version', async ({
    page,
    seed,
    admin,
  }) => {
    test.setTimeout(120_000);
    const wf = await seed.workflow({ stepCount: 3 });
    const base = `/admin/workflows/${wf.workflowDefinitionId}/versions`;
    await page.goto(`${base}/${wf.versionId}`);
    await expect(page.locator('[data-status]')).toContainText('Published');
    await expect(bar(page).getByRole('button', { name: 'Create new draft from v1' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Publish...' })).toHaveCount(0);
    await bar(page).getByRole('button', { name: 'More version actions' }).click();
    await expect(page.getByRole('menuitem', { name: 'Retire version' })).toBeVisible();
    await page.keyboard.press('Escape');

    // With a draft open, the second draft is replaced by a link to the first.
    const draft = await admin.post(`/api/v1/workflows/${wf.workflowDefinitionId}/versions`, {});
    await page.goto(`${base}/${wf.versionId}`);
    const open = bar(page).getByRole('link', { name: 'Open draft v2' });
    await expect(open).toHaveAttribute('href', `${base}/${draft.version.workflowVersionId}`);
    await expect(page.getByRole('button', { name: /Create new draft/ })).toHaveCount(0);
    await open.click();
    await expect(page).toHaveURL(new RegExp(`${draft.version.workflowVersionId}$`));
    await expect(page.getByRole('button', { name: 'Publish...' })).toBeVisible();

    // Retire the published v1 from the overflow (keyboard); the retired version has no overflow.
    await page.goto(`${base}/${wf.versionId}`);
    const more = bar(page).getByRole('button', { name: 'More version actions' });
    await more.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Retire version' });
    await expect(dialog).toBeVisible();
    await expectNoViolations(page, 'retire dialog');
    await dialog.getByRole('button', { name: 'Retire', exact: true }).click();
    await expect(page.locator('[data-status]')).toContainText('Retired');
    await expect(bar(page).locator('[data-overflow]')).toHaveCount(0);
    await expect(bar(page).getByRole('link', { name: 'Open draft v2' })).toBeVisible();
    for (const size of SIZES) {
      await page.setViewportSize({ width: size.w, height: size.h });
      await noSideScroll(page);
      await shoot(page, 'retired-readonly', size);
    }
    await expectNoViolations(page, 'retired');
  });

  test('an empty draft cannot be published and says why; the bar still shows', async ({
    page,
    admin,
  }) => {
    const created = await admin.post('/api/v1/workflows', {
      name: `Empty ${Date.now()}`,
      description: null,
      isOrdered: true,
    });
    await page.goto(
      `/admin/workflows/${created.workflow.workflowDefinitionId}/versions/${created.versions[0].workflowVersionId}`,
    );
    await expect(bar(page).getByRole('button', { name: 'Publish...' })).toBeDisabled();
    await expect(page.locator('[data-publish-hint]')).toBeVisible();
    await expect(bar(page).getByRole('button', { name: 'Save draft' })).toBeDisabled();
  });

  test('permissions: Workflow.Manage with Task.View gets the bar; TaskType.Manage only and Task.View only get the 403 page', async ({
    seed,
    admin,
    asUser,
  }) => {
    test.setTimeout(120_000);
    const { url } = await draftWorld(seed, admin, 3);
    // Workflow.Manage alone opens the page but the version endpoint also needs Task.View (a load error otherwise): the Workflow
    // administrator role carries both.
    const wfRole = await seed.role(['Workflow.Manage', 'Task.View'], 'Workflow admin');
    const wfUser = await seed.user([wfRole.name], 'wf-only');
    const wfPage = await asUser(wfUser.username);
    await wfPage.goto(url);
    await expect(wfPage.getByRole('button', { name: 'Publish...' })).toBeVisible();
    await expect(bar(wfPage).getByRole('button', { name: 'Save draft' })).toBeVisible();
    await expect(bar(wfPage).getByRole('button', { name: 'More version actions' })).toBeVisible();

    const ttRole = await seed.role(['TaskType.Manage', 'Task.View'], 'Type only');
    const ttUser = await seed.user([ttRole.name], 'tt-only');
    const ttPage = await asUser(ttUser.username);
    await ttPage.goto(url);
    await expect(
      ttPage.getByRole('heading', { name: "You don't have permission to view this." }),
    ).toBeVisible();
    await expect(ttPage.locator('mf-workflow-version-bar')).toHaveCount(0);

    const viewRole = await seed.role(['Task.View'], 'Viewer');
    const viewer = await seed.user([viewRole.name], 'viewer');
    const viewerPage = await asUser(viewer.username);
    await viewerPage.goto(url);
    await expect(
      viewerPage.getByRole('heading', { name: "You don't have permission to view this." }),
    ).toBeVisible();
    await expect(viewerPage.getByRole('button', { name: 'Publish...' })).toHaveCount(0);
  });
});
