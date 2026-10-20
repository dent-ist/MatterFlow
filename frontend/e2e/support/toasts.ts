import { Locator, Page } from '@playwright/test';

/** Every toast on the page (the one toast host of the app shell). */
export const toasts = (page: Page): Locator => page.locator('.p-toast-message');
