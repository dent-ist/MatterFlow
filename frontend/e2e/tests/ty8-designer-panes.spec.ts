import { Page } from '@playwright/test';
import { Api } from '../support/api';
import { expect, test } from '../support/fixtures';
import {
  DesignerWorld,
  SIZES,
  assetTypeWorld,
  customFieldWorld,
  expectNoViolations,
  manyFields,
  noPageScroll,
  noSideScroll,
  shoot,
  stepWorld,
  typeWorld,
} from '../support/designer';
import { Seeder } from '../support/seed';

/**
 * Task Types UX epic #352, WP-TY8, FD1 (#407): the form designer is a fixed-height page. The header and the action bar (Save draft,
 * Publish...) stay; Add a field, Fields and the details column scroll inside themselves. The designer is ONE shared component, so the
 * same checks run for a Task Type, a Step, an Asset Type and the Custom Fields of an object.
 * Screenshots go to the folder in E2E_SCREENSHOTS (docs/ux/task-types-review/fixes/ty8-designer) when it is set.
 */
const LONG = manyFields(45, true);

interface Owner {
  label: string;
  build: (seed: Seeder, admin: Api) => Promise<DesignerWorld>;
}

const OWNERS: Owner[] = [
  {
    label: 'Task Type',
    build: (seed, admin) => typeWorld(seed, admin, { fields: LONG, published: true, draft: true }),
  },
  {
    label: 'Step',
    build: (seed, admin) => stepWorld(seed, admin, { fields: LONG, published: true, draft: true }),
  },
  {
    label: 'Asset Type',
    build: (_seed, admin) => assetTypeWorld(admin, { fields: LONG, draft: true }),
  },
];

const inView = async (page: Page, name: string | RegExp): Promise<void> => {
  const box = await page.getByRole('button', { name }).first().boundingBox();
  const height = page.viewportSize()!.height;
  expect(box, `${name} has a box`).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(height);
};

test.describe('FD1: the form designer is three fixed panes', () => {
  for (const owner of OWNERS) {
    for (const size of SIZES.slice(0, 2)) {
      test(`${owner.label}: no page scroll at ${size.w}x${size.h}, panes scroll inside, buttons stay, axe 0`, async ({
        page,
        seed,
        admin,
      }) => {
        test.setTimeout(120_000);
        const world = await owner.build(seed, admin);
        await page.setViewportSize({ width: size.w, height: size.h });
        await page.goto(world.url);
        await expect(page.getByRole('button', { name: 'Publish...' })).toBeVisible();
        await expect(page.locator('[data-row="44"]')).toHaveCount(1);
        await noPageScroll(page);
        await noSideScroll(page);
        await inView(page, 'Save draft');
        await inView(page, 'Publish...');

        // The Fields pane is its own scroll area: the last field is reached by scrolling it, and the buttons never move.
        const fields = page.getByRole('region', { name: 'Fields list, scrollable' });
        await expect(fields).toHaveAttribute('tabindex', '0');
        await fields.evaluate((el) => (el.scrollTop = el.scrollHeight));
        await expect(page.locator('[data-row="44"]')).toBeInViewport();
        await noPageScroll(page);
        await inView(page, 'Publish...');
        // The palette is a pane of its own too.
        await expect(page.locator('[data-palette]')).toBeVisible();

        // A field with a long property list scrolls inside the details column, not the page.
        await page.locator('[data-row="4"]').click();
        await expect(page.getByLabel('Label', { exact: true })).toBeVisible();
        await noPageScroll(page);
        await inView(page, 'Publish...');
        await shoot(
          page,
          `panes-${owner.label.toLowerCase().replace(' ', '-')}-field-selected`,
          size,
        );
        await expectNoViolations(page, `${owner.label} designer`);
      });
    }
  }

  test('Custom Fields: the same fixed layout and sticky buttons at 1366x768 and 1920x1080', async ({
    page,
    admin,
  }) => {
    const world = await customFieldWorld(admin, 'project');
    for (const size of SIZES.slice(0, 2)) {
      await page.setViewportSize({ width: size.w, height: size.h });
      await page.goto(world.url);
      await expect(page.getByRole('heading', { level: 1 })).toContainText('Project custom fields');
      await expect(page.getByRole('group', { name: 'Form actions' })).toBeVisible();
      await noPageScroll(page);
      await noSideScroll(page);
      await expectNoViolations(page, 'custom fields designer');
    }
  });

  for (const size of SIZES) {
    test(`Task Type draft with 45 long labels at ${size.w}x${size.h}: no side scroll, axe 0, screenshots`, async ({
      page,
      seed,
      admin,
    }) => {
      test.setTimeout(120_000);
      const world = await typeWorld(seed, admin, { fields: LONG, published: true, draft: true });
      await page.setViewportSize({ width: size.w, height: size.h });
      await page.goto(world.url);
      await expect(page.getByRole('button', { name: 'Publish...' })).toBeVisible();
      await noSideScroll(page);
      if (size.w >= 768) await noPageScroll(page);
      await shoot(page, 'panes-draft', size);
      await expectNoViolations(page, 'draft 45 fields');
    });
  }

  test('the action bar stays under the application header while a narrow page scrolls', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await typeWorld(seed, admin, { fields: LONG, published: true, draft: true });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(world.url);
    await expect(page.getByRole('button', { name: 'Publish...' })).toBeVisible();
    await page.mouse.move(100, 500);
    await page.mouse.wheel(0, 2500);
    await expect
      .poll(() =>
        page.evaluate(() => window.scrollY || document.querySelector('.mf-main')?.scrollTop || 0),
      )
      .toBeGreaterThan(300);
    await inView(page, 'Publish...');
    await inView(page, 'Save draft');
  });

  test('keyboard: Tab reaches the buttons, the palette, the scrolling Fields list and its controls; focus is visible', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await typeWorld(seed, admin, { fields: LONG, published: true, draft: true });
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(world.url);
    await page.getByRole('button', { name: 'Versions (2)' }).focus();
    await page.keyboard.press('Tab'); // Save draft is disabled: next stop is Publish
    await expect(page.getByRole('button', { name: 'Publish...' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('region', { name: 'Field types, scrollable' })).toBeFocused();
    await expect(page.getByRole('button', { name: 'Add Section heading' })).toBeVisible();
    const outline = await page
      .getByRole('region', { name: 'Field types, scrollable' })
      .evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe('none');
  });
});
