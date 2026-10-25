import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { noHorizontalScroll, shot, SIZES } from '../support/screens';

/**
 * S1 (#625): the global "Create task" button is hidden on Matter and Project records, whose record header has its own (route data
 * `hidesGlobalCreateTask`); Client records and lists keep it; without Task.Create there is none.
 */
const nav = (page: Page) => page.getByRole('navigation', { name: 'Main' });

test.describe('Global Create task (#625)', () => {
  const global = (page: Page) => page.locator('header .mf-create');
  const create = (page: Page) => page.getByRole('button', { name: 'Create task' });

  test("Matter and Project records show one Create task (the record header's); Client and lists show the global one", async ({
    page,
    seed,
  }) => {
    const client = await seed.client();
    const matter = await seed.matter({ client });
    const project = await seed.project(matter);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      for (const url of [`/matters/${matter.matterId}`, `/projects/${project.projectId}`]) {
        await page.goto(url);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expect(global(page)).toHaveCount(0);
        await expect(create(page)).toHaveCount(1);
        await expect(create(page)).toBeVisible();
      }
      for (const url of [`/clients/${client.clientId}`, '/clients', '/matters', '/tasks']) {
        await page.goto(url);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expect(global(page)).toHaveCount(1);
      }
      await page.goto(`/matters/${matter.matterId}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await shot(page, 'create-task-matter');
      if (axeAvailable()) expect(await axeViolations(page), `matter at ${size.width}`).toEqual([]);
      await noHorizontalScroll(page);
    }
  });

  test('the Edit pages keep the global button; /tasks/new still hides it; leaving a record brings it back', async ({
    page,
    seed,
  }) => {
    const matter = await seed.matter({ client: await seed.client() });
    await page.goto(`/matters/${matter.matterId}/edit`);
    await expect(global(page)).toHaveCount(1);
    await page.goto('/tasks/new');
    await expect(global(page)).toHaveCount(0);
    await page.goto(`/matters/${matter.matterId}`);
    await expect(global(page)).toHaveCount(0);
    await nav(page).getByRole('link', { name: 'Task Queue' }).click();
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
    }
    const intake = await personas.named('intakeCoordinator');
    const p2 = await asUser(intake.username);
    await p2.goto(`/matters/${matter.matterId}`);
    await expect(p2.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(p2.locator('header .mf-create')).toHaveCount(0);
    await expect(create(p2)).toHaveCount(1);
    await create(p2).focus();
    await expect(create(p2)).toBeFocused();
    await p2.keyboard.press('Enter');
    await expect(p2).toHaveURL(/\/tasks\/new/);
  });
});
