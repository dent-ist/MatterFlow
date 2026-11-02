import { expect, test } from '../support/fixtures';
import { axeClean, shot } from '../support/pod-work-checks';

/**
 * Matter detail round 2 (MD-21 to MD-26, #1025 to #1030): the Matters list columns and the shared column resize, the New matter pop-up, the
 * Summary rows, the Assets column order, the "+ New ..." labels and the buttons of the Matter detail tabs against the shared theme.
 */
test.describe('Matters list: columns and resize (MD-21)', () => {
  test('CM Number, Primary PM and Secondary PM; a handle resizes by keyboard, the width is remembered and survives a reload', async ({
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
    expect(texts).toContain('Primary PM');
    expect(texts).toContain('Secondary PM');
    expect(texts).not.toContain('Matter reference');
    expect(texts).not.toContain('Project manager');
    await shot(page, 'matters-list-1366x768');

    const name = page.getByRole('separator', { name: 'Resize Name column' });
    await expect(name).toHaveAttribute('aria-valuemin', /\d+/);
    const th = page.locator('thead tr:first-child th', { hasText: /^\s*Name\s*$/ });
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
      return { name: widthOf('Name'), client: widthOf('Client'), cm: widthOf('CM Number') };
    });
    expect(w.name).toBeGreaterThan(w.cm);
    expect(w.client).toBeGreaterThan(110);
    const side = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(side).toBeLessThanOrEqual(0);
  });
});

test.describe('New matter pop-up (MD-22)', () => {
  test('+ New matter opens a centred dialog; Cancel is left, Create right; typing makes Esc ask first; the old address opens it too', async ({
    page,
    seed,
  }) => {
    const client = await seed.client();
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/matters');
    await page.getByRole('button', { name: 'New matter' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'New matter' });
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(/\/matters$/);
    const buttons = dialog.locator('[data-panel-footer] button');
    await expect(buttons.first()).toHaveText('Cancel');
    await expect(buttons.last()).toHaveText('Create matter');
    const b = (await dialog.boundingBox())!;
    expect(Math.abs(b.x + b.width / 2 - 683)).toBeLessThan(160); // centred in the window, not docked right
    await shot(page, 'new-matter-dialog-1366x768');
    await axeClean(page, 'new matter dialog');

    await dialog.locator('#matter-number').fill('4');
    await page.keyboard.press('Escape');
    await expect(dialog.locator('[data-panel-guard]')).toBeVisible();
    await dialog.getByRole('button', { name: 'Discard' }).click();
    await expect(dialog).toHaveCount(0);

    await page.goto(`/matters/new?clientId=${client.clientId}`);
    await expect(page.getByRole('dialog', { name: 'New matter' })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'New matter' })).toContainText(
      client.clientNumber,
    );
    await expect(page).toHaveURL(/\/matters$/);
  });

  test('a phone gets the dialog full screen', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/matters');
    await page.getByRole('button', { name: 'New matter' }).first().click();
    const b = (await page.getByRole('dialog', { name: 'New matter' }).boundingBox())!;
    expect(b.width).toBeGreaterThanOrEqual(374);
    expect(b.height).toBeGreaterThanOrEqual(800);
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
    await expect(page.locator('.mf-formdlg')).toContainText('Edit matter');
    await expect(page.locator('.mf-slide')).toHaveCount(0);
  });

  test('Projects: "+ New Project" opens the pop-up; Assets: Type is the first column', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/matters/${world.matter.matterId}?tab=projects`);
    await page.getByRole('button', { name: /New Project/ }).click();
    await expect(page.locator('.mf-formdlg')).toContainText('New project');
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
    const create = page.getByRole('button', { name: /New Production/ });
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
    const project = await look(page.getByRole('button', { name: /New Project/ }));
    expect(production.height).toBe(32);
    expect(production.font).toBe(project.font);
    expect(production.radius).toBe(project.radius);
    await page.goto(`/matters/${world.matter.matterId}?tab=productions`);
    await shot(page, 'productions-1366x768');
    await axeClean(page, 'productions tab');
  });
});
