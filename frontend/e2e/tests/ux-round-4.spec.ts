import { Page } from '@playwright/test';
import { CreateTaskPage } from '../pages/create-task.page';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

/** Fixes of the UX / QA review round 4 (docs/ux/review-round-4.md, section "Round 4 fixes"). */

const pageOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** WCAG contrast ratio of two `rgb()` / `rgba()` strings (the background is assumed opaque). */
function contrast(fg: string, bg: string): number {
  const channels = (c: string) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
  const lum = (c: string) => {
    const [r, g, b] = channels(c).map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

test.describe('Round 4: layout and responsive', () => {
  test('UXR4-01: no page-level sideways scroll on Users at 375 px or on Audit Logs at 768 px', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    for (const path of ['/admin/users', '/admin/roles', '/admin/audit']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(await pageOverflow(page), `${path} at 375`).toBeLessThanOrEqual(0);
    }
    await page.setViewportSize({ width: 768, height: 900 });
    for (const path of ['/admin/audit', '/admin/users']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(await pageOverflow(page), `${path} at 768`).toBeLessThanOrEqual(0);
    }
  });

  test('UXR4-02: My Work, Task Queue and the matter Tasks grid fit at 1280 px with Status and Due visible; the Task Queue fits at 1024 px', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await seed.world();
    const me = await admin.get('/api/v1/me');
    const title = `Fit ${uid()}`;
    await seed.task(world, { title, assignedUserId: me.userId, dueDate: '2030-01-15' });
    const fits = async (path: string, width: number) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path);
      const wrap = page.locator('.wt-wrap');
      await expect(wrap).toBeVisible();
      await expect(page.locator('tr[data-task]').first()).toBeVisible();
      expect(
        await wrap.evaluate((el) => el.scrollWidth - el.clientWidth),
        `${path} at ${width}`,
      ).toBeLessThanOrEqual(1);
      for (const column of ['due', 'status']) {
        const cell = page.locator(`tr[data-task] td[data-col="${column}"]`).first();
        const cellBox = (await cell.boundingBox())!;
        const wrapBox = (await wrap.boundingBox())!;
        expect(
          cellBox.x + cellBox.width,
          `${column} inside the box at ${width}`,
        ).toBeLessThanOrEqual(wrapBox.x + wrapBox.width + 1);
      }
    };
    await fits('/my-work', 1280);
    await fits('/tasks', 1280);
    await fits(`/matters/${world.matter.matterId}`, 1280);
    await fits('/tasks', 1024);
    await fits('/my-work', 1024);
  });

  test('UXR4-02: the matter Tasks grid leaves out the repeated "Client / Matter" line; queues keep it', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    const task = await seed.task(world, { title: `Context ${uid()}` });
    await page.goto(`/matters/${world.matter.matterId}`);
    await expect(page.locator(`tr[data-task="${task.taskNumber}"]`)).toBeVisible();
    await expect(page.locator('[data-title-context]')).toHaveCount(0);
    await page.goto(`/tasks?q=${encodeURIComponent(task.title)}`);
    await expect(
      page.locator(`tr[data-task="${task.taskNumber}"] [data-title-context]`),
    ).toBeVisible();
  });

  test('UXR4-02: the "New" marker never cuts the title', async ({ page, seed, admin }) => {
    const world = await seed.world();
    const me = await admin.get('/api/v1/me');
    const title = `Intake: new custodian ${uid()}`;
    const task = await seed.task(world, { title, assignedUserId: me.userId });
    await page.setViewportSize({ width: 1280, height: 900 });
    // The marker shows for tasks assigned since the current visit began: the first use marks nothing, so start the visit a day ago.
    await page.addInitScript((userId) => {
      localStorage.setItem(
        `mf.my-work.visit.v2.${userId}`,
        JSON.stringify({ lastActiveAt: Date.now(), visitSince: Date.now() - 86_400_000 }),
      );
    }, me.userId);
    await page.goto('/my-work');
    const row = page.locator(`tr[data-task="${task.taskNumber}"]`);
    await expect(row).toBeVisible();
    const link = row.locator('a.wt-title');
    await expect(link).toHaveText(title);
    // Fully visible: nothing is clipped by an ellipsis or a line clamp.
    const clipped = await link.evaluate((el) => el.scrollHeight > el.clientHeight + 1);
    expect(clipped).toBe(false);
    const marker = row.locator('[data-new-marker]');
    if ((await marker.count()) > 0) {
      const [a, b] = [(await link.boundingBox())!, (await marker.boundingBox())!];
      expect(b.y).toBeGreaterThanOrEqual(a.y + a.height - 1); // under the title, not squeezing it
    }
  });

  test('UXR4-03: the task page H1 shows the task type icon only, not the section icon too', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    const task = await seed.task(world);
    await page.goto(`/tasks/${task.taskId}`);
    const h1 = page.getByRole('heading', { level: 1 });
    await expect(h1.locator('[data-title-icon]')).toBeVisible();
    await expect(h1.locator('i[data-page-icon]')).toHaveCount(0);
    await page.setViewportSize({ width: 375, height: 800 });
    const [icon, number] = [
      (await h1.locator('[data-title-icon]').boundingBox())!,
      (await h1.locator('[data-task-number]').boundingBox())!,
    ];
    expect(Math.abs(icon.y - number.y)).toBeLessThan(30); // on the same line as the number
  });

  test('UXR4-04: the Create Task type chooser uses the full width', async ({ page, seed }) => {
    await seed.world();
    await page.setViewportSize({ width: 1280, height: 900 });
    const create = new CreateTaskPage(page);
    await create.open();
    const chooser = (await create.chooser.boundingBox())!;
    expect(chooser.width).toBeGreaterThan(900);
  });

  test('UXR4-05: the Roles tab lists roles in a full-width table-like list', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/admin/roles');
    const list = page.getByRole('region', { name: 'Roles' });
    await expect(list).toBeVisible();
    expect((await list.boundingBox())!.width).toBeGreaterThan(700);
    const first = list.getByRole('button').first();
    await expect(first).toContainText('member');
    await first.click();
    await expect(page.locator('[data-editor]')).toBeVisible();
  });

  test('UXR4-06: Create and Edit say "Due date" and "Time (zone)" the same way', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    const task = await seed.task(world);
    const create = new CreateTaskPage(page);
    await create.open();
    await create.chooseTaskType(world.taskType.name);
    await expect(page.getByLabel('Due date', { exact: true })).toBeVisible();
    await expect(page.getByLabel(/^Time \(\w+\)$/)).toBeVisible();
    await page.goto(`/tasks/${task.taskId}`);
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit task details' });
    await expect(dialog.getByLabel('Due date', { exact: true })).toBeVisible();
    await expect(dialog.getByLabel(/^Time \(\w+\)$/)).toBeVisible();
    const [date, time] = [
      (await dialog.locator('label[for="td-due-date"]').boundingBox())!,
      (await dialog.locator('label[for="td-due-time"]').boundingBox())!,
    ];
    expect(Math.abs(date.y - time.y)).toBeLessThan(2); // the labels sit on one line
    expect(date.height).toBeLessThan(24); // and neither wraps
  });
});

test.describe('Round 4: task type icons', () => {
  async function openPicker(page: Page, taskTypeId: number): Promise<void> {
    await page.goto(`/admin/task-types/${taskTypeId}`);
    await page.locator('[data-icon-trigger]').click();
    await expect(page.getByRole('dialog', { name: 'Choose an icon' })).toBeVisible();
  }

  test('UXR4-07/08/11: a tall picker with category buttons, Esc returns focus to the opener, and the button name contains its visible text', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/admin/task-types/${world.taskType.id}`);
    const trigger = page.locator('[data-icon-trigger]');
    // UXR4-11: the accessible name holds the visible words "Document" and "Change icon".
    await expect(trigger).toHaveAccessibleName(/Icon.*Document.*Change icon/);
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Choose an icon' });
    await expect(dialog).toBeVisible();

    const scroll = dialog.locator('[data-icon-scroll]');
    await expect
      .poll(async () => (await scroll.boundingBox())!.height, { message: 'grid area height' })
      .toBeGreaterThan(400);
    const categories = dialog.getByRole('group', { name: 'Show category' });
    await expect(categories.getByRole('button')).toHaveCount(13); // All and the 12 categories
    await categories.getByRole('button', { name: /^Production/ }).click();
    await expect(dialog.getByRole('heading', { level: 3 })).toHaveText(['Production']);
    await expect(categories.getByRole('button', { name: /^Production/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await categories.getByRole('button', { name: /^All/ }).click();
    await expect(dialog.getByRole('heading', { level: 3 }).first()).toHaveText('General');

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();

    // The keyboard path too: open with Enter, close with Esc from the search box.
    await trigger.press('Enter');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('searchbox', { name: 'Search icons' }).fill('mail');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('UXR4-09: search puts exact and word-start matches before substrings ("tar" is TAR, not Star or Rocket)', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    await openPicker(page, world.taskType.id);
    const dialog = page.getByRole('dialog', { name: 'Choose an icon' });
    await dialog.getByRole('searchbox', { name: 'Search icons' }).fill('tar');
    const keys = await dialog
      .locator('[role=radio]')
      .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset['key']!));
    expect(keys[0]).toBe('robot'); // "Predictive coding": TAR is its keyword
    for (const weak of ['rocket', 'star']) {
      expect(keys.indexOf(weak), weak).toBeGreaterThan(keys.indexOf('target'));
    }
    await dialog.getByRole('searchbox', { name: 'Search icons' }).fill('email');
    const email = await dialog
      .locator('[role=radio]')
      .evaluateAll((els) => els.slice(0, 3).map((e) => (e as HTMLElement).dataset['key']!));
    expect(email[0]).toBe('mail');
    expect(email).not.toContain('microphone');
  });

  test('UXR4-10: no brand logos or duplicate labels; a retired brand key is refused by the API', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await seed.world();
    await openPicker(page, world.taskType.id);
    const dialog = page.getByRole('dialog', { name: 'Choose an icon' });
    const items = await dialog
      .locator('[role=radio]')
      .evaluateAll((els) =>
        els.map((e) => ({ key: (e as HTMLElement).dataset['key']!, label: e.textContent!.trim() })),
      );
    expect(items.length).toBe(300);
    expect(items.filter((i) => i.key.startsWith('brand-'))).toEqual([]);
    const labels = items.map((i) => i.label.toLowerCase());
    expect(labels.filter((l, i) => labels.indexOf(l) !== i)).toEqual([]);
    for (const word of ['Slack', 'Apple', 'AWS', 'Azure', 'WhatsApp', 'Facebook']) {
      expect(
        labels.filter((l) => l.includes(word.toLowerCase())),
        word,
      ).toEqual([]);
    }

    const type = await admin.get(`/api/v1/task-types/${world.taskType.id}`);
    const refused = await admin.raw('PUT', `/api/v1/task-types/${world.taskType.id}`, {
      name: type.name,
      description: type.description,
      iconKey: 'brand-slack',
      isActive: type.isActive,
      eligibleWorkflowIds: type.eligibleWorkflowIds,
      defaultWorkflowDefinitionId: type.defaultWorkflowDefinitionId,
      rowVersion: type.rowVersion,
    });
    expect(refused.status).toBe(400);
    expect(refused.body.errors.iconKey[0].code).toBe('UNKNOWN_ICON');
  });

  test('UXR4-09: the Create Task chooser finds "De-duplication" by "dedup" and ranks name matches first', async ({
    page,
    seed,
  }) => {
    const dedup = await seed.taskType({
      name: `De-duplication ${uid()}`,
      workflows: [await seed.workflow()],
    });
    // Named to come first alphabetically: only the ranking (a name match before a description match) can put it after the other one. The
    // shared database keeps the "De-duplication <token>" types of earlier runs, so the new one is not necessarily the first card.
    const other = await seed.taskType({
      name: `Aardvark ${uid()}`,
      description: 'Includes dedup of mailboxes',
      workflows: [await seed.workflow()],
    });
    const create = new CreateTaskPage(page);
    await create.open();
    await create.typeSearch.fill('dedup');
    const cards = page.locator('[data-type-cards] [role=radio]');
    await expect(page.locator(`[data-type-card="${dedup.name}"]`)).toBeVisible();
    await expect(page.locator(`[data-type-card="${other.name}"]`)).toBeVisible();
    await expect(cards.first()).toContainText('De-duplication');
    const order = await cards.evaluateAll((els) =>
      els.map((e) => e.getAttribute('data-type-card')),
    );
    expect(order.indexOf(dedup.name)).toBeGreaterThanOrEqual(0);
    expect(order.indexOf(dedup.name)).toBeLessThan(order.indexOf(other.name));
  });
});

test.describe('Round 4: administration naming', () => {
  const titles: [string, string, string | RegExp][] = [
    ['/admin/task-types', 'Task Types', 'Task Types - MatterFlow'],
    ['/admin/workflows', 'Task Types', 'Task Types - Workflows - MatterFlow'],
    ['/admin/steps', 'Task Types', 'Task Types - Workflow Steps - MatterFlow'],
    ['/admin/priorities', 'Labels', 'Labels - Priorities - MatterFlow'],
    ['/admin/status-labels', 'Labels', 'Labels - Status labels - MatterFlow'],
    ['/admin/custom-fields', 'Custom Fields', 'Custom Fields - MatterFlow'],
    ['/admin/audit', 'Audit Logs', 'Audit Logs - MatterFlow'],
    ['/admin/users', 'Users', 'Users - MatterFlow'],
    ['/admin/roles', 'Users', 'Users - Roles - MatterFlow'],
    [
      '/admin/asset-types',
      'Asset Types & Link Roles',
      'Asset Types & Link Roles - Asset Types - MatterFlow',
    ],
    [
      '/admin/asset-types?tab=link-roles',
      'Asset Types & Link Roles',
      'Asset Types & Link Roles - Link Roles - MatterFlow',
    ],
  ];

  for (const [path, heading, title] of titles) {
    test(`UXR4-12: ${path} has the H1 "${heading}" and the document title "${title}"`, async ({
      page,
    }) => {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
      await expect(page).toHaveTitle(title);
    });
  }

  test('UXR4-12: the document title follows the Users / Roles tab, and the admin Assets page says it is administration', async ({
    page,
  }) => {
    await page.goto('/admin/users');
    await expect(page).toHaveTitle('Users - MatterFlow');
    await page.getByRole('tab', { name: 'Roles' }).click();
    await expect(page).toHaveTitle('Users - Roles - MatterFlow');
    await page.goto('/admin/asset-types');
    await expect(
      page.getByRole('navigation', { name: 'Breadcrumb' }).getByText('Administration'),
    ).toBeVisible();
    // Two "Assets" items in the menu: the data list and the Administration one, which sits under the Administration heading.
    const admin = page
      .getByRole('list', { name: 'Administration' })
      .getByRole('link', { name: 'Assets' });
    await expect(admin).toHaveAttribute('href', '/admin/asset-types');
    await expect(admin).toHaveAttribute('aria-current', 'page');
  });

  test('UXR4-13: Asset Types has the same Name and Status column filters as the other lists', async ({
    page,
    admin,
  }) => {
    const name = `Findable ${uid()}`;
    await admin.post('/api/v1/asset-types', { name, description: null });
    await page.goto('/admin/asset-types');
    await page.getByRole('button', { name: /^Filters/ }).click();
    await page.getByRole('textbox', { name: 'Filter by Name' }).fill(name);
    await expect(page.locator('[data-types] tr[data-row]')).toHaveCount(1);
    await expect(page.locator(`[data-row="${name}"]`)).toBeVisible();
    await page.getByRole('combobox', { name: 'Filter by Status' }).selectOption('inactive');
    await expect(page.locator('[data-types] tr[data-row]')).toHaveCount(0);
  });

  test('UXR4-14: the Users tab opens on Pending access when people are waiting (product owner decision)', async ({
    page,
    seed,
  }) => {
    await seed.user([], 'waiting'); // no role: stays in Access Pending
    await page.goto('/admin/users');
    await page.getByRole('button', { name: /^Filters/ }).click();
    await expect(page.getByRole('combobox', { name: 'Filter by Status' })).toHaveValue('pending');
  });

  test('UXR4-15: a grouped audit row shows the Object it is about', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await seed.world();
    const task = await seed.task(world, { title: `Grouped ${uid()}` });
    // One edit that changes several fields is one operation with several audit events.
    await admin.put(`/api/v1/tasks/${task.taskId}`, {
      rowVersion: task.rowVersion,
      title: `${task.title} edited`,
      requestorName: 'Someone Else',
      description: 'A new description',
    });
    await page.goto('/admin/audit');
    await page.getByRole('button', { name: /^Filters/ }).click();
    await page.getByRole('combobox', { name: 'Filter by Object type' }).selectOption('Task');
    await page.getByRole('textbox', { name: 'Filter by Object id' }).fill(String(task.taskId));
    const group = page.locator('tr[data-group]').first();
    await expect(group).toBeVisible();
    const object = group.locator('[data-group-object]');
    await expect(object).toContainText(task.taskNumber);
    await expect(object.getByRole('link')).toHaveAttribute('href', `/tasks/${task.taskId}`);
  });

  test('UXR4-15: the Activity timeline names a pod without "(pod)"', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await seed.world();
    const pod = await seed.pod(`Wording Pod ${uid()}`, []);
    const task = await seed.task(world, { assignedPodId: pod.podId });
    await page.goto(`/tasks/${task.taskId}`);
    await page.getByRole('button', { name: 'Activity' }).click();
    const drawer = page.getByRole('dialog', { name: /^Activity:/ });
    await expect(drawer).toContainText(pod.name);
    await expect(drawer).not.toContainText('(pod)');
    expect(admin).toBeTruthy();
  });
});

test.describe('Round 4: queues, wording and accessibility', () => {
  test('UXR4-16: Filters and Columns have one height; Create matter lines up with the Filters button', async ({
    page,
    seed,
  }) => {
    await page.goto('/tasks');
    const [filters, columns] = [
      (await page.getByRole('button', { name: /^Filters/ }).boundingBox())!,
      (await page.getByRole('button', { name: 'Columns' }).boundingBox())!,
    ];
    expect(columns.height).toBe(filters.height);
    // "Sorted by", Columns, More filters and Filters are one bar directly above the grid (one line at this width).
    const header = (await page.locator('table thead').first().boundingBox())!;
    expect(Math.abs(columns.y - filters.y)).toBeLessThan(2);
    expect(columns.y + columns.height).toBeLessThanOrEqual(header.y + 1);

    const client = await seed.client();
    await page.goto(`/clients/${client.clientId}`);
    const [button, input] = [
      (await page.getByRole('button', { name: 'Create matter' }).boundingBox())!,
      (await page.getByRole('button', { name: /^Filters/ }).boundingBox())!,
    ];
    expect(
      Math.abs(button.y + button.height / 2 - (input.y + input.height / 2)),
      'centres line up',
    ).toBeLessThan(1.5);
    // The standard: icons on create actions only, so Edit has none.
    await expect(
      page.getByRole('button', { name: 'Edit', exact: true }).locator('.pi'),
    ).toHaveCount(0);
  });

  test('UXR4-17: the Task type breakdown lists the top 8 types before "Other task types"', async ({
    page,
    seed,
  }) => {
    for (let i = 0; i < 2; i++) await seed.task(await seed.world());
    await page.goto('/dashboard?tab=breakdowns');
    const card = page.getByRole('region', { name: 'Task type' });
    await expect(card.locator('li').first()).toBeVisible();
    expect(await card.locator('li').count()).toBeLessThanOrEqual(9);
  });

  test('UXR4-18: a task due today reads "Due today" in the header like the queues, and a Title or Ref filter sits in the filter row, not in a chip', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(
      new Date(),
    );
    const task = await seed.task(world, { dueDate: today });
    await page.goto(`/tasks/${task.taskId}`);
    await expect(page.locator('[data-due]')).toContainText('Due today');
    await expect(page.locator('[data-due]')).not.toContainText('Due soon');

    await page.goto(`/tasks?q=${encodeURIComponent(task.taskNumber)}`);
    // A link with a filter and no status asks for every status: the filter and "Status: All" are the two filters it carries.
    await expect(page.getByRole('button', { name: /^Filters/ })).toHaveText(
      /^\s*Filters\s*\(2\)\s*$/,
    );
    await expect(page.getByRole('textbox', { name: 'Filter by Title or Ref' })).toHaveValue(
      task.taskNumber,
    );
    // The column is on screen, so the filter is in the row and there is no chip for it.
    await expect(page.getByRole('list', { name: 'Active filters' })).toHaveCount(0);
  });

  test('UXR4-19: My Work tabs stay on one row at 375 px and the near-empty line shares the pager row', async ({
    page,
    seed,
    asUser,
  }) => {
    const tech = await seed.user(['Data Technician'], 'mywork');
    const world = await seed.world();
    await seed.task(world, { assignedUserId: tech.userId });
    const mine = await asUser(tech.username);
    await mine.setViewportSize({ width: 375, height: 800 });
    await mine.goto('/my-work');
    const tabs = mine.getByRole('tab');
    await expect(tabs).toHaveCount(4);
    const tops = await tabs.evaluateAll((els) =>
      els.map((e) => Math.round(e.getBoundingClientRect().top)),
    );
    expect(new Set(tops).size).toBe(1);
    expect(await pageOverflow(mine)).toBeLessThanOrEqual(0);

    await mine.setViewportSize({ width: 1280, height: 900 });
    const near = mine.locator('[data-near-empty]');
    await expect(near).toBeVisible();
    const pager = mine.getByRole('navigation', { name: 'Pagination' });
    const [n, p] = [(await near.boundingBox())!, (await pager.boundingBox())!];
    expect(Math.abs(n.y + n.height / 2 - (p.y + p.height / 2))).toBeLessThan(20);
    expect(page).toBeTruthy();
  });

  test('UXR4-20: every Activity drawer opens with focus on its Close button', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    const task = await seed.task(world);
    for (const path of [
      `/clients/${world.client.clientId}`,
      `/matters/${world.matter.matterId}`,
      `/tasks/${task.taskId}`,
    ]) {
      await page.goto(path);
      await page.getByRole('button', { name: 'Activity' }).click();
      const drawer = page.getByRole('dialog', { name: /^Activity:/ });
      await expect(drawer).toBeVisible();
      await expect(drawer.getByRole('button', { name: 'Close activity' }), path).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(drawer).toHaveCount(0);
    }
  });

  test('UXR4-21: the zero count of a My Work tab has at least 4.5:1 contrast', async ({ page }) => {
    await page.goto('/my-work');
    const zero = page.locator('.count--zero').first();
    await expect(zero).toBeVisible();
    const colors = await zero.evaluate((el) => {
      const walk = (node: Element | null): string => {
        for (let n = node; n; n = n.parentElement) {
          const bg = getComputedStyle(n).backgroundColor;
          if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
        }
        return 'rgb(255, 255, 255)';
      };
      return { fg: getComputedStyle(el).color, bg: walk(el) };
    });
    expect(contrast(colors.fg, colors.bg)).toBeGreaterThanOrEqual(4.5);
  });

  test('UXR4-21: toasts (Draft saved) have at least 4.5:1 contrast', async ({ page, seed }) => {
    const world = await seed.world();
    await page.goto(`/admin/task-types/${world.taskType.id}`);
    await page.locator('#tt-name').fill(`${world.taskType.name} renamed`);
    await page.locator('[data-save] button').click();
    const toast = page.locator('.p-toast-message-success').first();
    await expect(toast).toBeVisible();
    const colors = await toast.evaluate((el) => {
      const summary = el.querySelector('.p-toast-summary') ?? el;
      return { fg: getComputedStyle(summary).color, bg: getComputedStyle(el).backgroundColor };
    });
    // The tint is translucent over white; compare with the solid colour it blends to.
    const rgba = colors.bg.match(/[\d.]+/g)!.map(Number);
    const alpha = rgba[3] ?? 1;
    const solid = `rgb(${rgba
      .slice(0, 3)
      .map((c) => Math.round(c * alpha + 255 * (1 - alpha)))
      .join(',')})`;
    expect(contrast(colors.fg, solid)).toBeGreaterThanOrEqual(4.5);
  });

  test('UXR4-22: the global search landmark has its own name', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('search', { name: 'Search MatterFlow' })).toHaveCount(1);
    await page.goto('/admin/users');
    await expect(page.getByRole('button', { name: /^Filters/ })).toBeVisible();
    const searches = page.getByRole('search');
    const names = await searches.evaluateAll((els) =>
      els.map((e) => e.getAttribute('aria-label') ?? ''),
    );
    expect(names.filter((n) => n === 'Search MatterFlow')).toHaveLength(1);
    expect(new Set(names).size).toBe(names.length === 1 ? 1 : new Set(names).size);
  });
});
