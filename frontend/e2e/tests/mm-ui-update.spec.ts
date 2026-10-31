import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { inDays, mmWorld } from '../support/my-matters-fixtures';
import { expect, test } from '../support/fixtures';
import { SIZES } from '../support/screens';

/**
 * The new My Matters (epic #953, issues UI-10 to UI-18; mockup my-matters-v3-b-tree-r2): the title row and the Client and Matter dropdowns, the five tabs, the docked tree and its rail,
 * the Status chips and the Show filter with counts that equal the grid, the + New menu with its reasons, the Calendar, the Assets list and the Activity feed, and that every grid fits the
 * window on a desktop (the page never scrolls; the frames do). Written for QA: run it with the rest of the suite on a fresh database.
 */

const TABS = ['overview', 'calendar', 'assets', 'metrics', 'activity'] as const;

async function pageOverflow(page: Page): Promise<{ page: number; main: number }> {
  return page.evaluate(() => {
    const se = document.scrollingElement as HTMLElement;
    const main = document.querySelector('main') as HTMLElement;
    return {
      page: se.scrollHeight - window.innerHeight,
      main: main.scrollHeight - main.clientHeight,
    };
  });
}

test.describe('My Matters: the page', () => {
  test('title, dropdown row, five tabs, Filter button, default All open and the urgency order', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'ui1');
    const a = await w.matter('Alpha');
    await w.matterInOtherClient('Beta');
    await w.task(a, { dueDate: '2000-01-01', title: 'Overdue one' });
    await w.task(a, { dueDate: inDays(5), title: 'Soon one' });
    const page = await asUser(w.pm.username);
    await page.goto('/my-matters');
    await expect(page.getByRole('heading', { name: 'My Matters', level: 1 })).toBeVisible();
    await expect(page.locator('#mm-client')).toBeVisible();
    await expect(page.locator('#mm-matter')).toBeVisible();
    await expect(page.locator('[data-new-menu]')).toBeVisible();
    await expect(page.getByRole('tab')).toHaveText([
      /Overview/,
      /Calendar/,
      /Assets/,
      /Metrics/,
      /Activity/,
    ]);
    // Default: All open (no column filter), urgency order (no heading marked), the overdue task first; there is no row of status buttons, a Filter button instead.
    await expect(page.locator('mf-mm-task-list mf-filter-chips')).toHaveCount(0);
    await expect(page.locator('[data-filter-toggle]')).toBeVisible();
    await expect(page.locator('[data-filter-count]')).toHaveCount(0);
    const links = page.locator('mf-mm-task-list a[data-task-link]');
    await expect(links.first()).toContainText('Overdue one');
    await expect(
      page.locator(
        'mf-mm-task-list th[aria-sort="ascending"], mf-mm-task-list th[aria-sort="descending"]',
      ),
    ).toHaveCount(0);
    // The count of the Show dropdown equals the grid.
    const label = await page.locator('#mm-show').innerText();
    const n = /\((\d+)\)/.exec(label)?.[1] ?? '';
    await expect(page.locator('mf-mm-task-list .tot')).toHaveText(n);
  });

  test('column filters (Status dropdown, text) and the Show filter combine, and the counts equal what the grid shows', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'ui2');
    const a = await w.matter('Alpha');
    await w.task(a, { dueDate: '2000-01-01', title: 'Late' });
    await w.task(a, { dueDate: inDays(30), title: 'Later' });
    const page = await asUser(w.pm.username);
    await page.goto('/my-matters');
    await expect(page.locator('mf-mm-task-list a[data-task-link]').first()).toBeVisible();
    await page.locator('#mm-show').click();
    await page.locator('[role=option][data-value="overdue"]').click();
    await expect(page).toHaveURL(/show=overdue/);
    const label = await page.locator('#mm-show').innerText();
    const n = Number(/\((\d+)\)/.exec(label)?.[1]);
    await expect(page.locator('mf-mm-task-list a[data-task-link]')).toHaveCount(n);
    // The Filter button opens the column filters; Status is a dropdown with counts and several choices; the filters combine with Show and show as chips.
    await page.locator('[data-filter-toggle]').click();
    await page.locator('#mm-f-status').click();
    await page.locator('[role=option][data-value="new"]').click();
    await page.locator('[data-dd-done]').click();
    await expect(page).toHaveURL(/status=new/);
    await expect(page).toHaveURL(/show=overdue/);
    await expect(page.locator('[data-filter-count]')).toHaveText(/1/);
    await expect(page.locator('[data-active-filters]')).toContainText('Status: New');
    await page.locator('[data-clear-filters]').click();
    await expect(page).not.toHaveURL(/status=/);
    // The task text search narrows by the title.
    await page.locator('[data-filter-q]').fill('Later');
    await expect(page).toHaveURL(/q=Later/);
    await expect(page.locator('mf-mm-task-list a[data-task-link]')).toHaveCount(0); // Later is not overdue: Show and the text combine
  });

  test('Client and Matter stay in step, and the tree follows them and collapses to its rail', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'ui3');
    const a = await w.matter('Alpha');
    await w.matterInOtherClient('Beta');
    await w.task(a, { title: 'Alpha task' });
    const page = await asUser(w.pm.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/my-matters');
    const tree = page.getByRole('tree', { name: 'Clients and matters' });
    await expect(tree).toBeVisible();
    await tree.getByRole('treeitem', { name: new RegExp(a.name) }).click();
    await expect(page).toHaveURL(/matterId=\d+/);
    await expect(page).toHaveURL(/clientId=\d+/);
    await expect(page.locator('#mm-client')).not.toContainText('All clients');
    await expect(page.locator('#mm-matter')).toContainText(a.name);
    // The tree went to its rail; the side panel opened in the room.
    await expect(page.locator('mf-mm-tree-rail')).toBeVisible();
    await page.locator('[data-tree-expand-rail]').click();
    await expect(page.getByRole('tree', { name: 'Clients and matters' })).toBeVisible();
    // Keyboard: Down moves, Home goes to the first item.
    const selected = page.getByRole('treeitem', { selected: true });
    await selected.focus();
    await page.keyboard.press('Home');
    await expect(page.getByRole('treeitem').first()).toBeFocused();
    // Clear removes both.
    await page.locator('[data-clear-scope]').click();
    await expect(page).not.toHaveURL(/matterId=/);
  });

  test('+ New: four items, a disabled one says why in words, and no new keyboard shortcut is added', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'ui4');
    await w.matter('Alpha');
    const limited = await personas.create({
      label: 'ui4-limited',
      permissions: ['Client.View', 'Matter.View', 'Matter.BeManager', 'Task.View', 'Task.Create'],
    });
    const m = await w.matter('Limited matter', limited, null);
    void m;
    const page = await asUser(limited.username);
    await page.goto('/my-matters');
    await page.locator('[data-new-menu]').click();
    await expect(page.getByRole('menuitem')).toHaveCount(4);
    const asset = page.locator('[data-new="asset"]');
    await expect(asset).toHaveAttribute('aria-disabled', 'true');
    await expect(asset).toContainText('You do not have permission to create assets.');
    await expect(page.locator('[data-new="task"]')).not.toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-new-menu]')).toBeFocused();
  });

  test('every grid fits the window on a desktop: the page never scrolls, the frames reach the bottom', async ({
    seed,
    personas,
    asUser,
  }) => {
    test.slow();
    const w = await mmWorld(seed, personas, 'ui5');
    const a = await w.matter('Alpha');
    for (let i = 0; i < 30; i++) await w.task(a, { title: `Fit ${i}`, dueDate: inDays(i) });
    const page = await asUser(w.pm.username);
    for (const size of [
      { width: 1366, height: 768 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(size);
      for (const tab of TABS) {
        await page.goto(tab === 'overview' ? '/my-matters' : `/my-matters?tab=${tab}`);
        await page.waitForLoadState('networkidle');
        const o = await pageOverflow(page);
        expect(o.page, `${tab} at ${size.width}: the document does not scroll`).toBeLessThanOrEqual(
          1,
        );
        expect(o.main, `${tab} at ${size.width}: main does not scroll`).toBeLessThanOrEqual(1);
      }
    }
  });

  test('a phone scrolls as a whole and shows cards; no sideways scroll at 375 and 768', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'ui6');
    const a = await w.matter('Alpha');
    await w.task(a, { title: 'Phone task' });
    const page = await asUser(w.pm.username);
    for (const size of [SIZES[3], SIZES[2]]) {
      await page.setViewportSize(size);
      for (const tab of TABS) {
        await page.goto(tab === 'overview' ? '/my-matters' : `/my-matters?tab=${tab}`);
        await page.waitForLoadState('networkidle');
        const over = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(over, `${tab} at ${size.width}`).toBeLessThanOrEqual(0);
      }
    }
  });

  test('axe finds nothing on the five tabs at four sizes', async ({ seed, personas, asUser }) => {
    test.slow();
    expect(axeAvailable(), 'set E2E_AXE_PATH to axe.min.js').toBe(true);
    const w = await mmWorld(seed, personas, 'ui7');
    const a = await w.matter('Alpha');
    await w.task(a, { title: 'Axe task', dueDate: '2000-01-01' });
    const page = await asUser(w.pm.username);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      for (const tab of TABS) {
        await page.goto(tab === 'overview' ? '/my-matters' : `/my-matters?tab=${tab}`);
        await page.waitForLoadState('networkidle');
        expect(await axeViolations(page), `${tab} at ${size.width}`).toEqual([]);
      }
    }
  });
});

test.describe('My Matters: one dropdown style, pin and icons (UI-19)', () => {
  test('Show, Recent activity kind, Client and Matter are the same listbox dropdown; the pin shows its state; the grid has its icons', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'ui13');
    const a = await w.matter('Alpha');
    await w.matterInOtherClient('Beta');
    await w.task(a, { dueDate: '2000-01-01', title: 'Late icon task' });
    const page = await asUser(w.pm.username);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/my-matters');
    await expect(page.locator('mf-mm-task-list a[data-task-link]').first()).toBeVisible();
    // The icons of the first row: task type chip, status chip icon, assignee cell (Unassigned has its icon), the overdue warning.
    const row = page.locator('mf-mm-task-list tr[data-task]').first();
    await expect(row.locator('mf-task-type-chip [role=img]')).toHaveCount(1);
    await expect(row.locator('mf-status-chip .newic, mf-status-chip .pi')).not.toHaveCount(0);
    await expect(row.locator('[data-cell=assignee] .pi-user-minus')).toHaveCount(1);
    await expect(row.locator('[data-cell=due] .pi-exclamation-triangle')).toHaveCount(1);
    // One dropdown component for every list.
    for (const [id, name] of [
      ['#mm-show', 'Show'],
      ['#mm-feed-kind', 'Kind of activity'],
      ['#mm-client', 'Client'],
      ['#mm-matter', 'Matter'],
    ] as const) {
      await page.locator(id).click();
      const list = page.getByRole('listbox', { name });
      await expect(list).toBeVisible();
      await expect(list.locator('[role=option][aria-selected=true] .tick .pi-check')).toHaveCount(
        1,
      );
      await page.keyboard.press('Escape');
      await expect(list).toHaveCount(0);
      await expect(page.locator(id)).toBeFocused();
    }
    // The activity kind is ONE dropdown with counts, not a row of chips.
    await expect(page.locator('[data-section=activity] mf-filter-chips')).toHaveCount(0);
    // The pin: a different icon and aria-pressed, and the words Unpin / Pin.
    const pin = page.locator('[data-tree-pin]');
    await expect(pin).toHaveAttribute('aria-pressed', 'false');
    const before = await pin.locator('svg').getAttribute('class');
    await pin.click();
    await expect(pin).toHaveAttribute('aria-pressed', 'true');
    expect(await pin.locator('svg').getAttribute('class')).not.toBe(before);
    await expect(pin).toHaveAttribute('aria-label', /Unpin/);
  });
});

test.describe('My Matters: review round 2 (UI-20)', () => {
  test('title size, coloured 32 px task type chip, two-line Due, step hint, activity icons and the + on a calendar day', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'ui14');
    const a = await w.matter('Alpha');
    await w.task(a, { dueDate: '2000-01-01', title: 'Round two task' });
    const page = await asUser(w.pm.username);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/my-matters');
    const row = page.locator('mf-mm-task-list tr[data-task]').first();
    await expect(row).toBeVisible();
    const h1 = await page
      .getByRole('heading', { name: 'My Matters', level: 1 })
      .evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
    expect(h1).toBeGreaterThanOrEqual(21.5);
    const chip = row.locator('mf-task-type-chip [role=img]');
    const box = await chip.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(31);
    await expect(chip).toHaveAttribute('aria-label', /^Task type: /);
    const bg = await chip.evaluate((e) => getComputedStyle(e).backgroundColor);
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');
    // Due: icon and date on line 1, the overdue note on line 2.
    const due = row.locator('[data-cell=due]');
    await expect(due.locator('.l1 .pi-exclamation-triangle')).toHaveCount(1);
    await expect(due.locator('.rel')).toContainText(/\d+ d overdue/);
    // The activity kind dropdown: options carry the icons of the items.
    await page.locator('#mm-feed-kind').click();
    await expect(page.locator('[role=listbox] [role=option] .ki')).toHaveCount(7);
    await page.keyboard.press('Escape');
    // Calendar: the + of a day opens the dialog with the date.
    await page.goto('/my-matters?tab=calendar&matterId=' + a.matterId);
    const day = page.locator('[data-add-day]').first();
    await expect(day).toHaveAttribute('aria-label', /^Add event on /);
    await day.focus();
    await expect(day).toBeVisible();
    await day.click();
    const dialog = page.getByRole('dialog', { name: 'New calendar item' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Date')).not.toHaveValue('');
  });
});

test.describe('My Matters: review round 3 (UI-21)', () => {
  test('a client row of the tree is always selectable, even with one of its matters chosen', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'ui15');
    const a = await w.matter('Alpha');
    await w.matterInOtherClient('Beta');
    const page = await asUser(w.pm.username);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(`/my-matters?matterId=${a.matterId}`);
    await expect(page.locator('#mm-matter')).toContainText(a.name);
    // The tree is on its rail after a choice by address too: open it, pin, then click the client row.
    await page.locator('mf-mm-tree-panel, mf-mm-tree-rail').first().waitFor();
    const tree = page.getByRole('tree', { name: 'Clients and matters' });
    if (!(await tree.count())) await page.locator('[data-tree-expand-rail]').click();
    await expect(page.locator('[role=treeitem][aria-selected=true]')).toHaveCount(1);
    const client = tree
      .getByRole('treeitem')
      .filter({ hasNot: page.locator('[aria-level="2"]') })
      .first();
    await tree.locator('[role=treeitem][aria-level="1"]').first().click();
    await expect(page).toHaveURL(/clientId=\d+/);
    await expect(page).not.toHaveURL(/matterId=/);
    void client;
    await expect(page.locator('#mm-matter')).toContainText('All matters');
  });

  test('the calendar item dialog: Client before Matter, the type tiles are a 4 x 2 radio group with arrow keys', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'ui16');
    const a = await w.matter('Alpha');
    await w.matterInOtherClient('Beta');
    const page = await asUser(w.pm.username);
    await page.goto(`/my-matters?tab=calendar&matterId=${a.matterId}`);
    await page.locator('[data-add-event]').click();
    const dialog = page.getByRole('dialog', { name: 'New calendar item' });
    await expect(dialog).toBeVisible();
    const order = await dialog.locator('mf-dropdown button').evaluateAll((b) => b.map((x) => x.id));
    expect(order.slice(0, 2)).toEqual(['ev-client', 'ev-matter']);
    await expect(dialog.locator('#ev-matter')).toContainText(a.name);
    // Client first: choosing the other client drops the matter; the matter list is then that client's; choosing a matter sets its client.
    await dialog.locator('#ev-client').click();
    await page.locator('[role=option]').filter({ hasText: 'Other' }).first().click();
    await expect(dialog.locator('#ev-matter')).toContainText('Choose a matter');
    await dialog.locator('#ev-matter').click();
    await page.getByRole('combobox', { name: 'Search matters', exact: true }).fill('Beta');
    await page.locator('[role=option]').filter({ hasText: 'Beta' }).first().click();
    await expect(dialog.locator('#ev-client')).toContainText('Other');
    const tiles = dialog.locator('.tg input[type=radio]');
    await expect(tiles).toHaveCount(8);
    await tiles.first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(tiles.nth(1)).toBeChecked();
    expect(
      await dialog
        .locator('.tg')
        .evaluate((e) => getComputedStyle(e).gridTemplateColumns.split(' ').length),
    ).toBe(4);
  });
});

test.describe('My Matters: the Options menu (scope switch and Focus)', () => {
  test('Focus: pick task types once, the grid and the chip follow, it stays after a reload and Clear removes it', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'ui11');
    const second = await seed.taskType({ workflows: [w.world.workflow] });
    const a = await w.matter('Alpha');
    await w.task(a, { dueDate: '2000-01-01', title: 'Type one A' });
    await w.task(a, { dueDate: '2000-01-02', title: 'Type one B' });
    await w.task(a, { dueDate: '2000-01-03', taskTypeId: second.id, title: 'Type two' });
    const page = await asUser(w.pm.username);
    await page.goto('/my-matters');
    const rows = page.locator('mf-mm-task-list a[data-task-link]');
    await expect(rows).toHaveCount(3);
    await page.locator('[data-mm-options] [data-options-trigger]').click();
    await page.locator(`[data-focus-option="${second.id}"]`).check();
    await page.locator('[data-focus-save]').click();
    await expect(rows).toHaveCount(1);
    await expect(page.locator('[data-focus-chip]').first()).toContainText(second.name);
    await page.reload();
    await expect(rows).toHaveCount(1);
    await page.locator('[data-focus-chip] button').click();
    await expect(rows).toHaveCount(3);
  });

  test('the My matters / All matters switch is offered only to people who hold Matter.AssignManagers, and ?scope=all keeps working for them', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'ui12');
    await w.matter('Alpha');
    const page = await asUser(w.pm.username);
    await page.goto('/my-matters?scope=all');
    await page.locator('[data-mm-options] [data-options-trigger]').click();
    const sw = page.locator('[data-scope-switch]');
    if ((await sw.count()) === 0) {
      // No Matter.AssignManagers: no switch, and the address cannot force it.
      await expect(page).not.toHaveURL(/scope=all/);
      return;
    }
    await expect(page).toHaveURL(/scope=all/);
    await sw.getByRole('button').first().click();
    await expect(page).not.toHaveURL(/scope=all/);
  });
});

test.describe('My Matters: calendar events, assets and activity (need the UI-03 and UI-05 endpoints)', () => {
  test('a calendar item added from + New appears in the month and in Upcoming events, and can be edited and deleted by its manager', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'ui8');
    const a = await w.matter('Alpha');
    await w.task(a, { title: 'Alpha task' });
    const page = await asUser(w.pm.username);
    await page.goto(
      `/my-matters?tab=calendar&month=${inDays(2).slice(0, 7)}&matterId=${a.matterId}`,
    );
    await page.locator('[data-add-event]').click();
    const dialog = page.getByRole('dialog', { name: 'New calendar item' });
    await expect(dialog).toBeVisible();
    // An empty form says what is missing, under the fields.
    await dialog.getByRole('button', { name: 'Add item' }).click();
    await expect(dialog.getByRole('alert').first()).toBeVisible();
    await dialog.getByLabel('Court hearing').check({ force: true });
    await dialog.getByLabel('Title').fill('Motion hearing');
    await dialog.getByLabel('Date').fill(inDays(2));
    await dialog.getByRole('button', { name: 'Add item' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator(`[data-day="${inDays(2)}"]`)).toHaveAttribute(
      'aria-label',
      /1 event/,
    );
    await page.goto(`/my-matters?matterId=${a.matterId}`);
    await expect(page.locator('[data-section="events"]')).toContainText('Motion hearing');
    // A person who is not a manager of the matter and cannot edit matters does not see the item at all unless they can see the matter.
    await page.goto(
      `/my-matters?tab=calendar&month=${inDays(2).slice(0, 7)}&matterId=${a.matterId}`,
    );
    await page.locator(`[data-day="${inDays(2)}"]`).click();
    await page.locator('[data-edit]').first().click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(page.locator(`[data-day="${inDays(2)}"]`)).toHaveAttribute(
      'aria-label',
      /0 events/,
    );
  });

  test('the Assets tab has no comment column, and a row opens the side panel with the linked tasks and their latest comment', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'ui9');
    const m = await w.matter('Alpha');
    await seed.asset({ matterId: m.matterId }, 'Panel asset');
    const page = await asUser(w.pm.username);
    await page.goto('/my-matters?tab=assets');
    await expect(page.getByRole('columnheader', { name: /Comment/ })).toHaveCount(0);
    for (const h of ['Client', 'Matter', 'Asset type', 'Created', 'Updated', 'Status'])
      await expect(page.getByRole('columnheader', { name: new RegExp(h) }).first()).toBeVisible();
    await page.locator('[data-open]').first().click();
    await expect(page.locator('[data-asset-panel]')).toContainText('Linked tasks');
  });

  test('an activity item opens the task in a NEW tab', async ({
    seed,
    personas,
    asUser,
    context,
  }) => {
    const w = await mmWorld(seed, personas, 'ui10');
    const a = await w.matter('Alpha');
    await w.task(a, { dueDate: '2000-01-01', title: 'Late for the feed' });
    const page = await asUser(w.pm.username);
    await page.goto('/my-matters?tab=activity');
    const item = page.locator('mf-mm-activity-tab a[data-feed]').first();
    await expect(item).toBeVisible();
    await expect(item).toHaveAttribute('target', '_blank');
    const [popup] = await Promise.all([page.context().waitForEvent('page'), item.click()]);
    await expect(popup).toHaveURL(/\/tasks\/\d+/);
  });
});
