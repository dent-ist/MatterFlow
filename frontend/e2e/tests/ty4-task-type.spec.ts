import fs from 'node:fs';
import path from 'node:path';
import { Locator, Page } from '@playwright/test';
import { Api } from '../support/api';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Seeder, WorkflowResult, uid } from '../support/seed';

/**
 * WP-TY4 Task Type record page (epic #352, #380 to #386): the record header with the status badge, Edit, Activity, the primary Edit form and
 * the overflow with Deactivate or Activate; the summary strip; Overview | Workflows (n) | Request form with a save per tab; the table of
 * eligible workflows with the Default radio and the searchable Add workflow list; the one status note; the Request form tab; counters and
 * the clamped title. With E2E_SCREENSHOTS set to a folder the tests also save screenshots (docs/ux/task-types-review/fixes/ty4-task-type).
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

interface World {
  token: string;
  /** Four published workflows. */
  workflows: WorkflowResult[];
  /** A workflow that has only a draft (no published version). */
  draftOnly: { id: number; name: string };
  /** A published workflow that was deactivated. */
  inactive: { id: number; name: string };
  type: { id: number; name: string; formDefinitionId: number };
}

/** A type with the first two workflows (the first is the default) and a published form of four fields. */
async function world(seed: Seeder, admin: Api, opts: { fields?: boolean } = {}): Promise<World> {
  const token = uid();
  const workflows: WorkflowResult[] = [];
  for (let i = 0; i < 4; i++) {
    workflows.push(await seed.workflow({ name: `Flow ${'ABCD'[i]} ${token}`, stepCount: i + 1 }));
  }
  const draft = (await admin.post('/api/v1/workflows', {
    name: `Flow Draft ${token}`,
    description: null,
    isOrdered: true,
  })) as { workflow: { workflowDefinitionId: number } };
  const inactiveWf = await seed.workflow({ name: `Flow Retired ${token}` });
  const detail = (await admin.get(`/api/v1/workflows/${inactiveWf.workflowDefinitionId}`)) as {
    workflow: { rowVersion: string };
  };
  await admin.put(`/api/v1/workflows/${inactiveWf.workflowDefinitionId}`, {
    name: inactiveWf.name,
    isActive: false,
    rowVersion: detail.workflow.rowVersion,
  });
  const fields =
    opts.fields === false
      ? undefined
      : [1, 2, 3, 4].map((n) => ({ key: `f${n}`, label: `Field ${n}`, control: 'TEXT' }));
  const created = await seed.taskType({
    name: `Type ${token}`,
    workflows: workflows.slice(0, 2),
    fields,
    description: 'The review type used by the Task Type page tests.',
  });
  const view = (await admin.get(`/api/v1/task-types/${created.id}`)) as {
    formDefinitionId: number;
  };
  return {
    token,
    workflows,
    draftOnly: { id: draft.workflow.workflowDefinitionId, name: `Flow Draft ${token}` },
    inactive: { id: inactiveWf.workflowDefinitionId, name: inactiveWf.name },
    type: { id: created.id, name: created.name, formDefinitionId: view.formDefinitionId },
  };
}

const typeUrl = (w: World, tab = ''): string =>
  `/admin/task-types/${w.type.id}${tab ? `?tab=${tab}` : ''}`;

/** Opens the page and waits until the record is there (the loading skeleton has tabs of its own). */
async function openType(page: Page, w: World, tab = ''): Promise<void> {
  await page.goto(typeUrl(w, tab));
  await expect(page.locator('[data-task-type-page]')).toBeVisible();
}

const tab = (page: Page, key: string): Locator => page.locator(`[role=tab][data-tab="${key}"]`);
const announce = (page: Page): Locator => page.locator('[data-announce]');
const radio = (page: Page, id: number): Locator => page.locator(`[data-default-radio="${id}"]`);
const rowOf = (page: Page, id: number): Locator => page.locator(`[data-workflow="${id}"]`);

async function menuItem(page: Page, name: string): Promise<void> {
  await page.locator('[data-page-actions] button[data-overflow]').click();
  await page.getByRole('menuitem', { name }).click();
}

test.describe('Task Type record page', () => {
  test.describe('header, strip, badge and tabs (#380, #381)', () => {
    for (const size of SIZES) {
      test(`at ${size.w}x${size.h} the header, strip, tabs and overflow are clean and nothing scrolls sideways`, async ({
        page,
        seed,
        admin,
      }) => {
        test.skip(!axeAvailable(), 'axe-core not installed (set E2E_AXE_PATH to axe.min.js)');
        const w = await world(seed, admin);
        await page.setViewportSize({ width: size.w, height: size.h });
        await openType(page, w);
        const header = page.locator('[data-record-header]');
        await expect(header.locator('h1')).toContainText(w.type.name);
        await expect(header).toContainText('Active');
        // The strip: Form, Workflows, Default workflow, Open tasks (a link into the Task Queue) and Status.
        const strip = page.locator('[data-strip]');
        await expect(strip.locator('[data-strip-item=form]')).toContainText('Published v1');
        await expect(strip.locator('[data-strip-item=workflows]')).toContainText('2');
        await expect(strip.locator('[data-strip-item=default]')).toContainText(w.workflows[0].name);
        const open = strip.locator('a[data-strip-item=open]');
        await expect(open).toContainText('0');
        expect(await open.getAttribute('href')).toContain(`type=${w.type.id}`);
        await expect(strip.locator('[data-strip-item=status]')).toContainText('Active');
        await expect(page.locator('[role=tab]')).toHaveText([
          'Overview',
          'Workflows (2)',
          'Request form',
        ]);
        await clean(page, 'overview');
        await shot(page, 'overview', size.w);

        // Edit stays on the page, and Activate / Deactivate is only in the overflow.
        await expect(page.locator('[data-page-actions] [data-action=deactivate]')).toHaveCount(0);
        await page.locator('[data-page-actions] button[data-overflow]').click();
        await expect(page.getByRole('menuitem', { name: 'Deactivate' })).toBeVisible();
        await clean(page, 'overflow open');
        await shot(page, 'overflow', size.w);
        await page.keyboard.press('Escape');
        await expect(page.locator('[data-page-actions] button[data-overflow]')).toBeFocused();
      });
    }

    test('the header has Edit, Activity and the primary Edit form; Edit focuses the name and Edit form opens the designer', async ({
      page,
      seed,
      admin,
    }) => {
      const w = await world(seed, admin);
      await page.setViewportSize({ width: 1366, height: 768 });
      await openType(page, w, 'workflows');
      const actions = page.locator('[data-page-actions] button[data-action]');
      await expect(actions).toHaveText(['Edit', 'Activity', 'Edit form']);
      await expect(page.locator('[data-action=edit-form]')).toHaveClass(/mf-btn--primary/);
      // Edit leaves the page where it is, shows the Overview and puts focus on the name.
      await page.locator('[data-action=edit]').click();
      await expect(page).toHaveURL(new RegExp(`/admin/task-types/${w.type.id}$`));
      await expect(page.locator('#tt-name')).toBeFocused();
      await page.locator('[data-action=edit-form]').click();
      await expect(page).toHaveURL(new RegExp(`/admin/task-types/${w.type.id}/form$`));
    });

    test('Activity opens the audit drawer at every width, axe clean, and focus returns to the button', async ({
      page,
      seed,
      admin,
    }) => {
      const w = await world(seed, admin);
      await openType(page, w);
      for (const size of SIZES) {
        await page.setViewportSize({ width: size.w, height: size.h });
        // Let the layout settle after the resize (the header decides which actions fit in a frame or two) before asking what is visible.
        await page.waitForFunction((w) => window.innerWidth === w, size.w);
        await page.evaluate(
          () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
        );
        await expect(page.locator('[data-page-actions] button[data-overflow]')).toBeVisible();
        // A phone keeps only the primary action in the header: Activity is in the overflow there.
        const button = page.locator('[data-action=activity]');
        const inOverflow = !(await button.isVisible());
        if (inOverflow) {
          await page.locator('[data-page-actions] button[data-overflow]').click();
          await page.getByRole('menuitem', { name: 'Activity' }).click();
        } else {
          await button.click();
        }
        const drawer = page.getByRole('dialog', { name: /Activity/ });
        await expect(drawer).toBeVisible();
        await expect(drawer).toContainText(w.type.name);
        if (axeAvailable())
          expect(await axeViolations(page), `drawer axe at ${size.w}`).toEqual([]);
        await shot(page, 'activity', size.w);
        await page.keyboard.press('Escape');
        await expect(drawer).toBeHidden();
        await expect(
          inOverflow ? page.locator('[data-page-actions] button[data-overflow]') : button,
        ).toBeFocused();
      }
    });

    test('deactivating says what it affects, shows Inactive and the note; Activate takes it back', async ({
      page,
      seed,
      admin,
    }) => {
      const w = await world(seed, admin);
      await page.setViewportSize({ width: 1366, height: 768 });
      await openType(page, w);
      await menuItem(page, 'Deactivate');
      const dialog = page.getByRole('dialog', { name: 'Deactivate task type?' });
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('[data-impact]')).toContainText(
        'No open tasks use this task type.',
      );
      for (const size of SIZES) {
        await page.setViewportSize({ width: size.w, height: size.h });
        if (axeAvailable())
          expect(await axeViolations(page), `dialog axe at ${size.w}`).toEqual([]);
        await shot(page, 'deactivate-dialog', size.w);
      }
      await page.setViewportSize({ width: 1366, height: 768 });
      await dialog.getByRole('button', { name: 'Keep active' }).click();
      await expect(dialog).toBeHidden();
      await expect(page.locator('[data-page-actions] button[data-overflow]')).toBeFocused();

      await menuItem(page, 'Deactivate');
      await dialog.getByRole('button', { name: 'Deactivate task type' }).click();
      await expect(page.locator('[data-record-header] h1')).toContainText('Inactive');
      const note = page.locator('[data-status-note]');
      await expect(note).toContainText('The task type is inactive.');
      await expect(page.locator('[data-strip-item=status]')).toContainText('Inactive');
      await shot(page, 'inactive', 1366);
      // The fix in the note is Activate it (no confirmation: nothing is lost).
      await note.getByRole('button', { name: 'Activate it' }).click();
      await expect(page.locator('[data-record-header] h1')).toContainText('Active');
      await expect(note).toHaveCount(0);
      // The overflow now offers Deactivate again.
      await page.locator('[data-page-actions] button[data-overflow]').click();
      await expect(page.getByRole('menuitem', { name: 'Deactivate' })).toBeVisible();
    });

    test('the deactivate dialog counts open tasks and names the workflows left without a task type; Open tasks links to the Task Queue', async ({
      page,
      seed,
    }) => {
      const world = await seed.world();
      await seed.task(world);
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto(`/admin/task-types/${world.taskType.id}`);
      await expect(page.locator('[data-task-type-page]')).toBeVisible();
      const open = page.locator('a[data-strip-item=open]');
      await expect(open).toContainText('1');
      await menuItem(page, 'Deactivate');
      const dialog = page.getByRole('dialog', { name: 'Deactivate task type?' });
      await expect(dialog.locator('[data-impact]')).toContainText(
        '1 open task keeps this type. 1 workflow is left without a task type.',
      );
      await expect(dialog.locator('[data-impact-names] li')).toHaveText([world.workflow.name]);
      await dialog.getByRole('button', { name: 'Keep active' }).click();
      await open.click();
      await expect(page).toHaveURL(new RegExp(`/tasks\\?.*type=${world.taskType.id}`));
    });

    test('the tabs follow the keyboard model and the address is replaced, not added', async ({
      page,
      seed,
      admin,
    }) => {
      const w = await world(seed, admin);
      await openType(page, w);
      const history = await page.evaluate(() => window.history.length);
      await tab(page, 'overview').focus();
      await page.keyboard.press('ArrowRight');
      await expect(tab(page, 'workflows')).toBeFocused();
      await expect(page).toHaveURL(/tab=workflows/);
      await page.keyboard.press('End');
      await expect(tab(page, 'form')).toBeFocused();
      await expect(page).toHaveURL(/tab=form/);
      await page.keyboard.press('Home');
      await expect(tab(page, 'overview')).toBeFocused();
      await expect(page).not.toHaveURL(/tab=/);
      expect(await page.evaluate(() => window.history.length)).toBe(history);
      await expect(page.locator('[role=tabpanel]')).toHaveAttribute(
        'aria-labelledby',
        'tt-tab-overview',
      );
    });

    test('switching tabs with unsaved edits asks first: Stay keeps them, Save and leave saves, Leave drops them', async ({
      page,
      seed,
      admin,
    }) => {
      const w = await world(seed, admin);
      await page.setViewportSize({ width: 1366, height: 768 });
      await openType(page, w);
      await page.locator('#tt-description').fill('Edited description');
      await expect(page.locator('[data-footer]')).toBeVisible();
      await tab(page, 'workflows').click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await shot(page, 'leave-tab-dialog', 1366);
      await dialog.getByRole('button', { name: 'Stay' }).click();
      await expect(page).not.toHaveURL(/tab=workflows/);
      await expect(page.locator('#tt-description')).toHaveValue('Edited description');

      await tab(page, 'workflows').click();
      await dialog.getByRole('button', { name: 'Save and leave' }).click();
      await expect(page).toHaveURL(/tab=workflows/);
      await expect(page.locator('[data-footer]')).toHaveCount(0);
      const saved = (await admin.get(`/api/v1/task-types/${w.type.id}`)) as { description: string };
      expect(saved.description).toBe('Edited description');

      // Leave drops the edits of the tab.
      await tab(page, 'overview').click();
      await page.locator('#tt-name').fill('Dropped name');
      await tab(page, 'workflows').click();
      await dialog.getByRole('button', { name: 'Leave', exact: true }).click();
      await expect(page).toHaveURL(/tab=workflows/);
      await tab(page, 'overview').click();
      await expect(page.locator('#tt-name')).toHaveValue(w.type.name);
    });

    test('each tab saves on its own: the footer shows only for the tab with edits and saves only that tab', async ({
      page,
      seed,
      admin,
    }) => {
      const w = await world(seed, admin);
      await openType(page, w);
      await expect(page.locator('[data-footer]')).toHaveCount(0);
      await page.locator('#tt-name').fill(`Renamed ${w.token}`);
      await page.locator('[data-save]').click();
      await expect(page.locator('[data-record-header] h1')).toContainText(`Renamed ${w.token}`);
      await expect(page.locator('[data-footer]')).toHaveCount(0);
      let saved = (await admin.get(`/api/v1/task-types/${w.type.id}`)) as {
        name: string;
        eligibleWorkflowIds: number[];
      };
      expect(saved.name).toBe(`Renamed ${w.token}`);
      expect(saved.eligibleWorkflowIds).toHaveLength(2);

      await tab(page, 'workflows').click();
      await expect(page.locator('[data-footer]')).toHaveCount(0);
      await rowOf(page, w.workflows[1].workflowDefinitionId).locator('[data-remove]').click();
      await expect(tab(page, 'workflows')).toContainText('(1)');
      await expect(page.locator('[data-footer]')).toBeVisible();
      await page.locator('[data-save]').click();
      await expect(page.locator('[data-footer]')).toHaveCount(0);
      saved = (await admin.get(`/api/v1/task-types/${w.type.id}`)) as typeof saved;
      expect(saved.name).toBe(`Renamed ${w.token}`);
      expect(saved.eligibleWorkflowIds).toEqual([w.workflows[0].workflowDefinitionId]);
    });

    test('a new type: no strip, the Request form tab is disabled with its reason, Create lands on the Workflows tab', async ({
      page,
      seed,
    }) => {
      const wf = await seed.workflow({ name: `New flow ${uid()}` });
      const name = `Created ${uid()}`;
      for (const size of SIZES) {
        await page.setViewportSize({ width: size.w, height: size.h });
        await page.goto('/admin/task-types/new');
        await expect(page.locator('[data-record-header] h1')).toContainText('New task type');
        await expect(page.locator('[data-strip]')).toHaveCount(0);
        await expect(page.locator('[data-page-actions] [data-action]')).toHaveCount(0);
        const form = tab(page, 'form');
        await expect(form).toHaveAttribute('aria-disabled', 'true');
        await expect(form).toHaveAccessibleDescription('Save the task type first');
        await clean(page, `new at ${size.w}`);
        await shot(page, 'new', size.w);
      }
      // A disabled tab does nothing and the address stays.
      await tab(page, 'form').click({ force: true });
      await expect(page).toHaveURL(/\/admin\/task-types\/new$/);

      await page.locator('#tt-name').fill(name);
      await tab(page, 'workflows').click();
      await page.locator('[data-add-input]').fill(wf.name);
      await page.locator('[data-add-input]').press('ArrowDown');
      await page.locator('[data-add-input]').press('Enter');
      await expect(rowOf(page, wf.workflowDefinitionId)).toBeVisible();
      await page.locator('[data-save]').click();
      await expect(page).toHaveURL(/\/admin\/task-types\/\d+\?tab=workflows$/);
      await expect(tab(page, 'workflows')).toHaveAttribute('aria-selected', 'true');
      await expect(rowOf(page, wf.workflowDefinitionId)).toBeVisible();
      await expect(radio(page, wf.workflowDefinitionId)).toBeChecked();
      // Back leaves the page (the address was replaced).
      await page.goBack();
      await expect(page).not.toHaveURL(/admin\/task-types\/\d+/);
    });
  });

  test.describe('the Workflows tab (#382, #383)', () => {
    /** A type with `n` published workflows (long names among them), plus a draft-only and a deactivated workflow that are not added. */
    async function bigWorld(seed: Seeder, admin: Api, n = 33) {
      const token = uid();
      const eligible: WorkflowResult[] = [];
      for (let from = 0; from < n; from += 6) {
        const batch = await Promise.all(
          Array.from({ length: Math.min(6, n - from) }, (_, k) => {
            const i = from + k;
            const long =
              i === 5
                ? ' - Cross-border collection, processing and production for regulatory investigations'
                : '';
            return seed.workflow({
              name: `Wf ${String(i).padStart(2, '0')} ${token}${long}`,
              stepCount: 1,
            });
          }),
        );
        eligible.push(...batch);
      }
      eligible.sort((a, b) => a.name.localeCompare(b.name));
      const draft = (await admin.post('/api/v1/workflows', {
        name: `Wx Draft only ${token}`,
        description: null,
        isOrdered: true,
      })) as { workflow: { workflowDefinitionId: number } };
      const retired = await seed.workflow({ name: `Wx Retired ${token}` });
      const detail = (await admin.get(`/api/v1/workflows/${retired.workflowDefinitionId}`)) as {
        workflow: { rowVersion: string };
      };
      await admin.put(`/api/v1/workflows/${retired.workflowDefinitionId}`, {
        name: retired.name,
        isActive: false,
        rowVersion: detail.workflow.rowVersion,
      });
      const spare = await seed.workflow({ name: `Wx Spare ${token}` });
      const type = await seed.taskType({ name: `Big type ${token}`, workflows: eligible });
      return {
        token,
        eligible,
        draft: { id: draft.workflow.workflowDefinitionId, name: `Wx Draft only ${token}` },
        retired: { id: retired.workflowDefinitionId, name: retired.name },
        spare,
        type,
      };
    }

    for (const size of SIZES) {
      test(`at ${size.w}x${size.h} a type with 33 workflows (one with a long name) is a table, the picker lists reasons, axe clean, nothing scrolls sideways`, async ({
        page,
        seed,
        admin,
      }) => {
        test.skip(!axeAvailable(), 'axe-core not installed (set E2E_AXE_PATH to axe.min.js)');
        test.setTimeout(180_000);
        const b = await bigWorld(seed, admin);
        await page.setViewportSize({ width: size.w, height: size.h });
        await page.goto(`/admin/task-types/${b.type.id}?tab=workflows`);
        await expect(page.locator('[data-workflows] tbody tr')).toHaveCount(33);
        await expect(tab(page, 'workflows')).toContainText('(33)');
        const long = b.eligible.find((e) => e.name.includes('Cross-border'))!;
        const longRow = rowOf(page, long.workflowDefinitionId);
        await expect(longRow.locator('[data-wf-link]')).toHaveAttribute('title', long.name);
        if (size.w >= 768) {
          expect((await longRow.boundingBox())!.height).toBeLessThanOrEqual(45);
        }
        await clean(page, 'table');
        await shot(page, 'workflows-33', size.w);

        // The search lists what can be added first and the others disabled with the reason.
        await page.locator('[data-add-input]').fill(b.token);
        await expect(page.locator('[data-add-list] [role=option]')).toHaveCount(3);
        const options = page.locator('[data-add-list] [role=option]');
        await expect(options.nth(0)).toContainText('Wx Spare');
        await expect(options.nth(0)).toHaveAttribute(
          'data-option',
          String(b.spare.workflowDefinitionId),
        );
        await expect(options.nth(1)).toHaveAttribute('aria-disabled', 'true');
        await expect(options.nth(1)).toContainText('No published version');
        await expect(options.nth(2)).toHaveAttribute('aria-disabled', 'true');
        await expect(options.nth(2)).toContainText('Inactive');
        await clean(page, 'picker open');
        await shot(page, 'picker-reasons', size.w);
      });
    }

    test('add, change the default, remove and remove the default with the keyboard only; announcements; focus', async ({
      page,
      seed,
      admin,
    }) => {
      const w = await world(seed, admin);
      const [a, b, c] = w.workflows.map((x) => x.workflowDefinitionId);
      await page.setViewportSize({ width: 1366, height: 768 });
      await openType(page, w, 'workflows');
      await expect(radio(page, a)).toBeChecked();

      // Add: type, arrow, Enter; the list closes, focus stays in the search, the table has the new row.
      const search = page.locator('[data-add-input]');
      await search.focus();
      await page.keyboard.type(`Flow C ${w.token}`);
      await expect(search).toHaveAttribute('aria-expanded', 'true');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await expect(rowOf(page, c)).toBeVisible();
      await expect(search).toBeFocused();
      await expect(search).toHaveValue('');
      await expect(announce(page)).toContainText(`${w.workflows[2].name} added.`);
      await expect(tab(page, 'workflows')).toContainText('(3)');
      await expect(radio(page, a)).toBeChecked();

      // The Default radios are one Tab stop: Tab from the checked one goes to its Remove button, an arrow moves the choice.
      await radio(page, a).focus();
      await page.keyboard.press('Tab');
      await expect(rowOf(page, a).locator('[data-remove]')).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(radio(page, a)).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(radio(page, b)).toBeChecked();
      await expect(announce(page)).toContainText(
        `${w.workflows[1].name} is now the default workflow.`,
      );

      // Remove the default: the default moves to the next row, focus to the next Remove, and it is said.
      await rowOf(page, b).locator('[data-remove]').focus();
      await page.keyboard.press('Enter');
      await expect(rowOf(page, b)).toHaveCount(0);
      await expect(radio(page, c)).toBeChecked();
      await expect(announce(page)).toContainText(
        `${w.workflows[1].name} removed. ${w.workflows[2].name} is now the default workflow.`,
      );
      await expect(rowOf(page, c).locator('[data-remove]')).toBeFocused();
      await expect(tab(page, 'workflows')).toContainText('(2)');

      // Save with the footer; the server has the table.
      await page.locator('[data-save]').click();
      await expect(page.locator('[data-footer]')).toHaveCount(0);
      const saved = (await admin.get(`/api/v1/task-types/${w.type.id}`)) as {
        eligibleWorkflowIds: number[];
        defaultWorkflowDefinitionId: number;
      };
      expect([...saved.eligibleWorkflowIds].sort((x, y) => x - y)).toEqual(
        [a, c].sort((x, y) => x - y),
      );
      expect(saved.defaultWorkflowDefinitionId).toBe(c);
      // Removing every row leaves no default and the focus on the search.
      await rowOf(page, a).locator('[data-remove]').click();
      await rowOf(page, c).locator('[data-remove]').click();
      await expect(announce(page)).toContainText('There is no default workflow.');
      await expect(search).toBeFocused();
      await expect(page.locator('[data-no-workflows]')).toBeVisible();
    });

    test('a disabled entry can be reached with the arrows (its reason is read) but cannot be added; Escape closes the list', async ({
      page,
      seed,
      admin,
    }) => {
      const b = await bigWorld(seed, admin, 2);
      await page.goto(`/admin/task-types/${b.type.id}?tab=workflows`);
      const search = page.locator('[data-add-input]');
      await search.fill(b.token);
      await expect(search).toHaveAttribute('role', 'combobox');
      // The first entry is the one that can be added; one arrow down reaches the disabled "No published version" entry.
      await page.keyboard.press('ArrowDown');
      const active = await search.getAttribute('aria-activedescendant');
      const option = page.locator(`#${active}`);
      await expect(option).toHaveAttribute('aria-disabled', 'true');
      await expect(option).toContainText('No published version');
      await page.keyboard.press('Enter');
      await expect(rowOf(page, b.draft.id)).toHaveCount(0);
      await expect(page.locator('[data-add-list]')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-add-list]')).toHaveCount(0);
      await expect(search).toBeFocused();
      // Workflows that are already added are not listed.
      await search.fill(b.eligible[0].name);
      await expect(page.locator('[data-add-empty]')).toContainText('No workflows match.');
    });

    test('the list shows eight entries at a time and says how to narrow it down; the first one added is the default', async ({
      page,
      seed,
      admin,
    }) => {
      const b = await bigWorld(seed, admin, 10);
      const empty = (await admin.post('/api/v1/task-types', {
        name: `Empty type ${b.token}`,
        description: null,
        iconKey: 'file-text',
        isActive: true,
        eligibleWorkflowIds: [],
      })) as { id: number };
      await page.goto(`/admin/task-types/${empty.id}?tab=workflows`);
      await expect(page.locator('[data-no-workflows]')).toBeVisible();
      const search = page.locator('[data-add-input]');
      await search.fill(b.token);
      await expect(page.locator('[data-add-list] [role=option]')).toHaveCount(8);
      await expect(page.locator('[data-add-more]')).toContainText('Showing 8 of 13.');
      const first = page.locator('[data-add-list] [role=option]').first();
      await expect(first).toHaveAttribute('aria-setsize', '13');
      await expect(first).toHaveAttribute('aria-posinset', '1');
      await search.fill(b.eligible[3].name);
      await expect(page.locator('[data-add-list] [role=option]')).toHaveCount(1);
      await expect(page.locator('[data-add-more]')).toHaveCount(0);
      await page.keyboard.press('Enter');
      await expect(page.locator('[data-workflows] tbody tr')).toHaveCount(1);
      await expect(radio(page, b.eligible[3].workflowDefinitionId)).toBeChecked();
      await expect(announce(page)).toContainText('is now the default workflow');
      await expect(page.locator('[data-save]')).toBeVisible();
    });

    test('a workflow name links to the workflow with Workflow.Manage', async ({
      page,
      seed,
      admin,
    }) => {
      const w = await world(seed, admin);
      await openType(page, w, 'workflows');
      await rowOf(page, w.workflows[0].workflowDefinitionId).locator('[data-wf-link]').click();
      await expect(page).toHaveURL(
        new RegExp(`/admin/workflows/${w.workflows[0].workflowDefinitionId}$`),
      );
    });
  });

  test.describe('the status note (#384)', () => {
    async function make(
      seed: Seeder,
      admin: Api,
      opts: { workflows: WorkflowResult[]; draftForm: boolean; publishedForm?: boolean },
    ) {
      const token = uid();
      const created = (await admin.post('/api/v1/task-types', {
        name: `Note type ${token}`,
        description: null,
        iconKey: 'file-text',
        isActive: true,
        eligibleWorkflowIds: opts.workflows.map((x) => x.workflowDefinitionId),
        defaultWorkflowDefinitionId: opts.workflows[0]?.workflowDefinitionId,
      })) as { id: number; formDefinitionId: number; name: string };
      const fields = [{ key: 'a', label: 'A', control: 'TEXT' }];
      if (opts.publishedForm) await seed.publishForm(created.formDefinitionId, fields);
      if (opts.draftForm) {
        const draft = (await admin.post(`/api/v1/forms/${created.formDefinitionId}/versions`)) as {
          version: { formVersionId: number; rowVersion: string };
        };
        await admin.put(
          `/api/v1/forms/${created.formDefinitionId}/versions/${draft.version.formVersionId}`,
          { fields, rowVersion: draft.version.rowVersion },
        );
      }
      return created;
    }

    test('one neutral note names every reason with its fix as a link; the fixes move to the form and the tab', async ({
      page,
      seed,
      admin,
    }) => {
      const t = await make(seed, admin, { workflows: [], draftForm: true });
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto(`/admin/task-types/${t.id}`);
      const note = page.locator('[data-status-note]');
      await expect(note).toHaveCount(1);
      await expect(note).toContainText('Not usable for new tasks yet.');
      await expect(note.locator('li')).toHaveText([
        "The request form isn't published. Open the form",
        'No eligible published workflow. Add one',
      ]);
      await expect(page.locator('[data-record-header] h1')).toContainText('Not usable');
      await expect(page.locator('[data-strip-item=status]')).toContainText('Not usable');
      // Grey, never warning colours.
      const same = await page.evaluate(() => {
        const note = document.querySelector('[data-status-note]') as HTMLElement;
        const probe = (v: string): string => {
          const d = document.createElement('div');
          d.style.background = `var(${v})`;
          document.body.appendChild(d);
          const c = getComputedStyle(d).backgroundColor;
          d.remove();
          return c;
        };
        const bg = getComputedStyle(note).backgroundColor;
        return {
          warning: bg === probe('--mf-warning-bg'),
          danger: bg === probe('--mf-danger-bg'),
          alt: bg === probe('--mf-surface-alt'),
        };
      });
      expect(same).toEqual({ warning: false, danger: false, alt: true });
      for (const size of SIZES) {
        await page.setViewportSize({ width: size.w, height: size.h });
        await clean(page, `note at ${size.w}`);
        await shot(page, 'note', size.w);
      }
      await page.setViewportSize({ width: 1366, height: 768 });
      await note.getByRole('button', { name: 'Add one' }).click();
      await expect(page).toHaveURL(/tab=workflows/);
      await expect(page.locator('[data-add-input]')).toBeFocused();
      await page.goto(`/admin/task-types/${t.id}`);
      await page.locator('[data-status-note]').getByRole('link', { name: 'Open the form' }).click();
      await expect(page).toHaveURL(new RegExp(`/admin/task-types/${t.id}/form$`));
    });

    test('each reason on its own, and no note for a usable type', async ({ page, seed, admin }) => {
      const wf = await seed.workflow();
      const noWorkflow = await make(seed, admin, { workflows: [], draftForm: false });
      await page.goto(`/admin/task-types/${noWorkflow.id}`);
      await expect(page.locator('[data-status-note] li')).toHaveText([
        'No eligible published workflow. Add one',
      ]);
      const formOnly = await make(seed, admin, { workflows: [wf], draftForm: true });
      await page.goto(`/admin/task-types/${formOnly.id}`);
      await expect(page.locator('[data-status-note] li')).toHaveText([
        "The request form isn't published. Open the form",
      ]);
      const usable = await make(seed, admin, {
        workflows: [wf],
        draftForm: false,
        publishedForm: true,
      });
      await page.goto(`/admin/task-types/${usable.id}`);
      await expect(page.locator('[data-task-type-page]')).toBeVisible();
      await expect(page.locator('[data-status-note]')).toHaveCount(0);
      await expect(page.locator('[data-record-header] h1')).toContainText('Active');
    });
  });

  test.describe('the Request form tab (#385)', () => {
    test('none, draft only, published and published with a draft', async ({
      page,
      seed,
      admin,
    }) => {
      const wf = await seed.workflow();
      const make = async (kind: 'none' | 'draft' | 'published' | 'both') => {
        const token = uid();
        const t = (await admin.post('/api/v1/task-types', {
          name: `Form ${kind} ${token}`,
          description: null,
          iconKey: 'file-text',
          isActive: true,
          eligibleWorkflowIds: [wf.workflowDefinitionId],
          defaultWorkflowDefinitionId: wf.workflowDefinitionId,
        })) as { id: number; formDefinitionId: number };
        const fields = [1, 2, 3].map((n) => ({ key: `f${n}`, label: `F${n}`, control: 'TEXT' }));
        if (kind === 'published' || kind === 'both')
          await seed.publishForm(t.formDefinitionId, fields);
        if (kind === 'draft' || kind === 'both') {
          const draft = (await admin.post(`/api/v1/forms/${t.formDefinitionId}/versions`)) as {
            version: { formVersionId: number; rowVersion: string };
          };
          await admin.put(
            `/api/v1/forms/${t.formDefinitionId}/versions/${draft.version.formVersionId}`,
            {
              fields,
              rowVersion: draft.version.rowVersion,
            },
          );
        }
        return t.id;
      };
      await page.setViewportSize({ width: 1366, height: 768 });
      const none = await make('none');
      await page.goto(`/admin/task-types/${none}?tab=form`);
      await expect(page.locator('[data-form-none]')).toContainText('No form yet');
      await expect(page.locator('[data-open-form]')).toHaveText('Create form');
      await shot(page, 'form-none', 1366);

      const draft = await make('draft');
      await page.goto(`/admin/task-types/${draft}?tab=form`);
      await expect(page.locator('[data-form-draft]')).toHaveText(/Draft v1 in progress/);
      await expect(page.locator('[data-form-published]')).toHaveCount(0);
      await expect(page.locator('[data-open-form]')).toHaveText('Edit form');

      const published = await make('published');
      await page.goto(`/admin/task-types/${published}?tab=form`);
      await expect(page.locator('[data-form-published]')).toHaveText(
        /Published v1\s*·\s*,\s*3 fields\s*·\s*,\s*last published [A-Z][a-z]{2} \d{1,2}, \d{4}/,
      );
      await expect(page.locator('[data-form-draft]')).toHaveCount(0);
      await expect(page.locator('[data-strip-item=form]')).toContainText('Published v1');
      await expect(page.locator('body')).not.toContainText('Open the form designer');
      for (const size of SIZES) {
        await page.setViewportSize({ width: size.w, height: size.h });
        await clean(page, `form tab at ${size.w}`);
        await shot(page, 'form-published', size.w);
      }

      const both = await make('both');
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto(`/admin/task-types/${both}?tab=form`);
      await expect(page.locator('[data-form-published]')).toContainText('Published v1');
      await expect(page.locator('[data-form-draft]')).toHaveText(/Draft v2 in progress/);
      await shot(page, 'form-published-and-draft', 1366);
      // The tab's button is the same action as the header's primary.
      await page.locator('[data-open-form]').click();
      await expect(page).toHaveURL(new RegExp(`/admin/task-types/${both}/form$`));
    });
  });

  test.describe('counters and the clamped title (#386)', () => {
    test('a 100-character name: counter announced from 90, H1 at most two lines at 375, crumb cut at 40 with the full text as tooltip', async ({
      page,
      seed,
    }) => {
      const wf = await seed.workflow();
      const name = `${uid()} ${'Collection and review of cross-border data '.repeat(3)}`
        .slice(0, 100)
        .trim();
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto('/admin/task-types/new');
      const input = page.locator('#tt-name');
      const live = page.locator('#tt-name ~ mf-char-counter [data-char-count-live]');
      await input.fill('x'.repeat(89));
      await expect(page.locator('#tt-name-count')).toHaveText('89 / 100');
      await expect(live).toHaveText('');
      await input.fill('x'.repeat(90));
      await expect(live).toHaveText('90 of 100 characters');
      await expect(live).toHaveAttribute('role', 'status');
      await expect(live).toHaveAttribute('aria-live', 'polite');
      await expect(input).toHaveAttribute('aria-describedby', /tt-name-count/);
      await input.fill(`${name}`);
      await expect(page.locator('#tt-name-count')).toHaveText(
        `${Math.min(100, name.length)} / 100`,
      );
      await page.locator('#tt-description').fill('d'.repeat(950));
      await expect(page.locator('#tt-description-count')).toHaveText('950 / 1000');
      await expect(
        page.locator('#tt-description ~ mf-char-counter [data-char-count-live]'),
      ).toHaveText('950 of 1000 characters');
      await clean(page, 'new with counters');
      await shot(page, 'counters', 375);
      await page.locator('[data-save]').click();
      await expect(page).toHaveURL(/\/admin\/task-types\/\d+\?tab=workflows$/);
      await page.goto(page.url().replace('?tab=workflows', ''));
      await expect(page.locator('[data-task-type-page]')).toBeVisible();
      const title = page.locator('[data-record-header] h1');
      const lines = await title.evaluate((e) => {
        const line = parseFloat(getComputedStyle(e).lineHeight) || 24;
        return Math.round(e.getBoundingClientRect().height / line);
      });
      expect(lines).toBeLessThanOrEqual(2);
      const crumb = page.locator('[data-crumb-current]');
      await expect(crumb).toHaveAttribute('title', name);
      const shown = await crumb.locator('[aria-hidden="true"]').innerText();
      expect(shown.length).toBeLessThanOrEqual(40);
      expect(shown.endsWith('…')).toBe(true);
      await clean(page, 'long name');
      await shot(page, 'long-name', 375);
      void wf;
    });
  });

  test.describe('leaving with edits', () => {
    test('the crumb back to the list asks, offers Save and leave and keeps the list view', async ({
      page,
      seed,
      admin,
    }) => {
      const w = await world(seed, admin);
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto(`/admin/task-types?name=${w.token}`);
      await page.getByRole('link', { name: w.type.name, exact: true }).click();
      await expect(page.locator('[data-task-type-page]')).toBeVisible();
      await page.locator('#tt-description').fill('Saved on the way out');
      await page
        .locator('[data-record-header] nav[aria-label="Breadcrumb"]')
        .getByRole('link', { name: 'Task Types' })
        .click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByRole('button', { name: 'Save and leave' })).toBeVisible();
      await shot(page, 'leave-page-dialog', 1366);
      await dialog.getByRole('button', { name: 'Save and leave' }).click();
      await expect(page).toHaveURL(new RegExp(`/admin/task-types\\?name=${w.token}`));
      const saved = (await admin.get(`/api/v1/task-types/${w.type.id}`)) as { description: string };
      expect(saved.description).toBe('Saved on the way out');
    });

    test('Cancel on a tab drops its edits and Leave on the page question discards them', async ({
      page,
      seed,
      admin,
    }) => {
      const w = await world(seed, admin);
      await openType(page, w);
      await page.locator('#tt-name').fill('Not saved');
      await page.locator('[data-cancel]').click();
      await expect(page.locator('#tt-name')).toHaveValue(w.type.name);
      await expect(page.locator('[data-footer]')).toHaveCount(0);
      await page.locator('#tt-name').fill('Not saved either');
      await page.locator('[data-action=edit-form]').click();
      await page.getByRole('dialog').getByRole('button', { name: 'Leave', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/admin/task-types/${w.type.id}/form$`));
      const saved = (await admin.get(`/api/v1/task-types/${w.type.id}`)) as { name: string };
      expect(saved.name).toBe(w.type.name);
    });
  });

  test.describe('permission variants', () => {
    test('TaskType.Manage with Task.View: workflow names as plain text, Add search, no Activity; Audit.View adds Activity; TaskType.Manage alone opens the page too; Workflow.Manage only and Task.View only get the 403 page', async ({
      seed,
      admin,
      asUser,
    }) => {
      const w = await world(seed, admin);
      const ttRole = await seed.role(['TaskType.Manage', 'Task.View'], 'TY4 type and tasks');
      const ttUser = await seed.user([ttRole.name], 'ty4-tt');
      const ttPage = await asUser(ttUser.username);
      await ttPage.goto(typeUrl(w));
      await expect(ttPage.locator('[data-task-type-page]')).toBeVisible();
      await expect(ttPage.locator('[data-page-actions] button[data-action]')).toHaveText([
        'Edit',
        'Edit form',
      ]);
      // Task.View gives the Open tasks number as a link; the default workflow is named (TY-P: TaskType.Manage reads the workflow list) but is not a link.
      await expect(ttPage.locator('a[data-strip-item=open]')).toBeVisible();
      await expect(ttPage.locator('[data-strip-item=default]')).toContainText('Flow A');
      await expect(ttPage.locator('[data-strip-item=default]')).not.toContainText(/Workflow \d/);
      await ttPage.goto(typeUrl(w, 'workflows'));
      await expect(ttPage.locator('[data-workflows] tbody tr')).toHaveCount(2);
      await expect(ttPage.locator('[data-wf-link]')).toHaveCount(0);
      await expect(ttPage.locator('[data-add-input]')).toBeVisible();
      await expect(ttPage.locator('[data-cannot-add]')).toHaveCount(0);
      // Remove and Save still work.
      await ttPage.locator('[data-workflows] [data-remove]').first().click();
      await ttPage.locator('[data-save]').click();
      await expect(ttPage.locator('[data-footer]')).toHaveCount(0);
      if (axeAvailable()) expect(await axeViolations(ttPage), 'type only axe').toEqual([]);
      await shot(ttPage, 'perm-type-only', 1440);

      const auditRole = await seed.role(
        ['TaskType.Manage', 'Workflow.Manage', 'Task.View', 'Audit.View'],
        'TY4 type workflow audit',
      );
      const auditUser = await seed.user([auditRole.name], 'ty4-audit');
      const auditPage = await asUser(auditUser.username);
      await auditPage.goto(typeUrl(w, 'workflows'));
      await expect(auditPage.locator('[data-page-actions] button[data-action]')).toHaveText([
        'Edit',
        'Activity',
        'Edit form',
      ]);
      await expect(auditPage.locator('[data-wf-link]').first()).toBeVisible();
      await expect(auditPage.locator('[data-add-input]')).toBeVisible();

      // Each administration permission reads what it manages (TY-P): TaskType.Manage alone opens the page, the open-task number is left out.
      const bareRole = await seed.role(['TaskType.Manage'], 'TY4 type alone');
      const bare = await seed.user([bareRole.name], 'ty4-bare');
      const barePage = await asUser(bare.username);
      await barePage.goto(typeUrl(w));
      await expect(barePage.locator('[data-task-type-page]')).toBeVisible();
      await expect(barePage.locator('a[data-strip-item=open]')).toHaveCount(0);
      await expect(barePage.locator('[data-toast]')).toHaveCount(0);

      const wfRole = await seed.role(['Workflow.Manage', 'Task.View'], 'TY4 workflow only');
      const wfUser = await seed.user([wfRole.name], 'ty4-wf');
      const wfPage = await asUser(wfUser.username);
      await wfPage.goto(typeUrl(w));
      await expect(wfPage).toHaveURL(/\/403$/);
      await expect(
        wfPage.getByRole('heading', { name: "You don't have permission to view this." }),
      ).toBeVisible();
      await expect(wfPage.locator('[data-task-type-page]')).toHaveCount(0);

      const taskRole = await seed.role(['Task.View'], 'TY4 viewer');
      const viewer = await seed.user([taskRole.name], 'ty4-view');
      const viewerPage = await asUser(viewer.username);
      await viewerPage.goto(typeUrl(w));
      await expect(
        viewerPage.getByRole('heading', { name: "You don't have permission to view this." }),
      ).toBeVisible();
      await expect(viewerPage.locator('[data-task-type-page]')).toHaveCount(0);
    });
  });
});
