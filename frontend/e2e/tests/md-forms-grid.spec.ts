import { expect, test } from '../support/fixtures';
import { showMatterColumns } from '../support/matter-columns';
import { axeClean, shot } from '../support/pod-work-checks';

/**
 * Matter detail round 2 (MD-21 to MD-26, #1025 to #1030): the Matters list columns and the shared column resize, the New matter pop-up, the
 * Summary rows, the Assets column order, the "+ New ..." labels and the buttons of the Matter detail tabs against the shared theme.
 */
test.describe('Matters list: columns and resize (MD-21)', () => {
  test('CM Number and Primary PM; Secondary PM is one click away in Columns; a handle resizes by keyboard, the width is remembered and survives a reload', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/matters?name=${encodeURIComponent(world.matter.name)}&status=all`);
    const heads = page.locator('thead tr:first-child th');
    await expect(heads.first()).toBeVisible();
    const texts = (await heads.allTextContents()).map((t) => t.trim());
    expect(texts).toContain('CM Number');
    // Epic #1298 (owner, 2026-11-08): Matter Type and Current State are default; the PMs and the counts are one click away in Columns.
    expect(texts).toContain('Matter Types');
    expect(texts).toContain('Current State');
    expect(texts).not.toContain('Primary PM');
    expect(texts).not.toContain('Secondary PM');
    expect(texts).toContain('Matter Name');
    expect(texts).not.toContain('Matter reference');
    expect(texts).not.toContain('Project Manager');
    await shot(page, 'matters-list-1366x768');

    const name = page.getByRole('separator', { name: 'Resize Matter Name column' });
    await expect(name).toHaveAttribute('aria-valuemin', /\d+/);
    const th = page.locator('thead tr:first-child th', { hasText: /^\s*Matter Name\s*$/ });
    const before = (await th.boundingBox())!.width;
    await name.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    const after = (await th.boundingBox())!.width;
    expect(after).toBeGreaterThan(before + 20);
    // The sort is not triggered by the handle.
    await expect(page).not.toHaveURL(/sort=/);

    await page.reload();
    await expect(heads.first()).toBeVisible();
    const reloaded = (await th.boundingBox())!.width;
    expect(Math.abs(reloaded - after)).toBeLessThanOrEqual(2);
    await axeClean(page, 'matters list with resize handles');
  });

  test('Name and Client get the most room at 1366x768 and nothing is clipped', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/matters?name=${encodeURIComponent(world.matter.name)}&status=all`);
    await expect(page.locator('tbody td.ml-name').first()).toBeVisible();
    const w = await page.evaluate(() => {
      const widthOf = (t: string) =>
        Array.from(document.querySelectorAll('thead tr:first-child th'))
          .find((h) => h.textContent?.trim() === t)!
          .getBoundingClientRect().width;
      return { name: widthOf('Matter Name'), client: widthOf('Client'), cm: widthOf('CM Number') };
    });
    expect(w.name).toBeGreaterThan(w.cm);
    expect(w.client).toBeGreaterThan(110);
    const side = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(side).toBeLessThanOrEqual(0);
  });
});

test.describe('New matter page (epic #1368, #1371; it was the pop-up of MD-22)', () => {
  test('+ New matter opens a full page, not a dialog; Cancel returns to the list; typing makes leaving ask first; the Client pages open it with their client', async ({
    page,
    seed,
  }) => {
    const client = await seed.client();
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/matters?name=zzz-none');
    await page.getByRole('button', { name: 'New Matter' }).first().click();
    await expect(page).toHaveURL(/\/matters\/new$/);
    await expect(page.getByRole('heading', { level: 1, name: 'New Matter' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const buttons = page.locator('[data-matter-form] .pg-actions button');
    await expect(buttons.first()).toHaveText('Cancel');
    await expect(buttons.last()).toHaveText('Create Matter');
    await shot(page, 'new-matter-page-1366x768');
    await axeClean(page, 'new matter page');

    // Typing makes leaving ask first; Cancel goes back to the page the person came from (with its filters).
    await page.locator('#matter-number').fill('4');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page
      .getByRole('dialog', { name: 'Unsaved Changes' })
      .getByRole('button', { name: 'Discard Changes' })
      .click();
    await expect(page).toHaveURL(/\/matters\?name=zzz-none$/);

    await page.goto(`/matters/new?clientId=${client.clientId}`);
    await expect(page.getByRole('heading', { level: 1, name: 'New Matter' })).toBeVisible();
    await expect(page.locator('[data-matter-form]')).toContainText(client.clientNumber);
    // Opened directly, Cancel has no page to go back to: the Matters list.
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page).toHaveURL(/\/matters$/);
  });
});

test.describe('Matter detail tabs: Summary, Projects, Assets, Productions, buttons (MD-23, MD-25, MD-26)', () => {
  test('Summary lists Primary PM and Secondary PM and has no Next events; Edit opens the pop-up', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/matters/${world.matter.matterId}`);
    await expect(page.locator('[data-summary-details]')).toBeVisible();
    const labels = await page.locator('[data-summary-details] dt').allTextContents();
    expect(labels.map((l) => l.trim())).toEqual(
      expect.arrayContaining(['Primary PM', 'Secondary PM']),
    );
    await expect(page.getByText('Next events')).toHaveCount(0);
    await expect(page.locator('[data-add-event]')).toHaveCount(0);
    await shot(page, 'summary-1366x768');
    await page.locator('[data-edit-matter]').click();
    await expect(page.getByRole('heading', { level: 1, name: 'Edit Matter' })).toBeVisible(); // a full page (epic #1368, #1381)
    await expect(page).toHaveURL(/\/matters\/\d+\/edit$/);
    await expect(page.locator('.mf-slide')).toHaveCount(0);
  });

  test('Projects: "+ New Project" opens the pop-up; Assets: Type is the first column', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/matters/${world.matter.matterId}?tab=projects`);
    await page
      .getByRole('button', { name: /New Project/ })
      .first()
      .first()
      .click();
    await expect(page.locator('.mf-formdlg')).toContainText('New Project');
    await page.keyboard.press('Escape');

    await seed.asset(world.matter);
    await page.goto(`/matters/${world.matter.matterId}?tab=assets`);
    await expect(page.locator('mf-matter-assets thead th').first()).toBeVisible();
    const heads = (await page.locator('thead tr:first-child th').allTextContents()).map((t) =>
      t.trim(),
    );
    expect(heads.slice(0, 2)).toEqual(['Type', 'Name']);
    await shot(page, 'assets-1366x768');
  });

  test('every button in the Productions tab uses the shared theme: same height, font and radius as a PrimeNG button elsewhere', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/matters/${world.matter.matterId}?tab=productions`);
    const create = page.getByRole('button', { name: /New Production/ }).first();
    await expect(create).toBeVisible();
    const look = (l: typeof create) =>
      l.evaluate((el) => {
        const s = getComputedStyle(el);
        return {
          height: el.getBoundingClientRect().height,
          font: s.fontSize + '/' + s.fontWeight,
          radius: s.borderRadius,
          bg: s.backgroundColor,
        };
      });
    const production = await look(create);
    await page.goto(`/matters/${world.matter.matterId}?tab=projects`);
    const project = await look(page.getByRole('button', { name: /New Project/ }).first());
    expect(production.height).toBe(36); // the 36 px control height of the shared theme (UI2)
    expect(production.height).toBe(project.height);
    expect(production.font).toBe(project.font);
    expect(production.radius).toBe(project.radius);
    await page.goto(`/matters/${world.matter.matterId}?tab=productions`);
    await shot(page, 'productions-1366x768');
    await axeClean(page, 'productions tab');
  });
});

test.describe('Shared grid: Columns menu, reorder and row hover (MD-28, MD-29)', () => {
  test('Tasks tab: move Due left by keyboard, add Progress and Project, reload keeps it, Reset restores', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    await seed.project(world.matter, 'Wave 1');
    await seed.task(world, { dueDate: '2099-01-01' });
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/matters/${world.matter.matterId}?tab=tasks`);
    const heads = async () =>
      (await page.locator('mf-task-table thead tr:first-child th').allTextContents()).map((t) =>
        t.trim(),
      );
    await expect(page.locator('mf-task-table tbody tr[data-task]').first()).toBeVisible();
    // Project and Progress are optional columns of the Tasks tab: the tab is already inside one matter, and Status and Priority stay whole at 1366 (#1154).
    expect(await heads()).not.toContain('Project');
    expect(await heads()).not.toContain('Progress');

    await page.locator('[data-grid-columns]').click();
    const panel = page.locator('[data-grid-columns-panel]');
    await panel.locator('[data-move="due:left"]').focus();
    await page.keyboard.press('Enter');
    await expect(panel.locator('[data-move="due:left"]')).toBeFocused();
    // Each choice is made from the columns the grid last reported: wait until the grid shows the column before the next choice (a person sees it
    // too), so a second choice never starts from the state before the first one.
    await panel.locator('[data-column="steps"]').check();
    await expect.poll(heads).toContain('Progress');
    await panel.locator('[data-column="project"]').check();
    await expect.poll(heads).toContain('Project');
    await page.keyboard.press('Escape');
    const after = await heads();
    expect(after).toContain('Progress');
    expect(after).toContain('Project');
    expect(after.indexOf('Due')).toBeLessThan(after.indexOf('Assignee'));
    await shot(page, 'tasks-columns-1366x768');

    await page.reload();
    await expect(page.locator('mf-task-table tbody tr[data-task]').first()).toBeVisible();
    expect(await heads()).toEqual(after);

    await page.locator('[data-grid-columns]').click();
    await page.locator('[data-grid-columns-reset]').click();
    await page.keyboard.press('Escape');
    expect(await heads()).toEqual([
      'Ref',
      'Type',
      'Title',
      'Priority',
      'Assignee',
      'Due',
      'Status',
      'Actions',
    ]);
    await axeClean(page, 'tasks tab with the Columns menu');
  });

  test('the row under the pointer changes colour with the hover token', async ({ page, seed }) => {
    const world = await seed.world();
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/matters?name=${encodeURIComponent(world.matter.name)}&status=all`);
    const cell = page.locator('tbody tr td.ml-name').first();
    await expect(cell).toBeVisible();
    const bg = () => cell.evaluate((c) => getComputedStyle(c).backgroundColor);
    const before = await bg();
    await cell.hover();
    const hovered = await bg();
    expect(hovered).not.toBe(before);
    const token = await page.evaluate(() => {
      const d = document.createElement('div');
      d.style.background = 'var(--mf-row-hover)';
      document.body.appendChild(d);
      const c = getComputedStyle(d).backgroundColor;
      d.remove();
      return c;
    });
    expect(hovered).toBe(token);
  });

  test('Matters list: Client moves left of Name with the Columns menu and survives a reload', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    await page.setViewportSize({ width: 1366, height: 768 });
    const url = `/matters?name=${encodeURIComponent(world.matter.name)}&status=all`;
    await page.goto(url);
    const heads = async () =>
      (await page.locator('thead tr:first-child th').allTextContents()).map((t) => t.trim());
    await expect(page.locator('tbody tr').first()).toBeVisible();
    await page.locator('[data-grid-columns]').click();
    await page.locator('[data-move="client:left"]').click();
    await page.keyboard.press('Escape');
    expect((await heads()).slice(0, 3)).toEqual(['CM Number', 'Client', 'Matter Name']);
    await page.reload();
    await expect(page.locator('tbody tr').first()).toBeVisible();
    expect((await heads()).slice(0, 3)).toEqual(['CM Number', 'Client', 'Matter Name']);
    await axeClean(page, 'matters list after a reorder');
  });
});
