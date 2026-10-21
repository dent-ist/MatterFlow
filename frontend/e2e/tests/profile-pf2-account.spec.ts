import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { PERSONAS } from '../support/personas';
import { SIZES, noHorizontalScroll, shot } from '../support/screens';

/**
 * My profile epic #520, WP-PF2: #527 (P1, the read-only Account card). Screenshots for docs/ux/profile-review/fixes/pf2-identity/ are
 * written when E2E_SCREENSHOTS is set.
 */

const VARIANTS = [
  { key: 'technician', ...PERSONAS.technician },
  { key: 'observer', ...PERSONAS.readOnlyObserver },
  { key: 'director', ...PERSONAS.director },
  { key: 'taskViewOnly', ...PERSONAS.taskViewOnly },
];

test.describe('pf2-account-card: the read-only Account card (#527)', () => {
  for (const who of VARIANTS) {
    test(`shows name, account, roles and Pods, ${who.key}`, async ({ personas, asUser, seed }) => {
      const p = await personas.create({ ...who, label: `pf2${who.key}` });
      const pod = await seed.pod(undefined, [p.userId]);
      const me = await asUser(p.username);
      await me.goto('/profile');
      const card = me.getByRole('region', { name: 'Account' });
      await expect(card).toBeVisible();
      await expect(card.locator('[data-ac-name]')).toHaveText(p.displayName ?? p.username);
      await expect(card.locator('[data-ac-account]')).toHaveText(p.username);
      await expect(card.locator('[data-ac-email]')).toHaveText('Not set');
      await expect(card.locator('[data-ac-role]').first()).toBeVisible();
      await expect(card.locator('[data-ac-pod]')).toHaveCount(1);
      await expect(card.locator('[data-ac-pod]')).toContainText(pod.name);
      await expect(card.locator('[data-ac-note]')).toHaveText('Managed by your administrator.');
      await expect(card.locator('input, select, textarea')).toHaveCount(0);
    });
  }

  test('a person with no Pod reads No pods yet', async ({ personas, asUser }) => {
    const p = await personas.create({ ...PERSONAS.technician, label: 'pf2nopod' });
    const me = await asUser(p.username);
    await me.goto('/profile');
    await expect(me.locator('[data-ac-pods-none]')).toHaveText('No pods yet');
  });

  test('5 pods (primary first, marked), 3 roles, a 66-character name, an email, and the copy button', async ({
    personas,
    asUser,
    seed,
    admin,
  }) => {
    const p = await personas.create({
      roles: ['Data Technician', 'Pod Lead', 'Director'],
      displayNameLength: 66,
      label: 'pf2full',
    });
    const detail = await admin.get<Record<string, string>>(`/api/v1/users/${p.userId}`);
    await admin.put(`/api/v1/users/${p.userId}`, {
      displayName: detail['displayName'],
      email: 'pf2.full@example.test',
      rowVersion: detail['rowVersion'],
    });
    const pods = [];
    for (let i = 0; i < 5; i++) pods.push(await seed.pod(undefined, [p.userId]));
    await admin.put(`/api/v1/pods/${pods[3].podId}/members/${p.userId}`, { isPrimary: true });

    const me = await asUser(p.username);
    await me.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await me.goto('/profile');
    const card = me.getByRole('region', { name: 'Account' });
    await expect(card.locator('[data-ac-name]')).toHaveText(p.displayName!);
    await expect(card.locator('[data-ac-email]')).toHaveText('pf2.full@example.test');
    await expect(card.locator('[data-ac-role]')).toHaveCount(3);
    await expect(card.locator('[data-ac-pod]')).toHaveCount(5);
    await expect(card.locator('[data-ac-pod]').first()).toHaveAttribute('data-primary', '');
    await expect(card.locator('[data-ac-pod]').first()).toContainText('Primary');
    await expect(card.locator('[data-ac-pod]').first()).toContainText(pods[3].name);

    await card.getByRole('button', { name: 'Copy Windows account' }).click();
    await expect(card.getByText('Copied')).toBeAttached();

    expect(axeAvailable(), 'axe-core must be available (set E2E_AXE_PATH)').toBe(true);
    for (const size of SIZES) {
      await me.setViewportSize(size);
      expect(await axeViolations(me), `account card at ${size.width}`).toEqual([]);
      await noHorizontalScroll(me);
      await card.scrollIntoViewIfNeeded();
      await shot(me, 'pf2-account-card');
    }
  });
});
