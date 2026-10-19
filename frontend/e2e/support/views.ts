import { expect, Locator, Page } from '@playwright/test';

/**
 * The Task Queue's quick views (WP16, #220): a view is a button in the strip, or - when the toolbar's first line has no room for it, and
 * always for Recently completed - an item of the "More" menu. Tests choose a view by its key and do not care where it sits.
 */
export type ViewKey =
  | 'allOpen'
  | 'unassigned'
  | 'overdue'
  | 'dueSoon'
  | 'asap'
  | 'onHold'
  | 'myPod'
  | 'createdByMe'
  | 'recentlyCompleted';

export const VIEW_LABEL: Record<ViewKey, string> = {
  allOpen: 'All open',
  unassigned: 'Unassigned',
  overdue: 'Overdue',
  dueSoon: 'Due soon',
  asap: 'ASAP',
  onHold: 'On hold',
  myPod: 'My pod',
  createdByMe: 'Created by me',
  recentlyCompleted: 'Recently completed',
};

/** The `views` field of the response that holds a view's count. */
export const VIEW_FIELD: Record<ViewKey, string> = {
  allOpen: 'open',
  unassigned: 'unassigned',
  overdue: 'overdue',
  dueSoon: 'dueSoon',
  asap: 'asap',
  onHold: 'onHold',
  myPod: 'myPod',
  createdByMe: 'createdByMe',
  recentlyCompleted: 'recentlyCompleted',
};

/** The button of a view in the strip (absent when the view sits in More). */
export const stripView = (page: Page, key: ViewKey): Locator =>
  page.locator(`.qv > [data-view="${key}"]`);

/** The "More" menu button of the strip. */
export const moreButton = (page: Page): Locator => page.locator('.qv > [data-more-views]');

/** True when the view is a button in the strip right now. */
export async function inStrip(page: Page, key: ViewKey): Promise<boolean> {
  return (await stripView(page, key).count()) > 0;
}

/** Opens the More menu and returns the item of the view (the view must be in it). */
export async function openMore(page: Page, key: ViewKey): Promise<Locator> {
  if ((await moreButton(page).getAttribute('aria-expanded')) !== 'true') {
    await moreButton(page).click();
  }
  const item = page.locator(`mf-filter-popover [data-view="${key}"]`);
  await item.waitFor();
  return item;
}

/** Chooses a view wherever it is. */
export async function chooseView(page: Page, key: ViewKey): Promise<void> {
  if (await inStrip(page, key)) {
    await stripView(page, key).click();
  } else {
    await (await openMore(page, key)).click();
  }
}

/** True when the view is pressed: its strip button, or the More button when the view sits in the menu. */
export async function isPressed(page: Page, key: ViewKey): Promise<boolean> {
  if (await inStrip(page, key)) {
    return (await stripView(page, key).getAttribute('aria-pressed')) === 'true';
  }
  return (
    (await moreButton(page).getAttribute('data-view-in-more')) === key &&
    (await moreButton(page).getAttribute('aria-pressed')) === 'true'
  );
}

/** True when the view is offered to this person at all (in the strip or in More). */
export async function viewAvailable(page: Page, key: ViewKey): Promise<boolean> {
  if (await inStrip(page, key)) return true;
  const menu = page.locator('mf-filter-popover');
  const wasOpen = (await menu.count()) > 0;
  if (!wasOpen) {
    await moreButton(page).click();
    // The items are drawn a moment after the popover opens: count them only once the first one is there.
    await expect(page.locator('mf-filter-popover [data-view]').first()).toBeVisible();
  }
  const there = (await page.locator(`mf-filter-popover [data-view="${key}"]`).count()) > 0;
  if (!wasOpen) {
    // An Escape pressed before the popover has registered its key handler is lost (1 in 100 on a quiet machine): press until it closes.
    await expect(async () => {
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0, { timeout: 1000 });
    }).toPass({ timeout: 15_000 });
  }
  return there;
}
