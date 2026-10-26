import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { PERSONAS, PersonaSpec } from '../support/personas';
import { SIZES, noHorizontalScroll, shot } from '../support/screens';
import { toasts } from '../support/toasts';

/**
 * My profile epic #520, WP-PF7: #584, the permission and state matrix of My profile, the account menu and the Set out of office dialog.
 * People who hold Task.View (it carries availability) get My profile, Set out of office / I'm back and the Account card with their OWN data;
 * people without it get no such entries, `/profile` is the 403 page, a pending person goes to Access Pending and a disabled one to the
 * disabled-account page. No dead entry, no toast on a denial, axe 0 on the 403 page.
 */
const FORBIDDEN = "You don't have permission to view this.";

const MATRIX: readonly (PersonaSpec & { key: string })[] = [
  { key: 'systemAdmin', ...PERSONAS.systemAdmin },
  { key: 'dataTechnician', ...PERSONAS.technician },
  { key: 'readOnlyObserver', ...PERSONAS.readOnlyObserver },
  { key: 'complianceAuditor', ...PERSONAS.complianceAuditor },
  { key: 'configurationAdmin', ...PERSONAS.configurationAdmin },
  { key: 'intakeCoordinator', ...PERSONAS.intakeCoordinator },
  { key: 'director', ...PERSONAS.director },
  { key: 'clientViewOnly', ...PERSONAS.clientViewOnly },
  { key: 'userManageOnly', ...PERSONAS.userManageOnly },
  { key: 'podViewNoTaskView', ...PERSONAS.podViewWithoutTaskView },
  { key: 'noDisplayName', ...PERSONAS.technician },
  { key: 'longName', ...PERSONAS.longName },
];

async function holdsTaskView(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    const r = await fetch('/api/v1/me', { headers: { 'X-MatterFlow-Client': 'web' } });
    const me = (await r.json()) as { permissions: string[]; isSystemAdmin: boolean };
    return me.isSystemAdmin || me.permissions.includes('Task.View');
  });
}

test.describe('pf7-permissions: who gets My profile, the menu entries and the dialog (#584)', () => {
  for (const who of MATRIX) {
    test(`${who.key}: menu entries, page access and the Account card agree with Task.View`, async ({
      personas,
      asUser,
      seed,
    }) => {
      const p = await personas.create({ ...who, label: `pf7${who.key.slice(0, 8)}` });
      const pod = await seed.pod(undefined, [p.userId]);
      const me = await asUser(p.username);
      await me.goto('/clients');
      await me.goto('/profile');
      const allowed = await holdsTaskView(me);

      await me.goto(allowed ? '/profile' : '/profile');
      if (allowed) {
        await expect(me.locator('[data-profile-header] h1')).toBeVisible();
        await expect(me.locator('[data-ac-account]')).toHaveText(p.username);
        await expect(me.locator('[data-ac-name]')).toHaveText(p.displayName ?? p.username);
        await expect(me.locator('[data-ac-pod]')).toContainText(pod.name);
        await expect(me.locator('[data-ac-pod]')).toHaveCount(1);
        await expect(me.locator('[data-page-actions] button')).toHaveText('Set out of office...');
      } else {
        await expect(me.getByRole('heading', { name: FORBIDDEN, level: 1 })).toBeVisible();
        await expect(me.locator('[data-account-card]')).toHaveCount(0);
        await expect(toasts(me)).toHaveCount(0);
        if (axeAvailable()) expect(await axeViolations(me), `403 for ${who.key}`).toEqual([]);
      }

      await me.getByRole('button', { name: /account menu/ }).click();
      const menu = me.getByRole('menu', { name: 'Your account' });
      if (allowed) {
        await expect(menu.getByRole('menuitem')).toHaveText([
          /My profile/,
          /Set out of office/,
          /Keyboard shortcuts/,
        ]);
        await menu.getByRole('menuitem', { name: 'Set out of office...' }).click();
        const dialog = me.getByRole('dialog', { name: 'Set out of office' });
        await expect(dialog).toBeVisible();
        await dialog.getByRole('button', { name: 'Cancel' }).click();
        await expect(dialog).toHaveCount(0);
      } else {
        await expect(menu.getByRole('menuitem')).toHaveText([/Keyboard shortcuts/]);
        await expect(me.locator('[data-menu-identity] [data-availability-chip]')).toHaveCount(0);
      }
    });
  }

  test("two people each see their own Account card, never the other person's", async ({
    personas,
    asUser,
  }) => {
    const a = await personas.create({
      ...PERSONAS.technician,
      label: 'pf7ownA',
      displayName: 'Alice Ownerson',
    });
    const b = await personas.create({
      ...PERSONAS.director,
      label: 'pf7ownB',
      displayName: 'Bob Ownerson',
    });
    const pa = await asUser(a.username);
    const pb = await asUser(b.username);
    await Promise.all([pa.goto('/profile'), pb.goto('/profile')]);
    await expect(pa.locator('[data-ac-name]')).toHaveText('Alice Ownerson');
    await expect(pb.locator('[data-ac-name]')).toHaveText('Bob Ownerson');
    await expect(pa.locator('[data-account-card]')).not.toContainText('Bob');
    await expect(pb.locator('[data-account-card]')).not.toContainText('Alice');
    await expect(pa.locator('main h1')).toContainText('Alice Ownerson');
  });

  test('a person in 5 pods: the context line names the primary one, the card lists all five', async ({
    personas,
    asUser,
    seed,
    admin,
  }) => {
    const p = await personas.create({ ...PERSONAS.technician, label: 'pf7pods5' });
    const pods = [];
    for (let i = 0; i < 5; i++) pods.push(await seed.pod(undefined, [p.userId]));
    await admin.put(`/api/v1/pods/${pods[2].podId}/members/${p.userId}`, { isPrimary: true });
    const me = await asUser(p.username);
    for (const size of SIZES) {
      await me.setViewportSize(size);
      await me.goto('/profile');
      await expect(me.locator('[data-ac-pod]')).toHaveCount(5);
      await expect(me.locator('[data-page-description]')).toContainText(pods[2].name);
      await noHorizontalScroll(me);
      if (axeAvailable()) expect(await axeViolations(me), `5 pods at ${size.width}`).toEqual([]);
      if (size.width === 1366) await shot(me, 'pf7-five-pods');
    }
  });

  test('a pending person goes to Access Pending and a disabled one to the disabled page; /profile never shows a profile to either', async ({
    personas,
    asUser,
  }) => {
    const pending = await asUser((await personas.named('pending', { label: 'pf7pend' })).username);
    await pending.goto('/profile');
    await expect(pending).toHaveURL(/\/access-pending$/);
    await expect(pending.locator('[data-account-card]')).toHaveCount(0);
    if (axeAvailable()) expect(await axeViolations(pending), 'access pending').toEqual([]);

    const disabled = await asUser((await personas.named('disabled', { label: 'pf7dis' })).username);
    await disabled.goto('/profile');
    await expect(disabled.getByRole('heading', { name: 'Your account is disabled' })).toBeVisible();
    await expect(disabled.locator('[data-account-card]')).toHaveCount(0);
  });

  test('the 403 page at four sizes: no sideways scroll, axe 0, no toast', async ({
    personas,
    asUser,
  }) => {
    const p = await personas.create({ ...PERSONAS.clientViewOnly, label: 'pf7403' });
    const me = await asUser(p.username);
    for (const size of SIZES) {
      await me.setViewportSize(size);
      await me.goto('/profile');
      await expect(me.getByRole('heading', { name: FORBIDDEN, level: 1 })).toBeVisible();
      await noHorizontalScroll(me);
      if (axeAvailable()) expect(await axeViolations(me), `403 at ${size.width}`).toEqual([]);
      await expect(toasts(me)).toHaveCount(0);
      if (size.width === 1366 || size.width === 375) await shot(me, 'pf7-403');
    }
  });
});
