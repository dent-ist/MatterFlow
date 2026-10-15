import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { busyTaskPage } from '../pages/task-detail.page';
import { seedBusyTask } from '../support/busy-task';
import { expect, test } from '../support/fixtures';

/**
 * Screenshot and accessibility run for docs/ux/task-detail-v2 (not a test: skipped unless E2E_SCREENSHOTS is set to the output folder):
 *   E2E_SCREENSHOTS=docs/ux/task-detail-v2 E2E_SHOT_SUFFIX=after E2E_AXE=/path/to/axe.min.js frontend/e2e/run-local.sh -g "task detail v2 screenshots"
 * Seeds one busy task (long pasted email with a wide table, 6 steps, 12 comments, 8 assets) and photographs it at 1920x1080, 1366x768,
 * 1024x768 and 375x812 (full page and first screen). With the resizable layout it also drags the splitter to 40 % and 65 %. With `E2E_AXE`
 * every shot is also checked with axe and the run fails on a violation. `E2E_SHOT_SUFFIX` (before / after) names the files.
 */
const OUT = process.env['E2E_SCREENSHOTS'];
const AXE = process.env['E2E_AXE'];
const SUFFIX = process.env['E2E_SHOT_SUFFIX'] ?? 'after';

const SIZES = [
  { w: 1920, h: 1080 },
  { w: 1366, h: 768 },
  { w: 1024, h: 768 },
  { w: 375, h: 812 },
];

async function axeViolations(page: Page): Promise<string[]> {
  if (!AXE) return [];
  // Evaluated through the protocol: the app's Content Security Policy blocks an injected script tag.
  await page.evaluate(fs.readFileSync(AXE, 'utf8'));
  return page.evaluate(async () => {
    interface Violation {
      id: string;
      impact: string;
      nodes: { target: string[] }[];
    }
    const result = await (
      window as unknown as { axe: { run: () => Promise<{ violations: Violation[] }> } }
    ).axe.run();
    return result.violations.map(
      (v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
    );
  });
}

test.describe('task detail v2 screenshots', () => {
  test.skip(!OUT, 'set E2E_SCREENSHOTS to the output folder');

  test('capture', async ({ page, seed, admin }) => {
    test.setTimeout(300_000);
    fs.mkdirSync(OUT!, { recursive: true });
    const task = await seedBusyTask(seed, admin);
    const problems: string[] = [];

    for (const size of SIZES) {
      await page.setViewportSize({ width: size.w, height: size.h });
      const shoot = async (name: string, fullPage = true) => {
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(OUT!, `${name}-${SUFFIX}.png`), fullPage });
      };
      await busyTaskPage(page, task.taskId);
      await shoot(`${size.w}`);
      await shoot(`${size.w}-fold`, false);
      for (const v of await axeViolations(page)) problems.push(`${size.w}: ${v}`);

      const handle = page.getByRole('separator', { name: 'Resize Details panel' });
      if (size.w === 1366 && (await handle.count()) > 0) {
        for (const percent of [40, 65]) {
          const grid = (await page.locator('[data-detail-layout]').boundingBox())!;
          const box = (await handle.boundingBox())!;
          const x = box.x + box.width / 2;
          const y = Math.max(box.y + 40, 200);
          const target = grid.x + 8 + ((grid.width - 16) * percent) / 100;
          await page.mouse.move(x, y);
          await page.mouse.down();
          await page.mouse.move((x + target) / 2, y, { steps: 5 });
          await page.mouse.move(target, y, { steps: 5 });
          await page.mouse.up();
          await expect(handle).toHaveAttribute('aria-valuenow', String(percent));
          await shoot(`${size.w}-split-${percent}`);
          await shoot(`${size.w}-split-${percent}-fold`, false);
        }
        await handle.dblclick();
        await expect(handle).toHaveAttribute('aria-valuenow', '60');
      }
    }
    expect(problems).toEqual([]);
  });
});
