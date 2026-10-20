import { expect, test } from '../support/fixtures';
import { Api } from '../support/api';
import { SHELL_ROUTES, failApi, failMe, goOffline } from '../support/personas';

/** The personas helper itself (#596): the people it creates behave as described, and its failure helpers do what they say. */
test.describe('E2E personas and failure helpers (#596)', () => {
  test.setTimeout(180_000);

  test('a persona with a permission set has exactly those permissions; pending, disabled and long-name personas look as named', async ({
    personas,
    asUser,
  }) => {
    const viewer = await personas.create({ permissions: ['Client.View'], label: 'selftest' });
    expect(viewer.roleNames).toHaveLength(1);
    const api = await Api.as(viewer.username);
    try {
      const me = await api.get<{ permissions: string[] }>('/api/v1/me');
      expect(me.permissions).toEqual(['Client.View']);
    } finally {
      await api.dispose();
    }

    const pending = await personas.named('pending');
    const pendingPage = await asUser(pending.username);
    await pendingPage.goto('/');
    await expect(pendingPage).toHaveURL(/\/access-pending$/);

    const disabled = await personas.named('disabled');
    const disabledPage = await asUser(disabled.username);
    await disabledPage.goto('/');
    await expect(
      disabledPage.getByRole('heading', { name: 'Your account is disabled' }),
    ).toBeVisible();

    const long = await personas.named('longName');
    expect(long.displayName).toHaveLength(66);
    const longPage = await asUser(long.username);
    await longPage.goto('/tasks');
    await expect(longPage.getByRole('button', { name: /account menu/ })).toBeVisible();
  });

  test('the route table: a System Admin opens every route with its heading, and a person without the permission gets the 403', async ({
    page,
    seed,
    personas,
    asUser,
  }) => {
    const client = await seed.client();
    const matter = await seed.matter({ client });
    const project = await seed.project(matter);
    const task = await seed.task(await seed.world());
    const ids = {
      client: client.clientId,
      matter: matter.matterId,
      project: project.projectId,
      task: task.taskId,
    };
    const nobody = await asUser((await personas.create({ permissions: ['Audit.View'] })).username);
    for (const route of SHELL_ROUTES) {
      const url = route.record ? route.path.replace(':id', String(ids[route.record])) : route.path;
      await page.goto(url);
      await expect(page.getByRole('heading', { level: 1 }).first(), url).toHaveText(route.heading, {
        timeout: 30_000,
      });
      if (['/clients', '/pods/work', '/admin/task-types'].includes(route.path)) {
        await nobody.goto(url);
        await expect(nobody.getByRole('heading', { level: 1 }), `403 for ${url}`).toHaveText(
          "You don't have permission to view this.",
          { timeout: 30_000 },
        );
      }
    }
  });

  test('failMe, failApi and goOffline', async ({ page, personas, asUser }) => {
    const director = await asUser((await personas.named('director')).username);
    const off = await failMe(director, 500);
    await director.goto('/');
    await expect(director).toHaveURL(/\/error$/);
    await off();

    const tech = await asUser((await personas.named('technician')).username);
    await tech.goto('/clients');
    await expect(tech.getByRole('heading', { name: 'Clients', level: 1 })).toBeVisible();
    await failApi(tech, '**/api/v1/clients?*', 500, { times: 1 });
    await tech.reload();
    await expect(tech.getByRole('heading', { name: 'Clients', level: 1 })).toBeVisible();
    await goOffline(tech);
    expect(await tech.evaluate(() => navigator.onLine)).toBe(false);
    await goOffline(tech, false);
    expect(await tech.evaluate(() => navigator.onLine)).toBe(true);
    void page;
  });
});
