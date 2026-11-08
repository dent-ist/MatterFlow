import { expect, test } from '../support/fixtures';
import { pmFixtures } from '../support/pm-fixtures';

/**
 * List scope defaults (epic #1330, #1334): the five lists (Clients, Matters, Projects, Assets, Task Queue) open on All unless the person manages
 * at least one matter; an explicit remembered choice wins.
 */
test.describe('List scope defaults (#1334)', () => {
  test.setTimeout(300_000);

  const LISTS = ['/clients', '/matters', '/projects', '/assets', '/tasks'];

  test('a Director who manages no matter opens all five lists on All; a project manager with matters opens on My matters; a remembered choice wins', async ({
    seed,
    personas,
    asUser,
  }) => {
    const fx = await pmFixtures(seed, personas);
    const director = await asUser(fx.director.username);
    for (const url of LISTS) {
      await director.goto(url);
      await expect(director, url).toHaveURL(/scope=all/);
      await expect(director.locator('[data-scope="all"]')).toHaveAttribute('aria-pressed', 'true');
    }
    const pm = await asUser(fx.pmA.username);
    for (const url of LISTS) {
      await pm.goto(url);
      await expect(pm, url).toHaveURL(/scope=mine/);
    }
    // An explicit choice is remembered and wins, also for the Director.
    await director.goto('/clients');
    await director.locator('[data-scope="mine"]').click();
    await expect(director).toHaveURL(/scope=mine/);
    await director.goto('/clients');
    await expect(director).toHaveURL(/scope=mine/);
  });
});
