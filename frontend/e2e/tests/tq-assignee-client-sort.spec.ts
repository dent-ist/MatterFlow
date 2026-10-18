import { Page } from '@playwright/test';
import { TaskQueuePage } from '../pages/queues.pages';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

/**
 * TQ23 (#233): the Assignee and Client headers of the shared work table sort A to Z (and Z to A), case and accent insensitive, with
 * unassigned last. Own tagged tasks, own clients and users; nothing depends on global counts.
 */
async function column(page: Page, key: string): Promise<string[]> {
  const cells = await page.locator(`tbody tr[data-task] td[data-col="${key}"]`).allTextContents();
  return cells.map((c) => c.replace(/\s+/g, ' ').trim());
}

test.describe('Task Queue Assignee and Client sorts', () => {
  test('TQ23: header clicks sort Assignee and Client, with aria-sort, URL and axe at 1366', async ({
    seed,
    asUser,
  }) => {
    const tag = uid();
    const base = await seed.world();
    const users = [
      await seed.user(['Data Technician'], 'sort-a'),
      await seed.user(['Data Technician'], 'sort-b'),
    ];
    const clients = [`Zulu ${tag}`, `étoile ${tag}`, `apple ${tag}`];
    for (const [i, name] of clients.entries()) {
      const matter = await seed.matter({ client: await seed.client({ name }) });
      await seed.task(
        { ...base, matter },
        { title: `Sorting ${tag}`, assignedUserId: i < 2 ? users[i].userId : undefined },
      );
    }

    const role = await seed.role(['Task.View', 'Matter.View'], `E2E sorter ${uid()}`);
    const viewer = await seed.user([role.name], 'sort-viewer');
    const page = await asUser(viewer.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    const queue = new TaskQueuePage(page);
    await queue.open();
    await queue.search(tag);
    await expect(page.locator('tbody tr[data-task]')).toHaveCount(3);

    await page.getByRole('button', { name: 'Columns', exact: true }).click();
    await page.getByLabel('Client', { exact: true }).check();
    await page.getByRole('button', { name: 'Columns', exact: true }).click();

    const header = (key: string) => page.locator(`th[data-col="${key}"]`);
    const button = (key: string) => page.locator(`th[data-col="${key}"] button`);

    await button('client').click();
    await expect(page).toHaveURL(/sort=client/);
    await expect(header('client')).toHaveAttribute('aria-sort', 'ascending');
    await expect
      .poll(() => column(page, 'client'))
      .toEqual([`apple ${tag}`, `étoile ${tag}`, `Zulu ${tag}`]);
    await button('client').click();
    await expect(header('client')).toHaveAttribute('aria-sort', 'descending');
    await expect
      .poll(() => column(page, 'client'))
      .toEqual([`Zulu ${tag}`, `étoile ${tag}`, `apple ${tag}`]);
    await expect(page.locator('[data-sort-note]')).toContainText('Sorted by Client');

    await button('assignee').click();
    await expect(page).toHaveURL(/sort=assignee/);
    await expect(header('assignee')).toHaveAttribute('aria-sort', 'ascending');
    await expect(header('client')).toHaveAttribute('aria-sort', 'none');
    await expect(page.locator('[data-sort-note]')).toContainText('Sorted by Assignee');
    // Both assigned rows come first (names ascending); the unassigned task is last.
    await expect.poll(async () => (await column(page, 'client'))[2]).toBe(`apple ${tag}`);
    const names = (await column(page, 'assignee')).slice(0, 2).map((n) => n.toLowerCase());
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    await button('assignee').click();
    await expect(header('assignee')).toHaveAttribute('aria-sort', 'descending');
    await expect.poll(async () => (await column(page, 'client'))[2]).toBe(`apple ${tag}`);

    await page.getByRole('button', { name: 'Reset sort' }).click();
    await expect(page).not.toHaveURL(/sort=/);
    await expect(header('assignee')).toHaveAttribute('aria-sort', 'none');

    await button('assignee').click();
    if (axeAvailable()) expect(await axeViolations(page), 'axe at 1366').toEqual([]);
  });
});
