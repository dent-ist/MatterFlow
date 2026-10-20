import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { Api } from '../support/api';
import { expect, test } from '../support/fixtures';
import { axeAvailable, axeViolations } from '../support/axe';
import { uid } from '../support/seed';

/**
 * WP-TY1 BUG-3 (#354): Back and the breadcrumb return to the exact list view (page, size, filters) with keyboard focus on the name link of
 * the row that was left, on the three Administration lists. With E2E_SCREENSHOTS set the focused row is also saved at four widths
 * (docs/ux/task-types-review/fixes/ty1-foundations).
 */
const SHOTS = process.env['E2E_SCREENSHOTS'];
const SIZES = [
  { w: 1366, h: 768 },
  { w: 1920, h: 1080 },
  { w: 768, h: 1024 },
  { w: 375, h: 812 },
];

type Kind = 'types' | 'workflows' | 'steps';

interface Seeded {
  token: string;
  ids: number[];
  names: string[];
}

const KINDS: Record<Kind, { list: string; filter: string; heading: string }> = {
  types: { list: '/admin/task-types', filter: 'name', heading: 'Task Types' },
  workflows: { list: '/admin/workflows', filter: 'name', heading: 'Workflows' },
  steps: { list: '/admin/steps', filter: 'title', heading: 'Workflow Steps' },
};

/** Twenty-nine records of a kind with the same token, named so that they sort in creation order (page 2 of 25 holds the last four). */
async function seedMany(
  admin: Api,
  kind: Kind,
  extra: { eligible?: number[] } = {},
): Promise<Seeded> {
  const token = uid();
  const ids: number[] = [];
  const names: string[] = [];
  for (let i = 0; i < 29; i++) {
    const name = `${token} Row ${String(i).padStart(2, '0')}`;
    names.push(name);
    if (kind === 'types') {
      const eligible = extra.eligible ?? [];
      const created = await admin.post('/api/v1/task-types', {
        name,
        description: null,
        isActive: true,
        eligibleWorkflowIds: eligible,
        defaultWorkflowDefinitionId: eligible[0] ?? null,
      });
      ids.push(created.id);
    } else if (kind === 'workflows') {
      const created = await admin.post('/api/v1/workflows', {
        name,
        description: null,
        isOrdered: true,
      });
      ids.push(created.workflow.workflowDefinitionId);
    } else {
      const created = await admin.post('/api/v1/step-definitions', {
        title: name,
        description: null,
        instructions: null,
        tags: [],
      });
      ids.push(created.stepDefinitionId);
    }
  }
  return { token, ids, names };
}

const rowLink = (page: Page, id: number) => page.locator(`a[data-row-key="${id}"]`);
const focusedKey = (page: Page) =>
  page.evaluate(() => document.activeElement?.getAttribute('data-row-key') ?? null);
const crumb = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name, exact: true });
const urlOf = (page: Page) => {
  const u = new URL(page.url());
  return u.pathname + u.search;
};

async function shot(page: Page, name: string, size: { w: number }): Promise<void> {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}-${size.w}.png`) });
}

test.describe('Back and the breadcrumb keep the list view and the row focus (#354)', () => {
  for (const kind of ['types', 'workflows', 'steps'] as const) {
    test(`${kind}: open the 4th row of page 2, Back and the crumb land on the same view with focus on the name link`, async ({
      page,
      admin,
    }) => {
      const seeded = await seedMany(admin, kind);
      const { list, filter, heading } = KINDS[kind];
      const listUrl = `${list}?${filter}=${seeded.token}&size=25&page=2&sort=${kind === 'steps' ? 'title' : 'name'}`;
      await page.goto(listUrl);
      const id = seeded.ids[25 + 3];
      await expect(rowLink(page, id)).toBeVisible();
      const before = urlOf(page);

      // Browser Back.
      await rowLink(page, id).click();
      await expect(page).toHaveURL(new RegExp(`${list}/${id}$`));
      await page.goBack();
      expect(urlOf(page)).toBe(before);
      await expect(rowLink(page, id)).toBeFocused();

      // The breadcrumb.
      await rowLink(page, id).click();
      await expect(page).toHaveURL(new RegExp(`${list}/${id}$`));
      await crumb(page, heading).click();
      expect(urlOf(page)).toBe(before);
      await expect(rowLink(page, id)).toBeFocused();

      // Cancel on the edit page is the same way back (the Task Type and Step record pages have no Cancel until a tab has edits, #380, #403).
      if (kind === 'workflows') {
        await rowLink(page, id).click();
        await expect(page).toHaveURL(new RegExp(`${list}/${id}$`));
        await page
          .getByRole('link', { name: 'Cancel' })
          .or(page.getByRole('button', { name: 'Cancel' }))
          .click();
        expect(urlOf(page)).toBe(before);
        await expect(rowLink(page, id)).toBeFocused();
      }

      // A reload of the list is not a return: nothing takes focus.
      await page.reload();
      await expect(rowLink(page, id)).toBeVisible();
      expect(await focusedKey(page)).toBeNull();
    });
  }

  test('the filtered views (?workflow=, ?taskType=, ?step=) come back too', async ({
    page,
    admin,
    seed,
  }) => {
    const step = await seed.step({ title: 'Return step' });
    const workflow = await seed.workflow({
      name: `Return flow ${uid()}`,
      steps: [{ stepDefinitionId: step.id, title: step.title }],
    });
    const types = await seedMany(admin, 'types', { eligible: [workflow.workflowDefinitionId] });
    // Task Types filtered by workflow.
    await page.goto(`/admin/task-types?workflow=${workflow.workflowDefinitionId}&size=25&page=2`);
    const typeId = types.ids.find((id) => id > 0)!;
    const links = page.locator('a[data-row-key]');
    await expect(links.first()).toBeVisible();
    const target = links.nth(1);
    const key = await target.getAttribute('data-row-key');
    const before = urlOf(page);
    await target.click();
    await crumb(page, 'Task Types').click();
    expect(urlOf(page)).toBe(before);
    await expect(page.locator(`a[data-row-key="${key}"]`)).toBeFocused();
    expect(typeId).toBeGreaterThan(0);

    // Workflows filtered by task type and by step.
    for (const query of [`taskType=${types.ids[0]}`, `step=${step.id}`]) {
      await page.goto(`/admin/workflows?${query}&size=25`);
      const first = page.locator('a[data-row-key]').first();
      await expect(first).toBeVisible();
      const k = await first.getAttribute('data-row-key');
      const url = urlOf(page);
      await first.click();
      await expect(page).toHaveURL(new RegExp(`/admin/workflows/${k}$`));
      await crumb(page, 'Workflows').click();
      expect(urlOf(page), query).toBe(url);
      await expect(page.locator(`a[data-row-key="${k}"]`), query).toBeFocused();
    }
  });

  test('the row menu entries (Edit form, Open draft, Edit inputs) leave a row that Back finds again; the version page and the form page crumbs keep the view', async ({
    page,
    admin,
  }) => {
    const types = await seedMany(admin, 'types');
    const flows = await seedMany(admin, 'workflows');
    const steps = await seedMany(admin, 'steps');

    // Edit form from the Task Types row menu, then Back and the crumb of the form page.
    const typesUrl = `/admin/task-types?name=${types.token}&size=25&page=2`;
    await page.goto(typesUrl);
    const typeId = types.ids[26];
    await page.getByRole('button', { name: `Actions for ${types.names[26]}` }).click();
    await page.getByRole('menuitem', { name: 'Edit form' }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/task-types/${typeId}/form$`));
    await page.goBack();
    await expect(rowLink(page, typeId)).toBeFocused();
    await page.getByRole('button', { name: `Actions for ${types.names[26]}` }).click();
    await page.getByRole('menuitem', { name: 'Edit form' }).click();
    await crumb(page, 'Task Types').click();
    expect(urlOf(page)).toBe(typesUrl);
    await expect(rowLink(page, typeId)).toBeFocused();

    // Name link, then the edit page's link to the designer: the form page crumb still returns to the list view.
    await rowLink(page, typeId).click();
    await page.locator('[data-action="edit-form"]').click();
    await expect(page).toHaveURL(new RegExp(`/admin/task-types/${typeId}/form$`));
    await crumb(page, 'Task Types').click();
    expect(urlOf(page)).toBe(typesUrl);

    // Workflows: edit page, then Open draft, then the version page crumb "Workflows".
    const flowsUrl = `/admin/workflows?name=${flows.token}&size=25&page=2`;
    await page.goto(flowsUrl);
    const flowId = flows.ids[26];
    await rowLink(page, flowId).click();
    await expect(page).toHaveURL(new RegExp(`/admin/workflows/${flowId}$`));
    await page.getByRole('button', { name: /Open draft v1/ }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/workflows/${flowId}/versions/\\d+$`));
    await crumb(page, 'Workflows').click();
    expect(urlOf(page)).toBe(flowsUrl);

    // Workflows row menu: Open draft.
    await page.getByRole('button', { name: `Actions for ${flows.names[27]}` }).click();
    await page.getByRole('menuitem', { name: /Open draft v1/ }).click();
    await expect(page).toHaveURL(/\/versions\/\d+$/);
    await page.goBack();
    await expect(rowLink(page, flows.ids[27])).toBeFocused();

    // Steps: Edit inputs from the row menu, then the form page crumb.
    const stepsUrl = `/admin/steps?title=${steps.token}&size=25&page=2`;
    await page.goto(stepsUrl);
    await page.getByRole('button', { name: `Actions for ${steps.names[28]}` }).click();
    await page.getByRole('menuitem', { name: 'Edit inputs' }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/steps/${steps.ids[28]}/form$`));
    await crumb(page, 'Workflow Steps').click();
    expect(urlOf(page)).toBe(stepsUrl);
    await expect(rowLink(page, steps.ids[28])).toBeFocused();
  });

  test('two pages deep (list, record, form designer or version page) the crumb of the list puts focus on the row that was left', async ({
    page,
    admin,
  }) => {
    const types = await seedMany(admin, 'types');
    const flows = await seedMany(admin, 'workflows');
    const steps = await seedMany(admin, 'steps');

    // Task Types: row, record page, form designer; the list crumb (two levels up) lands on the row.
    const typesUrl = `/admin/task-types?name=${types.token}&size=25&page=2`;
    await page.goto(typesUrl);
    const typeId = types.ids[27];
    await rowLink(page, typeId).click();
    await page.locator('[data-action=edit-form]').click();
    await expect(page).toHaveURL(new RegExp(`/admin/task-types/${typeId}/form$`));
    await crumb(page, 'Task Types').click();
    expect(urlOf(page)).toBe(typesUrl);
    await expect(rowLink(page, typeId)).toBeFocused();

    // One level up first (the record's own crumb), then the list crumb from the record page: still the same row.
    await rowLink(page, typeId).click();
    await page.locator('[data-action=edit-form]').click();
    await page
      .getByRole('navigation', { name: 'Breadcrumb' })
      .getByRole('link', { name: types.names[27] })
      .click();
    await expect(page).toHaveURL(new RegExp(`/admin/task-types/${typeId}$`));
    await crumb(page, 'Task Types').click();
    expect(urlOf(page)).toBe(typesUrl);
    await expect(rowLink(page, typeId)).toBeFocused();

    // Steps: row, step page, form designer.
    const stepsUrl = `/admin/steps?title=${steps.token}&size=25&page=2`;
    await page.goto(stepsUrl);
    await rowLink(page, steps.ids[26]).click();
    await page.getByRole('link', { name: 'Edit inputs in the form designer' }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/steps/${steps.ids[26]}/form$`));
    await crumb(page, 'Workflow Steps').click();
    expect(urlOf(page)).toBe(stepsUrl);
    await expect(rowLink(page, steps.ids[26])).toBeFocused();

    // Workflows: row, workflow page, version page.
    const flowsUrl = `/admin/workflows?name=${flows.token}&size=25&page=2`;
    await page.goto(flowsUrl);
    await rowLink(page, flows.ids[25]).click();
    await expect(page).toHaveURL(new RegExp(`/admin/workflows/${flows.ids[25]}$`));
    await page.getByRole('link', { name: /Open draft v1/ }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/workflows/${flows.ids[25]}/versions/\\d+$`));
    await crumb(page, 'Workflows').click();
    expect(urlOf(page)).toBe(flowsUrl);
    await expect(rowLink(page, flows.ids[25])).toBeFocused();

    // Browser Back twice does the same (it always did) and a reload in between is not a return.
    await rowLink(page, flows.ids[25]).click();
    await expect(page).toHaveURL(new RegExp(`/admin/workflows/${flows.ids[25]}$`));
    await page.getByRole('link', { name: /Open draft v1/ }).click();
    await page.goBack();
    await page.goBack();
    expect(urlOf(page)).toBe(flowsUrl);
    await expect(rowLink(page, flows.ids[25])).toBeFocused();
    await rowLink(page, flows.ids[25]).click();
    await expect(page).toHaveURL(new RegExp(`/admin/workflows/${flows.ids[25]}$`));
    await page.getByRole('link', { name: /Open draft v1/ }).click();
    await page.reload();
    await crumb(page, 'Workflows').click();
    expect(urlOf(page)).toBe(flowsUrl);
  });

  test('a row that left the filtered result puts focus on the page heading; a return address from another section is ignored', async ({
    page,
    admin,
  }) => {
    const steps = await seedMany(admin, 'steps');
    const stepsUrl = `/admin/steps?title=${steps.token}&size=25`;
    await page.goto(stepsUrl);
    await rowLink(page, steps.ids[2]).click();
    await expect(page).toHaveURL(new RegExp(`/admin/steps/${steps.ids[2]}$`));
    // Deactivated meanwhile (another person): the default Active filter no longer lists the row.
    const detail = await admin.get<{ rowVersion: string }>(
      `/api/v1/step-definitions/${steps.ids[2]}`,
    );
    await admin.post(`/api/v1/step-definitions/${steps.ids[2]}/deactivate`, {
      rowVersion: detail.rowVersion,
    });
    await crumb(page, 'Workflow Steps').click();
    await expect(page.locator('tbody tr[data-row]').first()).toBeVisible();
    await expect(rowLink(page, steps.ids[2])).toHaveCount(0);
    await expect(page.locator('[data-page-title]')).toBeFocused();

    // A foreign return address (another section's list) is not followed: the crumb is the plain list.
    await page.goto(`/admin/steps/${steps.ids[3]}`);
    await page.evaluate(() => history.replaceState({ returnTo: '/clients?page=2' }, ''));
    await page.reload();
    await expect(crumb(page, 'Workflow Steps')).toHaveAttribute('href', '/admin/steps');
    // ... and so is another admin list's address.
    await page.evaluate(() => history.replaceState({ returnTo: '/admin/workflows?page=2' }, ''));
    await page.reload();
    await expect(crumb(page, 'Workflow Steps')).toHaveAttribute('href', '/admin/steps');
    // Opened from a pasted address with no state: plain list.
    await page.goto(`/admin/steps/${steps.ids[3]}`);
    await expect(crumb(page, 'Workflow Steps')).toHaveAttribute('href', '/admin/steps');
  });

  for (const size of SIZES) {
    test(`at ${size.w}x${size.h} the returned list has focus on the row, no sideways page scroll and no axe violations`, async ({
      page,
      admin,
    }) => {
      test.skip(!axeAvailable(), 'axe-core not installed (set E2E_AXE_PATH to axe.min.js)');
      const steps = await seedMany(admin, 'steps');
      await page.setViewportSize({ width: size.w, height: size.h });
      const url = `/admin/steps?title=${steps.token}&size=25&page=2`;
      await page.goto(url);
      await rowLink(page, steps.ids[28]).click();
      // A phone shows "Back to Workflow Steps" in place of the crumb trail (record header, #403): the same way back.
      await expect(page.locator('[data-record-header]')).toBeVisible();
      const back = page.locator('[data-back-link]');
      if (await back.isVisible()) await back.click();
      else await crumb(page, 'Workflow Steps').click();
      await expect(rowLink(page, steps.ids[28])).toBeFocused();
      expect(urlOf(page)).toBe(url);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      ).toBe(true);
      expect(await axeViolations(page)).toEqual([]);
      await shot(page, 'steps-return-focus', size);
    });
  }

  test.describe('permission variants', () => {
    test('Workflow.Manage only (Workflows, Steps), TaskType.Manage only (Task Types): Back and the crumb work; Task.View only gets the 403 page', async ({
      seed,
      admin,
      asUser,
    }) => {
      const flows = await seedMany(admin, 'workflows');
      const steps = await seedMany(admin, 'steps');
      const types = await seedMany(admin, 'types');
      const wfRole = await seed.role(['Workflow.Manage', 'Task.View'], 'TY1 workflow only');
      const wf = await asUser((await seed.user([wfRole.name], 'ty1-wf')).username);
      for (const [kind, data] of [
        ['workflows', flows],
        ['steps', steps],
      ] as const) {
        const { list, filter, heading } = KINDS[kind];
        const url = `${list}?${filter}=${data.token}&size=25&page=2`;
        await wf.goto(url);
        const id = data.ids[26];
        await rowLink(wf, id).click();
        await crumb(wf, heading).click();
        expect(urlOf(wf), kind).toBe(url);
        await expect(rowLink(wf, id), kind).toBeFocused();
        await rowLink(wf, id).click();
        await wf.goBack();
        expect(urlOf(wf), kind).toBe(url);
        await expect(rowLink(wf, id), kind).toBeFocused();
      }

      const ttRole = await seed.role(['TaskType.Manage', 'Task.View'], 'TY1 type only');
      const tt = await asUser((await seed.user([ttRole.name], 'ty1-tt')).username);
      const typesUrl = `/admin/task-types?name=${types.token}&size=25&page=2`;
      await tt.goto(typesUrl);
      await rowLink(tt, types.ids[26]).click();
      await crumb(tt, 'Task Types').click();
      expect(urlOf(tt)).toBe(typesUrl);
      await expect(rowLink(tt, types.ids[26])).toBeFocused();

      const viewRole = await seed.role(['Task.View'], 'TY1 viewer');
      const viewer = await asUser((await seed.user([viewRole.name], 'ty1-view')).username);
      for (const url of ['/admin/task-types', '/admin/workflows', '/admin/steps']) {
        await viewer.goto(url);
        await expect(
          viewer.getByRole('heading', { name: "You don't have permission to view this." }),
        ).toBeVisible();
        await expect(viewer.locator('a[data-row-key]')).toHaveCount(0);
      }
    });
  });
});
