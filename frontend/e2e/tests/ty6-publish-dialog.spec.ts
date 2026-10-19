import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { Api } from '../support/api';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Seeder, uid } from '../support/seed';

/**
 * Task Types UX epic #352, WP-TY6, BUG-4 (#358): the content of the publish dialogs scrolls by itself when the list of changes is
 * longer than the window, so it must be a named region that the keyboard can reach (axe `scrollable-region-focusable`).
 * Screenshots go to the folder in E2E_SCREENSHOTS (docs/ux/task-types-review/fixes/ty6-version) when it is set.
 */
const OUT = process.env['E2E_SCREENSHOTS'];

const SIZES = [
  { w: 1366, h: 768 },
  { w: 1920, h: 1080 },
  { w: 768, h: 1024 },
  { w: 375, h: 812 },
];

const REGION = 'Changes in this version';

/** A published workflow of 3 steps whose draft has those 3 plus `extra` more (the publish dialog then lists `extra` additions). */
async function longDiff(seed: Seeder, admin: Api, extra = 40) {
  const wf = await seed.workflow({ stepCount: 3 });
  const added: number[] = [];
  for (let i = 0; i < extra; i++) {
    added.push(
      (await seed.step({ title: `Added step with a longer descriptive title ${i + 1}` })).id,
    );
  }
  const id = wf.workflowDefinitionId;
  const draft = await admin.post(`/api/v1/workflows/${id}/versions`, {});
  await admin.put(`/api/v1/workflows/${id}/versions/${draft.version.workflowVersionId}`, {
    isOrdered: true,
    steps: [...wf.stepIds, ...added].map((sourceStepDefinitionId) => ({
      sourceStepDefinitionId,
      isSkippable: false,
      skipCommentRequired: false,
    })),
    rowVersion: draft.version.rowVersion,
  });
  return `/admin/workflows/${id}/versions/${draft.version.workflowVersionId}`;
}

/** A task type whose form has a draft with `count` new fields (the publish dialog lists them all as added). */
async function longFormDraft(seed: Seeder, admin: Api, count = 80) {
  const wf = await seed.workflow({ stepCount: 1 });
  const created = await admin.post('/api/v1/task-types', {
    name: `E2E Form ${uid()}`,
    description: null,
    isActive: true,
    eligibleWorkflowIds: [wf.workflowDefinitionId],
    defaultWorkflowDefinitionId: wf.workflowDefinitionId,
  });
  const formId = created.formDefinitionId;
  const draft = await admin.post(`/api/v1/forms/${formId}/versions`);
  await admin.put(`/api/v1/forms/${formId}/versions/${draft.version.formVersionId}`, {
    fields: Array.from({ length: count }, (_, i) => ({
      key: `field_${i + 1}`,
      label: `Added request field with a descriptive label ${i + 1}`,
      control: 'TEXT',
      required: false,
    })),
    rowVersion: draft.version.rowVersion,
  });
  return `/admin/task-types/${created.id}/form`;
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

test.describe('Publish dialogs: the scrollable list of changes is reachable by keyboard (BUG-4, #358)', () => {
  for (const size of SIZES) {
    test(`version publish dialog with 40 changes at ${size.w}x${size.h}: axe 0, region named, PageDown scrolls it`, async ({
      page,
      seed,
      admin,
    }) => {
      test.setTimeout(180_000);
      const url = await longDiff(seed, admin);
      await page.setViewportSize({ width: size.w, height: size.h });
      await page.goto(url);
      await page.getByRole('button', { name: 'Publish...' }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.locator('[data-diff] li').nth(39)).toBeAttached();
      await noSideScroll(page);

      // The body is taller than the window: it is a named, focusable region.
      const region = dialog.getByRole('region', { name: REGION });
      await expect(region).toBeVisible();
      await expect(region).toHaveAttribute('tabindex', '0');
      expect(
        await region.evaluate((el) => el.scrollHeight > el.clientHeight),
        'the region scrolls',
      ).toBe(true);
      await shoot(page, 'publish-dialog-long', size);
      await expectNoViolations(page, 'publish dialog open');

      // Keyboard: Tab from the close button reaches the region, PageDown and End scroll it, Shift+Tab leaves it.
      await dialog.getByRole('button', { name: 'Close dialog' }).focus();
      await page.keyboard.press('Tab');
      await expect(region).toBeFocused();
      expect(await region.evaluate((el) => el.scrollTop)).toBe(0);
      await page.keyboard.press('PageDown');
      await expect.poll(() => region.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
      await page.keyboard.press('End');
      await expect
        .poll(() => region.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop))
        .toBeLessThanOrEqual(1);
      await expectNoViolations(page, 'publish dialog scrolled');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: 'Publish...' })).toBeFocused();
    });
  }

  test('a short diff adds no empty Tab stop: the body is not a region while it fits', async ({
    page,
    seed,
    admin,
  }) => {
    test.setTimeout(120_000);
    const url = await longDiff(seed, admin, 1);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(url);
    await page.getByRole('button', { name: 'Publish...' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('[data-diff] li')).toHaveCount(1);
    await expect(dialog.getByRole('region')).toHaveCount(0);
    await expect(dialog.locator('[data-confirm-body]')).not.toHaveAttribute('tabindex', /.*/);
    await expectNoViolations(page, 'short diff');
  });

  for (const size of SIZES) {
    test(`form publish dialog with 80 added fields at ${size.w}x${size.h}: axe 0, region named, PageDown scrolls it`, async ({
      page,
      seed,
      admin,
    }) => {
      test.setTimeout(180_000);
      const url = await longFormDraft(seed, admin);
      await page.setViewportSize({ width: size.w, height: size.h });
      await page.goto(url);
      await page.getByRole('button', { name: 'Publish...' }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.locator('[data-dialog="publish"]')).toBeVisible();
      await noSideScroll(page);
      const region = dialog.getByRole('region', { name: REGION });
      await expect(region).toBeVisible();
      await expect(region).toHaveAttribute('tabindex', '0');
      await shoot(page, 'form-publish-dialog-long', size);
      await expectNoViolations(page, 'form publish dialog open');

      await region.focus();
      await page.keyboard.press('PageDown');
      await expect.poll(() => region.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: 'Publish...' })).toBeFocused();
    });
  }
});

test.describe('Publish dialogs: permissions', () => {
  test('Workflow.Manage with Task.View publishes from the version page; TaskType.Manage only and Task.View only get the 403 page', async ({
    seed,
    admin,
    asUser,
  }) => {
    test.setTimeout(180_000);
    const url = await longDiff(seed, admin, 5);
    const role = await seed.role(['Workflow.Manage', 'Task.View'], 'Workflow admin');
    const user = await seed.user([role.name], 'wf-admin');
    const page = await asUser(user.username);
    await page.goto(url);
    await page.getByRole('button', { name: 'Publish...' }).click();
    await expect(page.getByRole('dialog').locator('[data-diff] li')).toHaveCount(5);
    await expectNoViolations(page, 'publish dialog, workflow admin');

    for (const [codes, label] of [
      [['TaskType.Manage', 'Task.View'], 'tt-only'],
      [['Task.View'], 'viewer'],
    ] as const) {
      const r = await seed.role([...codes], label);
      const u = await seed.user([r.name], label);
      const denied = await asUser(u.username);
      await denied.goto(url);
      await expect(
        denied.getByRole('heading', { name: "You don't have permission to view this." }),
      ).toBeVisible();
      await expect(denied.getByRole('button', { name: 'Publish...' })).toHaveCount(0);
    }
  });
});
