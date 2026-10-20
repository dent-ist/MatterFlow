import { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { failApi } from '../support/personas';
import { atEverySize } from '../support/screens';

/**
 * BUG-8 (#594): the not-found, no-access and could-not-be-loaded states of the four records set their own document title through the one
 * helper (`recordStateTitle`): "<Record> not found - MatterFlow", "No access to this <record> - MatterFlow", "<Record> could not be loaded
 * - MatterFlow". Client, Matter and Project used to keep "Client - MatterFlow" while loading failed. The page itself does not change.
 */
const KINDS = [
  { api: 'clients', noun: 'client', title: 'Client' },
  { api: 'matters', noun: 'matter', title: 'Matter' },
  { api: 'projects', noun: 'project', title: 'Project' },
  { api: 'tasks', noun: 'task', title: 'Task' },
] as const;

const titleOf = (page: Page) => page.evaluate(() => document.title);

test.describe('Record states: document titles (#594)', () => {
  for (const k of KINDS) {
    test(`${k.noun}: an unknown id, a 403 and a server fault each name the state in the tab title`, async ({
      page,
      seed,
    }) => {
      // 404: a real unknown id.
      await page.goto(`/${k.api}/99999999`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        `We couldn't find that ${k.noun}.`,
      );
      await expect(page).toHaveTitle(`${k.title} not found - MatterFlow`);

      // 403 and 500: the record exists, its request is answered with the failure.
      let id: number;
      if (k.api === 'tasks') id = (await seed.task(await seed.world())).taskId;
      else {
        const client = await seed.client();
        const matter = await seed.matter({ client });
        id = [client.clientId, matter.matterId, (await seed.project(matter)).projectId][
          ['clients', 'matters', 'projects'].indexOf(k.api)
        ];
      }
      const unroute = await failApi(page, `**/api/v1/${k.api}/${id}`, 403, {
        method: 'GET',
      });
      await page.goto(`/${k.api}/${id}`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        `You don't have access to this ${k.noun}.`,
      );
      await expect(page).toHaveTitle(`No access to this ${k.noun} - MatterFlow`);
      await unroute();

      const unroute500 = await failApi(page, `**/api/v1/${k.api}/${id}`, 500, {
        method: 'GET',
      });
      await page.goto(`/${k.api}/${id}`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        `Couldn't load this ${k.noun}.`,
      );
      expect(await titleOf(page)).toBe(`${k.title} could not be loaded - MatterFlow`);
      await unroute500();

      // Retry recovers: the title names the record again, not the state.
      await page.reload();
      await expect(page.getByRole('heading', { level: 1 })).not.toContainText("Couldn't load");
      expect(await titleOf(page)).not.toContain('could not be loaded');
      expect(await titleOf(page)).not.toContain('not found');
    });
  }

  test('the not-found state is unchanged on the page (axe clean, no sideways scroll)', async ({
    page,
  }) => {
    await page.goto('/clients/99999999');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      "We couldn't find that client.",
    );
    await atEverySize(page, 'record-404-title');
  });
});
