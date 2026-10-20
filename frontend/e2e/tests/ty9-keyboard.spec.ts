import fs from 'node:fs';
import path from 'node:path';
import { Locator, Page } from '@playwright/test';
import { Api } from '../support/api';
import { LISTS, ListKind, seedMix } from '../support/admin-lists';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Seeder, uid } from '../support/seed';
import { build } from '../support/ty-workflow';
import { stepWorld, typeWorld } from '../support/designer';
import { draftWorld } from '../support/version-page';

/**
 * WP-TY9 Keyboard, focus and a11y (epic #352): #413 Tab stops on the three lists and the "Skip to table" link, #414 focus and
 * announcement after publish, retire, deactivate, activate and discard, #415 the keyboard and axe audit of the new pages.
 * With E2E_SCREENSHOTS set to a folder (docs/ux/task-types-review/fixes/ty9-keyboard) the Tab-stop counts are written to
 * `tab-stops.json` there (recorded, not gated, except the "about 55 stops for a 25-row page" target of #413).
 * No keyboard shortcut is added or changed by this package: skip links, roving tabindex inside a row, focus and live regions only.
 */
const OUT = process.env['E2E_SCREENSHOTS'];
const SIZES = [
  [1366, 768],
  [1920, 1080],
  [768, 1024],
  [375, 812],
] as const;
const ROWS = 30;

/** Tab-stop counts, written once for the issue comment. */
const stops: Record<string, number | string> = {};
test.afterAll(() => {
  if (!OUT || Object.keys(stops).length === 0) return;
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, 'tab-stops.json');
  // Workers write in turn: keep what the others recorded.
  const before: Record<string, number | string> = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, 'utf8'))
    : {};
  fs.writeFileSync(file, JSON.stringify({ ...before, ...stops }, null, 2));
});

/** What has keyboard focus, as one comparable string: `a:Name #key`, `button:Actions for X`, `h1:...`. */
async function active(page: Page): Promise<string> {
  return page.evaluate(() => {
    const e = document.activeElement as HTMLElement | null;
    if (!e || e === document.body) return 'body';
    const key = e.getAttribute('data-row-key');
    const text = (e.getAttribute('aria-label') ?? e.textContent ?? '').trim().replace(/\s+/g, ' ');
    return `${e.tagName.toLowerCase()}:${text.slice(0, 60)}${key ? ` #${key}` : ''}`;
  });
}

/** Presses Tab from the top of the document until `stop(descriptor)` says so; returns every stop passed (the last one included). */
async function tabUntil(
  page: Page,
  stop: (d: string) => boolean,
  max = 400,
): Promise<string[] | null> {
  const seen: string[] = [];
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const d = await active(page);
    seen.push(d);
    if (stop(d)) return seen;
    if (d === 'body') return null;
  }
  return null;
}

async function freshTop(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await expect(page.locator('[data-page-title]').first()).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

interface Data {
  token: string;
  types: string;
  workflows: string;
  steps: string;
}
let data: Data;

/** 30 task types (each with a workflow, so each row has a Workflows link), 30 workflows with a draft, 30 steps (5 used in a workflow). */
async function seedLists(seed: Seeder, admin: Api): Promise<Data> {
  const token = uid().slice(0, 6);
  const wf = await seed.workflow({ name: `Kbd ${token} Base`, stepCount: 1 });
  await seedMix(admin, 'types', `Kbd${token}`, ROWS, 0, { eligible: [wf.workflowDefinitionId] });
  await seedMix(admin, 'workflows', `Kbd${token}`, ROWS, 0);
  const steps = await seedMix(admin, 'steps', `Kbd${token}`, ROWS, 0);
  for (let i = 0; i < 5; i++) {
    await seed.workflow({
      name: `Kbd${token} Used ${i}`,
      steps: [{ stepDefinitionId: steps[i].id, title: steps[i].name }],
    });
  }
  return {
    token,
    types: `${LISTS.types.list}?name=Kbd${token}`,
    workflows: `${LISTS.workflows.list}?name=Kbd${token}`,
    steps: `${LISTS.steps.list}?title=Kbd${token}`,
  };
}

test.beforeAll(async ({ seed, admin }) => {
  test.setTimeout(300_000);
  data = await seedLists(seed, admin);
});

const KINDS: ListKind[] = ['types', 'workflows', 'steps'];
const urlOf = (k: ListKind): string => data[k];

const NAME_LINK = 'a[data-row-key]';

/** The first row's name link (table) or card name link (phone). */
const firstName = (page: Page): Locator =>
  page.locator(`${NAME_LINK}, li[data-record-card] a[data-card-name]`).first();

test.describe('#413: skip link and Tab stops on the three lists', () => {
  for (const kind of KINDS) {
    test(`${kind}: "Skip to table" is the first Tab stop and lands on the first row, at four widths`, async ({
      page,
    }) => {
      for (const [w, h] of SIZES) {
        await page.setViewportSize({ width: w, height: h });
        await freshTop(page, urlOf(kind));
        await expect(firstName(page)).toBeVisible();
        await page.keyboard.press('Tab');
        await expect(
          page.getByRole('link', { name: 'Skip to table' }),
          `${kind} ${w}`,
        ).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(firstName(page), `${kind} ${w}: first row`).toBeFocused();
        // One more Tab goes to the next stop of the row (its menu), not back to the top.
        await page.keyboard.press('Tab');
        expect(await active(page), `${kind} ${w}`).toMatch(/^button:Actions for /);
        if (axeAvailable() && w === 375) expect(await axeViolations(page)).toEqual([]);
      }
    });

    test(`${kind}: a row has two Tab stops, the name and its menu; a 25-row page is at most 55 stops (recorded)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      await freshTop(page, urlOf(kind));
      await expect(page.locator(NAME_LINK)).toHaveCount(25);
      const toFirst = await tabUntil(page, (d) => /#\d+$/.test(d));
      expect(toFirst, 'a name link is reached').not.toBeNull();
      // From the first name link to the 25th row's menu: name, menu, name, menu, ...
      const walked: string[] = [];
      for (let i = 0; i < 49; i++) {
        await page.keyboard.press('Tab');
        walked.push(await active(page));
      }
      expect(walked.filter((d) => /#\d+$/.test(d))).toHaveLength(24);
      expect(walked.filter((d) => d.startsWith('button:Actions for '))).toHaveLength(25);
      expect(
        walked.filter((d) => !/#\d+$/.test(d) && !d.startsWith('button:Actions for ')),
        'no other stop inside the rows (counts and the draft link are reached with the arrow keys)',
      ).toEqual([]);
      stops[`${kind} 1366: Tab presses to the first row (no skip link used)`] = toFirst!.length;
      stops[`${kind} 1366: with the skip link`] = 'Tab, Enter (2 key presses)';
      stops[`${kind} 1366: Tab stops in a 25-row page`] = 50;
    });
  }

  test('Task Types: the arrow keys reach the Workflows link of a row; Enter opens it; Shift+Tab and the left arrow come back', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await freshTop(page, urlOf('types'));
    await firstName(page).focus();
    await page.keyboard.press('ArrowRight');
    expect(await active(page)).toMatch(/^a:1 workflow for /);
    await page.keyboard.press('ArrowLeft');
    await expect(firstName(page)).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+Tab');
    await expect(firstName(page)).toBeFocused();
    // Tab from the count link goes on to the row's menu, like Tab from the name.
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Tab');
    expect(await active(page)).toMatch(/^button:Actions for /);
    // Enter on the count link opens the filtered Workflows list.
    await firstName(page).focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/admin\/workflows\?/);
  });

  test('Workflows: the arrow keys step from the name to the draft link and the task types count', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await freshTop(page, urlOf('workflows'));
    // The first row is "Base" (30 task types use it); the others have a draft v1 only.
    const row = page.locator('tr[data-row]').first();
    await row.locator(NAME_LINK).focus();
    await page.keyboard.press('ArrowRight');
    expect(await active(page)).toMatch(/^a:(Draft|Open draft|30 task types)/);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    // No wrap: the last stop stays where it is.
    const last = await active(page);
    await page.keyboard.press('ArrowRight');
    expect(await active(page)).toBe(last);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(row.locator(NAME_LINK)).toBeFocused();
  });

  test('a phone card keeps the same model: name, menu, and the count with the arrow', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await freshTop(page, urlOf('types'));
    const card = page.locator('li[data-record-card]').first();
    await expect(card).toBeVisible();
    const stopsInCard = await card.evaluate(
      (c) =>
        Array.from(
          c.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]'),
        ).filter((e) => e.getAttribute('tabindex') !== '-1').length,
    );
    expect(stopsInCard, 'name link and menu button').toBe(2);
    stops['types 375: Tab stops in a card'] = stopsInCard;
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// #414: focus and announcement after publish, retire, deactivate, activate and discard
// ---------------------------------------------------------------------------------------------------------------------

/** The text of every live region (polite statuses, alerts and the toasts) in the page. */
async function said(page: Page): Promise<string> {
  return (
    await page.locator('[role="status"], [role="alert"], [aria-live="polite"]').allInnerTexts()
  ).join(' | ');
}

/** The status badge of the page title. */
const titleBadge = (page: Page): Locator => page.locator('[data-page-title] mf-badge').first();

async function pressMenu(
  page: Page,
  opener: string | RegExp,
  item: string | RegExp,
): Promise<void> {
  const button = page.getByRole('button', { name: opener }).first();
  await button.focus();
  await page.keyboard.press('Enter');
  const entry = page.getByRole('menuitem', { name: item }).first();
  await expect(entry).toBeVisible();
  await entry.focus();
  await page.keyboard.press('Enter');
}

/** Presses the confirm button of the open dialog with the keyboard. */
async function confirm(page: Page, name: string | RegExp): Promise<Locator> {
  const button = page.getByRole('dialog').getByRole('button', { name }).last();
  await expect(button).toBeVisible();
  // The dialog puts focus on its first control when its opening animation ends; wait for that before moving focus ourselves.
  await expect(page.locator('.p-dialog :focus')).toHaveCount(1);
  await button.focus();
  await page.keyboard.press('Enter');
  return button;
}

/** A server error on the request that matches `url` and `method`, for the next calls. */
async function failNext(page: Page, url: RegExp, method: string): Promise<void> {
  await page.route(url, async (route) => {
    if (route.request().method() !== method) return route.fallback();
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 500,
        code: 'INTERNAL_ERROR',
        detail: 'The server could not do that just now.',
      }),
    });
  });
}

test.describe('#414: record pages', () => {
  test('Task Type: deactivate and activate move focus to the status badge and announce; a failure keeps focus in the dialog', async ({
    page,
    seed,
    admin,
  }) => {
    const tt = await typeWorld(seed, admin, { published: true });
    await page.setViewportSize({ width: 1366, height: 768 });
    await freshTop(page, `/admin/task-types/${tt.id}`);
    await expect(titleBadge(page)).toContainText('Active');

    // A failure: the dialog stays open, says why, and focus stays on its button.
    await failNext(page, new RegExp(`/api/v1/task-types/${tt.id}$`), 'PUT');
    await pressMenu(page, 'More actions', 'Deactivate');
    const confirmButton = await confirm(page, /^Deactivate/);
    await expect(page.getByRole('dialog').locator('[data-confirm-error]')).toContainText(
      'could not do that',
    );
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(confirmButton).toBeFocused();
    await page.unroute(new RegExp(`/api/v1/task-types/${tt.id}$`));

    // Retry: success.
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(titleBadge(page)).toContainText('Inactive');
    await expect(titleBadge(page)).toBeFocused();
    await expect.poll(() => said(page)).toContain(`${tt.name} deactivated.`);

    // Activate has no dialog: same rule.
    await pressMenu(page, 'More actions', 'Activate');
    await expect(titleBadge(page)).toContainText('Active');
    await expect(titleBadge(page)).toBeFocused();
    await expect.poll(() => said(page)).toContain(`${tt.name} activated.`);
  });

  test('Workflow: deactivate, activate and retire a version', async ({ page, seed, admin }) => {
    const s = await build(seed, admin);
    const id = s.workflow.workflowDefinitionId;
    await page.setViewportSize({ width: 1366, height: 768 });
    await freshTop(page, `/admin/workflows/${id}`);

    await failNext(page, new RegExp(`/api/v1/workflows/${id}$`), 'PUT');
    await pressMenu(page, 'More actions', 'Deactivate');
    const confirmButton = await confirm(page, /^Deactivate/);
    await expect(page.getByRole('dialog').locator('[data-confirm-error]')).toContainText(
      'could not save the workflow',
    );
    await expect(confirmButton).toBeFocused();
    await page.unroute(new RegExp(`/api/v1/workflows/${id}$`));
    await page.keyboard.press('Enter');
    await expect(titleBadge(page)).toContainText('Inactive');
    await expect(titleBadge(page)).toBeFocused();
    await expect.poll(() => said(page)).toContain('Workflow deactivated');

    await pressMenu(page, 'More actions', 'Activate');
    await expect(titleBadge(page)).toContainText('Active');
    await expect(titleBadge(page)).toBeFocused();
    await expect.poll(() => said(page)).toContain('Workflow activated');

    // Retire the published version (v2) from the Versions tab: focus goes to the Published badge, which changes.
    await page.getByRole('tab', { name: /^Versions/ }).click();
    await failNext(page, /\/retire$/, 'POST');
    await pressMenu(page, 'Actions for v2', /^Retire/);
    const retireButton = await confirm(page, /^Retire v2/);
    await expect(page.getByRole('dialog').locator('[data-confirm-error]')).toBeVisible();
    await expect(retireButton).toBeFocused();
    await page.unroute(/\/retire$/);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const state = page.locator('main [data-state-badge]').first();
    await expect(state).toContainText('Not published');
    await expect(state).toBeFocused();
    await expect.poll(() => said(page)).toContain('v2 retired');
  });

  test('Step: deactivate and activate', async ({ page, seed }) => {
    const step = await seed.step({ title: 'Focus step' });
    await page.setViewportSize({ width: 1366, height: 768 });
    await freshTop(page, `/admin/steps/${step.id}`);

    await failNext(page, /\/step-definitions\/\d+\/deactivate$/, 'POST');
    await pressMenu(page, 'More actions', 'Deactivate');
    const confirmButton = await confirm(page, /^Deactivate/);
    await expect(page.getByRole('dialog').locator('[data-confirm-error]')).toBeVisible();
    await expect(confirmButton).toBeFocused();
    await page.unroute(/\/step-definitions\/\d+\/deactivate$/);
    await page.keyboard.press('Enter');
    await expect(titleBadge(page)).toContainText('Inactive');
    await expect(titleBadge(page)).toBeFocused();
    await expect.poll(() => said(page)).toContain(`${step.title} deactivated.`);

    await pressMenu(page, 'More actions', 'Activate');
    await expect(titleBadge(page)).toContainText('Active');
    await expect(titleBadge(page)).toBeFocused();
    await expect.poll(() => said(page)).toContain(`${step.title} activated.`);
  });
});

test.describe('#414: the three lists', () => {
  for (const kind of KINDS) {
    test(`${kind}: deactivate under the default Active filter (the row leaves) puts focus on the heading; Show all keeps the row's menu`, async ({
      page,
      admin,
    }) => {
      const token = uid().slice(0, 6);
      const rows = await seedMix(admin, kind, `Foc${token}`, 3, 0);
      const info = LISTS[kind];
      const name = rows[1].name;
      await page.setViewportSize({ width: 1366, height: 768 });

      // The row leaves the result: the opener is gone.
      await freshTop(page, `${info.list}?${info.filter}=Foc${token}`);
      await expect(page.getByRole('button', { name: `Actions for ${name}` })).toBeVisible();
      await failNext(
        page,
        /\/api\/v1\/(task-types|workflows|step-definitions)\/\d+(\/deactivate)?$/,
        kind === 'steps' ? 'POST' : 'PUT',
      );
      await pressMenu(page, `Actions for ${name}`, 'Deactivate');
      const button = await confirm(page, /^Deactivate/);
      await expect(page.getByRole('dialog').locator('[data-confirm-error]')).toBeVisible();
      await expect(button).toBeFocused();
      await page.unroute(/\/api\/v1\/(task-types|workflows|step-definitions)\/\d+(\/deactivate)?$/);
      await page.keyboard.press('Enter');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.getByRole('button', { name: `Actions for ${name}` })).toHaveCount(0);
      await expect(page.locator('[data-page-title]').first()).toBeFocused();
      await expect.poll(() => said(page)).toContain(`${name} deactivated.`);

      // With all rows shown the row stays, and focus stays on its menu button (the opener); Activate announces.
      await freshTop(page, `${info.list}?${info.filter}=Foc${token}&status=all`);
      const menu = page.getByRole('button', { name: `Actions for ${name}` });
      await expect(menu).toBeVisible();
      await pressMenu(page, `Actions for ${name}`, 'Activate');
      await expect(menu).toBeFocused();
      await expect.poll(() => said(page)).toContain(`${name} activated.`);
    });
  }
});

const dialogError = (page: Page): Locator =>
  page.getByRole('dialog').locator('[data-confirm-error], [data-dialog-error]');

test.describe('#414: version page', () => {
  test('Publish: a failure keeps the dialog; the retry opens the workflow with focus on the Published badge', async ({
    page,
    seed,
    admin,
  }) => {
    const w = await draftWorld(seed, admin, 3);
    await page.setViewportSize({ width: 1366, height: 768 });
    await freshTop(page, w.url);
    await failNext(page, /\/publish$/, 'POST');
    await page.getByRole('button', { name: 'Publish...' }).focus();
    await page.keyboard.press('Enter');
    const button = await confirm(page, /^Publish v2/);
    await expect(dialogError(page)).toBeVisible();
    await expect(button).toBeFocused();
    await page.unroute(/\/publish$/);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/admin/workflows/${w.wf.workflowDefinitionId}$`));
    const state = page.locator('main [data-state-badge]').first();
    await expect(state).toContainText('Published v2');
    await expect(state).toBeFocused();
    await expect.poll(() => said(page)).toContain('v2 published');
  });

  test('Discard draft: a failure keeps the dialog; the retry opens the workflow with focus on its state badge', async ({
    page,
    seed,
    admin,
  }) => {
    const w = await draftWorld(seed, admin, 3);
    await page.setViewportSize({ width: 1366, height: 768 });
    await freshTop(page, w.url);
    await failNext(page, /\/versions\/\d+$/, 'DELETE');
    await pressMenu(page, 'More version actions', 'Discard draft');
    const button = await confirm(page, /^Discard draft/);
    await expect(dialogError(page)).toBeVisible();
    await expect(button).toBeFocused();
    await page.unroute(/\/versions\/\d+$/);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/admin/workflows/${w.wf.workflowDefinitionId}$`));
    const state = page.locator('main [data-state-badge]').first();
    await expect(state).toContainText('Published v1');
    await expect(state).toBeFocused();
    await expect.poll(() => said(page)).toContain('Draft discarded');
  });

  test('Retire and Create new draft on a published version', async ({ page, seed, admin }) => {
    const w = await draftWorld(seed, admin, 3);
    await page.setViewportSize({ width: 1366, height: 768 });
    await freshTop(page, w.publishedUrl);
    await failNext(page, /\/retire$/, 'POST');
    await pressMenu(page, 'More version actions', /^Retire/);
    const button = await confirm(page, /^Retire v1/);
    await expect(dialogError(page)).toBeVisible();
    await expect(button).toBeFocused();
    await page.unroute(/\/retire$/);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(titleBadge(page)).toContainText('Retired');
    await expect(titleBadge(page)).toBeFocused();
    await expect.poll(() => said(page)).toContain('v1 retired');
  });

  test('Create new draft opens the draft with focus on its Draft badge', async ({ page, seed }) => {
    const wf = await seed.workflow({ stepCount: 2 });
    await page.setViewportSize({ width: 1366, height: 768 });
    await freshTop(page, `/admin/workflows/${wf.workflowDefinitionId}/versions/${wf.versionId}`);
    const create = page.getByRole('button', { name: /^Create new draft/ });
    await create.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/versions\/\d+$/);
    await expect(titleBadge(page)).toContainText('Draft');
    await expect(titleBadge(page)).toBeFocused();
    await expect.poll(() => said(page)).toContain('Draft v2 created');
  });
});

test.describe('#414: form designer', () => {
  test('Publish and Retire: failures stay in the dialog; success moves focus to the status badge', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await typeWorld(seed, admin, { published: true, draft: true });
    await page.setViewportSize({ width: 1366, height: 768 });
    await freshTop(page, world.url);
    await expect(titleBadge(page)).toContainText('Draft v2');

    await failNext(page, /\/publish(\?|$)/, 'POST');
    await page.getByRole('button', { name: 'Publish...' }).focus();
    await page.keyboard.press('Enter');
    const publish = await confirm(page, /^Publish v2/);
    await expect(dialogError(page)).toBeVisible();
    await expect(publish).toBeFocused();
    await page.unroute(/\/publish(\?|$)/);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(titleBadge(page)).toContainText('Published v2');
    await expect(titleBadge(page)).toBeFocused();
    await expect.poll(() => said(page)).toContain('Version 2 published.');

    await failNext(page, /\/retire(\?|$)/, 'POST');
    const retireButton = page.getByRole('button', { name: 'Retire version' });
    await retireButton.focus();
    await page.keyboard.press('Enter');
    const retire = await confirm(page, /^Retire v2/);
    await expect(dialogError(page)).toBeVisible();
    await expect(retire).toBeFocused();
    await page.unroute(/\/retire(\?|$)/);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(titleBadge(page)).toContainText('Retired v2');
    await expect(titleBadge(page)).toBeFocused();
    await expect.poll(() => said(page)).toContain('Version 2 is retired');
  });

  test('Create new draft: focus goes to the Draft badge', async ({ page, seed, admin }) => {
    const world = await stepWorld(seed, admin, { published: true });
    await page.setViewportSize({ width: 1366, height: 768 });
    await freshTop(page, world.url);
    const create = page.getByRole('button', { name: 'Create new draft' });
    await create.focus();
    await page.keyboard.press('Enter');
    await expect(titleBadge(page)).toContainText('Draft v2');
    await expect(titleBadge(page)).toBeFocused();
    await expect.poll(() => said(page)).toContain('Draft v2 created');
  });
});
