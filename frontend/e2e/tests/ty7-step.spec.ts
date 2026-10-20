import fs from 'node:fs';
import path from 'node:path';
import { Locator, Page } from '@playwright/test';
import { Api } from '../support/api';
import { axeAvailable, axeViolations } from '../support/axe';
import { manyFields, stepWorld } from '../support/designer';
import { expect, test } from '../support/fixtures';
import { Seeder, uid } from '../support/seed';

/**
 * WP-TY7 Step record page (epic #352, #403 to #406): the record header (the step title as the H1, Active / Inactive, Edit, Activity, the primary
 * Edit inputs, the overflow with Deactivate or Activate), the summary strip, Details | Inputs | Used by (n) with a save for Details, the read-only
 * Inputs list, Used by with a link and a status badge for each workflow version, and the Deactivate dialog that says how many drafts keep the step.
 * With E2E_SCREENSHOTS set to a folder the tests also save screenshots (docs/ux/task-types-review/fixes/ty7-step).
 */
const SHOTS = process.env['E2E_SCREENSHOTS'];
const SIZES = [
  { w: 1366, h: 768 },
  { w: 1920, h: 1080 },
  { w: 1024, h: 768 },
  { w: 768, h: 1024 },
  { w: 375, h: 812 },
] as const;

async function shot(page: Page, name: string, w: number): Promise<void> {
  if (!SHOTS || w === 1024) return; // screenshots at the four review sizes; 1024 is checked, not photographed
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}-${w}.png`) });
}

/** No page-level sideways scroll and no axe violations at the current size; `name` labels the failure. */
async function clean(page: Page, name: string): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${name}: page-level horizontal scroll`).toBeLessThanOrEqual(0);
  if (axeAvailable()) expect(await axeViolations(page), `${name}: axe`).toEqual([]);
}

const tab = (page: Page, key: string): Locator => page.locator(`[role=tab][data-tab="${key}"]`);
const overflowButton = (page: Page): Locator =>
  page.locator('[data-page-actions] button[data-overflow]');

async function openStep(page: Page, id: number, tabKey = ''): Promise<void> {
  await page.goto(`/admin/steps/${id}${tabKey ? `?tab=${tabKey}` : ''}`);
  await expect(page.locator('[data-step-page]')).toBeVisible();
}

async function menuItem(page: Page, name: string): Promise<void> {
  await overflowButton(page).click();
  await page.getByRole('menuitem', { name }).click();
}

interface StepFacts {
  id: number;
  title: string;
  formId: number;
}

/** A step with the given tags and, when asked, a published form and/or a draft. */
async function makeStep(
  admin: Api,
  seed: Seeder,
  opts: {
    published?: boolean;
    draft?: boolean;
    fields?: number;
    long?: boolean;
    tags?: string[];
    description?: string;
  } = {},
): Promise<StepFacts> {
  const world = await stepWorld(seed, admin, {
    published: opts.published,
    draft: opts.draft,
    fields: manyFields(opts.fields ?? 4, opts.long),
  });
  if (opts.tags || opts.description) {
    const detail = (await admin.get(`/api/v1/step-definitions/${world.id}`)) as {
      rowVersion: string;
    };
    await admin.put(`/api/v1/step-definitions/${world.id}`, {
      title: world.name,
      description: opts.description ?? null,
      instructions: null,
      documentationUrl: null,
      tags: opts.tags ?? [],
      isActive: true,
      rowVersion: detail.rowVersion,
    });
  }
  return { id: world.id, title: world.name, formId: world.formId };
}

/** Publishes `count` workflows that contain the step (names are long on request) and returns them. */
async function useInWorkflows(
  seed: Seeder,
  step: StepFacts,
  count: number,
  long = false,
): Promise<{ id: number; name: string; versionId: number }[]> {
  const out: { id: number; name: string; versionId: number }[] = [];
  const token = uid();
  for (let i = 0; i < count; i++) {
    const name = long
      ? `Workflow ${i + 1} ${token} with a very long descriptive name that keeps going well past the width of a phone`
      : `Workflow ${i + 1} ${token}`;
    const wf = await seed.workflow({
      name,
      steps: [{ stepDefinitionId: step.id, title: step.title }],
    });
    out.push({ id: wf.workflowDefinitionId, name, versionId: wf.versionId });
  }
  return out;
}

/** Opens a workflow draft (a new version holding the step). */
async function openDraft(admin: Api, workflowId: number): Promise<void> {
  await admin.post(`/api/v1/workflows/${workflowId}/versions`, {});
}

test.describe('Step record page', () => {
  test.describe('header, strip, badge and tabs (#403)', () => {
    for (const size of SIZES) {
      test(`at ${size.w}x${size.h} the header, strip, tabs and overflow are clean and nothing scrolls sideways`, async ({
        page,
        seed,
        admin,
      }) => {
        test.skip(!axeAvailable(), 'axe-core not installed (set E2E_AXE_PATH to axe.min.js)');
        const step = await makeStep(admin, seed, {
          published: true,
          tags: ['Relativity', 'QC'],
          description: 'Removes duplicate items before review.',
        });
        await useInWorkflows(seed, step, 2);
        await page.setViewportSize({ width: size.w, height: size.h });
        await openStep(page, step.id);
        const header = page.locator('[data-record-header]');
        await expect(header.locator('h1')).toContainText(step.title);
        await expect(header).toContainText('Active');
        await expect(page.locator('h1')).toHaveCount(1);
        const strip = page.locator('[data-strip]');
        await expect(strip.locator('[data-strip-item=status]')).toContainText('Active');
        await expect(strip.locator('[data-strip-item=used]')).toContainText('2');
        await expect(strip.locator('[data-strip-item=inputs]')).toContainText('4 inputs');
        await expect(strip.locator('[data-strip-item=tags]')).toContainText('Relativity, QC');
        await expect(page.locator('[role=tab]')).toHaveText(['Details', 'Inputs', 'Used by (2)']);
        await expect(page.locator('.pg-banner')).toHaveCount(0);
        await clean(page, 'details');
        await shot(page, 'details', size.w);

        await overflowButton(page).click();
        await expect(page.getByRole('menuitem', { name: 'Deactivate' })).toBeVisible();
        await clean(page, 'overflow open');
        await shot(page, 'overflow', size.w);
        await page.keyboard.press('Escape');
        await expect(overflowButton(page)).toBeFocused();
      });
    }

    test('the header has Edit, Activity and the primary Edit inputs; Edit focuses the title and Edit inputs opens the designer', async ({
      page,
      seed,
      admin,
    }) => {
      const step = await makeStep(admin, seed);
      await page.setViewportSize({ width: 1366, height: 768 });
      await openStep(page, step.id, 'used-by');
      await expect(page.locator('[data-page-actions] button[data-action]')).toHaveText([
        'Edit',
        'Activity',
        'Edit inputs',
      ]);
      await expect(page.locator('[data-action=edit-inputs]')).toHaveClass(/mf-btn--primary/);
      await page.locator('[data-action=edit]').click();
      await expect(page).toHaveURL(new RegExp(`/admin/steps/${step.id}$`));
      await expect(page.locator('#step-title')).toBeFocused();
      await page.locator('[data-action=edit-inputs]').click();
      await expect(page).toHaveURL(new RegExp(`/admin/steps/${step.id}/form$`));
    });

    test('a phone keeps only the primary action in the header; Edit and Activity are in the overflow', async ({
      page,
      seed,
      admin,
    }) => {
      const step = await makeStep(admin, seed);
      await page.setViewportSize({ width: 375, height: 812 });
      await openStep(page, step.id);
      await expect(page.locator('[data-page-actions] button[data-action]')).toHaveText([
        'Edit inputs',
      ]);
      await overflowButton(page).click();
      await expect(page.getByRole('menuitem')).toHaveText(['Edit', 'Activity', 'Deactivate']);
    });

    test('Activity opens the audit drawer at every width, axe clean, and focus returns to the button', async ({
      page,
      seed,
      admin,
    }) => {
      const step = await makeStep(admin, seed);
      await openStep(page, step.id);
      for (const size of SIZES) {
        await page.setViewportSize({ width: size.w, height: size.h });
        const button = page.locator('[data-action=activity]');
        const inOverflow = !(await button.isVisible());
        if (inOverflow) {
          await overflowButton(page).click();
          await page.getByRole('menuitem', { name: 'Activity' }).click();
        } else {
          await button.click();
        }
        const drawer = page.getByRole('dialog', { name: /Activity/ });
        await expect(drawer).toBeVisible();
        await expect(drawer).toContainText(step.title);
        if (axeAvailable())
          expect(await axeViolations(page), `drawer axe at ${size.w}`).toEqual([]);
        await shot(page, 'activity', size.w);
        await page.keyboard.press('Escape');
        await expect(drawer).toBeHidden();
        await expect(inOverflow ? overflowButton(page) : button).toBeFocused();
      }
    });

    test('the tabs follow the keyboard model and the address is replaced, not added', async ({
      page,
      seed,
      admin,
    }) => {
      const step = await makeStep(admin, seed);
      await openStep(page, step.id);
      const history = await page.evaluate(() => window.history.length);
      await tab(page, 'details').focus();
      await page.keyboard.press('ArrowRight');
      await expect(tab(page, 'inputs')).toBeFocused();
      await expect(page).toHaveURL(/tab=inputs/);
      await page.keyboard.press('End');
      await expect(tab(page, 'used-by')).toBeFocused();
      await expect(page).toHaveURL(/tab=used-by/);
      await page.keyboard.press('Home');
      await expect(tab(page, 'details')).toBeFocused();
      await expect(page).not.toHaveURL(/tab=/);
      expect(await page.evaluate(() => window.history.length)).toBe(history);
      await expect(page.locator('[role=tabpanel]')).toHaveAttribute(
        'aria-labelledby',
        'st-tab-details',
      );
    });

    test('a new step: H1 "New step", no badge or actions, Inputs and Used by disabled with a reason; saving opens Inputs', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto('/admin/steps/new');
      await expect(page.getByRole('heading', { name: 'New step', level: 1 })).toBeVisible();
      await expect(page.locator('[data-status-badge], mf-active-badge')).toHaveCount(0);
      await expect(page.locator('[data-page-actions] button[data-action]')).toHaveCount(0);
      await expect(tab(page, 'inputs')).toHaveAttribute('aria-disabled', 'true');
      await expect(tab(page, 'used-by')).toHaveAttribute('aria-disabled', 'true');
      await expect(tab(page, 'inputs')).toHaveAccessibleDescription('Save the step first');
      await tab(page, 'inputs').click({ force: true });
      await expect(page).toHaveURL(/\/admin\/steps\/new$/);
      await clean(page, 'new step');
      const title = `New step ${uid()}`;
      await page.locator('#step-title').fill(title);
      await page.getByRole('button', { name: 'Create step' }).click();
      await expect(page).toHaveURL(/\/admin\/steps\/\d+\?tab=inputs$/);
      await expect(page.locator('h1')).toContainText(title);
      await expect(page.locator('[data-inputs-none]')).toBeVisible();
    });

    test('a long title is cut at two lines in the header and the whole text stays available', async ({
      page,
      seed,
      admin,
    }) => {
      const step = await makeStep(admin, seed);
      const detail = (await admin.get(`/api/v1/step-definitions/${step.id}`)) as {
        rowVersion: string;
      };
      const long = `${'Very long step title '.repeat(9)}${uid()}`.slice(0, 200);
      await admin.put(`/api/v1/step-definitions/${step.id}`, {
        title: long,
        description: null,
        instructions: null,
        documentationUrl: null,
        tags: [],
        isActive: true,
        rowVersion: detail.rowVersion,
      });
      for (const size of SIZES) {
        await page.setViewportSize({ width: size.w, height: size.h });
        await openStep(page, step.id);
        await expect(page.locator('h1')).toContainText('Very long step title');
        await clean(page, `long title at ${size.w}`);
        await shot(page, 'long-title', size.w);
      }
    });
  });

  test.describe('Details saves on its own, with a guard (#403)', () => {
    test('the footer shows only with edits; Cancel drops them; Save saves and the header shows the new title', async ({
      page,
      seed,
      admin,
    }) => {
      const step = await makeStep(admin, seed);
      await page.setViewportSize({ width: 1366, height: 768 });
      await openStep(page, step.id);
      await expect(page.locator('[data-footer]')).toHaveCount(0);
      await page.locator('#step-description').fill('Edited description');
      await expect(page.locator('[data-footer]')).toBeVisible();
      await expect(page.locator('[data-footer] button')).toHaveText(['Save changes', 'Cancel']);
      await page.locator('[data-cancel]').click();
      await expect(page.locator('#step-description')).toHaveValue('');
      await expect(page.locator('[data-footer]')).toHaveCount(0);

      await page.locator('#step-title').fill(`${step.title} renamed`);
      await expect(page.locator('h1')).toContainText(step.title);
      await expect(page.locator('h1')).not.toContainText('renamed');
      await shot(page, 'details-edited', 1366);
      await page.getByRole('button', { name: 'Save changes' }).click();
      await expect(page.locator('h1')).toContainText('renamed');
      await expect(page.locator('[data-footer]')).toHaveCount(0);
      const saved = (await admin.get(`/api/v1/step-definitions/${step.id}`)) as { title: string };
      expect(saved.title).toBe(`${step.title} renamed`);
    });

    test('switching tabs with unsaved edits asks first: Stay keeps them, Save and leave saves, Leave drops them', async ({
      page,
      seed,
      admin,
    }) => {
      const step = await makeStep(admin, seed);
      await page.setViewportSize({ width: 1366, height: 768 });
      await openStep(page, step.id);
      await page.locator('#step-description').fill('Edited description');
      await tab(page, 'inputs').click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await shot(page, 'leave-tab-dialog', 1366);
      await dialog.getByRole('button', { name: 'Stay' }).click();
      await expect(page).not.toHaveURL(/tab=inputs/);
      await expect(page.locator('#step-description')).toHaveValue('Edited description');

      await tab(page, 'inputs').click();
      await dialog.getByRole('button', { name: 'Save and leave' }).click();
      await expect(page).toHaveURL(/tab=inputs/);
      const saved = (await admin.get(`/api/v1/step-definitions/${step.id}`)) as {
        description: string;
      };
      expect(saved.description).toBe('Edited description');

      await tab(page, 'details').click();
      await page.locator('#step-description').fill('Dropped');
      await tab(page, 'used-by').click();
      await dialog.getByRole('button', { name: 'Leave', exact: true }).click();
      await expect(page).toHaveURL(/tab=used-by/);
      await tab(page, 'details').click();
      await expect(page.locator('#step-description')).toHaveValue('Edited description');
    });

    test('Edit inputs with unsaved edits asks first, and Save and leave saves then opens the designer', async ({
      page,
      seed,
      admin,
    }) => {
      const step = await makeStep(admin, seed);
      await page.setViewportSize({ width: 1366, height: 768 });
      await openStep(page, step.id);
      await page.locator('#step-instructions').fill('Run the job.');
      await page.locator('[data-action=edit-inputs]').click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Save and leave' }).click();
      await expect(page).toHaveURL(new RegExp(`/admin/steps/${step.id}/form$`));
      const saved = (await admin.get(`/api/v1/step-definitions/${step.id}`)) as {
        instructions: string;
      };
      expect(saved.instructions).toBe('Run the job.');
    });

    test('a blank title shows the summary and the field message and keeps the edits', async ({
      page,
      seed,
      admin,
    }) => {
      const step = await makeStep(admin, seed);
      await openStep(page, step.id);
      await page.locator('#step-title').fill('');
      await page.getByRole('button', { name: 'Save changes' }).click();
      await expect(page.locator('[data-summary]')).toContainText('Enter a title.');
      await expect(page.locator('#step-title')).toBeFocused();
      await expect(page.locator('h1')).toContainText(step.title);
    });
  });

  test.describe('Used by (#404)', () => {
    test('a step used by 22 workflows with long names: one sentence, 22 linked lines with a badge, nothing scrolls sideways', async ({
      page,
      seed,
      admin,
    }) => {
      test.setTimeout(240_000);
      const step = await makeStep(admin, seed);
      const wfs = await useInWorkflows(seed, step, 22, true);
      await openDraft(admin, wfs[0].id);
      await openDraft(admin, wfs[1].id);
      await page.setViewportSize({ width: 1366, height: 768 });
      await openStep(page, step.id, 'used-by');
      await expect(tab(page, 'used-by')).toContainText('(22)');
      await expect(page.locator('[data-used-note]')).toContainText(
        "Editing this step doesn't change workflows that are already published.",
      );
      await expect(page.locator('.pg-banner, [data-banner]')).toHaveCount(0);
      // 22 published versions and 2 drafts (a draft is a new version of the same workflow).
      await expect(page.locator('[data-used-link]')).toHaveCount(24);
      await expect(page.locator('[data-used-status]').filter({ hasText: 'Draft' })).toHaveCount(2);
      await expect(page.locator('[data-used-status]').filter({ hasText: 'Published' })).toHaveCount(
        22,
      );
      for (const size of SIZES) {
        await page.setViewportSize({ width: size.w, height: size.h });
        await expect(page.locator('[data-used-note]')).toBeVisible();
        const heights = await page
          .locator('[data-used-version]')
          .evaluateAll((rows) => rows.map((r) => Math.round(r.getBoundingClientRect().height)));
        expect(Math.min(...heights), `row height at ${size.w}`).toBeGreaterThanOrEqual(44);
        expect(Math.max(...heights), `row height at ${size.w}`).toBeLessThanOrEqual(64);
        await clean(page, `used by at ${size.w}`);
        await shot(page, 'used-by-22', size.w);
      }
    });

    test('each line opens its workflow version; Tab reaches the links and Enter follows one', async ({
      page,
      seed,
      admin,
    }) => {
      const step = await makeStep(admin, seed);
      const [wf] = await useInWorkflows(seed, step, 1);
      await page.setViewportSize({ width: 1366, height: 768 });
      await openStep(page, step.id, 'used-by');
      const link = page.locator('[data-used-link]');
      await expect(link).toHaveText(`${wf.name} v1`);
      await expect(link).toHaveAttribute(
        'href',
        `/admin/workflows/${wf.id}/versions/${wf.versionId}`,
      );
      await link.focus();
      await expect(link).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(
        new RegExp(`/admin/workflows/${wf.id}/versions/${wf.versionId}`),
      );
      await expect(page.locator('h1')).toContainText(wf.name);
    });

    test('an unused step says Not used, without the sentence; the strip says so too', async ({
      page,
      seed,
      admin,
    }) => {
      const step = await makeStep(admin, seed);
      await page.setViewportSize({ width: 1366, height: 768 });
      await openStep(page, step.id, 'used-by');
      await expect(page.locator('[data-not-used]')).toContainText('Not used');
      await expect(page.locator('[data-used-note]')).toHaveCount(0);
      await expect(page.locator('[data-strip-item=used]')).toContainText('Not used');
      await expect(tab(page, 'used-by')).toContainText('(0)');
      for (const size of SIZES) {
        await page.setViewportSize({ width: size.w, height: size.h });
        await clean(page, `not used at ${size.w}`);
        await shot(page, 'not-used', size.w);
      }
    });

    test('a deactivated workflow is not counted and is marked', async ({ page, seed, admin }) => {
      const step = await makeStep(admin, seed);
      const wfs = await useInWorkflows(seed, step, 2);
      const detail = (await admin.get(`/api/v1/workflows/${wfs[1].id}`)) as {
        workflow: { rowVersion: string };
      };
      await admin.put(`/api/v1/workflows/${wfs[1].id}`, {
        name: wfs[1].name,
        isActive: false,
        rowVersion: detail.workflow.rowVersion,
      });
      await openStep(page, step.id, 'used-by');
      await expect(tab(page, 'used-by')).toContainText('(1)');
      await expect(page.locator('[data-used-inactive]')).toHaveCount(1);
      await expect(page.locator('[data-strip-item=used]')).toContainText('1');
    });
  });

  test.describe('Inputs (#405)', () => {
    test('none: says so, offers Edit inputs, and the strip says None', async ({
      page,
      seed,
      admin,
    }) => {
      const step = await makeStep(admin, seed);
      await page.setViewportSize({ width: 1366, height: 768 });
      await openStep(page, step.id, 'inputs');
      await expect(page.locator('[data-inputs-none]')).toContainText('no inputs yet');
      await expect(page.locator('[data-inputs-table]')).toHaveCount(0);
      await expect(page.locator('[data-strip-item=inputs]')).toContainText('None');
      for (const size of SIZES) {
        await page.setViewportSize({ width: size.w, height: size.h });
        await clean(page, `inputs none at ${size.w}`);
        await shot(page, 'inputs-none', size.w);
      }
      await page.locator('[data-open-inputs]').click();
      await expect(page).toHaveURL(new RegExp(`/admin/steps/${step.id}/form$`));
    });

    test('draft: lists the draft fields, says to publish them first', async ({
      page,
      seed,
      admin,
    }) => {
      const step = await makeStep(admin, seed, { draft: true, fields: 3 });
      await page.setViewportSize({ width: 1366, height: 768 });
      await openStep(page, step.id, 'inputs');
      await expect(page.locator('[data-status-draft]')).toContainText('Draft v1, 3 fields');
      await expect(page.locator('[data-draft-note]')).toContainText(
        'Publish them before this step can be published in a workflow.',
      );
      await expect(page.locator('[data-input]')).toHaveCount(3);
      await expect(page.locator('[data-strip-item=inputs]')).toContainText('Draft, 3 inputs');
      for (const size of SIZES) {
        await page.setViewportSize({ width: size.w, height: size.h });
        await clean(page, `inputs draft at ${size.w}`);
        await shot(page, 'inputs-draft', size.w);
      }
    });

    test('published: label, type and required in 44 px rows', async ({ page, seed, admin }) => {
      const step = await makeStep(admin, seed, { published: true, fields: 5 });
      await page.setViewportSize({ width: 1366, height: 768 });
      await openStep(page, step.id, 'inputs');
      await expect(page.locator('[data-status-published]')).toContainText('Published v1');
      await expect(page.locator('[data-draft-note]')).toHaveCount(0);
      const first = page.locator('[data-input]').first();
      await expect(first.locator('th')).toHaveText('Field 1');
      await expect(first.locator('td').first()).toHaveText('Text');
      await expect(page.locator('[data-input]')).toHaveCount(5);
      for (const size of SIZES) {
        await page.setViewportSize({ width: size.w, height: size.h });
        const heights = await page
          .locator('[data-input]')
          .evaluateAll((rows) => rows.map((r) => Math.round(r.getBoundingClientRect().height)));
        expect(heights, `row heights at ${size.w}`).toEqual([44, 44, 44, 44, 44]);
        await clean(page, `inputs published at ${size.w}`);
        await shot(page, 'inputs-published', size.w);
      }
    });

    test('published with a newer draft: the published list and a sentence naming the draft; 45 long labels stay 44 px rows', async ({
      page,
      seed,
      admin,
    }) => {
      const step = await makeStep(admin, seed, {
        published: true,
        draft: true,
        fields: 45,
        long: true,
      });
      await page.setViewportSize({ width: 1366, height: 768 });
      await openStep(page, step.id, 'inputs');
      await expect(page.locator('[data-status-published]')).toContainText('Published v1');
      await expect(page.locator('[data-newer-draft]')).toContainText('Draft v2, 45 fields');
      await expect(page.locator('[data-input]')).toHaveCount(45);
      await expect(page.locator('[data-strip-item=inputs]')).toContainText(
        '45 inputs, newer draft',
      );
      for (const size of SIZES) {
        await page.setViewportSize({ width: size.w, height: size.h });
        const heights = await page
          .locator('[data-input]')
          .evaluateAll((rows) => rows.map((r) => Math.round(r.getBoundingClientRect().height)));
        expect(new Set(heights), `row heights at ${size.w}`).toEqual(new Set([44]));
        await clean(page, `inputs both at ${size.w}`);
        await shot(page, 'inputs-both', size.w);
      }
    });
  });

  test.describe('Deactivate (#406)', () => {
    test('0 drafts: the dialog says no draft and no published version; footer holds no danger action', async ({
      page,
      seed,
      admin,
    }) => {
      const step = await makeStep(admin, seed);
      await page.setViewportSize({ width: 1366, height: 768 });
      await openStep(page, step.id);
      await page.locator('#step-title').fill(`${step.title} x`);
      await expect(page.locator('[data-footer] button')).toHaveText(['Save changes', 'Cancel']);
      await page.locator('[data-cancel]').click();
      await menuItem(page, 'Deactivate');
      const dialog = page.getByRole('dialog', { name: 'Deactivate step?' });
      await expect(dialog.locator('[data-impact]')).toHaveText(
        'No workflow draft contains this step. No published workflow version uses it.',
      );
      await dialog.getByRole('button', { name: 'Keep active' }).click();
      await expect(dialog).toBeHidden();
      await expect(overflowButton(page)).toBeFocused();
    });

    test('1 and 2 drafts say how many drafts keep the step and how many published versions use it', async ({
      page,
      seed,
      admin,
    }) => {
      test.setTimeout(180_000);
      const step = await makeStep(admin, seed);
      const wfs = await useInWorkflows(seed, step, 2);
      await openDraft(admin, wfs[0].id);
      await page.setViewportSize({ width: 1366, height: 768 });
      await openStep(page, step.id);
      await menuItem(page, 'Deactivate');
      const dialog = page.getByRole('dialog', { name: 'Deactivate step?' });
      await expect(dialog.locator('[data-impact]')).toHaveText(
        '1 workflow draft contains this step; it keeps it. 2 published workflow versions use it and are not changed.',
      );
      await dialog.getByRole('button', { name: 'Keep active' }).click();
      await openDraft(admin, wfs[1].id);
      await openStep(page, step.id);
      await menuItem(page, 'Deactivate');
      await expect(dialog.locator('[data-impact]')).toHaveText(
        '2 workflow drafts contain this step; they keep it. 2 published workflow versions use it and are not changed.',
      );
      for (const size of SIZES) {
        await page.setViewportSize({ width: size.w, height: size.h });
        await clean(page, `deactivate dialog at ${size.w}`);
        await shot(page, 'deactivate-dialog', size.w);
      }
      await page.setViewportSize({ width: 1366, height: 768 });
      await dialog.getByRole('button', { name: 'Deactivate step' }).click();
      await expect(page.locator('[data-record-header]')).toContainText('Inactive');
      await expect(page.locator('[data-strip-item=status]')).toContainText('Inactive');
      await shot(page, 'inactive', 1366);
      await menuItem(page, 'Activate');
      await expect(page.locator('[data-record-header]')).not.toContainText('Inactive');
      await expect(page.locator('[data-strip-item=status]')).toContainText('Active');
      const after = (await admin.get(`/api/v1/step-definitions/${step.id}`)) as {
        isActive: boolean;
      };
      expect(after.isActive).toBe(true);
    });

    test('Deactivate with unsaved edits keeps the edits', async ({ page, seed, admin }) => {
      const step = await makeStep(admin, seed);
      await page.setViewportSize({ width: 1366, height: 768 });
      await openStep(page, step.id);
      await page.locator('#step-description').fill('Typed, not saved');
      await menuItem(page, 'Deactivate');
      await page
        .getByRole('dialog', { name: 'Deactivate step?' })
        .getByRole('button', { name: 'Deactivate step' })
        .click();
      await expect(page.locator('[data-record-header]')).toContainText('Inactive');
      await expect(page.locator('#step-description')).toHaveValue('Typed, not saved');
      await expect(page.locator('[data-footer]')).toBeVisible();
    });
  });

  test.describe('permission variants', () => {
    test('System Admin, Workflow.Manage + Task.View, Workflow.Manage only, TaskType.Manage only and Task.View only', async ({
      page,
      seed,
      admin,
      asUser,
    }) => {
      test.setTimeout(180_000);
      const step = await makeStep(admin, seed, {
        published: true,
        draft: true,
        fields: 3,
      });
      await useInWorkflows(seed, step, 1);

      // System Admin.
      await openStep(page, step.id, 'inputs');
      await expect(page.locator('[data-input]')).toHaveCount(3);
      await expect(page.locator('[data-action=activity]')).toBeVisible();

      // Workflow.Manage + Task.View: the whole page, no Activity without Audit.View.
      const both = await seed.role(['Workflow.Manage', 'Task.View'], 'Workflow and view');
      const bothPage = await asUser((await seed.user([both.name], 'st-both')).username);
      await bothPage.goto(`/admin/steps/${step.id}?tab=inputs`);
      await expect(bothPage.locator('[data-input]')).toHaveCount(3);
      await expect(bothPage.locator('[data-action=activity]')).toHaveCount(0);

      // Workflow.Manage only: reading forms needs Task.View on the server, so Inputs explains instead of failing.
      const only = await seed.role(['Workflow.Manage'], 'Workflow only');
      const onlyPage = await asUser((await seed.user([only.name], 'st-wfonly')).username);
      await onlyPage.goto(`/admin/steps/${step.id}?tab=inputs`);
      await expect(onlyPage.locator('[data-step-page]')).toBeVisible();
      await expect(onlyPage.locator('[data-inputs-denied]')).toContainText(
        'permission to view tasks',
      );
      await expect(onlyPage.locator('[data-status-published]')).toContainText('Published');
      // The designer reads the form too and would answer "no access", so no button leads there.
      await expect(onlyPage.locator('[data-open-inputs]')).toHaveCount(0);
      await expect(onlyPage.locator('[data-action=edit-inputs]')).toHaveCount(0);
      await expect(onlyPage.locator('[data-inputs-table]')).toHaveCount(0);
      await onlyPage.waitForTimeout(900); // a toast would appear after 400 ms
      await expect(onlyPage.locator('.p-toast-message')).toHaveCount(0);
      await expect(onlyPage.locator('[data-strip-item=inputs]')).toContainText('newer draft');
      await expect(onlyPage.locator('[data-strip-item=used]')).toContainText('1');
      await onlyPage.goto(`/admin/steps/${step.id}?tab=used-by`);
      await expect(onlyPage.locator('[data-used-link]')).toHaveCount(1);
      await onlyPage.waitForTimeout(900);
      await expect(onlyPage.locator('.p-toast-message')).toHaveCount(0);
      await onlyPage.setViewportSize({ width: 375, height: 812 });
      await clean(onlyPage, 'workflow only at 375');
      await shot(onlyPage, 'perm-workflow-only', 375);

      // TaskType.Manage only and Task.View only: the 403 page (the route needs Workflow.Manage).
      const typeOnly = await seed.role(['TaskType.Manage', 'Task.View'], 'Type only');
      const typePage = await asUser((await seed.user([typeOnly.name], 'st-ttonly')).username);
      const viewer = await seed.role(['Task.View'], 'Viewer');
      const viewerPage = await asUser((await seed.user([viewer.name], 'st-viewer')).username);
      for (const p of [typePage, viewerPage]) {
        await p.goto(`/admin/steps/${step.id}`);
        await expect(
          p.getByRole('heading', { name: "You don't have permission to view this." }),
        ).toBeVisible();
      }
    });

    test('what a Workflow.Manage-only person finds in the Inputs designer', async ({
      seed,
      admin,
      asUser,
    }) => {
      const step = await makeStep(admin, seed, { published: true, fields: 2 });
      const only = await seed.role(['Workflow.Manage'], 'Workflow only designer');
      const onlyPage = await asUser((await seed.user([only.name], 'st-wfonly2')).username);
      await onlyPage.goto(`/admin/steps/${step.id}/form`);
      // The designer reads the form versions (Task.View). It must not leave a blank page: the shared record state or the designer itself answers.
      await expect(onlyPage.locator('h1')).toBeVisible();
      await onlyPage.waitForTimeout(900);
      await expect(onlyPage.getByText("You don't have access to this step.")).toBeVisible();
      await shot(onlyPage, 'perm-workflow-only-designer', 1440);
      await expect(onlyPage.locator('.p-toast-message')).toHaveCount(0);
    });
  });
});
