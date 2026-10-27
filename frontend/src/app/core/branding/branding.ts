/**
 * Application branding (epic #850, BR-04): the name and the icon an administrator chose on Administration > Settings > Branding.
 *
 * This file is read by `main.ts` before the first render, so it is tiny and has no Angular, `api-client` or `lookup-store` imports
 * (bundle rule; `initial-bundle.spec.ts` checks it). It keeps the current branding in a module-level holder (a plain object plus listeners),
 * which the `BrandingService` signal facade and the pure `documentTitle()` read. Everything here is defensive: a failed fetch, a slow API,
 * a blocked `localStorage` or an unexpected answer all end in the built-in `MatterFlow` and the built-in icon, never in an error or a blank title.
 */

/** The built-in name; also what a reset restores and what the static `index.html` says. */
export const DEFAULT_APP_NAME = 'MatterFlow';

/** The kinds of custom icon the server accepts. */
export type IconKind = 'png' | 'svg' | 'ico';

/** What `GET /api/v1/branding` returns (a local type: the generated client is never imported here). */
export interface Branding {
  appName: string;
  /** Address of the custom icon (with `?v=<version>`), or null while the built-in icons are used. */
  iconUrl: string | null;
  iconKind: IconKind | null;
  version: string;
}

export const DEFAULT_BRANDING: Branding = Object.freeze({
  appName: DEFAULT_APP_NAME,
  iconUrl: null,
  iconKind: null,
  version: '',
});

/** Where the last known branding is kept so a repeat visit never flashes the default name or icon. */
export const BRANDING_STORAGE_KEY = 'mf.branding.v1';

/** The address the server uses for the custom icon; anything else is ignored (the value is used in an image and in the page's icon links). */
const ICON_URL = /^\/api\/v1\/branding\/icon\?v=[0-9a-f]{12}$/;
// eslint-disable-next-line no-control-regex -- the point of the check is to refuse control characters
const NAME_FORBIDDEN = /[\u0000-\u001f\u007f<>]/;
const NAME_MAX = 40;
const FETCH_TIMEOUT_MS = 1500;
const ENDPOINT = '/api/v1/branding';

/** The links the static `index.html` ships; restored when a custom icon is reset. */
const BUILT_IN_LINKS: readonly Record<string, string>[] = [
  { rel: 'icon', type: 'image/svg+xml', href: 'favicon.svg' },
  { rel: 'icon', type: 'image/png', sizes: '32x32', href: 'favicon-32.png' },
  { rel: 'icon', type: 'image/x-icon', sizes: '16x16 32x32 48x48', href: 'favicon.ico' },
  { rel: 'apple-touch-icon', href: 'apple-touch-icon.png' },
];

const ICON_MIME: Record<IconKind, string> = {
  png: 'image/png',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
};

let current: Branding = DEFAULT_BRANDING;
const listeners = new Set<(branding: Branding) => void>();

/** The branding in force right now (never null). */
export function currentBranding(): Branding {
  return current;
}

/** The application name in force right now. */
export function appName(): string {
  return current.appName;
}

/** Calls `listener` whenever the branding is applied; returns the function that stops it. */
export function onBrandingChange(listener: (branding: Branding) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A checked `Branding` from an unknown value (the server answer or the stored copy), or null when it is not one. */
export function parseBranding(raw: unknown): Branding | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const name = typeof r['appName'] === 'string' ? r['appName'].trim() : '';
  if (name.length === 0 || name.length > NAME_MAX || NAME_FORBIDDEN.test(name)) return null;
  const iconUrl = r['iconUrl'] ?? null;
  const kind = r['iconKind'] ?? null;
  if (iconUrl !== null && (typeof iconUrl !== 'string' || !ICON_URL.test(iconUrl))) return null;
  if (kind !== null && kind !== 'png' && kind !== 'svg' && kind !== 'ico') return null;
  if ((iconUrl === null) !== (kind === null)) return null;
  const version = typeof r['version'] === 'string' ? r['version'] : '';
  return { appName: name, iconUrl, iconKind: kind, version };
}

/**
 * Makes `branding` the one in force: the holder, the document's bare title, the page icon links and the listeners. The route title strategy
 * adds the page part on the next navigation (`<Page>: <Tab> - <Application name>`).
 */
export function applyBranding(branding: Branding): void {
  const previousName = current.appName;
  current = branding;
  try {
    if (typeof document !== 'undefined') {
      syncTitle(previousName, branding.appName);
      syncIconLinks(branding);
    }
  } catch {
    // The page keeps whatever it had; branding must never break startup.
  }
  for (const listener of [...listeners]) listener(branding);
}

/** Stores the branding as the last known copy (a blocked or full `localStorage` is ignored). */
export function rememberBranding(branding: Branding): void {
  try {
    localStorage.setItem(BRANDING_STORAGE_KEY, JSON.stringify(branding));
  } catch {
    // private window, blocked site data or quota: the app works without the copy
  }
}

function readRemembered(): Branding | null {
  try {
    const text = localStorage.getItem(BRANDING_STORAGE_KEY);
    return text === null ? null : parseBranding(JSON.parse(text));
  } catch {
    return null;
  }
}

/**
 * The startup read: applies the last known copy at once (so a repeat visit never flashes the default), then asks the server (plain `fetch`,
 * 1.5 second limit) and applies and remembers the answer. Never throws and never waits longer than the limit; with the API down or slow the
 * app starts with what it has (the copy, or `MatterFlow` and the built-in icon).
 */
export async function loadBranding(): Promise<Branding> {
  const remembered = readRemembered();
  if (remembered) applyBranding(remembered);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // `no-cache`: ask the server on every page load (a cheap 304 while nothing changed) instead of trusting the 60 second browser copy, so
    // an administrator who just saved never sees the old name come back after a reload, and nobody waits a minute for a change.
    const response = await fetch(ENDPOINT, {
      headers: { Accept: 'application/json' },
      cache: 'no-cache',
      signal: controller.signal,
    });
    if (response.ok) {
      const fetched = parseBranding(await response.json());
      if (fetched) {
        applyBranding(fetched);
        rememberBranding(fetched);
      }
    }
  } catch {
    // offline, API down, timed out or not JSON: keep what is applied
  } finally {
    clearTimeout(timer);
  }
  return current;
}

/** Swaps the name in the current title (`Clients - Old` becomes `Clients - New`, a bare `Old` becomes `New`); the router writes the page part itself. */
function syncTitle(previousName: string, name: string): void {
  const title = document.title;
  if (title === previousName || title === DEFAULT_APP_NAME || title === '') document.title = name;
  else if (title.endsWith(` - ${previousName}`))
    document.title = title.slice(0, title.length - previousName.length) + name;
}

function syncIconLinks(branding: Branding): void {
  const head = document.head;
  const managed = head.querySelectorAll<HTMLLinkElement>('link[data-mf-icon]');
  const key = branding.iconUrl ?? '';
  const appliedKey = managed.length > 0 ? (managed[0].getAttribute('data-mf-icon') ?? '') : null;

  if (key === '' && appliedKey === null) return; // built-in links from index.html are still untouched
  if (key !== '' && appliedKey === key) return;

  managed.forEach((link) => link.remove());
  if (key === '') {
    for (const spec of BUILT_IN_LINKS) head.appendChild(makeLink(spec));
    return;
  }

  // A custom icon replaces every built-in icon link (a leftover built-in one would win in some browsers).
  head
    .querySelectorAll<HTMLLinkElement>('link[rel~="icon"], link[rel="apple-touch-icon"]')
    .forEach((link) => link.remove());
  const kind = branding.iconKind as IconKind;
  head.appendChild(makeLink({ rel: 'icon', type: ICON_MIME[kind], href: key }, key));
  // iOS cannot use an SVG or an ICO as a home-screen icon: only a PNG gets the apple-touch-icon link, otherwise there is none.
  if (kind === 'png') head.appendChild(makeLink({ rel: 'apple-touch-icon', href: key }, key));
}

function makeLink(spec: Record<string, string>, key?: string): HTMLLinkElement {
  const link = document.createElement('link');
  for (const [name, value] of Object.entries(spec)) link.setAttribute(name, value);
  if (key !== undefined) link.setAttribute('data-mf-icon', key);
  return link;
}
