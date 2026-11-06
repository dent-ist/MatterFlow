import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Seeder, uid } from '../support/seed';
import { dateInZone, FIRM_ZONE } from '../support/time';

/**
 * Pod Work strip (QA 2026-10-23): the hover fill of a strip item was `var(--mf-surface-2, var(--mf-border))`, a token that does not exist, so it
 * was always the border grey and the red Overdue text on it measured 4.16:1. The pointer rests on the Overdue item and axe must find nothing.
 * Desktop only (1366x768, D-82); the phone-card tests that lived beside this one were deleted with the phone layout (#1268).
 */
async function axeClean(page: Page, what: string): Promise<void> {
  if (axeAvailable()) expect(await axeViolations(page), what).toEqual([]);
}

/** A Pod Lead in a Pod with one overdue task of theirs, all tagged so the list can be filtered with `q=<tag>`. */
async function persona(seed: Seeder) {
  const me = await seed.user(['Pod Lead'], 'qc');
  const pod = await seed.pod(undefined, [me.userId]);
  const world = await seed.world();
  const tag = uid();
  await seed.task(world, {
    title: `Alpha ${tag}`,
    assignedPodId: pod.podId,
    assignedUserId: me.userId,
    dueDate: dateInZone(FIRM_ZONE, -3),
  });
  return { username: me.username, podId: pod.podId, tag };
}

test.describe('Pod Work strip hover', () => {
  test('the Overdue item of the strip keeps readable text while the pointer is on it (1366)', async ({
    seed,
    asUser,
  }) => {
    const px = await persona(seed);
    const page = await asUser(px.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/pods/work?podId=${px.podId}&q=${px.tag}`);
    const overdue = page.locator('[data-strip-item="overdue"].alert');
    await expect(overdue).toBeVisible();
    await overdue.hover();
    await axeClean(page, 'hovered Overdue item at 1366');
  });
});
