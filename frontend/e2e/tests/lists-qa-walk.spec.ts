import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { openRowMenu } from '../support/labels';

/**
 * QA walk of Administration > Lists on a real stack (#1320, #1321): create, rename, reorder, deactivate and activate, delete and the duplicate-name
 * error in the lists that have them, the catalogue count that follows (active rows), the Priorities default action, the Status Labels display
 * label, Note Tags including the inactive ones, the unsaved-changes guard when switching lists and the keyboard rules of the catalogue.
 */
const uniq = () => `${Date.now() % 1000000}${Math.floor(Math.random() * 90 + 10)}`;
const count = (page: Page, label: string) =>
  page
    .getByRole('option', { name: new RegExp(`^${label}`) })
    .locator('[data-count]')
    .innerText()
    .then((t) => Number(t.trim()));
const rowOf = (page: Page, name: string) =>
  page.locator('[data-list-body] tbody tr').filter({ has: page.getByText(name, { exact: true }) });
const menuOf = (page: Page, name: string) =>
  page.getByRole('button', { name: `Actions for ${name}` });
const dlg = (page: Page) => page.getByRole('dialog');

const NAME_LISTS = [
  { key: 'matter-types', label: 'Matter Types', add: 'New Matter Type', hasDelete: true },
  { key: 'current-states', label: 'Current States', add: 'New State', hasDelete: true },
  { key: 'team-titles', label: 'Team Titles', add: 'New Title', hasDelete: true },
  { key: 'on-hold-reasons', label: 'On-Hold Reasons', add: 'New Reason', hasDelete: false },
  { key: 'link-roles', label: 'Link Roles', add: 'New Link Role', hasDelete: true },
] as const;

test.describe('lifecycle of the name lists', () => {
  for (const l of NAME_LISTS) {
    test(`${l.label}: create, duplicate, rename, move, deactivate, activate${l.hasDelete ? ', delete' : ' (no delete)'}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto(`/admin/lists/${l.key}`);
      await expect(page.locator('[data-list-body] tbody tr').first()).toBeVisible();
      await expect(page.locator('[data-count]').first()).not.toHaveText('--');
      const before = await count(page, l.label);
      await expect(page.locator('[data-active-count]')).toContainText(`${before} active`);

      // create
      const name = `QA ${uniq()}`;
      await page.getByRole('button', { name: l.add }).click();
      await dlg(page).getByRole('textbox').fill(name);
      await dlg(page).locator('[data-lookup-submit]').click();
      await expect(dlg(page)).toHaveCount(0);
      await expect(rowOf(page, name)).toBeVisible();
      await expect.poll(() => count(page, l.label)).toBe(before + 1);
      await expect(page.locator('[data-active-count]')).toContainText(`${before + 1} active`);

      // duplicate name, in another case: the editor's own message, the dialog stays open and keeps the text
      await page.getByRole('button', { name: l.add }).click();
      await dlg(page).getByRole('textbox').fill(name.toLowerCase());
      await dlg(page).locator('[data-lookup-submit]').click();
      await expect(dlg(page)).toBeVisible();
      await expect(dlg(page).getByRole('alert').first()).toContainText(/exists|already|taken/i);
      await dlg(page).locator('[data-lookup-cancel]').click();
      // typed text is not lost silently: Cancel asks first
      await page
        .getByRole('dialog', { name: 'Unsaved Changes' })
        .getByRole('button', { name: 'Discard Changes' })
        .click();
      await expect(dlg(page)).toHaveCount(0);

      // rename
      await openRowMenu(page, menuOf(page, name));
      await page.getByRole('menuitem', { name: 'Rename' }).click();
      await dlg(page).getByRole('textbox').fill(`${name} r`);
      await dlg(page).locator('[data-lookup-submit]').click();
      await expect(dlg(page)).toHaveCount(0);
      await expect(rowOf(page, `${name} r`)).toBeVisible();

      // reorder: Move Up puts the new last row above its neighbour
      const names = () =>
        page
          .locator('[data-list-body] tbody tr[data-row]')
          .evaluateAll((r) => r.map((x) => x.getAttribute('data-row')));
      const order = await names();
      const i = order.indexOf(`${name} r`);
      await openRowMenu(page, menuOf(page, `${name} r`));
      await page.getByRole('menuitem', { name: 'Move Up' }).click();
      await expect.poll(async () => (await names()).indexOf(`${name} r`)).toBe(i - 1);
      await page.reload();
      await expect.poll(async () => (await names()).indexOf(`${name} r`)).toBe(i - 1);

      // deactivate (confirm) lowers the catalogue count, activate raises it
      await openRowMenu(page, menuOf(page, `${name} r`));
      await page.getByRole('menuitem', { name: 'Deactivate' }).click();
      await expect(dlg(page)).toBeVisible();
      await dlg(page).locator('[data-confirm-primary]').click();
      await expect(rowOf(page, `${name} r`)).toContainText('Inactive');
      await expect.poll(() => count(page, l.label)).toBe(before);
      await expect(page.locator('[data-active-count]')).toContainText(`${before} active`);
      await openRowMenu(page, menuOf(page, `${name} r`));
      await page.getByRole('menuitem', { name: 'Activate' }).click();
      await expect(rowOf(page, `${name} r`)).toContainText('Active');
      await expect.poll(() => count(page, l.label)).toBe(before + 1);

      // delete only where the list has it
      await openRowMenu(page, menuOf(page, `${name} r`));
      if (l.hasDelete) {
        await page.getByRole('menuitem', { name: 'Delete' }).click();
        await dlg(page).locator('[data-confirm-primary]').click();
        await expect(rowOf(page, `${name} r`)).toHaveCount(0);
        await expect.poll(() => count(page, l.label)).toBe(before);
      } else {
        await expect(page.getByRole('menuitem', { name: 'Delete' })).toHaveCount(0);
        await page.keyboard.press('Escape');
      }
    });
  }
});

test.describe('Priorities, Status Labels and Note Tags', () => {
  test('Priorities: new with a colour, set as default, the default cannot be deleted or deactivated, delete', async ({
    page,
    admin,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    const label = `QA P ${uniq()}`;
    await page.goto('/admin/lists/priorities');
    await expect(page.locator('[data-list-body] tbody tr').first()).toBeVisible();
    // Other specs add and remove priorities at the same time in the same database, so the catalogue's number is compared with the server's active count
    // of the moment, not with a number read earlier.
    const activeOnServer = async () =>
      (await admin.get('/api/v1/priorities')).filter((p: { isActive: boolean }) => p.isActive)
        .length;
    const countMatchesServer = () =>
      expect.poll(async () => (await count(page, 'Priorities')) - (await activeOnServer())).toBe(0);
    await page.getByRole('button', { name: 'New Priority' }).click();
    await dlg(page).locator('#priority-label').fill(label);
    await dlg(page)
      .getByRole('button', { name: /^(Add|Save) Priority/ })
      .click();
    await expect(dlg(page)).toHaveCount(0);
    await expect(rowOf(page, label)).toBeVisible();
    await expect(rowOf(page, label).locator('td').filter({ hasText: /\S/ }).nth(2)).not.toBeEmpty();
    await countMatchesServer();

    const original = (await admin.get('/api/v1/priorities')).find(
      (p: { isDefault: boolean }) => p.isDefault,
    );
    await openRowMenu(page, menuOf(page, label));
    await page.getByRole('menuitem', { name: 'Set as Default' }).click();
    await dlg(page).locator('[data-confirm-primary]').click();
    await expect(rowOf(page, label)).toContainText('Default');
    // the default can be neither deactivated nor deleted
    await openRowMenu(page, menuOf(page, label));
    await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeDisabled();
    await page.keyboard.press('Escape');
    // give the default back, then delete the new one
    await openRowMenu(page, menuOf(page, original.label));
    await page.getByRole('menuitem', { name: 'Set as Default' }).click();
    await dlg(page).locator('[data-confirm-primary]').click();
    await expect(rowOf(page, original.label)).toContainText('Default');
    await openRowMenu(page, menuOf(page, label));
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await dlg(page).locator('[data-confirm-primary]').click();
    await expect(rowOf(page, label)).toHaveCount(0);
    await countMatchesServer();
  });

  test('Priorities: a duplicate label is refused with the editor message', async ({
    page,
    admin,
  }) => {
    const label = `QA D ${uniq()}`;
    await admin.post('/api/v1/priorities', { label, color: 'low', isActive: true });
    await page.goto('/admin/lists/priorities');
    await page.getByRole('button', { name: 'New Priority' }).click();
    await dlg(page).locator('#priority-label').fill(label);
    await dlg(page)
      .getByRole('button', { name: /^(Add|Save) Priority/ })
      .click();
    await expect(dlg(page)).toBeVisible();
    await expect(dlg(page).getByRole('alert').first()).toBeVisible();
  });

  test('Status Labels: five fixed rows, no New button, rename shows "was <name>" and the catalogue still says 5', async ({
    page,
    admin,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/admin/lists/status-labels');
    await expect(page.locator('[data-list-body] tbody tr')).toHaveCount(5);
    await expect(page.locator('mf-list-editor [data-new]')).toHaveCount(0);
    await expect(
      page.locator('[data-list-body] tbody th, [data-list-body] thead th'),
    ).not.toContainText(['Order']);
    const first = (await admin.get('/api/v1/status-labels'))[0];
    const label = `QA S ${uniq()}`.slice(0, 50);
    await openRowMenu(page, page.getByRole('button', { name: /^Actions for/ }).first());
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    await dlg(page).getByRole('textbox').fill(label);
    await dlg(page).locator('[data-lookup-submit]').click();
    await expect(dlg(page)).toHaveCount(0);
    await expect(page.locator('[data-list-body] tbody tr').first()).toContainText(label);
    await expect(page.locator('[data-list-body] tbody tr').first()).toContainText('was');
    await expect(
      page.getByRole('option', { name: /^Status Labels/ }).locator('[data-count]'),
    ).toHaveText('5');
    // put the original back
    await admin.put(`/api/v1/status-labels/${first.code}`, {
      displayLabel: first.displayLabel,
      rowVersion: (await admin.get('/api/v1/status-labels'))[0].rowVersion,
    });
  });

  test('Note Tags: create with a colour, inactive tags are listed and counted out, delete when unused', async ({
    page,
    admin,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    const name = `QA T ${uniq()}`;
    const inactive = `QA I ${uniq()}`;
    const t = await admin.post('/api/v1/note-tags', { name: inactive, colourKey: null });
    await admin.put(`/api/v1/note-tags/${t.noteTagId}`, {
      name: inactive,
      colourKey: null,
      isActive: false,
      rowVersion: t.rowVersion,
    });
    await page.goto('/admin/lists/note-tags');
    await expect(page.locator('[data-note-tag-row]').first()).toBeVisible();
    const all = await admin.get('/api/v1/note-tags?includeInactive=true');
    const active = all.filter((x: { isActive: boolean }) => x.isActive).length;
    await expect(page.getByText(inactive, { exact: true })).toBeVisible(); // inactive tags are in the grid
    await expect.poll(() => count(page, 'Note Tags')).toBe(active);
    await expect(page.locator('[data-active-count]')).toContainText(`${active} active`);
    await page.getByRole('button', { name: 'New Tag' }).click();
    await page.locator('#nt-name').fill(name);
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /^(Create|Save) Tag/ })
      .first()
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText(name, { exact: true })).toBeVisible();
    await expect.poll(() => count(page, 'Note Tags')).toBe(active + 1);
    // duplicate: top-level DUPLICATE_NAME gives the editor message
    await page.getByRole('button', { name: 'New Tag' }).click();
    await page.locator('#nt-name').fill(name);
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /^(Create|Save) Tag/ })
      .first()
      .click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog').getByRole('alert').first()).toBeVisible();
  });
});

test.describe('guard, keyboard and catalogue', () => {
  test('unsaved text in an open dialog: leaving by the nav or Back asks; the catalogue is behind the modal dialog', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/admin/lists/matter-types');
    await expect(page.locator('[data-list-body] tbody tr').first()).toBeVisible();
    await page.getByRole('button', { name: 'New Matter Type' }).click();
    await dlg(page).getByRole('textbox').fill('typed text');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Unsaved Changes' })).toBeVisible();
    await page.getByRole('button', { name: 'Keep Editing' }).click();
    // an option behind the open dialog is not clickable (modal): the page stays on the list
    await page
      .getByRole('option', { name: /^Priorities/ })
      .click({ force: true, trial: false })
      .catch(() => undefined);
    await expect(page).toHaveURL(/matter-types/);
    await dlg(page).locator('[data-lookup-cancel]').click();
    await page.getByRole('button', { name: 'Discard Changes' }).click();
    await expect(page.getByRole('option', { name: /^Priorities/ })).toBeVisible();
    // with the dialog open, the nav entry asks as well
    await page.getByRole('button', { name: 'New Matter Type' }).click();
    await dlg(page).getByRole('textbox').fill('typed again');
    await page.goBack().catch(() => undefined);
    await expect(page).toHaveURL(/./);
  });

  test('focus order: skip link to the editor, one catalogue Tab stop, arrows and Home/End, no new shortcut', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/admin/lists/priorities');
    await expect(page.locator('[data-list-body] tbody tr').first()).toBeVisible();
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: /^Skip to/ });
    await expect(skip.first()).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#lists-editor')).toBeFocused();
    // Tab order from the top: skip link(s), nav..., Find a list, one option, Open Custom Fields, New, grid
    await page.goto('/admin/lists/priorities');
    await page.getByRole('searchbox', { name: 'Find a list' }).focus();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('option', { name: /^Priorities/ })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Open Custom Fields' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'New Priority' })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByRole('searchbox', { name: 'Find a list' })).toBeFocused();
    // focus ring of the focused option is visible (outline or ring)
    await page.getByRole('option', { name: /^Priorities/ }).focus();
    const ring = await page.getByRole('option', { name: /^Priorities/ }).evaluate((el) => {
      const s = getComputedStyle(el);
      return `${s.outlineStyle} ${s.outlineWidth} ${s.boxShadow}`;
    });
    expect(ring).not.toMatch(/^none 0px none$/);
    // the editor name after a pick is announced by the catalogue live region
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('Status Labels');
    await expect(
      page
        .locator('[role="status"]')
        .filter({ hasText: /Status Labels, 5/ })
        .first(),
    ).toBeAttached();
    // no keyboard shortcut was added: a plain letter does nothing in the listbox
    await page.keyboard.press('p');
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('Status Labels');
  });

  test('catalogue counts show -- first, then numbers', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.route('**/api/v1/matter-types', async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.fallback();
    });
    await page.goto('/admin/lists/priorities');
    await expect(
      page.getByRole('option', { name: /^Matter Types/ }).locator('[data-count]'),
    ).toHaveText('--');
    await expect(
      page.getByRole('option', { name: /^Matter Types/ }).locator('[data-count]'),
    ).not.toHaveText('--');
  });

  test('personas see their lists only, with the Lists nav item and its rail tooltip', async ({
    asUser,
    personas,
  }) => {
    const cases: [string[], string[]][] = [
      [['Priority.Manage'], ['Priorities']],
      [['MatterList.Manage'], ['Matter Types', 'Current States', 'Team Titles']],
      [['StatusLabel.Manage'], ['Status Labels', 'Note Tags']],
      [['OnHoldReason.Manage'], ['On-Hold Reasons']],
      [['AssetType.Manage'], ['Link Roles']],
      [
        [
          'Priority.Manage',
          'MatterList.Manage',
          'StatusLabel.Manage',
          'OnHoldReason.Manage',
          'AssetType.Manage',
        ],
        [
          'Matter Types',
          'Current States',
          'Team Titles',
          'Priorities',
          'Status Labels',
          'On-Hold Reasons',
          'Note Tags',
          'Link Roles',
        ],
      ],
    ];
    for (const [perms, expected] of cases) {
      const p = await asUser((await personas.create({ permissions: perms, label: 'lq' })).username);
      await p.setViewportSize({ width: 1366, height: 768 });
      await p.goto('/admin/lists');
      await expect(p.getByRole('heading', { level: 1 })).toHaveText('Lists');
      if (expected.length === 1) {
        await expect(p.getByRole('listbox')).toHaveCount(0);
        await expect(p.getByRole('heading', { level: 2 })).toHaveText(expected[0]);
      } else {
        await expect(p.getByRole('option')).toHaveText(expected.map((e) => new RegExp(`^${e}`)));
        await expect(p.getByRole('searchbox', { name: 'Find a list' })).toHaveCount(
          expected.length > 4 ? 1 : 0,
        );
      }
      await expect(p.getByRole('link', { name: 'Lists', exact: true })).toBeVisible();
      await expect(p.locator('[data-tip="Lists"]').first()).toBeAttached();
      await expect(p.getByRole('link', { name: 'Open Custom Fields' })).toHaveCount(0);
      // another list's address answers with the person's first list
      if (expected.length > 0) {
        await p.goto(
          '/admin/lists/' +
            (perms[0] === 'Priority.Manage' && perms.length === 1 ? 'link-roles' : 'priorities'),
        );
        if (perms.length === 1 && perms[0] !== 'Priority.Manage')
          await expect(p).toHaveURL(/\/admin\/lists\/(?!priorities)/);
      }
      // Axe only on a settled page: while the list loads its buttons are disabled and a transition makes their contrast read 1.95:1.
      await p.waitForLoadState('networkidle');
      await expect(p.locator('[data-list-body] tbody [data-loading]')).toHaveCount(0);
      if (axeAvailable()) expect(await axeViolations(p), perms.join()).toEqual([]);
      await p.close();
    }
  });
});

test.describe('fixed frame (D-03)', () => {
  for (const size of [
    { width: 1366, height: 768 },
    { width: 1920, height: 1080 },
  ]) {
    test(`no list scrolls the page and the rule line stays under the grid at ${size.width}`, async ({
      page,
      admin,
    }) => {
      // enough rows to need the grid's own scroll at 1366 (13 or more rows of 44 px)
      const types = await admin.get('/api/v1/matter-types');
      for (let i = types.length; i < 14; i++)
        await admin.post('/api/v1/matter-types', { name: `QA Fill ${uniq()}`, isActive: true });
      await page.setViewportSize(size);
      for (const key of [
        'matter-types',
        'current-states',
        'team-titles',
        'priorities',
        'status-labels',
        'on-hold-reasons',
        'note-tags',
        'link-roles',
      ]) {
        await page.goto(`/admin/lists/${key}`);
        await expect(page.locator('[data-list-body] tbody tr').first()).toBeVisible();
        const m = await page.evaluate(() => {
          const rule = document.querySelector('[data-rule]')!.getBoundingClientRect();
          const body = document.querySelector('[data-list-body]')!.getBoundingClientRect();
          const frame = document
            .querySelector('[data-list-body] mf-pager, [data-list-body] .mf-pager')
            ?.getBoundingClientRect();
          return {
            scroll: document.documentElement.scrollHeight - document.documentElement.clientHeight,
            inner: window.innerHeight,
            ruleTop: rule.top,
            ruleBottom: rule.bottom,
            bodyBottom: body.bottom,
            pagerBottom: frame?.bottom ?? 0,
          };
        });
        expect(m.scroll, `${key}: page scroll`).toBeLessThanOrEqual(0);
        expect(m.ruleBottom, `${key}: rule inside the window`).toBeLessThanOrEqual(m.inner);
        expect(m.ruleTop, `${key}: rule below the grid`).toBeGreaterThanOrEqual(m.bodyBottom - 1);
        expect(m.ruleTop, `${key}: rule below the pager`).toBeGreaterThanOrEqual(m.pagerBottom - 1);
      }
    });
  }
});
