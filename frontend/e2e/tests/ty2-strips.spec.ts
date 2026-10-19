import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { Api } from '../support/api';
import { axeAvailable, axeViolations } from '../support/axe';
import { seedMix } from '../support/admin-lists';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

/**
 * WP-TY2 tab counts (#364) and health strips (#367 Task Types, #368 Workflows and Steps) of the Task Types administration. The counts are
 * the ACTIVE records of each tab; the strips count the whole library (no filter applies to them) and their chips put the matching filter
 * in the address. Screenshots go to E2E_SCREENSHOTS (docs/ux/task-types-review/fixes/ty2-shell).
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

async function noSideScroll(page: Page, what: string): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${what}: page-level horizontal scroll`).toBeLessThanOrEqual(0);
}

const tab = (page: Page, key: string) => page.locator(`[role="tab"][data-tab="${key}"]`);
const chip = (page: Page, key: string) => page.locator(`[data-strip-item="${key}"]`);
/** The number in a strip chip ("Not usable 3" is 3). */
const chipCount = async (page: Page, key: string): Promise<number> =>
  Number((await chip(page, key).locator('.n').textContent())!.trim());
/** The total of the pager ("Showing 1-25 of 61 active" is 61). */
const pagerTotal = async (page: Page): Promise<number> => {
  const text = (await page.locator('mf-pager').textContent())!;
  return Number(/of (\d+)/.exec(text)![1]);
};

interface Counts {
  types: number;
  workflows: number;
  steps: number;
}

/** What the tabs must say, from the API directly. */
async function activeCounts(admin: Api): Promise<Counts> {
  const types = await admin.get<{ isActive: boolean }[]>('/api/v1/task-types');
  const wf = await admin.get<{ total: number }>(
    '/api/v1/workflows?isActive=true&page=1&pageSize=1',
  );
  const steps = await admin.get<{ total: number }>(
    '/api/v1/step-definitions?isActive=true&page=1&pageSize=1',
  );
  return { types: types.filter((t) => t.isActive).length, workflows: wf.total, steps: steps.total };
}

test.describe('tab counts (#364)', () => {
  test('each tab shows its active count, spoken as "Workflows, 30 active", and a deactivate moves it', async ({
    page,
    admin,
  }) => {
    const token = uid();
    await seedMix(admin, 'workflows', token, 2, 1);
    await seedMix(admin, 'steps', token, 2, 1);
    await seedMix(admin, 'types', token, 2, 1);
    const expected = await activeCounts(admin);
    await page.goto(`/admin/workflows?name=${token}`);
    await expect(tab(page, 'task-types')).toContainText(`(${expected.types})`);
    await expect(tab(page, 'workflows')).toContainText(`(${expected.workflows})`);
    await expect(tab(page, 'steps')).toContainText(`(${expected.steps})`);
    await expect(tab(page, 'workflows')).toHaveAttribute(
      'aria-label',
      `Workflows, ${expected.workflows} active`,
    );
    // A filtered view does not change a count: the name filter above shows two rows, the tab says the library.
    await expect(page.locator('tbody tr[data-row]')).toHaveCount(2);

    // Deactivate one in the list: the tab follows without another page load.
    await page.locator('tbody tr[data-row]').first().locator('button[data-overflow]').click();
    await page.getByRole('menuitem', { name: 'Deactivate' }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /^Deactivate/ })
      .click();
    await expect(tab(page, 'workflows')).toContainText(`(${expected.workflows - 1})`);
    expect((await activeCounts(admin)).workflows).toBe(expected.workflows - 1);

    // The Task Types tab reports its own number the same way.
    await page.goto(`/admin/task-types?name=${token}`);
    await page.locator('tbody tr[data-row]').first().locator('button[data-overflow]').click();
    await page.getByRole('menuitem', { name: 'Deactivate' }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /^Deactivate/ })
      .click();
    await expect(tab(page, 'task-types')).toContainText(`(${expected.types - 1})`);
  });

  test('four sizes: no sideways scroll and axe 0 with the counts', async ({ page }) => {
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto('/admin/task-types');
      await expect(tab(page, 'workflows')).toContainText(/\(\d+\)/);
      await noSideScroll(page, `tabs at ${size.width}`);
      if (axeAvailable()) expect(await axeViolations(page), `counts at ${size.width}`).toEqual([]);
      await shot(page, 'p364-tab-counts');
    }
  });

  test('permissions: only the tabs a person may use have a count, and nothing is asked for the others', async ({
    seed,
    asUser,
  }) => {
    const wfRole = await seed.role(['Workflow.Manage', 'Task.View'], 'Workflow only');
    const wf = await asUser((await seed.user([wfRole.name], 'ty2c-wf')).username);
    const asked: string[] = [];
    wf.on('request', (r) => asked.push(new URL(r.url()).pathname));
    await wf.goto('/admin/workflows');
    await expect(wf.locator('[role="tab"]')).toHaveCount(2);
    await expect(tab(wf, 'workflows')).toContainText(/\(\d+\)/);
    await expect(tab(wf, 'steps')).toContainText(/\(\d+\)/);
    expect(asked.filter((p) => p === '/api/v1/task-types')).toEqual([]);

    const typeRole = await seed.role(['TaskType.Manage', 'Task.View'], 'Type only');
    const tt = await asUser((await seed.user([typeRole.name], 'ty2c-tt')).username);
    const askedTypes: string[] = [];
    tt.on('request', (r) => askedTypes.push(new URL(r.url()).pathname + new URL(r.url()).search));
    await tt.goto('/admin/task-types');
    await expect(tt.locator('[role="tab"]')).toHaveCount(1);
    await expect(tab(tt, 'task-types')).toContainText(/\(\d+\)/);
    // No count request for the tabs it may not use (the workflow names behind the chips are the page's own, older request).
    expect(askedTypes.filter((p) => p.startsWith('/api/v1/step-definitions'))).toEqual([]);
    expect(askedTypes.filter((p) => /^\/api\/v1\/workflows\?.*pageSize=1(&|$)/.test(p))).toEqual(
      [],
    );
  });
});

test.describe('health strips (#367, #368)', () => {
  test('Task Types: Active, Not usable, Form in draft and Inactive count the library and their chips filter the list', async ({
    page,
    admin,
    seed,
  }) => {
    const token = uid();
    const flow = await seed.workflow({ name: `Flow ${token}`, stepCount: 1 });
    await seed.taskType({
      name: `${token} Usable`,
      workflows: [flow],
      fields: [{ key: 'note', label: 'Note', control: 'TEXT' }],
    });
    await seedMix(admin, 'types', token, 2, 2); // no workflow: active ones are not usable
    // A type whose form is a draft.
    const drafted = await admin.post('/api/v1/task-types', {
      name: `${token} Drafted`,
      description: null,
      isActive: true,
      eligibleWorkflowIds: [flow.workflowDefinitionId],
      defaultWorkflowDefinitionId: flow.workflowDefinitionId,
    });
    await admin.post(`/api/v1/forms/${drafted.formDefinitionId}/versions`);

    const all =
      await admin.get<{ isActive: boolean; usabilityIssues: string[]; formStatus?: string }[]>(
        '/api/v1/task-types',
      );
    const active = all.filter((t) => t.isActive);
    const expected = {
      active: active.length,
      notUsable: active.filter((t) => t.usabilityIssues.some((i) => i !== 'INACTIVE')).length,
      formDraft: active.filter((t) => t.formStatus === 'DRAFT' || t.formStatus === 'Draft').length,
      inactive: all.length - active.length,
    };

    await page.setViewportSize(SIZES[0]);
    await page.goto('/admin/task-types');
    const strip = page.getByRole('list', { name: 'Task types summary' });
    await expect(strip).toBeVisible();
    for (const key of ['active', 'notUsable', 'formDraft', 'inactive'] as const) {
      expect(await chipCount(page, key), key).toBe(expected[key]);
    }
    await expect(chip(page, 'active')).toHaveAttribute('aria-pressed', 'true');
    expect(expected.notUsable).toBeGreaterThan(0);
    expect(expected.formDraft).toBeGreaterThan(0);
    await shot(page, 'p367-strip');

    // Not usable: the address, the pressed chip, the rows (all active, all with the red line) and the announced count.
    await chip(page, 'notUsable').click();
    await expect(page).toHaveURL(/usable=no/);
    await expect(chip(page, 'notUsable')).toHaveAttribute('aria-pressed', 'true');
    await expect(chip(page, 'active')).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => pagerTotal(page)).toBe(expected.notUsable);
    await expect(page.locator('[data-announce]')).toContainText(
      `Not usable: ${expected.notUsable}`,
    );
    expect(await chipCount(page, 'notUsable')).toBe(expected.notUsable); // the strip does not follow the filter

    await chip(page, 'formDraft').click();
    await expect(page).toHaveURL(/form=draft/);
    await expect(page).not.toHaveURL(/usable=/);
    await expect.poll(() => pagerTotal(page)).toBe(expected.formDraft);

    await chip(page, 'inactive').click();
    await expect(page).toHaveURL(/status=inactive/);
    await expect(page.locator('tbody tr[data-row].inactive').first()).toBeVisible();

    // The pressed chip again goes back to Active; Active clears the others.
    await chip(page, 'inactive').click();
    await expect(page).not.toHaveURL(/status=/);
    await expect(chip(page, 'active')).toHaveAttribute('aria-pressed', 'true');

    // Keyboard: a chip is a button.
    await chip(page, 'notUsable').focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/usable=no/);
    await expect(page.getByRole('list', { name: 'Active filters' })).toContainText(
      'Can create tasks',
    );
  });

  test('Workflows: Published, Draft in progress, Not published and Inactive come from the API summary and filter the list', async ({
    page,
    admin,
    seed,
  }) => {
    const token = uid();
    const published = await seed.workflow({ name: `${token} Published`, stepCount: 1 });
    const both = await seed.workflow({ name: `${token} Both`, stepCount: 1 });
    await admin.post(`/api/v1/workflows/${both.workflowDefinitionId}/versions`, {});
    await admin.post('/api/v1/workflows', { name: `${token} Draft only`, isOrdered: true });
    await seedMix(admin, 'workflows', token, 0, 1);
    expect(published.workflowDefinitionId).toBeGreaterThan(0);
    const summary = (
      await admin.get<{
        summary: {
          published: number;
          draftInProgress: number;
          notPublished: number;
          inactive: number;
        };
      }>('/api/v1/workflows?page=1&pageSize=1')
    ).summary;

    await page.setViewportSize(SIZES[0]);
    await page.goto(`/admin/workflows?name=${token}`);
    const strip = page.getByRole('list', { name: 'Workflows summary' });
    await expect(strip).toBeVisible();
    // The counts are the library's, not the filtered list's (the name filter shows 3 rows).
    expect(await chipCount(page, 'published')).toBe(summary.published);
    expect(await chipCount(page, 'draft')).toBe(summary.draftInProgress);
    expect(await chipCount(page, 'notPublished')).toBe(summary.notPublished);
    expect(await chipCount(page, 'inactive')).toBe(summary.inactive);
    await shot(page, 'p368-workflows-strip');

    await page.goto('/admin/workflows');
    await chip(page, 'notPublished').click();
    await expect(page).toHaveURL(/hasPublished=false/);
    await expect(chip(page, 'notPublished')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => pagerTotal(page)).toBe(summary.notPublished);
    await chip(page, 'draft').click();
    await expect(page).toHaveURL(/hasDraft=true/);
    await expect(page).not.toHaveURL(/hasPublished=/);
    await expect.poll(() => pagerTotal(page)).toBe(summary.draftInProgress);
    await chip(page, 'published').click();
    await expect.poll(() => pagerTotal(page)).toBe(summary.published);
    await chip(page, 'inactive').click();
    await expect(page).toHaveURL(/status=inactive/);
    await expect(page.locator('tbody tr[data-row]').first()).toBeVisible();
    await chip(page, 'inactive').click(); // pressed again: all filters off
    await expect(page).not.toHaveURL(/status=|hasPublished=|hasDraft=/);
  });

  test('Steps: Active, Not used, Inputs in draft (a plain count) and Inactive come from the API summary', async ({
    page,
    admin,
  }) => {
    const token = uid();
    await seedMix(admin, 'steps', token, 2, 1);
    const summary = (
      await admin.get<{
        summary: { active: number; notUsed: number; inputsInDraft: number; inactive: number };
      }>('/api/v1/step-definitions?page=1&pageSize=1')
    ).summary;
    await page.setViewportSize(SIZES[0]);
    await page.goto(`/admin/steps?title=${token}`);
    await expect(page.getByRole('list', { name: 'Steps summary' })).toBeVisible();
    expect(await chipCount(page, 'active')).toBe(summary.active);
    expect(await chipCount(page, 'notUsed')).toBe(summary.notUsed);
    expect(await chipCount(page, 'inputsDraft')).toBe(summary.inputsInDraft);
    expect(await chipCount(page, 'inactive')).toBe(summary.inactive);
    await expect(chip(page, 'inputsDraft')).not.toHaveAttribute('aria-pressed', /.*/);
    await shot(page, 'p368-steps-strip');
    await page.goto('/admin/steps');
    await chip(page, 'notUsed').click();
    await expect(page).toHaveURL(/used=false/);
    await expect.poll(() => pagerTotal(page)).toBe(summary.notUsed);
    await chip(page, 'inactive').click();
    await expect(page).toHaveURL(/status=inactive/);
    await expect(page).not.toHaveURL(/used=/);
  });

  test('four sizes: the strips wrap without a sideways scroll and pass axe, a skeleton count shows -- while loading', async ({
    page,
  }) => {
    for (const path of ['/admin/task-types', '/admin/workflows', '/admin/steps']) {
      for (const size of SIZES) {
        await page.setViewportSize(size);
        await page.goto(path);
        await expect(page.locator('[data-strip]')).toBeVisible();
        await expect(page.locator('[data-strip-item] .n').first()).toHaveText(/\d+/);
        await noSideScroll(page, `${path} strip at ${size.width}`);
        if (axeAvailable()) {
          expect(await axeViolations(page), `${path} strip at ${size.width}`).toEqual([]);
        }
        await shot(page, `p367-strip${path.replace('/admin', '').replace('/', '-')}`);
      }
    }
    // While the first answer is on its way the counts read "--".
    await page.setViewportSize(SIZES[0]);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(
      (url) => url.pathname === '/api/v1/workflows',
      async (route) => {
        await held;
        await route.continue();
      },
    );
    await page.goto('/admin/workflows');
    await expect(chip(page, 'published').locator('.n')).toHaveText('--');
    release();
    await expect(chip(page, 'published').locator('.n')).toHaveText(/\d+/);
  });

  test('permissions: Workflow.Manage only has the Workflows and Steps strips, TaskType.Manage only the Task Types strip', async ({
    seed,
    asUser,
  }) => {
    const wfRole = await seed.role(['Workflow.Manage', 'Task.View'], 'Workflow only');
    const wf = await asUser((await seed.user([wfRole.name], 'ty2s-wf')).username);
    await wf.goto('/admin/workflows');
    await expect(wf.getByRole('list', { name: 'Workflows summary' })).toBeVisible();
    await wf.goto('/admin/steps');
    await expect(wf.getByRole('list', { name: 'Steps summary' })).toBeVisible();
    const typeRole = await seed.role(['TaskType.Manage', 'Task.View'], 'Type only');
    const tt = await asUser((await seed.user([typeRole.name], 'ty2s-tt')).username);
    await tt.goto('/admin/task-types');
    await expect(tt.getByRole('list', { name: 'Task types summary' })).toBeVisible();
  });
});
