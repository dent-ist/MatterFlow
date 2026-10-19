import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';

/**
 * Task Types administration: one form-page pattern for the Task Type, Workflow and Step edit pages (#361): the same 720 px card, the
 * same validation look (summary at the top, inline message with the icon, focus on the first invalid field) and one button component
 * (P5). Screenshots go to E2E_SCREENSHOTS (docs/ux/task-types-review/fixes/ty1-foundations).
 */
const OUT = process.env['E2E_SCREENSHOTS'];
const SIZES = [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
] as const;

interface FormPage {
  key: string;
  url: string;
  card: string;
  field: string;
  save: string;
  message: string;
}

const PAGES: FormPage[] = [
  {
    key: 'task-type',
    url: '/admin/task-types/new',
    card: 'form.edit',
    field: '#tt-name',
    save: 'Create task type',
    message: 'Enter a name.',
  },
  {
    key: 'workflow',
    url: '/admin/workflows/new',
    card: 'form.pg-form',
    field: '#wf-name',
    save: 'Create workflow',
    message: 'Enter a name.',
  },
  {
    key: 'step',
    url: '/admin/steps/new',
    card: 'form.pg-form',
    field: '#step-title',
    save: 'Create step',
    message: 'Enter a title.',
  },
];

async function atEverySize(page: Page, name: string): Promise<void> {
  for (const size of SIZES) {
    await page.setViewportSize(size);
    if (axeAvailable()) expect(await axeViolations(page), `${name} at ${size.width}`).toEqual([]);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${name}: page-level horizontal scroll at ${size.width}`).toBeLessThanOrEqual(
      0,
    );
    if (OUT) {
      fs.mkdirSync(OUT, { recursive: true });
      await page.screenshot({ path: path.join(OUT, `${name}-${size.width}x${size.height}.png`) });
    }
  }
}

test.describe('One form-page pattern for the three edit pages (#361)', () => {
  test('the three cards are 720 px wide where the window allows it', async ({ page }) => {
    for (const size of [SIZES[2], SIZES[3]]) {
      await page.setViewportSize(size);
      const widths: number[] = [];
      for (const p of PAGES) {
        await page.goto(p.url);
        await expect(page.locator(p.card)).toBeVisible();
        widths.push(Math.round((await page.locator(p.card).boundingBox())!.width));
      }
      expect(widths, `card widths at ${size.width}`).toEqual([720, 720, 720]);
    }
  });

  for (const p of PAGES) {
    test(`${p.key}: an empty save shows the summary, the message with its icon and focuses the first invalid field`, async ({
      page,
    }) => {
      await page.goto(p.url);
      await page.getByRole('button', { name: p.save }).click();
      const summary = page.locator('[data-summary]');
      await expect(summary).toBeVisible();
      await expect(summary).toHaveAttribute('role', 'alert');
      await expect(summary).toContainText('Fix the following to save:');
      await expect(summary.locator('li')).toHaveText([p.message]);
      await expect(page.locator(`${p.card} .pi-exclamation-circle`).first()).toBeVisible();
      await expect(page.locator(p.field)).toHaveAttribute('aria-invalid', 'true');
      await expect(page.locator(p.field)).toBeFocused();
      await atEverySize(page, `${p.key}-validation`);
    });
  }

  test('the header buttons of the three tabs are one component', async ({ page }) => {
    const metrics: { cls: string; h: number; r: string }[] = [];
    for (const [url, label] of [
      ['/admin/task-types', 'New task type'],
      ['/admin/workflows', 'New workflow'],
      ['/admin/steps', 'New step'],
    ]) {
      await page.goto(url);
      const button = page.getByRole('button', { name: label });
      await expect(button).toBeVisible();
      metrics.push(
        await button.evaluate((el) => ({
          cls: el.className.includes('p-button') ? 'p-button' : el.className,
          h: Math.round(el.getBoundingClientRect().height),
          r: getComputedStyle(el).borderRadius,
        })),
      );
    }
    expect(metrics.every((m) => m.cls === 'p-button')).toBe(true);
    expect(new Set(metrics.map((m) => m.h)).size).toBe(1);
    expect(new Set(metrics.map((m) => m.r)).size).toBe(1);
    await page.getByRole('button', { name: 'New step' }).click();
    await expect(page).toHaveURL(/\/admin\/steps\/new$/);
  });

  test('Cancel on the three pages is the same secondary button and leaves for the list', async ({
    page,
  }) => {
    for (const p of PAGES) {
      await page.goto(p.url);
      const cancel = page.getByRole('button', { name: 'Cancel' });
      await cancel.focus();
      await expect(cancel).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/admin\/(task-types|workflows|steps)$/);
    }
  });

  test('permission variants: each manager gets the pattern on the pages they may open; Task.View only gets the 403 page', async ({
    seed,
    asUser,
  }) => {
    const typeRole = await seed.role(['TaskType.Manage', 'Task.View'], 'Type only');
    const typePage = await asUser((await seed.user([typeRole.name], 'tt-ttonly')).username);
    await typePage.goto('/admin/task-types/new');
    await typePage.getByRole('button', { name: 'Create task type' }).click();
    await expect(typePage.locator('[data-summary] li')).toHaveText(['Enter a name.']);
    await expect(typePage.locator('#tt-name')).toBeFocused();

    const wfRole = await seed.role(['Workflow.Manage'], 'Workflow only');
    const wfPage = await asUser((await seed.user([wfRole.name], 'tt-wfonly')).username);
    for (const p of PAGES.filter((x) => x.key !== 'task-type')) {
      await wfPage.goto(p.url);
      await wfPage.getByRole('button', { name: p.save }).click();
      await expect(wfPage.locator(p.field)).toBeFocused();
    }
    await wfPage.goto('/admin/task-types/new');
    await expect(
      wfPage.getByRole('heading', { name: "You don't have permission to view this." }),
    ).toBeVisible();

    const viewerRole = await seed.role(['Task.View'], 'Viewer');
    const viewer = await asUser((await seed.user([viewerRole.name], 'tt-viewer')).username);
    for (const p of PAGES) {
      await viewer.goto(p.url);
      await expect(
        viewer.getByRole('heading', { name: "You don't have permission to view this." }),
      ).toBeVisible();
    }
  });
});
