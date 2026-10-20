import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

/**
 * Task Types administration: one wording table for the dialogs (#362): records are deactivated, published versions retired, drafts
 * discarded; the verb is in the primary button; the form publish and retire dialogs open on their primary action. Screenshots go to
 * E2E_SCREENSHOTS (docs/ux/task-types-review/fixes/ty1-foundations).
 */
const OUT = process.env['E2E_SCREENSHOTS'];
const SIZES = [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
] as const;

async function atEverySize(page: Page, name: string): Promise<void> {
  for (const size of SIZES) {
    await page.setViewportSize(size);
    if (axeAvailable()) expect(await axeViolations(page), `${name} at ${size.width}`).toEqual([]);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${name}: page-level horizontal scroll at ${size.width}`).toBeLessThanOrEqual(
      0,
    );
    if (OUT) {
      fs.mkdirSync(OUT, { recursive: true });
      await page.screenshot({ path: path.join(OUT, `${name}-${size.width}x${size.height}.png`) });
    }
  }
}

const dialog = (page: Page) => page.getByRole('dialog');

test.describe('Dialog wording and focus (#362)', () => {
  test('Deactivate task type: the title, the verb button and Keep active; Escape returns focus', async ({
    page,
    seed,
  }) => {
    const wf = await seed.workflow({});
    const tt = await seed.taskType({ workflows: [wf] });
    await page.goto(`/admin/task-types/${tt.id}`);
    // Deactivate is in the overflow of the record header (#380), not behind an Active checkbox.
    const overflow = page.locator('[data-page-actions] button[data-overflow]');
    await overflow.click();
    await page.getByRole('menuitem', { name: 'Deactivate' }).click();
    await expect(dialog(page)).toBeVisible();
    await expect(
      dialog(page).getByText('Deactivate task type?', { exact: true }).first(),
    ).toBeVisible();
    await expect(dialog(page).getByRole('button', { name: 'Deactivate task type' })).toBeVisible();
    await expect(dialog(page).getByRole('button', { name: 'Keep active' })).toBeVisible();
    await atEverySize(page, 'dialog-deactivate-task-type');
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await expect(overflow).toBeFocused();
  });

  test('Deactivate workflow and Deactivate step use the same wording', async ({ page, seed }) => {
    const wf = await seed.workflow({});
    await page.goto(`/admin/workflows/${wf.workflowDefinitionId}`);
    // The Active checkbox is gone on an existing workflow (#390): Deactivate is in the header menu.
    await page.locator('[data-record-header] [data-overflow]').click();
    await page.getByRole('menuitem', { name: 'Deactivate' }).click();
    await expect(dialog(page).getByRole('button', { name: 'Deactivate workflow' })).toBeVisible();
    await expect(dialog(page).getByRole('button', { name: 'Keep active' })).toBeVisible();
    await atEverySize(page, 'dialog-deactivate-workflow');

    const step = await seed.step({ title: `Wording ${uid()}` });
    await page.goto(`/admin/steps/${step.id}`);
    // Deactivate is in the overflow of the record header (#406), not beside Save.
    await page.locator('[data-page-actions] button[data-overflow]').click();
    await page.getByRole('menuitem', { name: 'Deactivate' }).click();
    await expect(dialog(page).getByRole('button', { name: 'Deactivate step' })).toBeVisible();
    await expect(dialog(page).getByRole('button', { name: 'Keep active' })).toBeVisible();
    await atEverySize(page, 'dialog-deactivate-step');
  });

  test('the form publish and retire dialogs: "Publish v2" and "Retire v2", focus on the primary, Version note reachable', async ({
    page,
    seed,
  }) => {
    const wf = await seed.workflow({});
    const tt = await seed.taskType({
      workflows: [wf],
      fields: [{ key: 'ref', label: 'Reference', control: 'TEXT' }],
    });
    await page.goto(`/admin/task-types/${tt.id}/form`);
    await page.getByRole('button', { name: 'Create new draft' }).click();
    await page.getByRole('button', { name: 'Publish...' }).click();
    const d = dialog(page);
    await expect(d.getByText('Publish v2', { exact: true }).first()).toBeVisible();
    const primary = d.getByRole('button', { name: 'Publish v2' });
    await expect(primary).toBeFocused();
    await expect(d.getByRole('button', { name: 'Back to draft' })).toBeVisible();
    await page.keyboard.press('Shift+Tab');
    await expect(d.getByLabel('Version note')).not.toBeFocused(); // Cancel sits between the note and the primary
    await page.keyboard.press('Shift+Tab');
    await expect(d.getByLabel('Version note')).toBeFocused();
    await atEverySize(page, 'dialog-form-publish');
    await d.getByRole('button', { name: 'Publish v2' }).click();
    await expect(page.locator('[data-status]')).toContainText('Published v2');

    await page.getByRole('button', { name: 'Retire version' }).click();
    await expect(dialog(page).getByRole('button', { name: 'Retire v2' })).toBeFocused();
    await expect(dialog(page).getByRole('button', { name: 'Keep published' })).toBeVisible();
    await atEverySize(page, 'dialog-form-retire');
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
  });

  test('permission variants: the wording is the same for each manager; Task.View only gets the 403 page', async ({
    seed,
    asUser,
  }) => {
    const wf = await seed.workflow({});
    const tt = await seed.taskType({ workflows: [wf] });
    const typeRole = await seed.role(['TaskType.Manage', 'Task.View'], 'Type only');
    const typePage = await asUser((await seed.user([typeRole.name], 'tt-ttonly')).username);
    await typePage.goto(`/admin/task-types/${tt.id}`);
    await typePage.locator('[data-page-actions] button[data-overflow]').click();
    await typePage.getByRole('menuitem', { name: 'Deactivate' }).click();
    await expect(
      typePage.getByRole('dialog').getByRole('button', { name: 'Deactivate task type' }),
    ).toBeVisible();

    const wfRole = await seed.role(['Workflow.Manage'], 'Workflow only');
    const wfPage = await asUser((await seed.user([wfRole.name], 'tt-wfonly')).username);
    await wfPage.goto(`/admin/workflows/${wf.workflowDefinitionId}`);
    await wfPage.locator('[data-record-header] [data-overflow]').click();
    await wfPage.getByRole('menuitem', { name: 'Deactivate' }).click();
    await expect(
      wfPage.getByRole('dialog').getByRole('button', { name: 'Deactivate workflow' }),
    ).toBeVisible();

    const viewerRole = await seed.role(['Task.View'], 'Viewer');
    const viewer = await asUser((await seed.user([viewerRole.name], 'tt-viewer')).username);
    await viewer.goto(`/admin/task-types/${tt.id}`);
    await expect(
      viewer.getByRole('heading', { name: "You don't have permission to view this." }),
    ).toBeVisible();
  });
});
