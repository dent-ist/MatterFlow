import { axeAvailable } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { atEverySize } from '../support/screens';

/**
 * S4a (#628): the landing rule. My Work if the person has Task.View and any pod membership or assignment; else the Dashboard if they hold
 * a Dashboard tab permission; else Task Queue; else the first page they can open; else Access Pending. The home address, the logo, the
 * 403 and 404 "Go to ..." link and Access Pending's "Check again" use the same rule.
 */
test.describe('Landing for oversight roles (#628)', () => {
  test.setTimeout(300_000);

  test('permission variants: where "/" and the logo lead for each kind of person', async ({
    personas,
    asUser,
    seed,
  }) => {
    const cases = [
      { who: 'director' as const, url: /\/dashboard/, name: 'Dashboard' },
      { who: 'readOnlyObserver' as const, url: /\/dashboard/, name: 'Dashboard' },
      { who: 'complianceAuditor' as const, url: /\/dashboard/, name: 'Dashboard' },
      // The Intake Coordinator holds Dashboard.ViewUnassigned: that is a Dashboard tab.
      { who: 'intakeCoordinator' as const, url: /\/dashboard/, name: 'Dashboard' },
      { who: 'taskViewOnly' as const, url: /\/tasks$/, name: 'Task Queue' },
      { who: 'clientViewOnly' as const, url: /\/clients/, name: 'Clients' },
    ];
    for (const c of cases) {
      const person = await personas.named(c.who);
      const page = await asUser(person.username);
      await page.goto('/');
      await expect(page, c.who).toHaveURL(c.url);
      // The 404 link and the logo follow the same rule.
      await page.goto('/no-such-page');
      await expect(page.locator('[data-state-actions] [data-back-link]'), c.who).toHaveText(
        `Go to ${c.name}`,
      );
      await page.getByRole('link', { name: 'MatterFlow home' }).click();
      await expect(page, `${c.who} logo`).toHaveURL(c.url);
    }
    // A technician with a pod keeps My Work; one without work and without a Dashboard tab keeps Task Queue.
    const tech = await personas.named('technician');
    await seed.pod(undefined, [tech.userId]);
    const techPage = await asUser(tech.username);
    await techPage.goto('/');
    await expect(techPage).toHaveURL(/\/my-work/);
    // Pod Work without Task.View is never a landing.
    const podOnly = await personas.named('podViewWithoutTaskView');
    const podPage = await asUser(podOnly.username);
    await podPage.goto('/');
    await expect(podPage).not.toHaveURL(/\/pods\/work/);
    // A custom role with one View permission, and a Task.View-only person who is in a pod.
    const one = await personas.create({ label: 'oneview', permissions: ['Matter.View'] });
    const onePage = await asUser(one.username);
    await onePage.goto('/');
    await expect(onePage).toHaveURL(/\/matters/);
  });

  test('an oversight person with work in a pod still lands on My Work (pod membership wins)', async ({
    personas,
    asUser,
    seed,
  }) => {
    const director = await personas.create({
      label: 'dirpod',
      permissions: ['Task.View', 'Dashboard.View', 'Dashboard.ViewSummary'],
    });
    await seed.pod(undefined, [director.userId]);
    const page = await asUser(director.username);
    await page.goto('/');
    await expect(page).toHaveURL(/\/my-work/);
  });

  test('Access Pending "Check again" lands by the same rule once access is granted', async ({
    personas,
    asUser,
    seed,
  }) => {
    const pending = await personas.named('pending');
    const page = await asUser(pending.username);
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: 'Your access is pending', level: 1 }),
    ).toBeVisible();
    await seed.grantRoles(pending.userId, ['Director']);
    await page.getByRole('button', { name: 'Check again' }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('axe is clean on the Dashboard a director lands on, at four sizes', async ({
    personas,
    asUser,
  }) => {
    expect(axeAvailable(), 'set E2E_AXE_PATH to axe.min.js').toBe(true);
    const director = await personas.named('director');
    const page = await asUser(director.username);
    await atEverySize(page, 'landing-director-dashboard', async () => {
      await page.goto('/');
      await expect(page).toHaveURL(/\/dashboard/);
      await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
    });
  });
});
