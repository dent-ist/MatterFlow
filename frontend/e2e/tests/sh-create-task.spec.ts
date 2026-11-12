import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { noHorizontalScroll, shot, SIZES } from '../support/screens';

/**
 * S1 (#625): the global "Create task" button is hidden on Matter and Project records, whose record header has its own (route data
 * `hidesGlobalCreateTask`); Client records and lists keep it; without Task.Create there is none. The Task Queue, My Work and Pod Work have their own
 * "New Task" in the page header, so the global one is hidden there too (#1167).
 */
const nav = (page: Page) => page.getByRole('navigation', { name: 'Main' });

test.describe('Global Create task (#625)', () => {
  const global = (page: Page) => page.locator('header .mf-create');
  /** A Project record's header has the primary "New Task" button; the work lists have "New Task" in the page header. */
  const create = (page: Page) => page.getByRole('button', { name: 'New Task' });
  /** A Matter record's header has the Create menu ("New": Task, Project, Asset, ...), whose Task entry is the record header's Create task (MD-01). */
  const createMenu = (page: Page) => page.getByRole('button', { name: 'Create: New' });
  const matterCreateTask = (page: Page) => page.locator('[data-action="create-task"]');

  test("Matter and Project records show one Create task (the record header's); Client and lists show the global one", async ({
    page,
    seed,
  }) => {
    const client = await seed.client();
    const matter = await seed.matter({ client });
    const project = await seed.project(matter);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto(`/matters/${matter.matterId}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(global(page)).toHaveCount(0);
      await expect(createMenu(page)).toHaveCount(1);
      await createMenu(page).click();
      await expect(matterCreateTask(page)).toHaveCount(1);
      await expect(matterCreateTask(page)).toBeVisible();
      await page.keyboard.press('Escape');
      await page.goto(`/projects/${project.projectId}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(global(page)).toHaveCount(0);
      await expect(create(page)).toHaveCount(1);
      await expect(create(page)).toBeVisible();
      for (const url of [`/clients/${client.clientId}`, '/clients', '/matters']) {
        await page.goto(url);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expect(global(page)).toHaveCount(1);
      }
      // The work lists have their own "New Task" in the page header: one button, not two (#1167).
      for (const url of ['/tasks', '/my-work', '/pods/work']) {
        await page.goto(url);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expect(global(page)).toHaveCount(0);
        await expect(create(page)).toHaveCount(1);
      }
      await page.goto(`/matters/${matter.matterId}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await shot(page, 'create-task-matter');
      if (axeAvailable()) expect(await axeViolations(page), `matter at ${size.width}`).toEqual([]);
      await noHorizontalScroll(page);
    }
  });

  test('the New Matter page keeps the global button; /tasks/new still hides it; leaving a record brings it back', async ({
    page,
    seed,
  }) => {
    const matter = await seed.matter({ client: await seed.client() });
    await page.goto('/matters/new');
    await expect(global(page)).toHaveCount(1);
    await page.goto('/tasks/new');
    await expect(global(page)).toHaveCount(0);
    await page.goto(`/matters/${matter.matterId}`);
    await expect(global(page)).toHaveCount(0);
    await nav(page).getByRole('link', { name: 'Clients' }).click();
    await expect(global(page)).toHaveCount(1);
  });

  test("permission variants: no Task.Create, no Create task button anywhere; the keyboard reaches the record header's", async ({
    personas,
    asUser,
    seed,
  }) => {
    const matter = await seed.matter({ client: await seed.client() });
    const viewer = await personas.named('taskViewOnly');
    const page = await asUser(viewer.username);
    for (const url of ['/clients', `/matters/${matter.matterId}`]) {
      await page.goto(url);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(create(page)).toHaveCount(0);
      await expect(matterCreateTask(page)).toHaveCount(0);
    }
    // A person who may not create tasks has no Task entry in the Create menu either (the menu itself may be absent).
    if (await createMenu(page).count()) {
      await createMenu(page).click();
      await expect(matterCreateTask(page)).toHaveCount(0);
    }
    const intake = await personas.named('intakeCoordinator');
    const p2 = await asUser(intake.username);
    await p2.goto(`/matters/${matter.matterId}`);
    await expect(p2.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(p2.locator('header .mf-create')).toHaveCount(0);
    await expect(createMenu(p2)).toHaveCount(1);
    await createMenu(p2).focus();
    await expect(createMenu(p2)).toBeFocused();
    await p2.keyboard.press('Enter');
    await expect(matterCreateTask(p2)).toBeFocused();
    await p2.keyboard.press('Enter');
    await expect(p2).toHaveURL(/\/tasks\/new/);
  });
});
