import catalogue from '../../../../../contracts/landing-pages.json';

/** One landing page of the catalogue (`contracts/landing-pages.json`, epic #1330): the stable key, its name as the navigation shows it, and the rule. */
export interface LandingPage {
  key: string;
  label: string;
  path: string;
  allOf: readonly string[];
  anyOf: readonly string[];
  dashboardTab: boolean;
}

/** The pages a role default or a personal choice may name, in navigation order (D-80). */
export const LANDING_PAGES: readonly LandingPage[] = catalogue.pages;

const DASHBOARD_TAB_PERMISSIONS: readonly string[] = catalogue.dashboardTabPermissions;

/**
 * The one test for "this permission set can open this page" (the navigation menu, the route guards and the API use the same rule; the API
 * evaluates the shipped catalogue, the browser needs it for permissions that are ticked but not saved yet): ALL of `allOf`, at least ONE of
 * `anyOf` (when it is not empty), and for the Dashboard a tab permission.
 */
export function canOpenPage(page: LandingPage, has: (code: string) => boolean): boolean {
  if (!page.allOf.every(has)) return false;
  if (page.anyOf.length > 0 && !page.anyOf.some(has)) return false;
  if (page.dashboardTab && !DASHBOARD_TAB_PERMISSIONS.some(has)) return false;
  return true;
}

/** The pages a holder of these permissions can open, in navigation order. */
export function openablePages(has: (code: string) => boolean): LandingPage[] {
  return LANDING_PAGES.filter((p) => canOpenPage(p, has));
}

/** The page of a stored key, or undefined for an unknown or empty key (an unknown key counts as "not set"). */
export function landingPageOf(key: string | null | undefined): LandingPage | undefined {
  return key ? LANDING_PAGES.find((p) => p.key === key) : undefined;
}

/** The name of a stored key as the navigation shows it; null for an unknown or empty key. */
export function landingLabel(key: string | null | undefined): string | null {
  return landingPageOf(key)?.label ?? null;
}
