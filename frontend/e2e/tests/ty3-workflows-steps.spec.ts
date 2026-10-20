import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

/**
 * WP-TY3 Workflows columns (#376 Versions, Steps, Task types, Last published; #377 the Draft badge links to the draft and Not published is
 * a neutral badge) and the Steps Inputs column (#378). Screenshots go to E2E_SCREENSHOTS (docs/ux/task-types-review/fixes/ty3-lists).
 */
const OUT = process.env['E2E_SCREENSHOTS'];
const SIZES = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
  { width: 768, height: 1024 },
  { width: 375, height: 812 },
] as const;

async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  const size = page.viewportSize()!;
  await page.screenshot({ path: path.join(OUT, `${name}-${size.width}x${size.height}.png`) });
}

const heads = (page: Page) =>
  page
    .locator('thead tr:first-child th')
    .allInnerTexts()
    .then((t) => t.map((x) => x.replace(/\s+/g, ' ').trim()));

test.describe('Workflows columns (#376, #377)', () => {
  test('Versions, Steps, Task types and Last published: the numbers equal the API, rows stay 44 px, the columns sort', async ({
    page,
    seed,
    admin,
  }) => {
    const token = uid();
    const old = await seed.workflow({ name: `${token} Old flow`, stepCount: 2 });
    const recent = await seed.workflow({ name: `${token} Recent flow`, stepCount: 4 });
    for (let i = 0; i < 2; i++) {
      await seed.taskType({ name: `${token} Type ${i}`, workflows: [recent] });
    }
    const draftOnly = await admin.post('/api/v1/workflows', {
      name: `${token} Draft only`,
      description: null,
      isOrdered: true,
    });
    expect(draftOnly.workflow.workflowDefinitionId).toBeGreaterThan(0);
    expect(old.workflowDefinitionId).toBeGreaterThan(0);

    const api = await admin.get<{
      items: {
        name: string;
        stepCount?: number;
        taskTypeCount: number;
        publishedAtUtc?: string;
      }[];
    }>(`/api/v1/workflows?name=${token}&pageSize=25`);
    const byName = Object.fromEntries(api.items.map((w) => [w.name, w]));

    await page.setViewportSize(SIZES[0]);
    await page.goto(`/admin/workflows?name=${token}`);
    await expect(page.locator('tbody tr[data-row]').first()).toBeVisible();
    expect(await heads(page)).toEqual([
      'Name',
      'Versions',
      'Steps',
      'Task types',
      'Last published',
      'Status',
      'Actions',
    ]);
    const row = (name: string) => page.locator(`[data-row="${token} ${name}"]`);
    await expect(row('Recent flow').locator('[data-steps]')).toHaveText('4');
    await expect(row('Recent flow').locator('[data-task-types]')).toHaveText(
      String(byName[`${token} Recent flow`].taskTypeCount),
    );
    await expect(row('Recent flow').locator('[data-task-types-link]')).toHaveText('2');
    await expect(row('Old flow').locator('[data-task-types]')).toHaveText('0');
    // The date of the last publication in the viewer's zone, Month day (with the year), the instant as its tooltip.
    await expect(row('Recent flow').locator('[data-last-published]')).toHaveText(
      /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/,
    );
    await expect(row('Draft only').locator('[data-last-published]')).toHaveText('–');
    await expect(row('Draft only').locator('[data-steps]')).toHaveText('–');
    await expect(row('Draft only').locator('[data-not-published]')).toContainText('Not published');
    await shot(page, 'p376-workflows');

    // 44 px rows with the new cells.
    for (const r of await page.locator('tbody tr[data-row]').all()) {
      const box = (await r.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(43);
      expect(box.height).toBeLessThanOrEqual(45);
    }

    // Last published sorts newest first on the first click; Task types busiest first.
    const published = page.getByRole('columnheader', { name: 'Last published' });
    await published.getByRole('button').click();
    await expect(page).toHaveURL(/sort=-publishedAtUtc/);
    await expect(published).toHaveAttribute('aria-sort', 'descending');
    await expect(page.locator('tbody tr[data-row]').last()).toHaveAttribute(
      'data-row',
      `${token} Draft only`,
    ); // never-published workflows come last in both directions
    const types = page.getByRole('columnheader', { name: 'Task types' });
    await types.getByRole('button').click();
    await expect(page).toHaveURL(/sort=-taskTypeCount/);
    await expect(page.locator('tbody tr[data-row]').first()).toHaveAttribute(
      'data-row',
      `${token} Recent flow`,
    );
    if (axeAvailable()) expect(await axeViolations(page), 'workflows columns').toEqual([]);
  });

  test('the Draft badge is the link into the draft: reached with the right arrow from the name (not a Tab stop, #413), Back puts focus on the name; Not published is a neutral badge', async ({
    page,
    seed,
    admin,
  }) => {
    const token = uid();
    const wf = await seed.workflow({ name: `${token} Flow`, stepCount: 1 });
    const draft = await admin.post(`/api/v1/workflows/${wf.workflowDefinitionId}/versions`, {});
    const draftId = draft.version.workflowVersionId;
    await page.setViewportSize(SIZES[0]);
    await page.goto(`/admin/workflows?name=${token}`);
    const link = page.getByRole('link', { name: 'Open draft v2' });
    await expect(link).toHaveAttribute(
      'href',
      `/admin/workflows/${wf.workflowDefinitionId}/versions/${draftId}`,
    );
    await shot(page, 'p377-draft-badge');
    if (axeAvailable()) expect(await axeViolations(page), 'draft badge link').toEqual([]);
    // The row has two Tab stops, the name and the menu (#413); the draft link is the stop the right arrow reaches from the name.
    await page.locator(`a[data-row-key="${wf.workflowDefinitionId}"]`).focus();
    await expect(link).toHaveAttribute('tabindex', '-1');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: `Actions for ${wf.name}` })).toBeFocused();
    await page.locator(`a[data-row-key="${wf.workflowDefinitionId}"]`).focus();
    await page.keyboard.press('ArrowRight');
    await expect(link).toBeFocused();
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(
      new RegExp(`/admin/workflows/${wf.workflowDefinitionId}/versions/${draftId}$`),
    );
    await page.goBack();
    await expect(page.locator(`a[data-row-key="${wf.workflowDefinitionId}"]`)).toBeFocused();

    // A workflow that was never published: the neutral badge, no consequence colour.
    const bare = await admin.post('/api/v1/workflows', {
      name: `${token} Bare`,
      description: null,
      isOrdered: true,
    });
    await page.goto(`/admin/workflows?name=${token}%20Bare`);
    const badge = page.locator(`[data-row="${token} Bare"] [data-not-published]`);
    await expect(badge).toContainText('Not published');
    await expect(badge.locator('[data-tone="neutral"]')).toHaveCount(1);
    expect(bare.workflow.workflowDefinitionId).toBeGreaterThan(0);
  });

  test('the columns drop in a fixed order: Last published below 1280, Task types below 1100, Steps below 900; phone cards say the facts; permissions', async ({
    page,
    seed,
    asUser,
  }) => {
    const all = ['Name', 'Versions', 'Steps', 'Task types', 'Last published', 'Status', 'Actions'];
    const expected: [number, string[]][] = [
      [1920, all],
      [1280, all],
      [1200, all.filter((h) => h !== 'Last published')],
      [1100, all.filter((h) => h !== 'Last published')],
      [1000, ['Name', 'Versions', 'Steps', 'Status', 'Actions']],
      [900, ['Name', 'Versions', 'Steps', 'Status', 'Actions']],
      [768, ['Name', 'Versions', 'Status', 'Actions']],
      [640, ['Name', 'Versions', 'Status', 'Actions']],
    ];
    for (const [width, names] of expected) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/admin/workflows');
      await expect(page.locator('tbody tr[data-row]').first()).toBeVisible();
      expect(await heads(page), `at ${width}`).toEqual(names);
    }
    const role = await seed.role(['Workflow.Manage', 'Task.View'], 'Workflow only');
    const wf = await asUser((await seed.user([role.name], 'ty3w-wf')).username);
    await wf.setViewportSize(SIZES[0]);
    await wf.goto('/admin/workflows');
    await expect(wf.locator('tbody tr[data-row]').first()).toBeVisible();
    // Without TaskType.Manage the number of task types is plain text, never a link to a page the person cannot open.
    await expect(wf.locator('[data-task-types-link]')).toHaveCount(0);
    await expect(wf.locator('[data-versions]').first()).toBeVisible();
  });
});

test.describe('Steps Inputs column (#378)', () => {
  test('Draft (a neutral badge), Published or None; hidden below 1024 px; the card names the draft', async ({
    page,
    seed,
    admin,
  }) => {
    const token = uid();
    const drafted = await admin.post('/api/v1/step-definitions', {
      title: `${token} Drafted`,
      description: null,
      instructions: null,
      tags: [],
    });
    const draft = await admin.post(`/api/v1/forms/${drafted.formDefinitionId}/versions`);
    await admin.put(
      `/api/v1/forms/${drafted.formDefinitionId}/versions/${draft.version.formVersionId}`,
      {
        fields: [
          { key: 'a', label: 'A', control: 'TEXT', required: false },
          { key: 'b', label: 'B', control: 'TEXT', required: false },
        ],
        rowVersion: draft.version.rowVersion,
      },
    );
    await seed.step({ title: `${token} Published`, requiredInput: true });
    await admin.post('/api/v1/step-definitions', {
      title: `${token} Bare`,
      description: null,
      instructions: null,
      tags: [],
    });
    const cell = (name: string) =>
      page.locator(`tbody tr[data-row^="${token} ${name}"] [data-inputs]`);

    await page.setViewportSize(SIZES[0]);
    await page.goto(`/admin/steps?title=${token}`);
    await expect(page.locator('tbody tr[data-row]').first()).toBeVisible();
    expect((await heads(page)).includes('Inputs')).toBe(true);
    await expect(cell('Drafted').locator('[data-inputs-draft]')).toHaveText('Draft');
    await expect(cell('Drafted').locator('[data-tone="neutral"]')).toHaveCount(1);
    await expect(cell('Drafted').locator('[data-inputs-draft]')).toHaveAttribute(
      'title',
      /2 fields/,
    );
    await expect(cell('Published')).toHaveText('Published');
    await expect(cell('Bare')).toHaveText('None');
    await shot(page, 'p378-steps-inputs');
    if (axeAvailable()) expect(await axeViolations(page), 'inputs column').toEqual([]);

    // 44 px rows, no sideways scroll at the table widths.
    for (const width of [1024, 1280, 1366, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/admin/steps?title=${token}`);
      await expect(page.locator('tbody tr[data-row]').first()).toBeVisible();
      for (const r of await page.locator('tbody tr[data-row]').all()) {
        const box = (await r.boundingBox())!;
        expect(box.height, `at ${width}`).toBeLessThanOrEqual(45);
      }
      const fit = await page
        .locator('.mf-table-wrap')
        .evaluate((el) => el.scrollWidth <= el.clientWidth);
      expect(fit, `at ${width}`).toBe(true);
    }
    await page.setViewportSize({ width: 768, height: 900 });
    await page.goto(`/admin/steps?title=${token}`);
    await expect(page.locator('tbody tr[data-row]').first()).toBeVisible();
    expect(await heads(page)).not.toContain('Inputs');

    // The phone card says it.
    await page.setViewportSize(SIZES[3]);
    await page.goto(`/admin/steps?title=${token}`);
    await expect(
      page.locator('li[data-record-card]').filter({ hasText: `${token} Drafted` }),
    ).toContainText('Inputs in draft (2 fields)');
  });
});
